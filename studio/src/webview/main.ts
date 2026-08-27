/**
 * The studio panel's UI.
 *
 * The webview holds no authority: the extension owns the state and the runner
 * owns the run. This renders what it is sent and posts back what the user
 * meant. The one thing it keeps for itself is a {@link RunModel}, fed by the
 * live trace stream, because folding events into a timeline as they arrive is
 * cheaper than shipping a rebuilt timeline on every event.
 */

import { compileTemplate } from "@relax.js/core/html";
import type { FromWebview, StudioState, ToWebview } from "../protocol.js";
import { RunModel } from "../run-model.js";
import { buildContext, type Control, type InputMode } from "./view-model.js";
import { readForm, type InputField } from "./input-form.js";
import { TEMPLATE } from "./template.js";

declare function acquireVsCodeApi(): { postMessage(msg: unknown): void };
const vscode = acquireVsCodeApi();

const model = new RunModel();
let state: StudioState = {
  file: null,
  agents: [],
  selectedExport: null,
  tree: null,
  findings: [],
  selectedPath: null,
  status: "idle",
  error: null,
  pending: null,
  output: undefined,
  pins: [],
  locks: {},
  edits: [],
  editError: null,
  catalog: [],
  tab: "settings",
};

const template = compileTemplate(TEMPLATE);
document.getElementById("app")!.appendChild(template.content);

function post(msg: FromWebview): void {
  vscode.postMessage(msg);
}

const handlers = {
  selectAgent: (e: Event) => post({ t: "selectAgent", exportName: (e.target as HTMLSelectElement).value }),
  select: (row: { path: string }) => post({ t: "select", path: row.path }),
  setTab: (tab: { id: string }) => post({ t: "setTab", tab: tab.id }),

  /**
   * Hold what was typed for the next save.
   *
   * Bound to `change` rather than `input`, which is the same choice the pin
   * textarea makes: the panel re-renders on every state update, and staging per
   * keystroke would redraw the control the user is still typing in.
   *
   * The raw string goes over as-is. Turning it into a number or a schema is the
   * extension's job, so a half-typed value is reported where every other
   * refusal is rather than being swallowed here.
   */
  stageField: (control: Control, event: Event) =>
    post({
      t: "stageEdit",
      edit: {
        kind: "field",
        path: control.path,
        construct: control.construct,
        field: control.field,
        value: valueOf(event.target),
      },
    }),
  stageRole: (control: Control, event: Event) => handlers.stageField(control, event),

  assign: (list: "tools" | "delegable") => {
    const picker = document.querySelector<HTMLSelectElement>(".assign-tool");
    const option = picker?.selectedOptions[0];
    if (!picker || !option) return;
    post({
      t: "stageEdit",
      edit: {
        kind: "assignTool",
        path: currentAgentPath(),
        list,
        identifier: picker.value,
        // The exporting module has to travel with the identifier: an import
        // cannot be written without knowing where the name comes from.
        fromFile: option.dataset["file"] ?? "",
      },
    });
  },

  unstage: (row: { index: number }) => post({ t: "unstageEdit", index: row.index }),
  discardEdits: () => post({ t: "discardEdits" }),
  saveDefinition: () => post({ t: "saveDefinition" }),
  reveal: () => {
    if (state.selectedPath) post({ t: "reveal", path: state.selectedPath });
  },
  run: () => post({ t: "run", input: currentInput() }),
  cancel: () => post({ t: "cancel" }),

  pinThrough: (row: { phase: string }) => post({ t: "pinThrough", phase: row.phase }),
  unpinAll: () => post({ t: "unpinAll" }),
  editPin: (pin: { phase: string }, event: Event) =>
    post({ t: "editPin", phase: pin.phase, json: (event.target as HTMLTextAreaElement).value }),

  useFields: () => {
    inputMode = "fields";
    render();
  },
  useText: () => {
    inputMode = "text";
    render();
  },

  // Copying goes through the extension: a webview's own clipboard access
  // depends on focus and permissions, and fails quietly when it does fail.
  copy: (f: { copyText: string; field: string }) =>
    post({ t: "copy", text: f.copyText, label: f.field }),
  copyAll: () => {
    const text = lastAllFindingsText;
    if (text) post({ t: "copy", text, label: "all issues" });
  },

  answerOption: (option: string) => {
    const pending = state.pending;
    if (pending?.kind !== "ask") return;
    post({ t: "askResult", id: pending.id, selected: [option] });
  },
  answerOther: () => {
    const pending = state.pending;
    if (pending?.kind !== "ask") return;
    post({ t: "askResult", id: pending.id, selected: [], other: freeTextValue() });
  },
  approve: () => {
    const pending = state.pending;
    if (pending?.kind !== "review") return;
    post({ t: "reviewApprove", id: pending.id });
  },
  revise: () => {
    const pending = state.pending;
    if (pending?.kind !== "review") return;
    const message = freeTextValue();
    if (!message) return;
    post({ t: "reviewRevise", id: pending.id, message });
    clearFreeText();
  },
  grant: () => {
    const pending = state.pending;
    if (pending?.kind !== "budget") return;
    post({ t: "budgetResult", id: pending.id, extendBy: budgetValue(pending.request.suggestedExtension) });
  },
  deny: () => {
    const pending = state.pending;
    if (pending?.kind !== "budget") return;
    post({ t: "budgetResult", id: pending.id, extendBy: null });
  },
};

window.addEventListener("message", (e: MessageEvent<ToWebview>) => {
  const msg = e.data;
  if (msg.t === "state") {
    if (msg.state.status === "running" && state.status !== "running") model.reset();
    state = msg.state;
  } else {
    model.apply(msg.event);
  }
  render();
});

/** Held for the copy-all handler, which has no row object to read it from. */
let lastAllFindingsText = "";
/** Held so Run can read the fields back without re-deriving them from the schema. */
let lastFields: readonly InputField[] = [];
/** Held for the assignment picker, which has no row object naming its agent. */
let lastDefinitionPath = "";
/**
 * Text unless the user asks for fields. A run normally receives an
 * instruction, so that is what the panel offers first.
 */
let inputMode: InputMode = "text";

/**
 * Redraw once a second while a run is going.
 *
 * A model call emits nothing between being made and being answered, so without
 * this the panel is genuinely motionless for as long as the model takes. The
 * elapsed time on the running phase is the only thing that says the run is
 * still alive, and it is worth a redraw a second to have it.
 */
let ticker: ReturnType<typeof setInterval> | null = null;

function retick(): void {
  const wanted = state.status === "running";
  if (wanted === (ticker !== null)) return;
  if (wanted) ticker = setInterval(render, 1000);
  else if (ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function render(): void {
  retick();
  const context = buildContext(state, model, state.pending, inputMode);
  lastAllFindingsText = String(context["allFindingsText"] ?? "");
  lastFields = (context["inputFields"] as InputField[]) ?? [];
  lastDefinitionPath = (context["definition"] as { path?: string } | null)?.path ?? "";
  // The casts are the one concession to the engine's `Context` type, which
  // does not admit readonly arrays or `unknown`-typed properties, both of
  // which the projected tree is full of, on purpose.
  template.render(context as never, handlers as never);
}

/**
 * What Run sends: the filled-in fields when that view is showing, otherwise
 * whatever was typed.
 */
function currentInput(): string | Record<string, unknown> {
  if (inputMode !== "fields" || lastFields.length === 0) {
    return (document.querySelector<HTMLTextAreaElement>(".run-input")?.value ?? "").trim();
  }
  return readForm(lastFields, (name) => {
    const el = document.querySelector<HTMLInputElement>(`.run-field[data-field="${CSS.escape(name)}"]`);
    return el ? { value: el.value, checked: el.checked } : null;
  });
}

/** Whatever the control holds, as the string it holds it as. */
function valueOf(target: EventTarget | null): string {
  const el = target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
  if (!el) return "";
  if (el instanceof HTMLInputElement && el.type === "checkbox") return String(el.checked);
  return el.value;
}

/**
 * The agent the definition view is about, which is what an assignment applies
 * to. A phase selection resolves to its owner, the same way the view itself
 * does, so assigning while a phase is selected still means its agent.
 */
function currentAgentPath(): string {
  return lastDefinitionPath;
}

function freeTextValue(): string {
  return (document.querySelector<HTMLTextAreaElement>(".prompt-text")?.value ?? "").trim();
}

function clearFreeText(): void {
  const el = document.querySelector<HTMLTextAreaElement>(".prompt-text");
  if (el) el.value = "";
}

function budgetValue(fallback: number): number {
  const raw = document.querySelector<HTMLInputElement>(".budget-amount")?.value;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

render();
// The extension cannot know when this script finished loading, and anything it
// posted before now was dropped. This is what tells it to send the state again.
post({ t: "ready" });
