import { describe, expect, it } from "vitest";
import { locatePhase, positionAt } from "../src/extension/locate.js";

const source = `import { agent, phase } from "agent-ftw";

const draft = phase({
  name: "draft",
  prompt: "Draft it.",
  deliverable: { type: "object" } as const,
});

export const planner = agent({ name: "planner", phases: [draft] });
`;

describe("a phase is located by the name literal in its declaration", () => {
  it("points at the name literal rather than the whole property", () => {
    const range = locatePhase(source, "draft");
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe('"draft"');
  });

  it("resolves the offset to the line the declaration is on", () => {
    const range = locatePhase(source, "draft")!;
    expect(positionAt(source, range.start).line).toBe(3);
  });
});

describe("an ambiguous name is refused rather than guessed at", () => {
  it("returns nothing when two declarations share the name", () => {
    // Pointing at the wrong one puts a diagnostic on an unrelated line, which
    // reads as a bug in the linter rather than a limit of the locator.
    const ambiguous = `${source}\nconst other = phase({ name: "draft" });`;
    expect(locatePhase(ambiguous, "draft")).toBeNull();
  });

  it("returns nothing when the name is built rather than written", () => {
    const computed = `const p = phase({ name: makeName("draft") });`;
    expect(locatePhase(computed, "draft")).toBeNull();
  });
});

describe("a name containing regex punctuation is matched literally", () => {
  it("does not treat the name as a pattern", () => {
    const dotted = `const p = phase({ name: "a.b" });\nconst q = phase({ name: "axb" });`;
    const range = locatePhase(dotted, "a.b");
    expect(range).not.toBeNull();
    expect(dotted.slice(range!.start, range!.end)).toBe('"a.b"');
  });
});

describe("single-quoted declarations are found too", () => {
  it("matches either quote style", () => {
    const single = `const p = phase({ name: 'review' });`;
    expect(locatePhase(single, "review")).not.toBeNull();
  });
});
