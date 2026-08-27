/**
 * Turning what the user changed in the panel into edits.
 *
 * The panel stages changes and writes them as one batch, so this takes the
 * whole batch and either produces every edit or refuses the lot. Half a batch
 * is the one outcome worth ruling out: granting a mutating tool to a child
 * needs an entry in the child's `tools` and one in the parent's `delegable`,
 * and a file carrying only the first will not compile.
 *
 * Kept free of `vscode`, like {@link ../lint-fix.ts}, so which edits are
 * possible, what they are, and when to refuse is all testable without an
 * editor. The extension module above this one is glue.
 */

import {
  type AgentNode,
  type CatalogTool,
  type EditConstruct,
  type FieldLock,
  type PendingEdit,
  type ToolList,
  fieldKey,
} from "./protocol.js";
import type { LoadedFile, SourceReader, SourceSet } from "./source/parse.js";
import { type Address, arrayProperty, bind, resolveAddress, unwrapReference } from "./source/locate.js";
import { inventory } from "./source/inventory.js";
import {
  type EmitStyle,
  emitBoolean,
  emitNumber,
  emitPhase,
  emitSchema,
  emitString,
  scaffoldPhase,
  styleOf,
} from "./source/emit.js";
import {
  type EditOutcome,
  appendElement,
  applyEdits,
  extendNamedImport,
  ensureImport,
  insertProperty,
  ordered,
  removeElement,
  replace,
} from "./source/edit.js";
import { syntaxErrors } from "./source/verify.js";
import { check } from "./source/verify.js";
import { indentAt, type TextEdit } from "./source/text.js";

/** How a field's value is written back into source. */
export type FieldKind = "string" | "number" | "boolean" | "schema";

export interface EditableField {
  readonly construct: EditConstruct;
  readonly field: string;
  readonly kind: FieldKind;
  readonly label: string;
}

/**
 * What the panel may change, and nothing else.
 *
 * `name` is absent on purpose, on every construct. It is the address: renaming
 * it invalidates traces, persisted sessions, pins and lint paths in the same
 * edit, which is a refactor rather than a tweak and belongs to the editor's own
 * rename. `tools`, `adapter`, `handler`, `terminator` and `accept` are absent
 * because they hold live values or wire up structure.
 */
export const EDITABLE: readonly EditableField[] = [
  { construct: "agent", field: "role", kind: "string", label: "Role" },
  { construct: "phase", field: "prompt", kind: "string", label: "Prompt" },
  { construct: "phase", field: "turnBudget", kind: "number", label: "Turn budget" },
  { construct: "phase", field: "review", kind: "boolean", label: "Host review" },
  { construct: "phase", field: "phaseEndToolName", kind: "string", label: "Phase-end tool" },
  { construct: "phase", field: "deliverable", kind: "schema", label: "Deliverable" },
  { construct: "checklist", field: "prompt", kind: "string", label: "Checklist prompt" },
  { construct: "subAgent", field: "description", kind: "string", label: "Description" },
  { construct: "subAgent", field: "maxRejects", kind: "number", label: "Max rejects" },
];

export function editableField(construct: EditConstruct, field: string): EditableField | null {
  return EDITABLE.find((f) => f.construct === construct && f.field === field) ?? null;
}

/**
 * What a control produced, as the type the field actually holds.
 *
 * Every HTML control hands back a string, and the webview is deliberately not
 * the place that knows a turn budget is a number or that a deliverable is JSON.
 * Doing it here means the failure is reported where the rest of them are, in
 * the words the panel already shows.
 */
export function normalizeFieldValue(
  edit: Extract<PendingEdit, { kind: "field" }>
): { readonly value: unknown } | { readonly error: string } {
  const field = editableField(edit.construct, edit.field);
  if (!field) return { error: `\`${edit.field}\` is not a field the panel writes.` };
  if (typeof edit.value !== "string") return { value: edit.value };

  const text = edit.value.trim();
  switch (field.kind) {
    case "number": {
      const parsed = Number(text);
      return Number.isFinite(parsed) ? { value: parsed } : { error: `${field.label} has to be a number.` };
    }
    case "boolean":
      return { value: text === "true" || text === "on" };
    case "schema":
      try {
        return { value: JSON.parse(text) };
      } catch (e) {
        return { error: `${field.label} is not valid JSON: ${e instanceof Error ? e.message : e}` };
      }
    case "string":
      return { value: edit.value };
  }
}

/**
 * Which of an agent's fields can actually be written, resolved once against the
 * source when the tree is built.
 *
 * Doing this up front rather than at save time is what lets the panel disable a
 * control instead of accepting typing it is going to refuse. The cost is one
 * bind per editable field, over files the set has already cached.
 */
export async function fieldLocks(
  set: SourceSet,
  entryFile: string,
  tree: AgentNode
): Promise<Record<string, FieldLock>> {
  const out: Record<string, FieldLock> = {};

  const lockOf = async (path: string, construct: EditConstruct, field: string): Promise<void> => {
    try {
      const result = await bind(set, entryFile, { path, construct, field });
      out[fieldKey(path, construct, field)] = lockFrom(result);
    } catch (e) {
      out[fieldKey(path, construct, field)] = {
        locked: true,
        reason: e instanceof Error ? e.message : String(e),
      };
    }
  };

  for (const agent of agentsIn(tree)) {
    for (const field of EDITABLE.filter((f) => f.construct === "agent")) {
      await lockOf(agent.path, "agent", field.field);
    }
    for (const phase of agent.phases) {
      for (const field of EDITABLE.filter((f) => f.construct === "phase")) {
        await lockOf(phase.path, "phase", field.field);
      }
      if (phase.checklist) {
        for (const field of EDITABLE.filter((f) => f.construct === "checklist")) {
          await lockOf(phase.path, "checklist", field.field);
        }
      }
    }
    for (const tool of [...agent.tools, ...agent.phases.flatMap((p) => p.tools)]) {
      if (tool.kind !== "subAgent") continue;
      for (const field of EDITABLE.filter((f) => f.construct === "subAgent")) {
        await lockOf(tool.agent.path, "subAgent", field.field);
      }
    }
  }

  return out;
}

function lockFrom(result: Awaited<ReturnType<typeof bind>>): FieldLock {
  if (result.readOnly) {
    return { locked: true, reason: result.readOnlyReason ?? "Declared somewhere this may not rewrite." };
  }
  const binding = unwrapReference(result.binding);
  switch (binding.kind) {
    case "literal":
    case "concatenation":
    case "absent":
      return { locked: false, reason: "" };
    case "computed":
      return { locked: true, reason: `Written as ${readable(binding.expression)}, so it is shown but not edited here.` };
    case "ambiguous":
      return { locked: true, reason: binding.reason };
    default:
      return { locked: true, reason: "Behind more than one reference." };
  }
}

/** Every agent in the tree, each once. */
function agentsIn(tree: AgentNode): readonly AgentNode[] {
  const out: AgentNode[] = [];
  const seen = new Set<string>();
  const visit = (node: AgentNode): void => {
    if (seen.has(node.path)) return;
    seen.add(node.path);
    out.push(node);
    for (const tool of [...node.tools, ...node.phases.flatMap((p) => p.tools)]) {
      if (tool.kind === "subAgent") visit(tool.agent);
    }
  };
  visit(tree);
  return out;
}

/** Where a property should sit when it has to be inserted rather than replaced. */
const AFTER: Readonly<Record<string, string>> = {
  turnBudget: "tools",
  review: "turnBudget",
  phaseEndToolName: "name",
  role: "name",
  maxRejects: "agent",
};

/** A value the plan will read back out of the edited text before anything is written. */
export interface PlanCheck {
  readonly address: Address;
  readonly expected: string;
}

export interface EditPlan {
  readonly edits: readonly TextEdit[];
  readonly checks: readonly PlanCheck[];
}

export type PlanOutcome =
  | { readonly kind: "plan"; readonly plan: EditPlan }
  /** Nothing to write. Every staged change was already the case. */
  | { readonly kind: "no-change"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * Build the edits a batch of staged changes asks for.
 *
 * One refusal refuses the batch, and names which change caused it. The panel
 * disables a locked control, so reaching a refusal here means either a
 * concurrent source change or a bug, and neither is a reason to write the rest.
 */
export async function planEdits(
  set: SourceSet,
  entryFile: string,
  tree: AgentNode,
  staged: readonly PendingEdit[]
): Promise<PlanOutcome> {
  const edits: TextEdit[] = [];
  const checks: PlanCheck[] = [];
  const skipped: string[] = [];

  for (const edit of staged) {
    const outcome = await planOne(set, entryFile, tree, edit);
    if (outcome.kind === "refused") return { kind: "refused", reason: `${describe(edit)}: ${outcome.reason}` };
    if (outcome.kind === "no-change") {
      skipped.push(`${describe(edit)}: ${outcome.reason}`);
      continue;
    }
    edits.push(...outcome.plan.edits);
    checks.push(...outcome.plan.checks);
  }

  if (edits.length === 0) {
    return { kind: "no-change", reason: skipped.join(" ") || "Nothing was changed." };
  }

  const sorted = ordered(edits);
  return overlapping(sorted) ?? { kind: "plan", plan: { edits: sorted, checks } };
}

/**
 * Two edits claiming the same characters.
 *
 * Distinct fields always produce distinct spans, so this only fires on a bug.
 * It fires before anything is written rather than leaving a spliced file behind.
 */
function overlapping(sorted: readonly TextEdit[]): PlanOutcome | null {
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (previous.file === current.file && current.start < previous.end) {
      return { kind: "refused", reason: "Two of these changes rewrite the same characters." };
    }
  }
  return null;
}

async function planOne(
  set: SourceSet,
  entryFile: string,
  tree: AgentNode,
  edit: PendingEdit
): Promise<PlanOutcome> {
  switch (edit.kind) {
    case "field":
      return planField(set, entryFile, edit);
    case "addPhase":
      return planAddPhase(set, entryFile, tree, edit);
    case "assignTool":
      return planAssign(set, entryFile, tree, edit);
    case "unassignTool":
      return planUnassign(set, entryFile, edit);
  }
}

// ---------------------------------------------------------------------------
// Changing a declared value
// ---------------------------------------------------------------------------

async function planField(
  set: SourceSet,
  entryFile: string,
  edit: Extract<PendingEdit, { kind: "field" }>
): Promise<PlanOutcome> {
  const field = editableField(edit.construct, edit.field);
  if (!field) return { kind: "refused", reason: `\`${edit.field}\` is not a field the panel writes.` };

  const address: Address = { path: edit.path, construct: edit.construct, field: edit.field };
  const result = await bind(set, entryFile, address);
  if (result.readOnly) {
    return { kind: "refused", reason: result.readOnlyReason ?? "The value is not one this may rewrite." };
  }

  // A reference the walk followed puts the value in whichever file declared the
  // const, which `readOnly` has already vouched is this one and used once.
  const targetFile = result.binding.kind === "reference" ? result.binding.file : result.file;
  const file = await set.load(targetFile);
  if (!file) return { kind: "refused", reason: `${targetFile} could not be read.` };

  const binding = unwrapReference(result.binding);
  if (binding.kind === "computed") {
    return { kind: "refused", reason: `It is written as ${readable(binding.expression)}, not a literal.` };
  }
  if (binding.kind === "ambiguous") return { kind: "refused", reason: binding.reason };
  if (binding.kind === "reference") return { kind: "refused", reason: "The value is behind more than one reference." };

  const style = styleOf(file);

  if (binding.kind === "absent") {
    const text = emitValue(field, edit.value, style, binding.indent);
    if (text === null) return { kind: "refused", reason: `${JSON.stringify(edit.value)} is not a ${field.kind}.` };

    const node = await resolveAddress(set, entryFile, { path: edit.path, construct: edit.construct });
    if (node.kind !== "resolved") return { kind: "refused", reason: node.reason };

    const after = AFTER[edit.field];
    return {
      kind: "plan",
      plan: {
        edits: insertProperty(node.node.file, node.node.object, edit.field, text, after ? { after } : {}),
        checks: [{ address, expected: text }],
      },
    };
  }

  // The value's own line already spends columns on `prompt: `, so the emitter
  // is told where it starts or a long string wraps in the wrong place.
  const indent = indentAt(file.text, binding.range.start);
  const used = binding.range.start - lineStart(file.text, binding.range.start);
  const text = emitValue(field, edit.value, style, indent + style.step, used);
  if (text === null) return { kind: "refused", reason: `${JSON.stringify(edit.value)} is not a ${field.kind}.` };

  const current = file.text.slice(binding.range.start, binding.range.end);
  if (current === text) return { kind: "no-change", reason: "It already reads that way." };

  return {
    kind: "plan",
    plan: { edits: replace(targetFile, binding, text), checks: [{ address, expected: text }] },
  };
}

/**
 * A value as source text.
 *
 * Never with `as const`. A schema binding's range covers the object literal
 * alone, so the `as const` beside it is outside every edit and survives by
 * construction. Emitting it as well produces `{...} as const as const`, which
 * is valid TypeScript and therefore only the read-back would ever notice.
 */
function emitValue(
  field: EditableField,
  value: unknown,
  style: EmitStyle,
  indent: string,
  used = indent.length
): string | null {
  switch (field.kind) {
    case "string":
      return typeof value === "string" ? emitString(value, style, indent, used) : null;
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? emitNumber(value) : null;
    case "boolean":
      return typeof value === "boolean" ? emitBoolean(value) : null;
    case "schema":
      return value !== null && typeof value === "object" ? emitSchema(value, style, { indent }) : null;
  }
}

// ---------------------------------------------------------------------------
// Adding a phase
// ---------------------------------------------------------------------------

async function planAddPhase(
  set: SourceSet,
  entryFile: string,
  tree: AgentNode,
  edit: Extract<PendingEdit, { kind: "addPhase" }>
): Promise<PlanOutcome> {
  const agent = agentAt(tree, edit.path);
  if (!agent) return { kind: "refused", reason: `${edit.path} is not an agent in this tree.` };

  const taken = new Set(agent.phases.map((p) => p.name));
  const name = unique(edit.name, taken);

  const address: Address = { path: edit.path, construct: "agent" };
  const node = await resolveAddress(set, entryFile, address);
  if (node.kind !== "resolved") return { kind: "refused", reason: node.reason };

  const array = await arrayProperty(set, entryFile, address, "phases");
  if (array.readOnly) {
    return { kind: "refused", reason: array.readOnlyReason ?? "The phase list is not one this may change." };
  }
  if (array.binding.kind === "computed") {
    return { kind: "refused", reason: `\`phases\` is written as ${readable(array.binding.expression)}.` };
  }
  if (array.binding.kind === "ambiguous") return { kind: "refused", reason: array.binding.reason };

  const file = node.node.file;
  const style = styleOf(file);
  const indent = array.binding.kind === "array" ? array.binding.itemIndent : array.binding.indent + style.step;
  const element = emitPhase(scaffoldPhase(name), style, indent);

  const appended = appendElement(file, node.node.object, array.binding, "phases", element);
  if (appended.kind !== "edits") return fromOutcome(appended);

  // `phase` has to be in scope, and only the file's own import knows whether
  // that means `agent-ftw` or a relative path into a checkout.
  const imported = extendNamedImport(file, inventory(file), "phase", ["agent", "subAgent", "tool"]);
  if (imported.kind === "refused") return { kind: "refused", reason: imported.reason };

  return {
    kind: "plan",
    plan: {
      edits: [...appended.edits, ...(imported.kind === "edits" ? imported.edits : [])],
      // Nothing to read back: the new phase has no address until the tree is
      // rebuilt. The syntax pass in `verifyPlan` is what proves this one.
      checks: [],
    },
  };
}

/** `review`, then `review_2`, and so on, because `validate` throws on a duplicate. */
function unique(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// ---------------------------------------------------------------------------
// Assigning a tool
// ---------------------------------------------------------------------------

async function planAssign(
  set: SourceSet,
  entryFile: string,
  tree: AgentNode,
  edit: Extract<PendingEdit, { kind: "assignTool" }>
): Promise<PlanOutcome> {
  const address: Address = { path: edit.path, construct: "agent" };
  const node = await resolveAddress(set, entryFile, address);
  if (node.kind !== "resolved") return { kind: "refused", reason: node.reason };

  const array = await arrayProperty(set, entryFile, address, edit.list);
  if (array.readOnly) {
    return { kind: "refused", reason: array.readOnlyReason ?? `\`${edit.list}\` is not a list this may change.` };
  }
  if (array.binding.kind === "computed") {
    return { kind: "refused", reason: `\`${edit.list}\` is written as ${readable(array.binding.expression)}.` };
  }
  if (array.binding.kind === "ambiguous") return { kind: "refused", reason: array.binding.reason };

  const file = node.node.file;
  const appended = appendElement(file, node.node.object, array.binding, edit.list, edit.identifier);
  if (appended.kind !== "edits") return fromOutcome(appended);

  const imported = ensureImport(file, inventory(file), edit.identifier, edit.fromFile);
  if (imported.kind === "refused") return { kind: "refused", reason: imported.reason };

  return {
    kind: "plan",
    plan: {
      edits: [...appended.edits, ...(imported.kind === "edits" ? imported.edits : [])],
      checks: [],
    },
  };
}

async function planUnassign(
  set: SourceSet,
  entryFile: string,
  edit: Extract<PendingEdit, { kind: "unassignTool" }>
): Promise<PlanOutcome> {
  const address: Address = { path: edit.path, construct: "agent" };
  const array = await arrayProperty(set, entryFile, address, edit.list);
  if (array.readOnly) {
    return { kind: "refused", reason: array.readOnlyReason ?? `\`${edit.list}\` is not a list this may change.` };
  }

  const file = await set.load(array.file);
  if (!file) return { kind: "refused", reason: `${array.file} could not be read.` };

  // The import is deliberately left alone. An unused import is inert; removing
  // one another declaration still uses is a real bug, and Organize Imports
  // already exists in the editor.
  const removed = removeElement(file, array.binding, edit.identifier);
  return removed.kind === "edits" ? { kind: "plan", plan: { edits: removed.edits, checks: [] } } : fromOutcome(removed);
}

/**
 * Whether an assignment would still compile, checked before it is offered.
 *
 * Each of these mirrors a `CompileError` the framework raises, so the panel can
 * say what is wrong while the user is choosing rather than after the file has
 * been written and re-imported.
 */
export type AssignCheck =
  | { readonly kind: "ok" }
  /** Allowed, but the parent has to grant it in the same batch or the child will not compile. */
  | { readonly kind: "also-grant"; readonly parentPath: string; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string };

export function checkAssign(tree: AgentNode, path: string, list: ToolList, tool: CatalogTool): AssignCheck {
  const agent = agentAt(tree, path);
  if (!agent) return { kind: "refused", reason: `${path} is not an agent in this tree.` };

  if (list === "tools" && tool.mutates && agent.role === "coordinator") {
    return {
      kind: "refused",
      reason: `${agent.name} is a coordinator, so it may not hold \`${tool.name}\`, which writes. Add it to what it may hand down instead, and contract a child to use it.`,
    };
  }

  const exposed = new Set([
    ...agent.tools.map((t) => t.name),
    ...agent.phases.flatMap((p) => p.tools.map((t) => t.name)),
  ]);
  if (list === "tools" && exposed.has(tool.name)) {
    return { kind: "refused", reason: `${agent.name} already exposes a tool named \`${tool.name}\`.` };
  }

  const parentPath = parentOf(path);
  if (list === "tools" && parentPath) {
    const parent = agentAt(tree, parentPath);
    if (parent && !parent.delegable.includes(tool.name)) {
      return {
        kind: "also-grant",
        parentPath,
        reason: `${parent.name} does not hand \`${tool.name}\` down, so it will also be added to what it may grant.`,
      };
    }
  }

  return { kind: "ok" };
}

/** `lead>implementer` is a child of `lead`; a root path has no parent. */
function parentOf(path: string): string | null {
  const cut = path.lastIndexOf(">");
  return cut < 0 ? null : path.slice(0, cut);
}

// ---------------------------------------------------------------------------
// Proving the batch before writing it
// ---------------------------------------------------------------------------

/**
 * Re-parse the edited text and read every changed value back.
 *
 * Run before the edits are written rather than after: the check costs the same
 * either way, and refusing up front means a bad splice never reaches the file
 * instead of having to be undone.
 */
export async function verifyPlan(
  reader: SourceReader,
  entryFile: string,
  plan: EditPlan
): Promise<{ readonly kind: "ok" } | { readonly kind: "mismatch"; readonly reason: string }> {
  for (const file of [...new Set(plan.edits.map((e) => e.file))]) {
    const original = await reader(file);
    if (!original) return { kind: "mismatch", reason: `${file} could not be read back.` };
    const errors = syntaxErrors(applyEdits(original.text, plan.edits.filter((e) => e.file === file)), file);
    if (errors.length > 0) return { kind: "mismatch", reason: `The edit did not parse: ${errors.join("; ")}` };
  }

  for (const step of plan.checks) {
    const verdict = await check(reader, entryFile, plan.edits, step.address, step.expected);
    if (verdict.kind !== "ok") return verdict;
  }
  return { kind: "ok" };
}

// ---------------------------------------------------------------------------

function fromOutcome(outcome: EditOutcome): PlanOutcome {
  if (outcome.kind === "edits") return { kind: "plan", plan: { edits: outcome.edits, checks: [] } };
  return outcome.kind === "no-change"
    ? { kind: "no-change", reason: outcome.reason }
    : { kind: "refused", reason: outcome.reason };
}

/** Every agent in the tree, found by the path the source layer addresses it by. */
function agentAt(tree: AgentNode, path: string): AgentNode | null {
  if (tree.path === path) return tree;
  for (const tool of [...tree.tools, ...tree.phases.flatMap((p) => p.tools)]) {
    if (tool.kind !== "subAgent") continue;
    const found = agentAt(tool.agent, path);
    if (found) return found;
  }
  return null;
}

function lineStart(text: string, offset: number): number {
  return text.lastIndexOf("\n", offset - 1) + 1;
}

/** A TypeScript syntax kind, said the way a person would say it. */
function readable(expression: string): string {
  const words: Readonly<Record<string, string>> = {
    CallExpression: "a function call",
    Identifier: "a reference to something declared elsewhere",
    BinaryExpression: "an expression",
    TemplateExpression: "a template with substitutions",
    PropertyAccessExpression: "a property of something else",
    SpreadAssignment: "a spread of another object",
    ConditionalExpression: "a conditional",
  };
  return words[expression] ?? `a ${expression}`;
}

/** The one line the refusal message leads with, so the user knows which change failed. */
export function describe(edit: PendingEdit): string {
  switch (edit.kind) {
    case "field":
      return `${edit.path} · ${edit.field}`;
    case "addPhase":
      return `${edit.path} · add phase ${edit.name}`;
    case "assignTool":
      return `${edit.path} · ${edit.list} += ${edit.identifier}`;
    case "unassignTool":
      return `${edit.path} · ${edit.list} -= ${edit.identifier}`;
  }
}

export type { LoadedFile };
