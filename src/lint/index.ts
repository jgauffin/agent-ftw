import type { AgentDecl, PhaseDecl, SubAgentDecl } from "../declare/index.js";
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
  /**
   * The fix, written out.
   *
   * A hint says what to change; this says what to type, using the names from
   * the declaration being linted rather than invented ones. Advice phrased only
   * in the abstract ("add a description") leaves the reader to work out where
   * it goes, which is the step they were already stuck on.
   *
   * A code fragment, not a whole file: render it as code.
   */
  readonly example: string;
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
  lintPipeline(agent, out);
  lintDelegation(agent, out);

  for (const t of allTools(agent)) {
    if (t.kind === "subAgent") lintAgent(t.agent, out, seen);
  }
}

/**
 * Checks that span phases rather than sitting inside one.
 *
 * A non-final phase's deliverable is visible to exactly one audience: the
 * phases after it in the same agent, which receive it in their system prompt.
 * Nothing else can reach it. That makes it possible to ask whether anything
 * downstream actually asked for a field, which is not a question a single
 * phase can answer about itself.
 */
function lintPipeline(agent: AgentDecl, out: LintFinding[]): void {
  const phases = agent.phases;

  // There is deliberately no "this field is never consumed downstream" check.
  // Prompts refer to a prior deliverable generically far more often than by
  // name — "the previous phase", "the draft above", "the same three elements" —
  // and no lexical rule tells that apart from ignoring it. Measured against the
  // shipped examples the check was wrong nearly every time it fired, and a
  // linter that cries wolf gets switched off, taking the exact checks with it.

  // A prompt that nearly names a field is worse than one that ignores it: the
  // author believed they were pointing at something.
  const known = new Set<string>();
  for (const t of allTools(agent)) known.add(t.name);
  for (const p of agent.phases) known.add(p.name);
  for (const [i, phase] of phases.entries()) {
    for (const p of phases.slice(0, i + 1)) {
      for (const f of allFields(p.deliverable)) known.add(f);
    }
    for (const token of identifierTokens(phase.prompt)) {
      if (known.has(token)) continue;
      const meant = nearestKnown(token, known);
      if (!meant) continue;
      out.push({
        code: "pipeline.misspelled-reference",
        severity: "warn",
        path: `${agent.name}/${phase.name}/prompt`,
        message: `The prompt says "${token}", which nothing declares. The closest thing that exists is "${meant}".`,
        hint: `Correct the prompt to "${meant}", or declare "${token}" if it is meant to be its own field.`,
        example: `prompt: "... ${meant} ...",   // <- was "${token}"`,
      });
    }
  }
}

/**
 * Checks on how an agent hands work down.
 *
 * Both of these are about authority that looks handled but is not: a grant
 * nobody can use, and a child nobody checks.
 */
function lintDelegation(agent: AgentDecl, out: LintFinding[]): void {
  const children = allTools(agent).filter((t): t is SubAgentDecl => t.kind === "subAgent");
  if (children.length === 0) return;

  const claimed = new Set<string>();
  for (const child of children) {
    for (const t of allTools(child.agent)) claimed.add(t.name);
  }
  for (const grant of agent.delegable ?? []) {
    if (claimed.has(grant.name)) continue;
    out.push({
      code: "coordinator.unused-delegable",
      severity: "warn",
      path: `${agent.name}/delegable/${grant.name}`,
      message: `"${grant.name}" is handed down but no sub-agent declares it, so no child can ever use it.`,
      hint: `Remove "${grant.name}" from delegable, or declare it on the sub-agent meant to have it.`,
      example: [
        `// either drop it from the parent:`,
        `delegable: [${(agent.delegable ?? [])
          .filter((t) => t.name !== grant.name)
          .map((t) => t.name)
          .join(", ")}],`,
        "",
        `// or give it to the child that needs it:`,
        `phase({ /* ... */ tools: [${grant.name}] })`,
      ].join("\n"),
    });
  }

  if ((agent.role ?? "worker") !== "coordinator") return;
  for (const child of children) {
    if (child.accept) continue;
    out.push({
      code: "subagent.unchecked",
      severity: "warn",
      path: `${agent.name}/subAgent/${child.name}`,
      message: `"${child.name}" has no acceptance check, so whatever it returns is accepted as long as the shape validates.`,
      hint: "Give it an `accept` predicate that checks the evidence, not just the shape.",
      example: [
        `subAgent({`,
        `  name: "${child.name}",`,
        `  // ...`,
        `  accept: async (result, evidence, ctx) => {`,
        `    if (evidence.length === 0) return { ok: false, reason: "show what you actually did" };`,
        `    return { ok: true };`,
        `  },`,
        `})`,
      ].join("\n"),
    });
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
    example: [
      "checklist({",
      '  prompt: "Check the deliverable against the brief.",',
      "  schema: checkSchema,",
      "  adapter: makeAdapter(),   // <- a second model, not the phase's own",
      "})",
    ].join("\n"),
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
    example: [
      "phase({",
      `  name: "${phase.name}",`,
      `  turnBudget: ${floor},   // <- was ${budget}; one turn per tool, plus one to finish`,
      "  // ...",
      "})",
    ].join("\n"),
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
      example: [
        "deliverable: {",
        '  type: "object",',
        "  properties: {",
        `    ${ctx.field ?? "result"}: { type: "${String(s["type"] ?? "string")}", description: "..." },`,
        "  },",
        `  required: ["${ctx.field ?? "result"}"],`,
        "} as const",
      ].join("\n"),
    });
  }

  if (Array.isArray(s["enum"]) && s["enum"].length === 1) {
    out.push({
      code: "deliverable.single-value-enum",
      severity: "warn",
      path: at,
      message: "Enum permits exactly one value, so the field carries no information.",
      hint: "Drop the field, or widen the enum to the values that are actually possible.",
      example: [
        `${ctx.field ?? "status"}: {`,
        '  type: "string",',
        `  enum: [${JSON.stringify(String(s["enum"][0]))}, "..."],   // <- the values that can really occur`,
        "}",
      ].join("\n"),
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
    code: "deliverable.unexplained-string",
    severity: "warn",
    path: at,
    message: `${ctx.field ? `String "${ctx.field}"` : "This string"} accepts any text, and nothing says what belongs in it: no schema description, and no mention in the phase prompt. The model is left to guess.`,
    hint: "Add a `description` to the property, name the field in the phase prompt, or constrain it with an enum.",
    example: unexplainedStringExample(ctx.field),
  });
}

/**
 * Both ways out, written against the field that triggered the finding.
 *
 * The wording to fill in stays an obvious placeholder rather than plausible
 * prose: text that reads like real advice but was generated from the field name
 * is worse than a blank, because it invites being pasted unchanged.
 *
 * The prompt option appears because the check reads the prompt too, so a phase
 * that already explains the field in its instructions needs no schema change.
 */
function unexplainedStringExample(field: string | null): string {
  const name = field ?? "theField";
  return [
    "// say what it holds, in the schema:",
    `${name}: { type: "string", description: "<what goes in ${name}, and how long>" },`,
    "",
    `// or mention "${name}" in the phase prompt; this check reads that too.`,
    `prompt: "... and a ${name} that <says what>",`,
  ].join("\n");
}

/** Every property name in a schema, at any depth. */
function allFields(schema: JSONSchema, into: Set<string> = new Set()): ReadonlySet<string> {
  const s = asObject(schema);
  if (!s) return into;
  const properties = asObject(s["properties"] as JSONSchema | undefined);
  if (properties) {
    for (const [name, sub] of Object.entries(properties)) {
      into.add(name);
      allFields(sub as JSONSchema, into);
    }
  }
  const items = s["items"];
  if (items !== undefined) allFields(items as JSONSchema, into);
  return into;
}

/**
 * Words in a prompt that look like code rather than prose: `camelCase` or
 * `snake_case`. Ordinary English almost never produces one, so a token like
 * this is the author pointing at something by name.
 */
function identifierTokens(prompt: string): readonly string[] {
  const matches = prompt.match(/\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*|_[a-z0-9]+)+\b/g) ?? [];
  return [...new Set(matches)];
}

/**
 * The declared name a token was probably meant to be, or null if it is not
 * close to any of them.
 *
 * Deliberately strict. A token merely absent from the declarations is usually a
 * function or a filename the prompt legitimately mentions; only one that nearly
 * matches something declared is worth reporting, because that is the author
 * believing they pointed at a real field.
 */
function nearestKnown(token: string, known: ReadonlySet<string>): string | null {
  if (token.length < 5) return null;
  for (const candidate of known) {
    if (candidate.length < 5) continue;
    if (editDistanceWithin(token, candidate, 2)) return candidate;
  }
  return null;
}

/** Levenshtein distance, answered only as "is it within `max`". */
function editDistanceWithin(a: string, b: string, max: number): boolean {
  if (a === b) return false; // Identical is a match, not a near-miss.
  if (Math.abs(a.length - b.length) > max) return false;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    if (Math.min(...current) > max) return false;
    previous = current;
  }
  return previous[b.length]! <= max;
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
        example: [
          '{ type: "object",',
          '  properties: { summary: { type: "string", description: "..." } },',
          '  required: ["summary"] }',
          "",
          "// or, if it really is meant to carry nothing:",
          '{ type: "object", properties: {}, additionalProperties: false }',
        ].join("\n"),
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
      // Naming the declared properties makes this a fix to paste rather than
      // one to work out, and it is usually all of them.
      example: `required: ${JSON.stringify(propNames)},`,
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
