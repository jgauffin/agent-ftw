/**
 * Builds a schema-valid value from a JSON Schema alone.
 *
 * This is what lets an agent be exercised without a model: a phase's
 * deliverable, a tool's input, a checklist's verdict are all schemas, so a
 * value that satisfies them can be constructed rather than generated.
 *
 * Deterministic by design. A dry run that produced different values each time
 * would be no better than the model runs it is standing in for.
 */

import type { JSONSchema } from "../schema/index.js";

/** A value built from a schema, and the places the schema did not say enough to build one. */
export interface Synthesis {
  readonly value: unknown;
  /**
   * Spots where synthesis had to give up or guess: an unresolved `$ref`, a
   * `pattern` no constructed string is going to match, a property with no
   * type. Each is a place a real model is equally unguided, so they are worth
   * reporting rather than swallowing.
   */
  readonly gaps: readonly string[];
}

/** How deep a self-similar schema is followed before synthesis gives up. */
const MAX_DEPTH = 12;

/**
 * Build the smallest value that satisfies `schema`.
 *
 * "Smallest" means required properties only, and one element in an array
 * rather than zero: an empty array satisfies most schemas while telling the
 * next phase nothing, which hides exactly the shape problems a dry run is for.
 *
 * @param schema The schema to satisfy.
 * @param hint A name for the value, used to make placeholder strings readable.
 */
export function synthesize(schema: JSONSchema, hint = "value"): Synthesis {
  const gaps: string[] = [];
  const value = build(schema as Node, "#", hint, gaps, 0);
  return { value, gaps };
}

type Node = Record<string, unknown> | boolean;

function build(node: Node, pointer: string, hint: string, gaps: string[], depth: number): unknown {
  if (depth > MAX_DEPTH) {
    gaps.push(`${pointer}: nests deeper than ${MAX_DEPTH} levels; synthesis stopped here`);
    return null;
  }
  if (node === true) return {};
  if (node === false) {
    gaps.push(`${pointer}: schema accepts no value at all`);
    return null;
  }
  if (typeof node !== "object" || node === null) {
    gaps.push(`${pointer}: not a schema`);
    return null;
  }

  if ("$ref" in node) {
    gaps.push(`${pointer}: $ref is not resolved; synthesis cannot see the target schema`);
    return null;
  }
  if ("const" in node) return clone(node.const);
  const enumValues = node.enum;
  if (Array.isArray(enumValues)) {
    if (enumValues.length === 0) {
      gaps.push(`${pointer}: empty enum, so no value satisfies it`);
      return null;
    }
    return clone(enumValues[0]);
  }

  const composed = composition(node);
  if (composed) return build(composed, pointer, hint, gaps, depth + 1);

  switch (typeName(node, gaps, pointer)) {
    case "object":
      return buildObject(node, pointer, gaps, depth);
    case "array":
      return buildArray(node, pointer, hint, gaps, depth);
    case "string":
      return buildString(node, pointer, hint, gaps);
    case "integer":
      return buildNumber(node, true);
    case "number":
      return buildNumber(node, false);
    // A synthesized checklist has to pass. Verdicts are booleans, and `false`
    // would send every dry run into the revision loop the checklist exists to
    // trigger, which says nothing about the agent being checked.
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return null;
  }
}

/**
 * Fold `allOf` / `anyOf` / `oneOf` into a single node to build from, or return
 * null when the schema has none.
 *
 * `allOf` members are merged because each one constrains the same value.
 * `anyOf` / `oneOf` take the first branch: any branch is valid by definition,
 * and picking the first keeps synthesis deterministic.
 */
function composition(node: Record<string, unknown>): Node | null {
  const all = node.allOf;
  if (Array.isArray(all) && all.length > 0) {
    const merged: Record<string, unknown> = { ...node };
    delete merged.allOf;
    for (const part of all) {
      if (typeof part !== "object" || part === null) continue;
      const p = part as Record<string, unknown>;
      const properties = { ...asRecord(merged.properties), ...asRecord(p.properties) };
      const required = [...asStringArray(merged.required), ...asStringArray(p.required)];
      Object.assign(merged, p);
      if (Object.keys(properties).length > 0) merged.properties = properties;
      if (required.length > 0) merged.required = [...new Set(required)];
    }
    return merged;
  }

  for (const key of ["anyOf", "oneOf"] as const) {
    const branches = node[key];
    if (Array.isArray(branches) && branches.length > 0) return branches[0] as Node;
  }
  return null;
}

/**
 * The declared type, or the one the schema's own keywords imply.
 *
 * A schema with `properties` but no `type` is an object in every practical
 * sense, and rejecting it would fail on declarations that run fine.
 */
function typeName(node: Record<string, unknown>, gaps: string[], pointer: string): string {
  const declared = node.type;
  if (typeof declared === "string") return declared;
  if (Array.isArray(declared)) {
    const first = declared.find((t) => typeof t === "string" && t !== "null") ?? declared[0];
    if (typeof first === "string") return first;
  }
  if ("properties" in node || "additionalProperties" in node) return "object";
  if ("items" in node) return "array";
  gaps.push(`${pointer}: no type, so nothing says what kind of value belongs here`);
  return "unknown";
}

function buildObject(
  node: Record<string, unknown>,
  pointer: string,
  gaps: string[],
  depth: number
): Record<string, unknown> {
  const properties = asRecord(node.properties);
  const required = asStringArray(node.required);
  const out: Record<string, unknown> = {};

  for (const key of required) {
    const propSchema = properties[key];
    if (propSchema === undefined) {
      gaps.push(`${pointer}/${key}: required but not described in properties`);
      out[key] = null;
      continue;
    }
    out[key] = build(propSchema as Node, `${pointer}/${key}`, key, gaps, depth + 1);
  }

  const minProperties = asNumber(node.minProperties);
  if (minProperties !== null && Object.keys(out).length < minProperties) {
    gaps.push(
      `${pointer}: minProperties ${minProperties} needs properties the schema does not name in required`
    );
  }
  return out;
}

function buildArray(
  node: Record<string, unknown>,
  pointer: string,
  hint: string,
  gaps: string[],
  depth: number
): unknown[] {
  const items = node.items;

  // Tuple form: each position has its own schema.
  if (Array.isArray(items)) {
    return items.map((s, i) => build(s as Node, `${pointer}/${i}`, `${hint}${i}`, gaps, depth + 1));
  }

  if (items === undefined) {
    const min = asNumber(node.minItems);
    if (min !== null && min > 0) {
      gaps.push(`${pointer}: minItems ${min} but no items schema says what an element looks like`);
    }
    return [];
  }

  const min = asNumber(node.minItems) ?? 1;
  const max = asNumber(node.maxItems);
  const count = Math.max(1, max === null ? min : Math.min(min, max));
  const element = () => build(items as Node, `${pointer}/items`, singular(hint), gaps, depth + 1);

  const out: unknown[] = [];
  for (let i = 0; i < count; i++) out.push(element());

  // Distinct elements cannot be met by repeating the same synthesized value.
  if (node.uniqueItems === true && count > 1) {
    gaps.push(`${pointer}: uniqueItems with minItems ${min}; synthesized elements repeat`);
  }
  return out;
}

function buildString(
  node: Record<string, unknown>,
  pointer: string,
  hint: string,
  gaps: string[]
): string {
  const format = node.format;
  if (typeof format === "string") {
    const known = FORMAT_SAMPLES[format];
    if (known) return known;
    gaps.push(`${pointer}: format "${format}" is not one synthesis knows how to satisfy`);
  }
  if (typeof node.pattern === "string") {
    gaps.push(`${pointer}: pattern ${node.pattern} will not match a placeholder string`);
  }

  let out = `<${hint}>`;
  const min = asNumber(node.minLength);
  if (min !== null && out.length < min) out = out.padEnd(min, ".");
  const max = asNumber(node.maxLength);
  if (max !== null && out.length > max) out = out.slice(0, max);
  return out;
}

/** Placeholders for the string formats worth recognising. */
const FORMAT_SAMPLES: Readonly<Record<string, string>> = {
  "date-time": "2024-01-01T00:00:00Z",
  date: "2024-01-01",
  time: "00:00:00",
  duration: "PT1S",
  email: "someone@example.invalid",
  hostname: "example.invalid",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  uri: "https://example.invalid/",
  "uri-reference": "/example",
  uuid: "00000000-0000-4000-8000-000000000000",
};

function buildNumber(node: Record<string, unknown>, integer: boolean): number {
  const exclusiveMin = asNumber(node.exclusiveMinimum);
  const min = asNumber(node.minimum);
  let out = exclusiveMin !== null ? exclusiveMin + (integer ? 1 : 0.1) : (min ?? (integer ? 0 : 0));

  const multipleOf = asNumber(node.multipleOf);
  if (multipleOf !== null && multipleOf > 0) out = Math.ceil(out / multipleOf) * multipleOf;

  const max = asNumber(node.maximum);
  if (max !== null && out > max) out = max;
  return integer ? Math.round(out) : out;
}

/** `reproSteps` -> `reproStep`, so a placeholder inside an array reads as one element. */
function singular(hint: string): string {
  return hint.endsWith("s") && hint.length > 1 ? hint.slice(0, -1) : hint;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clone(value: unknown): unknown {
  return value === undefined ? null : (JSON.parse(JSON.stringify(value)) as unknown);
}
