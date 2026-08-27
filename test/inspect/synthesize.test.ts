import { describe, it, expect } from "vitest";
import { synthesize } from "../../src/inspect/synthesize.js";
import { validateAgainstSchema } from "../../src/schema/index.js";
import type { JSONSchema } from "../../src/schema/index.js";

function satisfies(schema: JSONSchema): void {
  const { value } = synthesize(schema);
  const result = validateAgainstSchema(schema, value);
  expect(result.valid, result.valid ? "" : JSON.stringify({ value, errors: result.errors })).toBe(true);
}

describe("synthesize", () => {
  it("builds_a_value_that_satisfies_the_schema_it_came_from", () => {
    satisfies({
      type: "object",
      properties: {
        severity: { type: "string", enum: ["low", "high"] },
        reproSteps: { type: "array", items: { type: "string" }, minItems: 2 },
        count: { type: "integer", minimum: 3 },
        confirmed: { type: "boolean" },
      },
      required: ["severity", "reproSteps", "count", "confirmed"],
    } as const);
  });

  it("omits_optional_properties_so_the_value_stays_minimal", () => {
    const { value } = synthesize({
      type: "object",
      properties: { a: { type: "string" }, b: { type: "string" } },
      required: ["a"],
    } as const);
    expect(Object.keys(value as object)).toEqual(["a"]);
  });

  it("fills_an_array_with_one_element_when_the_schema_sets_no_minimum", () => {
    const { value } = synthesize({ type: "array", items: { type: "string" } } as const);
    expect((value as unknown[]).length).toBe(1);
  });

  it("names_the_placeholder_after_the_property_so_output_is_readable", () => {
    const { value } = synthesize({
      type: "object",
      properties: { fixSummary: { type: "string" } },
      required: ["fixSummary"],
    } as const);
    expect(value).toEqual({ fixSummary: "<fixSummary>" });
  });

  it("uses_a_true_boolean_so_a_synthesized_checklist_passes_rather_than_loops", () => {
    const { value } = synthesize({
      type: "object",
      properties: { passed: { type: "boolean" } },
      required: ["passed"],
    } as const);
    expect(value).toEqual({ passed: true });
  });

  it("satisfies_string_length_and_number_bounds", () => {
    satisfies({ type: "string", minLength: 40 } as const);
    satisfies({ type: "integer", minimum: 10, maximum: 20, multipleOf: 5 } as const);
    satisfies({ type: "number", exclusiveMinimum: 1 } as const);
  });

  it("satisfies_the_string_formats_it_claims_to_know", () => {
    for (const format of ["date-time", "date", "email", "uri", "uuid", "ipv4"]) {
      satisfies({ type: "string", format } as JSONSchema);
    }
  });

  it("takes_the_first_branch_of_a_union_and_the_merge_of_an_allOf", () => {
    satisfies({ anyOf: [{ type: "string" }, { type: "number" }] } as const);
    satisfies({
      allOf: [
        { type: "object", properties: { a: { type: "string" } }, required: ["a"] },
        { type: "object", properties: { b: { type: "integer" } }, required: ["b"] },
      ],
    } as const);
  });

  it("reports_a_pattern_it_cannot_satisfy_instead_of_pretending_it_did", () => {
    const { gaps } = synthesize({ type: "string", pattern: "^src/" } as const);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toContain("pattern");
  });

  it("reports_a_ref_it_cannot_follow", () => {
    const { gaps } = synthesize({ $ref: "#/$defs/thing" } as JSONSchema);
    expect(gaps[0]).toContain("$ref");
  });

  it("reports_a_property_that_is_required_but_never_described", () => {
    const { gaps } = synthesize({
      type: "object",
      properties: { a: { type: "string" } },
      required: ["a", "b"],
    } as const);
    expect(gaps.join(" ")).toContain("/b");
  });

  it("reports_a_missing_type_rather_than_guessing_one", () => {
    const { gaps } = synthesize({ type: "object", properties: { a: {} }, required: ["a"] } as JSONSchema);
    expect(gaps.join(" ")).toContain("no type");
  });

  it("stops_on_a_self_referential_schema_instead_of_recursing_forever", () => {
    // A schema that nests itself has no smallest value; synthesis has to give up.
    const node: Record<string, unknown> = { type: "object" };
    node.properties = { child: node };
    node.required = ["child"];
    const { gaps } = synthesize(node as JSONSchema);
    expect(gaps.join(" ")).toContain("nests deeper");
  });
});
