import type { AgentDecl, PhaseDecl } from "../declare/index.js";
import { DEFAULT_TURN_BUDGET } from "../declare/index.js";
import type { JSONSchema } from "../schema/index.js";

/**
 * How much confidence a finding carries. `error` means the declaration is
 * almost certainly wrong; `warn` means it is suspicious and worth a look.
 * Linting never throws — `validate` is what rejects a structurally invalid
 * agent. These findings are about *quality* of instructions and deliverables,
 * which is a judgement the author has to make.
 */
export type LintSeverity = "error" | "warn";

/**
 * One thing worth fixing in an agent declaration.
 *
 * `path` addresses the offending construct as `agent/phase/construct`, with a
 * JSON-pointer tail into the schema where one applies, e.g.
 * `triager/plan/deliverable#/filesToTouch`.
 */
export interface LintFinding {
  readonly code: string;
  readonly severity: LintSeverity;
  readonly path: string;
  readonly message: string;
  /** What to do about it. */
  readonly hint: string;
}

/**
 * Inspect an agent declaration (and every sub-agent reachable from it) for
 * instruction and deliverable problems that make a run fail in ways that are
 * hard to trace back to their cause.
 *
 * Purely static: no model is called and nothing is executed.
 *
 * @example
 * ```ts
 * for (const f of lint(myAgent)) {
 *   console.log(`${f.severity} ${f.code} at ${f.path}: ${f.message}`);
 * }
 * ```
 */
export function lint(agent: AgentDecl): readonly LintFinding[] {
  const findings: LintFinding[] = [];
  const seen = new Set<AgentDecl>();
  lintAgent(agent, findings, seen);
  return findings;
}

function lintAgent(agent: AgentDecl, out: LintFinding[], seen: Set<AgentDecl>): void {
  if (seen.has(agent)) return;
  seen.add(agent);

  for (const phase of agent.phases) {
    lintPhase(agent, phase, out);
  }

  for (const t of allTools(agent)) {
    if (t.kind === "subAgent") lintAgent(t.agent, out, seen);
  }
}

function lintPhase(agent: AgentDecl, phase: PhaseDecl, out: LintFinding[]): void {
  const base = `${agent.name}/${phase.name}`;
  const ctx: SchemaCtx = { path: `${base}/deliverable`, prompt: phase.prompt, field: null, out };
  lintSchema(phase.deliverable, ctx, "#", true);
  lintChecklist(phase, base, out);
  lintBudget(agent, phase, base, out);
}

/** Everything a schema check needs beyond the schema node itself. */
interface SchemaCtx {
  readonly path: string;
  /** The phase prompt, so a field explained in prose is not reported as unexplained. */
  readonly prompt: string;
  /** Nearest enclosing property name, which array items inherit. */
  readonly field: string | null;
  readonly out: LintFinding[];
}

function lintChecklist(phase: PhaseDecl, base: string, out: LintFinding[]): void {
  const cl = phase.checklist;
  if (!cl || cl.adapter) return;
  out.push({
    code: "checklist.self-judging",
    severity: "warn",
    path: `${base}/checklist`,
    message:
      "The checklist declares no adapter, so it falls back to the phase's own adapter and the model verifies its own deliverable.",
    hint: "Give the checklist its own adapter — a cheap local model is enough, and independence is the point.",
  });
}

function lintBudget(agent: AgentDecl, phase: PhaseDecl, base: string, out: LintFinding[]): void {
  const budget = phase.turnBudget ?? DEFAULT_TURN_BUDGET;
  const toolCount = agent.tools.length + phase.tools.length;
  // One turn per tool plus one to call the phase-end tool is the floor below
  // which the phase cannot even exercise what it was given.
  const floor = toolCount + 1;
  if (budget >= floor) return;
  out.push({
    code: "phase.budget-vs-tools",
    severity: "warn",
    path: `${base}/turnBudget`,
    message: `Turn budget ${budget} is below the ${floor} turns needed to call each of the ${toolCount} exposed tools once and then finish.`,
    hint: "Raise the budget or expose fewer tools to this phase.",
  });
}

function lintSchema(schema: JSONSchema, ctx: SchemaCtx, pointer: string, isRoot: boolean): void {
  const s = asObject(schema);
  if (!s) return;
  const out = ctx.out;
  const at = `${ctx.path}${pointer}`;

  if (isRoot && s["type"] !== "object") {
    out.push({
      code: "deliverable.not-an-object",
      severity: "warn",
      path: at,
      message: `Deliverable is "${String(s["type"] ?? "untyped")}" rather than an object.`,
      hint: "Use an object at the top level so fields can be named, described, and added later without a breaking change.",
    });
  }

  if (Array.isArray(s["enum"]) && s["enum"].length === 1) {
    out.push({
      code: "deliverable.single-value-enum",
      severity: "warn",
      path: at,
      message: "Enum permits exactly one value, so the field carries no information.",
      hint: "Drop the field, or widen the enum to the values that are actually possible.",
    });
  }

  if (s["type"] === "object") {
    lintObjectSchema(s, ctx, pointer, at);
    return;
  }

  if (s["type"] === "array") {
    const items = s["items"];
    // Array items inherit the enclosing property's name — that is what the
    // prompt would call them.
    if (items !== undefined) lintSchema(items as JSONSchema, ctx, `${pointer}/items`, false);
    return;
  }

  if (s["type"] !== "string" || s["enum"] !== undefined) return;
  // Explained in the schema, or explained in the prompt: either is enough.
  if (hasText(s["description"])) return;
  if (ctx.field !== null && promptMentions(ctx.prompt, ctx.field)) return;
  out.push({
    code: "deliverable.undescribed-freeform",
    severity: "warn",
    path: at,
    message:
      "Free-form string explained neither by a schema description nor by the phase prompt, so the model is guessing what to put here.",
    hint: "Add a description saying what the value means, mention the field in the prompt, or constrain it with an enum.",
  });
}

// Words too common to carry meaning when matching a field name against prose.
const STOP_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "is", "of", "or", "the", "to"]);

/**
 * Does the prompt talk about this field? A prompt phrases things naturally
 * ("the files you'd touch") rather than in the field's own casing
 * ("filesToTouch"), so match on the field's significant words appearing
 * anywhere in the prompt rather than as one adjacent phrase. Every significant
 * word must appear: matching on any one of them would let a prompt that says
 * "fix" suppress a finding about `fixSummary`.
 */
function promptMentions(prompt: string, field: string): boolean {
  const haystack = prompt.toLowerCase();
  if (haystack.includes(field.toLowerCase())) return true;
  const words = field
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(" ")
    .filter((w) => w.length > 0 && !STOP_WORDS.has(w));
  return words.length > 0 && words.every((w) => haystack.includes(w));
}

function lintObjectSchema(
  s: Record<string, unknown>,
  ctx: SchemaCtx,
  pointer: string,
  at: string
): void {
  const out = ctx.out;
  const properties = asObject(s["properties"] as JSONSchema | undefined);
  const propNames = properties ? Object.keys(properties) : [];

  if (propNames.length === 0) {
    if (s["additionalProperties"] !== false) {
      out.push({
        code: "deliverable.unbounded-object",
        severity: "warn",
        path: at,
        message: "Object declares no properties and does not forbid extra ones, so anything satisfies it.",
        hint: "Declare the properties you expect, or set additionalProperties:false if it really is meant to be empty.",
      });
    }
    return;
  }

  const required = Array.isArray(s["required"]) ? (s["required"] as unknown[]) : [];
  if (required.length === 0) {
    out.push({
      code: "deliverable.no-required",
      severity: "error",
      path: at,
      message: `Object declares ${propNames.length === 1 ? "a property" : "properties"} but nothing is required, so an empty object satisfies it.`,
      hint: "List the properties the phase must actually produce in `required`.",
    });
  }

  if (properties) {
    for (const name of propNames) {
      lintSchema(properties[name] as JSONSchema, { ...ctx, field: name }, `${pointer}/${name}`, false);
    }
  }
}

function allTools(agent: AgentDecl): readonly AgentDecl["tools"][number][] {
  return [...agent.tools, ...agent.phases.flatMap((p) => [...p.tools])];
}

function asObject(schema: JSONSchema | undefined): Record<string, unknown> | null {
  if (schema === undefined || typeof schema === "boolean" || schema === null) return null;
  return schema as unknown as Record<string, unknown>;
}

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}
