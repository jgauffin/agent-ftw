import { describe, it, expect } from "vitest";
import { agent, phase, checklist, subAgent, tool } from "../../src/declare/index.js";
import { lint } from "../../src/lint/index.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { JSONSchema } from "../../src/schema/index.js";

function codesFor(deliverable: JSONSchema): string[] {
  const a = agent({
    name: "a",
    phases: [phase({ name: "p", prompt: "go", deliverable })],
  });
  return lint(a).map((f) => f.code);
}

const GOOD_DELIVERABLE = {
  type: "object",
  properties: { summary: { type: "string", description: "One sentence on what was found." } },
  required: ["summary"],
} as const;

describe("lint", () => {
  it("passes a deliverable that names, describes and requires its fields", () => {
    expect(codesFor(GOOD_DELIVERABLE)).toEqual([]);
  });

  it("flags a deliverable an empty object would satisfy", () => {
    const codes = codesFor({
      type: "object",
      properties: { x: { type: "number" } },
    } as const);
    expect(codes).toContain("deliverable.no-required");
  });

  it("flags a free-form string the model has to guess the meaning of", () => {
    const codes = codesFor({
      type: "object",
      properties: { notes: { type: "string" } },
      required: ["notes"],
    } as const);
    expect(codes).toContain("deliverable.unexplained-string");
  });

  it("accepts a free-form string the prompt explains instead of the schema", () => {
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "p",
          prompt: "Read the report and record the suspected cause in your own words.",
          deliverable: {
            type: "object",
            properties: { suspectedCause: { type: "string" } },
            required: ["suspectedCause"],
          } as const,
        }),
      ],
    });
    expect(lint(a).map((f) => f.code)).not.toContain("deliverable.unexplained-string");
  });

  it("accepts a constrained string without a description", () => {
    const codes = codesFor({
      type: "object",
      properties: { severity: { type: "string", enum: ["low", "high"] } },
      required: ["severity"],
    } as const);
    expect(codes).not.toContain("deliverable.unexplained-string");
  });

  it("flags an object that anything satisfies", () => {
    const codes = codesFor({
      type: "object",
      properties: { payload: { type: "object" } },
      required: ["payload"],
    } as const);
    expect(codes).toContain("deliverable.unbounded-object");
  });

  it("flags an enum that permits only one value", () => {
    const codes = codesFor({
      type: "object",
      properties: { kind: { type: "string", enum: ["only"] } },
      required: ["kind"],
    } as const);
    expect(codes).toContain("deliverable.single-value-enum");
  });

  it("flags a deliverable that is not an object at the top level", () => {
    const codes = codesFor({ type: "string", description: "the answer" } as const);
    expect(codes).toContain("deliverable.not-an-object");
  });

  it("descends into arrays and nested objects", () => {
    const codes = codesFor({
      type: "object",
      properties: {
        findings: {
          type: "array",
          items: { type: "object", properties: { note: { type: "string" } }, required: ["note"] },
        },
      },
      required: ["findings"],
    } as const);
    expect(codes).toContain("deliverable.unexplained-string");
  });

  it("addresses the offending field by path", () => {
    const a = agent({
      name: "triager",
      phases: [
        phase({
          name: "plan",
          prompt: "go",
          deliverable: {
            type: "object",
            properties: { notes: { type: "string" } },
            required: ["notes"],
          } as const,
        }),
      ],
    });
    const finding = lint(a).find((f) => f.code === "deliverable.unexplained-string");
    expect(finding?.path).toBe("triager/plan/deliverable#/notes");
  });

  it("flags a checklist that lets the model grade its own work", () => {
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "p",
          prompt: "go",
          deliverable: GOOD_DELIVERABLE,
          checklist: checklist({ prompt: "check it", schema: GOOD_DELIVERABLE }),
        }),
      ],
    });
    expect(lint(a).map((f) => f.code)).toContain("checklist.self-judging");
  });

  it("accepts a checklist verified on its own adapter", () => {
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "p",
          prompt: "go",
          deliverable: GOOD_DELIVERABLE,
          checklist: checklist({
            prompt: "check it",
            schema: GOOD_DELIVERABLE,
            adapter: fakeAdapter(),
          }),
        }),
      ],
    });
    expect(lint(a).map((f) => f.code)).not.toContain("checklist.self-judging");
  });

  it("flags a turn budget too small to use the tools the phase was given", () => {
    const t = (name: string) =>
      tool({
        name,
        description: name,
        input: { type: "object" } as const,
        handler: async () => null,
      });
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "p",
          prompt: "go",
          deliverable: GOOD_DELIVERABLE,
          tools: [t("one"), t("two"), t("three")],
          turnBudget: 2,
        }),
      ],
    });
    expect(lint(a).map((f) => f.code)).toContain("phase.budget-vs-tools");
  });

  it("lints sub-agents reachable from the root", () => {
    const child = agent({
      name: "child",
      phases: [
        phase({
          name: "work",
          prompt: "go",
          deliverable: { type: "object", properties: { x: { type: "number" } } } as const,
        }),
      ],
    });
    const root = agent({
      name: "root",
      tools: [
        subAgent({
          name: "call_child",
          description: "child",
          input: { type: "object" } as const,
          agent: child,
        }),
      ],
      phases: [phase({ name: "p", prompt: "go", deliverable: GOOD_DELIVERABLE })],
    });
    const finding = lint(root).find((f) => f.code === "deliverable.no-required");
    expect(finding?.path).toBe("child/work/deliverable#");
  });
});
