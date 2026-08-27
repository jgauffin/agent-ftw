import { describe, expect, it } from "vitest";
import { inputForm, readForm } from "../src/webview/input-form.js";

describe("a form is offered only when something declares the input", () => {
  it("says nothing declares it when there is no schema", () => {
    const form = inputForm(null);
    expect(form.usable).toBe(false);
    // `Session.run` takes anything; only a `subAgent` wrapper describes an input.
    expect(form.reason).toContain("subAgent");
  });

  it("builds a field per declared property", () => {
    const form = inputForm({
      type: "object",
      properties: {
        topic: { type: "string", description: "What to research." },
        depth: { type: "number" },
      },
      required: ["topic"],
    });

    expect(form.usable).toBe(true);
    expect(form.fields.map((f) => f.name)).toEqual(["topic", "depth"]);
    expect(form.fields[0]!.required).toBe(true);
    expect(form.fields[0]!.note).toContain("What to research.");
    expect(form.fields[0]!.note).toContain("required");
    expect(form.fields[1]!.inputType).toBe("number");
  });

  it("shows an enum's permitted values, which is where a form beats typing JSON", () => {
    const form = inputForm({
      type: "object",
      properties: { tone: { type: "string", enum: ["formal", "casual"] } },
    });

    expect(form.fields[0]!.note).toContain("formal, casual");
  });
});

describe("a shape a form would not improve on falls back to typing it", () => {
  it("declines a nested object rather than generating a form for it", () => {
    const form = inputForm({
      type: "object",
      properties: { nested: { type: "object", properties: { a: { type: "string" } } } },
    });

    expect(form.usable).toBe(false);
    expect(form.reason).toContain("nested");
  });

  it("declines an array of items", () => {
    const form = inputForm({
      type: "object",
      properties: { items: { type: "array", items: { type: "string" } } },
    });

    expect(form.usable).toBe(false);
  });

  it("declines a schema that is not an object at all", () => {
    expect(inputForm({ type: "string" }).usable).toBe(false);
  });
});

describe("reading the filled-in fields back", () => {
  const form = inputForm({
    type: "object",
    properties: {
      topic: { type: "string" },
      depth: { type: "number" },
      deep: { type: "boolean" },
      note: { type: "string" },
    },
    required: ["topic"],
  });

  it("converts each value to the type its schema declares", () => {
    const values: Record<string, { value: string; checked: boolean }> = {
      topic: { value: "otters", checked: false },
      depth: { value: "3", checked: false },
      deep: { value: "", checked: true },
      note: { value: "", checked: false },
    };

    const out = readForm(form.fields, (name) => values[name] ?? null);

    expect(out).toEqual({ topic: "otters", depth: 3, deep: true });
  });

  it("omits an empty optional field rather than sending an empty string", () => {
    // An absent property and a present empty one mean different things to a
    // schema, and the model reads the difference too.
    const out = readForm(form.fields, (name) =>
      name === "topic" ? { value: "otters", checked: false } : { value: "", checked: false }
    );

    expect("note" in out).toBe(false);
  });

  it("keeps a required field even when it was left blank, so validation can say so", () => {
    const out = readForm(form.fields, () => ({ value: "", checked: false }));
    expect(out).toEqual({ topic: "", deep: false });
  });
});
