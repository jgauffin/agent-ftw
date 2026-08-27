import { describe, it, expect } from "vitest";
import { lint } from "../../src/lint/index.js";
import type { AgentDecl } from "../../src/declare/index.js";

import { greeter } from "../../examples/01-simple-agent.js";
import { geocoder } from "../../examples/02-agent-with-tool.js";
import { planner as multiPhase } from "../../examples/03-multi-phase.js";
import { productAgent } from "../../examples/04-multi-phase-tools.js";
import { copywriter } from "../../examples/05-checklist.js";
import { newsroom } from "../../examples/06-sub-agents.js";
import { planner as sideQuests } from "../../examples/07-side-quests.js";
import { lead } from "../../examples/08-coordinator.js";

/**
 * The linter run against every example in the repo.
 *
 * The README snippet is one hand-picked agent; these are the eight the project
 * actually ships and tells people to copy. If a check fires here it fires on
 * idiomatic code, and a linter that cries wolf on idiomatic code is one people
 * switch off. Each entry below is either a finding worth acting on or a bug in
 * the check.
 */
const EXAMPLES: ReadonlyArray<readonly [string, AgentDecl]> = [
  ["01 greeter", greeter],
  ["02 geocoder", geocoder],
  ["03 planner", multiPhase],
  ["04 productAgent", productAgent],
  ["05 copywriter", copywriter],
  ["06 newsroom", newsroom],
  ["07 sideQuests", sideQuests],
  ["08 lead", lead],
];

describe("lint against the shipped examples", () => {
  it("reports a known, small set", () => {
    const summary = EXAMPLES.flatMap(([label, a]) =>
      lint(a).map((f) => `${label}: ${f.code} ${f.path}`)
    );
    expect(summary).toMatchSnapshot();
  });

  it("never fires the precise checks on idiomatic code", () => {
    // These four are exact rather than heuristic: each one is either true or a
    // bug in the check, so none of them may fire on code we ship as an example.
    const precise = new Set([
      "deliverable.no-required",
      "deliverable.single-value-enum",
      "deliverable.unbounded-object",
      "pipeline.misspelled-reference",
    ]);
    const hits = EXAMPLES.flatMap(([label, a]) =>
      lint(a)
        .filter((f) => precise.has(f.code))
        .map((f) => `${label}: ${f.code} ${f.path} — ${f.message}`)
    );
    expect(hits).toEqual([]);
  });

  it("gives every finding an example of the fix", () => {
    for (const [label, a] of EXAMPLES) {
      for (const f of lint(a)) {
        expect(f.example.trim(), `${label}: ${f.code} has no example`).not.toBe("");
      }
    }
  });
});
