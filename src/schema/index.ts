import { Validator } from "@cfworker/json-schema";
import type { FromSchema, JSONSchema as JSTSSchema } from "json-schema-to-ts";

/**
 * JSON Schema type used everywhere in the framework. Re-exported from
 * `json-schema-to-ts` so authors can write `as const` schemas and (optionally)
 * derive a TS type via {@link Infer}.
 */
export type JSONSchema = JSTSSchema;

/**
 * Derive the TS type of a value that satisfies the given JSON Schema. Schema
 * must be authored `as const` for inference to work.
 *
 * @example
 * ```ts
 * const Schema = { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const;
 * type T = Infer<typeof Schema>; // { x: number }
 * ```
 */
export type Infer<S extends JSONSchema> = FromSchema<S>;

/**
 * Result of {@link validateAgainstSchema}. Pattern-match on `valid` to access errors.
 */
export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

/**
 * Validate a value against a JSON Schema using `@cfworker/json-schema`.
 * Returns a structured result; errors are stringified as `"<location>: <message>"`.
 */
export function validateAgainstSchema(schema: JSONSchema, value: unknown): ValidationResult {
  const v = new Validator(schema as object);
  const result = v.validate(value);
  if (result.valid) return { valid: true };
  return {
    valid: false,
    errors: result.errors.map((e) => `${e.instanceLocation}: ${e.error}`),
  };
}
