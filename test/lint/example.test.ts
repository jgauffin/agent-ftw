import { describe, it, expect } from "vitest";
import { agent, checklist, phase, tool } from "../../src/declare/index.js";
import { lint } from "../../src/lint/index.js";
import type { JSONSchema } from "../../src/schema/index.js";

// A finding that only names the problem leaves the reader where they started.
// Every one carries the fix written out, against the names in their own
// declaration rather than invented ones.

function findingsFor(deliverable: JSONSchema, prompt = "go") {
  return lint(agent({ name: "a", phases: [phase({ name: "p", prompt, deliverable })] }));
}

const NEEDS_NOTHING = {
  type: "object",
  properties: { summary: { type: "string", description: "One sentence on what was found." } },
  required: ["summary"],
} as const;

describe("every finding carries an example of the fix", () => {
  it("gives a non-empty example on each of them", () => {
    const cases: JSONSchema[] = [
      { type: "object", properties: { x: { type: "number" } } } as const,
      { type: "object", properties: {} } as const,
      { type: "string" } as const,
      { type: "object", properties: { s: { type: "string" } }, required: ["s"] } as const,
      {
        type: "object",
        properties: { mode: { type: "string", enum: ["only"], description: "d" } },
        required: ["mode"],
      } as const,
    ];

    const findings = cases.flatMap((c) => findingsFor(c));
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.example, `${f.code} has no example`).toBeTruthy();
      expect(f.example.trim().length, `${f.code} has an empty example`).toBeGreaterThan(0);
    }
  });
});

describe("an example is written against the declaration it is about", () => {
  it("lists the declared properties when nothing is required", () => {
    const findings = findingsFor({
      type: "object",
      properties: { title: { type: "string", description: "d" }, body: { type: "string", description: "d" } },
    } as const);

    const noRequired = findings.find((f) => f.code === "deliverable.no-required");
    // Pasteable as-is, rather than a shape to adapt.
    expect(noRequired!.example).toBe('required: ["title","body"],');
  });

  it("names the offending field when a free-form string is unexplained", () => {
    const findings = findingsFor({
      type: "object",
      properties: { rationale: { type: "string" } },
      required: ["rationale"],
    } as const);

    const freeform = findings.find((f) => f.code === "deliverable.unexplained-string");
    expect(freeform!.example).toContain("rationale:");
    expect(freeform!.example).toContain("description:");
    // The check reads the prompt too, so that way out is shown as well.
    expect(freeform!.example).toContain("prompt:");
    // The text to supply stays an obvious placeholder. Prose generated from the
    // field name reads like advice and invites being pasted unchanged.
    expect(freeform!.example).toContain("<");
  });

  it("names the field in the message, not only in the path", () => {
    const findings = findingsFor({
      type: "object",
      properties: { rationale: { type: "string" }, note: { type: "string" } },
      required: ["rationale", "note"],
    } as const);

    // Two findings whose message is word-for-word identical cannot be told
    // apart in any host that shows the message and not the path.
    const messages = findings
      .filter((f) => f.code === "deliverable.unexplained-string")
      .map((f) => f.message);

    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('"rationale"');
    expect(messages[1]).toContain('"note"');
  });

  it("names the phase and the budget it would take to exercise its tools", () => {
    const t = tool({
      name: "search",
      description: "Search.",
      input: { type: "object", properties: {} } as const,
      handler: async () => "ok",
    });
    const findings = lint(
      agent({
        name: "a",
        tools: [t],
        phases: [phase({ name: "triage", prompt: "go", deliverable: NEEDS_NOTHING, turnBudget: 1 })],
      })
    );

    const budget = findings.find((f) => f.code === "phase.budget-vs-tools");
    expect(budget!.example).toContain('name: "triage"');
    expect(budget!.example).toContain("turnBudget: 2");
  });

  it("shows a second adapter when a checklist would grade its own work", () => {
    const findings = lint(
      agent({
        name: "a",
        phases: [
          phase({
            name: "p",
            prompt: "go",
            deliverable: NEEDS_NOTHING,
            checklist: checklist({
              prompt: "check",
              schema: { type: "object", properties: { ok: { type: "boolean" } } } as const,
            }),
          }),
        ],
      })
    );

    const selfJudging = findings.find((f) => f.code === "checklist.self-judging");
    expect(selfJudging!.example).toContain("adapter:");
  });
});
