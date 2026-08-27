/**
 * Turning a value from the panel into TypeScript source text.
 *
 * There is one emitter and one style, so two consumers cannot produce two
 * dialects in the same file. Everything it writes has to look like the rest of
 * the file: a schema printed as `JSON.stringify` output would be valid
 * TypeScript and would read as though a machine had been through the file,
 * which is exactly the impression to avoid when the whole promise is "this is
 * an ordinary editor change".
 */

import * as ts from "typescript";
import type { LoadedFile } from "./parse.js";

export interface EmitStyle {
  readonly quote: '"' | "'";
  /** Where a long string wraps onto a new `+` line. */
  readonly width: number;
  /** One indent level. */
  readonly step: string;
}

/**
 * A width nobody in this repo argues about, used unless a caller says
 * otherwise. Measuring the file's longest line instead would let one long
 * import decide how every prompt is wrapped.
 */
export const DEFAULT_STYLE: EmitStyle = { quote: '"', width: 100, step: "  " };

/** The quote the file already uses, so an emitted string does not stand out. */
export function styleOf(file: LoadedFile, base: EmitStyle = DEFAULT_STYLE): EmitStyle {
  let double = 0;
  let single = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node)) {
      if (file.text[node.getStart()] === "'") single++;
      else double++;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file.ast, visit);
  return { ...base, quote: single > double ? "'" : '"' };
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/**
 * A string literal, wrapped into a `+` chain when it will not fit.
 *
 * Newlines become `\n` escapes rather than a template literal: a template
 * literal changes what the surrounding code means if it is later edited by
 * hand, and `+`-joined prompts are the idiom this repo already uses.
 *
 * @param indent Continuation indent for the second and later lines.
 * @param used Columns already spent on the current line, e.g. by `prompt: `.
 */
export function emitString(value: string, style: EmitStyle = DEFAULT_STYLE, indent = "", used = indent.length): string {
  const single = quoted(value, style.quote);
  if (used + single.length <= style.width) return single;

  const parts = chunk(value, style, indent, used);
  return parts.map((part) => quoted(part, style.quote)).join(` +\n${indent}`);
}

export function emitNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`${value} is not a number that can be written into source.`);
  return String(value);
}

export function emitBoolean(value: boolean): string {
  return value ? "true" : "false";
}

/**
 * A JSON Schema as an idiomatic TS object literal: unquoted keys where the key
 * is an identifier, two-space relative indentation, and `as const` restored
 * when the original had it.
 */
export function emitSchema(
  value: unknown,
  style: EmitStyle = DEFAULT_STYLE,
  options: { indent?: string; asConst?: boolean } = {}
): string {
  const indent = options.indent ?? "";
  const text = emitValue(value, style, indent, indent.length);
  return options.asConst ? `${text} as const` : text;
}

function emitValue(value: unknown, style: EmitStyle, indent: string, used: number): string {
  if (value === null) return "null";
  if (typeof value === "string") return emitString(value, style, indent + style.step, used);
  if (typeof value === "number") return emitNumber(value);
  if (typeof value === "boolean") return emitBoolean(value);
  if (Array.isArray(value)) return emitArray(value, style, indent, used);
  if (typeof value === "object") return emitObject(value as Record<string, unknown>, style, indent, used);
  throw new Error(`Cannot write a ${typeof value} into source.`);
}

function emitArray(value: readonly unknown[], style: EmitStyle, indent: string, used: number): string {
  if (value.length === 0) return "[]";
  const inline = `[${value.map((v) => emitValue(v, style, indent, used)).join(", ")}]`;
  if (!inline.includes("\n") && used + inline.length <= style.width) return inline;

  const inner = indent + style.step;
  const lines = value.map((v) => `${inner}${emitValue(v, style, inner, inner.length)},`);
  return `[\n${lines.join("\n")}\n${indent}]`;
}

function emitObject(value: Record<string, unknown>, style: EmitStyle, indent: string, used: number): string {
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return "{}";

  const inline = `{ ${entries.map(([k, v]) => `${key(k, style)}: ${emitValue(v, style, indent, used)}`).join(", ")} }`;
  if (!inline.includes("\n") && used + inline.length <= style.width) return inline;

  const inner = indent + style.step;
  const lines = entries.map(([k, v]) => {
    const prefix = `${inner}${key(k, style)}: `;
    return `${prefix}${emitValue(v, style, inner, prefix.length)},`;
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function key(name: string, style: EmitStyle): string {
  return IDENTIFIER.test(name) ? name : quoted(name, style.quote);
}

function quoted(value: string, quote: '"' | "'"): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(new RegExp(quote, "g"), `\\${quote}`)
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
  return `${quote}${escaped}${quote}`;
}

/**
 * Split a string into pieces that each fit, keeping every character.
 *
 * Whitespace stays attached to the word before it, so joining the pieces back
 * together reproduces the original exactly. That is what makes reading a value
 * and writing it back byte-identical.
 */
function chunk(value: string, style: EmitStyle, indent: string, used: number): readonly string[] {
  const words = value.match(/\S+\s*|\s+/g) ?? [value];
  const parts: string[] = [];
  let current = "";
  // Two quotes plus the ` +` that follows every line but the last.
  let budget = style.width - used - 4;

  for (const word of words) {
    if (current !== "" && current.length + word.length > budget) {
      parts.push(current);
      current = "";
      budget = style.width - indent.length - 4;
    }
    current += word;
  }
  if (current !== "" || parts.length === 0) parts.push(current);
  return parts;
}

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

export interface PhaseDraft {
  readonly name: string;
  readonly prompt: string;
  readonly deliverable: unknown;
  readonly turnBudget?: number;
  /** Identifiers, not names: only an identifier compiles. */
  readonly tools?: readonly string[];
}

export interface SubAgentDraft {
  readonly name: string;
  readonly description: string;
  readonly input: unknown;
  /** Identifier of the child agent. */
  readonly agent: string;
  readonly maxRejects?: number;
}

export interface AgentDraft {
  readonly name: string;
  readonly role?: "worker" | "coordinator";
  readonly phases: readonly PhaseDraft[];
  readonly tools?: readonly string[];
  readonly delegable?: readonly string[];
}

export function emitPhase(draft: PhaseDraft, style: EmitStyle = DEFAULT_STYLE, indent = ""): string {
  const inner = indent + style.step;
  const lines = [
    `${inner}name: ${emitString(draft.name, style)},`,
    `${inner}prompt: ${emitString(draft.prompt, style, inner + style.step, inner.length + "prompt: ".length)},`,
  ];
  if (draft.tools && draft.tools.length > 0) lines.push(`${inner}tools: [${draft.tools.join(", ")}],`);
  if (draft.turnBudget !== undefined) lines.push(`${inner}turnBudget: ${emitNumber(draft.turnBudget)},`);
  lines.push(`${inner}deliverable: ${emitSchema(draft.deliverable, style, { indent: inner, asConst: true })},`);
  return `phase({\n${lines.join("\n")}\n${indent}})`;
}

export function emitSubAgent(draft: SubAgentDraft, style: EmitStyle = DEFAULT_STYLE, indent = ""): string {
  const inner = indent + style.step;
  const lines = [
    `${inner}name: ${emitString(draft.name, style)},`,
    `${inner}description: ${emitString(draft.description, style, inner + style.step, inner.length + "description: ".length)},`,
    `${inner}input: ${emitSchema(draft.input, style, { indent: inner, asConst: true })},`,
  ];
  if (draft.maxRejects !== undefined) lines.push(`${inner}maxRejects: ${emitNumber(draft.maxRejects)},`);
  lines.push(`${inner}agent: ${draft.agent},`);
  return `subAgent({\n${lines.join("\n")}\n${indent}})`;
}

export function emitAgent(draft: AgentDraft, style: EmitStyle = DEFAULT_STYLE, indent = ""): string {
  // `validate` throws on an agent with no phases, so a scaffold that produced
  // one would be broken the moment it was written.
  if (draft.phases.length === 0) throw new Error(`Agent "${draft.name}" needs at least one phase.`);

  const inner = indent + style.step;
  const lines = [`${inner}name: ${emitString(draft.name, style)},`];
  if (draft.role) lines.push(`${inner}role: ${emitString(draft.role, style)},`);
  if (draft.tools && draft.tools.length > 0) lines.push(`${inner}tools: [${draft.tools.join(", ")}],`);
  if (draft.delegable && draft.delegable.length > 0) lines.push(`${inner}delegable: [${draft.delegable.join(", ")}],`);

  const phases = draft.phases.map((p) => `${inner}${style.step}${emitPhase(p, style, inner + style.step)},`);
  lines.push(`${inner}phases: [\n${phases.join("\n")}\n${inner}],`);
  return `agent({\n${lines.join("\n")}\n${indent}})`;
}

export function emitImport(specifier: string, names: readonly string[], style: EmitStyle = DEFAULT_STYLE): string {
  return `import { ${names.join(", ")} } from ${emitString(specifier, style)};`;
}

// ---------------------------------------------------------------------------
// Scaffolds
// ---------------------------------------------------------------------------

/**
 * A deliverable a new phase can start from.
 *
 * It has to be lint-clean out of the box: `lint` treats a deliverable with no
 * `required` as an error and warns on a free-form string nothing explains. A
 * scaffold that lights up the studio's own Problems panel the moment it is
 * written is a bug, not a starting point.
 */
export function scaffoldDeliverable(field = "summary"): unknown {
  return {
    type: "object",
    properties: { [field]: { type: "string", description: `What this phase produced, as ${field}.` } },
    required: [field],
  };
}

export function scaffoldPhase(name: string): PhaseDraft {
  return {
    name,
    prompt: `Describe what the ${name} phase should produce.`,
    deliverable: scaffoldDeliverable(),
  };
}

export function scaffoldAgent(name: string): AgentDraft {
  return { name, phases: [scaffoldPhase("draft")] };
}
