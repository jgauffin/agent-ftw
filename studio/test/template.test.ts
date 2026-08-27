/**
 * @vitest-environment jsdom
 *
 * The template is a string, so nothing type-checks it. A stray `{{` or an
 * `if` on a path the context never supplies fails silently at render time and
 * shows up as a blank panel, which is the least debuggable failure the studio
 * has. These render it against real projected data and read the DOM back.
 */

import { describe, expect, it } from "vitest";
import { compileTemplate } from "@relax.js/core/html";
import { agent, checklist, phase, subAgent } from "../../src/declare/index.js";
import * as lib from "../../src/index.js";
import type { AgentLib } from "../src/runner/lib.js";
import { project } from "../src/runner/project.js";
import type { PendingPrompt, StudioState } from "../src/protocol.js";
import { fieldKey } from "../src/protocol.js";
import { RunModel } from "../src/run-model.js";
import { TEMPLATE } from "../src/webview/template.js";
import { buildContext } from "../src/webview/view-model.js";

const AGENT_LIB = lib as unknown as AgentLib;

const deliverable = {
  type: "object",
  properties: { answer: { type: "string", description: "The answer." } },
  required: ["answer"],
} as const;

const child = agent({
  name: "researcher",
  phases: [phase({ name: "look", prompt: "Look it up.", deliverable })],
});

const newsroom = agent({
  name: "newsroom",
  tools: [
    subAgent({
      name: "research",
      description: "Research a topic.",
      input: { type: "object", properties: {} } as const,
      agent: child,
    }),
  ],
  phases: [
    phase({
      name: "write",
      prompt: "Write the piece.",
      deliverable,
      turnBudget: 8,
      checklist: checklist({
        prompt: "Grade it.",
        schema: { type: "object", properties: { ok: { type: "boolean" } } } as const,
      }),
    }),
  ],
});

const WRITE = "newsroom/write";

function baseState(): StudioState {
  const { tree, findings } = project(AGENT_LIB, newsroom, 3);
  return {
    file: "/tmp/newsroom.ts",
    agents: [{ exportName: "newsroom", agentName: "newsroom", phaseCount: 1 }],
    selectedExport: "newsroom",
    tree,
    findings,
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
}

/** The inspector showing one named tab, which is how every feature is reached. */
function onTab(tab: string, patch: Partial<StudioState> = {}): StudioState {
  return { ...baseState(), tab, ...patch };
}

/** Every editable field of the fixture unlocked, as an all-literal file gives. */
function unlocked(): StudioState["locks"] {
  return {
    [fieldKey("newsroom", "agent", "role")]: { locked: false, reason: "" },
    [fieldKey(WRITE, "phase", "prompt")]: { locked: false, reason: "" },
    [fieldKey(WRITE, "phase", "turnBudget")]: { locked: false, reason: "" },
    [fieldKey(WRITE, "phase", "deliverable")]: { locked: false, reason: "" },
    [fieldKey(WRITE, "checklist", "prompt")]: { locked: false, reason: "" },
  };
}

/** Renders through the same context builder the panel uses, not a copy of it. */
function renderPanel(state: StudioState, pending: PendingPrompt | null = null, model = new RunModel()): HTMLElement {
  const host = document.createElement("div");
  const tpl = compileTemplate(TEMPLATE);
  host.appendChild(tpl.content);
  tpl.render(buildContext(state, model, pending) as never, {} as never);
  return host;
}

function tabLabels(host: HTMLElement): string[] {
  return [...host.querySelectorAll(".tabs .tab")].map((t) => t.textContent?.replace(/\s+/g, " ").trim() ?? "");
}

describe("the map is the navigator", () => {
  it("draws a box per agent, a row per phase, and an edge per declaration", () => {
    const host = renderPanel(baseState());

    expect([...host.querySelectorAll(".map .agent .node-name")].map((n) => n.textContent)).toEqual([
      "newsroom",
      "researcher",
    ]);
    expect([...host.querySelectorAll(".map .phase .node-name")].map((n) => n.textContent)).toEqual(["write", "look"]);
    expect(host.querySelectorAll(".map .edge")).toHaveLength(1);
  });

  it("lists an agent-wide sub-agent once, not once per phase", () => {
    // The compiler exposes an agent-level tool on every phase, so reading the
    // phases and the agent both would draw one declaration twice.
    const names = [...renderPanel(baseState()).querySelectorAll(".map .agent .node-name")].map((n) => n.textContent);
    expect(names.filter((n) => n === "researcher")).toHaveLength(1);
  });

  it("marks what is selected, since the map is where you moved from", () => {
    const host = renderPanel({ ...baseState(), selectedPath: WRITE });
    expect(host.querySelector(".map .phase.selected .node-name")?.textContent).toBe("write");
  });

  it("shows a phase's budget before a run and what it spent during one", () => {
    const before = renderPanel(baseState());
    expect([...before.querySelectorAll(".map .phase .node-note")].map((n) => n.textContent)).toContain("8 turns");

    const model = new RunModel();
    const ts = 1;
    model.apply({ type: "agent.start", ts, runId: "root", agent: "newsroom", detail: { parentRunId: null } });
    model.apply({ type: "phase.start", ts, runId: "root", agent: "newsroom", phase: "write", detail: {} });
    model.apply({ type: "model.turn", ts, runId: "root", agent: "newsroom", phase: "write", detail: {} });

    const during = renderPanel(baseState(), null, model);
    expect([...during.querySelectorAll(".map .phase .node-note")].map((n) => n.textContent)).toContain("1/8 turns");
  });
});

describe("the inspector shows one thing at a time", () => {
  it("offers the tabs an agent has, and not a phase's", () => {
    const labels = tabLabels(renderPanel({ ...baseState(), selectedPath: "newsroom" }));

    expect(labels.some((l) => l.startsWith("Settings"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Sub-agents"))).toBe(true);
    // An agent has no prompt of its own; the tab is absent rather than empty.
    expect(labels.some((l) => l.startsWith("Prompt"))).toBe(false);
  });

  it("offers the tabs a phase has, and not an agent's", () => {
    const labels = tabLabels(renderPanel({ ...baseState(), selectedPath: WRITE }));

    expect(labels.some((l) => l.startsWith("Prompt"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Deliverable"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Checklist"))).toBe(true);
    expect(labels.some((l) => l.startsWith("Sub-agents"))).toBe(false);
  });

  it("omits the checklist tab when the phase has none", () => {
    const labels = tabLabels(renderPanel({ ...baseState(), selectedPath: "newsroom>researcher/look" }));
    expect(labels.some((l) => l.startsWith("Checklist"))).toBe(false);
  });

  it("always offers the run, which is about the session rather than the selection", () => {
    expect(tabLabels(renderPanel({ ...baseState(), selectedPath: "newsroom" }))).toContainEqual("Run");
    expect(tabLabels(renderPanel({ ...baseState(), selectedPath: WRITE }))).toContainEqual("Run");
  });

  it("renders exactly one pane, so nothing else is competing for the room", () => {
    const host = renderPanel(onTab("prompt", { selectedPath: WRITE }));
    expect(host.querySelectorAll(".tab-body .pane")).toHaveLength(1);
  });

  it("falls back to the first tab the new selection has", () => {
    // Moving from a phase to an agent while on Prompt must not land on nothing.
    const host = renderPanel(onTab("prompt", { selectedPath: "newsroom" }));
    expect(host.querySelector(".tabs .tab.current")?.textContent).toContain("Settings");
    expect(host.querySelector(".agent-settings")).not.toBeNull();
  });

  it("keeps the tab when the new selection still has it", () => {
    const host = renderPanel(onTab("prompt", { selectedPath: "newsroom>researcher/look" }));
    expect(host.querySelector(".tabs .tab.current")?.textContent).toContain("Prompt");
  });
});

describe("the prompt tab gives the prompt the whole pane", () => {
  it("puts the declared value in the control, not an empty box", () => {
    const host = renderPanel(onTab("prompt", { selectedPath: WRITE, locks: unlocked() }));
    const prompt = host.querySelector<HTMLTextAreaElement>(".pane .card-prompt");

    expect(prompt?.textContent).toBe("Write the piece.");
    expect(prompt?.getAttribute("data-key")).toBe(fieldKey(WRITE, "phase", "prompt"));
    expect(prompt?.hasAttribute("disabled")).toBe(false);
    // `value` binds the DOM property, so reading the attribute would lie.
    expect(host.querySelector<HTMLInputElement>(".pane .card-budget")?.value).toBe("8");
  });

  it("still shows a locked value, and says what got in the way", () => {
    // Hiding what the panel will not let you change would make it useless in
    // exactly the codebases worth editing.
    const host = renderPanel(
      onTab("prompt", {
        selectedPath: WRITE,
        locks: { [fieldKey(WRITE, "phase", "prompt")]: { locked: true, reason: "Written as a function call." } },
      })
    );
    const prompt = host.querySelector<HTMLTextAreaElement>(".pane .card-prompt");

    expect(prompt?.textContent).toBe("Write the piece.");
    expect(prompt?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector(".pane .lock-reason")?.textContent).toContain("a function call");
  });
});

describe("the deliverable tab is where the schema is edited", () => {
  it("offers the deliverable as text and the rest read-only", () => {
    const host = renderPanel(onTab("deliverable", { selectedPath: WRITE, locks: unlocked() }));
    const titles = [...host.querySelectorAll(".schema-entry h4")].map((n) => n.textContent);

    expect(titles).toContain("Deliverable");
    expect(titles).toContain("Checklist");
    expect(titles).toContain("Tool input: research");
    // The injected phase-end tool restates the deliverable already above it.
    expect(titles).not.toContain("Tool input: finish_write");

    expect(host.querySelector<HTMLTextAreaElement>(".schema-edit")?.textContent).toContain('"answer"');
  });
});

describe("the tools tab says what can be called and what can be handed down", () => {
  it("shows what a phase can reach, injected tools included", () => {
    const tools = [...renderPanel(onTab("tools", { selectedPath: WRITE })).querySelectorAll(".tool-name")].map(
      (n) => n.textContent
    );
    expect(tools).toContain("finish_write");
    expect(tools).toContain("research");
  });

  it("shows an agent's own tools and what it may grant", () => {
    const host = renderPanel(onTab("tools", { selectedPath: "newsroom" }));
    expect([...host.querySelectorAll(".tool-name")].map((n) => n.textContent)).toContain("research");
    // Nothing is delegable here, and saying so beats an empty list.
    expect(host.querySelector(".pane .hint")?.textContent).toContain("may only declare tools");
  });

  it("offers a workspace tool by identifier, with the module to import it from", () => {
    const host = renderPanel(
      onTab("tools", {
        selectedPath: "newsroom",
        catalog: [
          {
            kind: "tool",
            identifier: "writeSource",
            name: "writeSource",
            description: "Write a file.",
            mutates: true,
            file: "/tmp/tools.ts",
            line: 1,
            exported: true,
          },
        ],
      })
    );
    const option = host.querySelector<HTMLOptionElement>(".assign-tool option");

    // A name is not a reference: only the identifier compiles.
    expect(option?.getAttribute("value")).toBe("writeSource");
    // Without the module, no import can be written.
    expect(option?.dataset["file"]).toBe("/tmp/tools.ts");
    expect(option?.textContent).toContain("writes");
    // The tree only holds what a phase can reach, so this is the only place a
    // tool wired to nothing shows up at all.
    expect(host.querySelector(".unwired")?.textContent).toContain("writeSource");
  });
});

describe("the sub-agents tab", () => {
  it("says whether a child's results are checked when it returns", () => {
    const card = renderPanel(onTab("subAgents", { selectedPath: "newsroom" })).querySelector(".sub-agent-card");

    expect(card?.querySelector(".card-name")?.textContent).toBe("research");
    // An unchecked child is the drift the acceptance mechanism exists to catch.
    expect(card?.textContent).toContain("results are not checked");
    expect(card?.classList.contains("unchecked")).toBe(true);
  });
});

describe("the settings tab", () => {
  it("shows the name as locked, because it is the address", () => {
    const host = renderPanel(onTab("settings", { selectedPath: "newsroom" }));
    const name = host.querySelector(".agent-settings dd.locked");

    expect(name?.textContent).toContain("newsroom");
    expect(name?.querySelector(".lock-reason")?.textContent).toContain("trace");
  });

  it("offers the role as the two values it can take, and the phases in order", () => {
    const host = renderPanel(onTab("settings", { selectedPath: "newsroom", locks: unlocked() }));

    expect([...host.querySelectorAll(".agent-settings option")].map((o) => o.textContent)).toEqual([
      "worker",
      "coordinator",
    ]);
    expect(host.querySelector(".agent-settings")?.textContent).toContain("write");
  });
});

describe("the run tab holds the diagnostics", () => {
  it("says nothing has run yet rather than showing an empty list", () => {
    expect(renderPanel(onTab("run")).querySelector(".timeline .hint")?.textContent).toContain("No run yet");
  });

  it("offers to pin a phase once it has produced something", () => {
    const model = new RunModel();
    const ts = 1;
    model.apply({ type: "agent.start", ts, runId: "root", agent: "newsroom", detail: { parentRunId: null } });
    model.apply({ type: "phase.start", ts, runId: "root", agent: "newsroom", phase: "write", detail: {} });

    expect(renderPanel(onTab("run"), null, model).querySelector(".timeline .pin")).toBeNull();

    model.apply({
      type: "phase.end",
      ts,
      runId: "root",
      agent: "newsroom",
      phase: "write",
      detail: { deliverable: { answer: "done" } },
    });
    expect(renderPanel(onTab("run"), null, model).querySelector(".timeline .pin")?.textContent).toBe(
      "Pin through here"
    );
  });

  it("names the phase a pinned run will start at", () => {
    const host = renderPanel(onTab("run", { pins: [{ phase: "write", json: '{"answer":"held"}', error: null }] }));
    // `write` is the only phase of `newsroom`, so pinning it leaves nothing.
    expect(host.querySelector(".pins .hint")?.textContent).toContain("nothing left to run");
  });
});

describe("the issues tab carries the lint findings", () => {
  it("names the field each finding is about, so two are told apart", () => {
    // Two undescribed strings in one deliverable produce findings whose message
    // and hint are word-for-word identical. Only the field separates them.
    const vague = agent({
      name: "planner",
      phases: [
        phase({
          name: "draft",
          prompt: "Produce ideas.",
          deliverable: {
            type: "object",
            properties: { title: { type: "string" }, summary: { type: "string" } },
            required: ["title", "summary"],
          } as const,
        }),
      ],
    });
    const { tree, findings } = project(AGENT_LIB, vague, 3);
    const host = renderPanel(onTab("issues", { tree, findings, selectedPath: "planner/draft" }));

    expect([...host.querySelectorAll(".findings .finding-field")].map((n) => n.textContent)).toEqual([
      "title",
      "summary",
    ]);
    // Pasting one at a time is not how anyone fixes these.
    expect(host.querySelector(".findings-actions .copy-all")).not.toBeNull();
  });

  it("is not offered at all when the selection is clean", () => {
    const labels = tabLabels(renderPanel({ ...baseState(), selectedPath: "newsroom>researcher/look" }));
    expect(labels.some((l) => l.startsWith("Issues"))).toBe(false);
  });
});

describe("changes are held until they are saved", () => {
  const staged: StudioState = onTab("settings", {
    selectedPath: "newsroom",
    edits: [
      {
        edit: { kind: "field", path: WRITE, construct: "phase", field: "turnBudget", value: 20 },
        display: "newsroom/write · turnBudget → 20",
      },
    ],
  });

  it("lists what will be written, and offers to save or drop it", () => {
    const host = renderPanel(staged);

    expect(host.querySelector(".pending-edits .pending-what")?.textContent).toContain("turnBudget → 20");
    expect(host.querySelector(".status-controls .save")).not.toBeNull();
    expect(host.querySelector(".status-controls .discard")).not.toBeNull();
    expect(host.querySelector(".status-controls .pending-count")?.textContent).toContain("1");
  });

  it("offers nothing to save when nothing is staged", () => {
    expect(renderPanel(baseState()).querySelector(".status-controls .save")).toBeNull();
    expect(renderPanel(baseState()).querySelector(".pending-edits")).toBeNull();
  });

  it("says why a save was refused, where the buttons are", () => {
    const host = renderPanel({ ...staged, editError: "Turn budget has to be a number." });
    expect(host.querySelector(".status-controls .edit-error")?.textContent).toContain("has to be a number");
  });
});

describe("a prompt the run is blocked on takes over the top of the panel", () => {
  it("renders the question and one button per option", () => {
    const pending: PendingPrompt = {
      kind: "ask",
      id: 1,
      prompt: "Which way?",
      options: ["left", "right"],
      mode: "single",
      agent: "newsroom",
      phase: "write",
    };
    const host = renderPanel(baseState(), pending);

    expect(host.querySelector(".prompt .question")?.textContent).toBe("Which way?");
    expect([...host.querySelectorAll(".prompt .options button")].map((b) => b.textContent)).toEqual(["left", "right"]);
  });

  it("shows what the model was doing before asking for more turns", () => {
    const pending: PendingPrompt = {
      kind: "budget",
      id: 2,
      request: {
        agent: "newsroom",
        phase: "write",
        runId: "root",
        depth: 0,
        limit: "run",
        originalBudget: 8,
        turnsUsed: 8,
        extensionsGranted: 1,
        suggestedExtension: 8,
        lastAssistantText: "still weighing two options",
        recentToolCalls: [{ name: "research", inputSummary: '{"topic":"x"}' }],
      },
    };
    const host = renderPanel(baseState(), pending);

    // A run-wide grant funds the whole tree, not just this phase.
    expect(host.querySelector(".prompt .warning")?.textContent).toContain("run-wide budget");
    // Deciding whether more turns help depends on knowing what it was doing.
    const facts = host.querySelector(".budget-facts")?.textContent ?? "";
    expect(facts).toContain("still weighing two options");
    expect(facts).toContain("research");
  });

  it("shows nothing at all when the run is not waiting on anyone", () => {
    expect(renderPanel(baseState(), null).querySelector(".prompt")).toBeNull();
  });
});
