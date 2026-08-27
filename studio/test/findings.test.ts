import { describe, expect, it } from "vitest";
import { allFindingsText, fieldOf, findingText } from "../src/findings.js";

describe("a finding points at the field it is about", () => {
  it("reads the property out of a nested pointer", () => {
    expect(fieldOf("planner/brainstorm/deliverable#/ideas/title")).toBe("ideas/title");
  });

  it("reads a top-level property", () => {
    expect(fieldOf("planner/pick_best/deliverable#/rationale")).toBe("rationale");
  });

  it("says so when the finding is about the deliverable as a whole", () => {
    expect(fieldOf("planner/draft/deliverable#")).toBe("(whole deliverable)");
  });

  it("falls back to the construct when there is no pointer at all", () => {
    // `checklist.self-judging` and `phase.budget-vs-tools` address a construct
    // rather than a place inside a schema.
    expect(fieldOf("planner/draft/checklist")).toBe("checklist");
  });
});

const finding = {
  code: "deliverable.unexplained-string",
  severity: "warn",
  path: "planner/brainstorm/deliverable#/ideas/items/title",
  message: 'String "title" accepts any text.',
  hint: "Add a `description`.",
  example: 'title: { type: "string", description: "<what goes in title>" },',
};

describe("a copied finding stands on its own", () => {
  it("carries the file, phase and field, since the chat it is pasted into knows none of them", () => {
    const text = findingText("/repo/examples/03-multi-phase.ts", "brainstorm", finding);

    expect(text).toContain("/repo/examples/03-multi-phase.ts");
    expect(text).toContain("Phase: brainstorm");
    expect(text).toContain("Field: ideas/items/title");
    expect(text).toContain(finding.message);
    expect(text).toContain(finding.example);
  });
});

describe("a phase's issues copy as one paste", () => {
  it("counts them and separates them", () => {
    const text = allFindingsText("/repo/a.ts", "brainstorm", [finding, { ...finding, path: "x#/summary" }]);

    expect(text).toContain("found 2 issues");
    expect(text).toContain("Field: ideas/items/title");
    expect(text).toContain("Field: summary");
  });

  it("says one issue rather than 1 issues", () => {
    expect(allFindingsText("/repo/a.ts", "p", [finding])).toContain("found 1 issue in");
  });
});
