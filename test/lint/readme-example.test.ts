import { describe, it, expect } from "vitest";
import { agent, phase, checklist } from "../../src/declare/index.js";
import { lint } from "../../src/lint/index.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";

/**
 * The bug-triage agent exactly as the README presents it. It is the code users
 * copy first, so it doubles as the calibration case for the linter: if the
 * project's own showcase trips warnings, either the example needs improving or
 * the lint is too aggressive to be worth running.
 */
function readmeExample() {
  const triage = phase({
    name: "triage",
    prompt: "Read the bug report. Classify it and extract the reproduction signal.",
    deliverable: {
      type: "object",
      properties: {
        severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
        area: { type: "string", enum: ["api", "ui", "db", "build", "other"] },
        reproSteps: { type: "array", items: { type: "string" }, minItems: 1 },
        suspectedCause: { type: "string" },
      },
      required: ["severity", "area", "reproSteps", "suspectedCause"],
    } as const,
  });

  const plan = phase({
    name: "plan",
    prompt:
      "Given the triage, propose a minimal fix. List the files you'd touch and " +
      "the test you'd write first (we always reproduce before fixing).",
    deliverable: {
      type: "object",
      properties: {
        filesToTouch: { type: "array", items: { type: "string" }, minItems: 1 },
        reproTest: { type: "string" },
        fixSummary: { type: "string" },
      },
      required: ["filesToTouch", "reproTest", "fixSummary"],
    } as const,
    checklist: checklist({
      // The README verifies on a separate local adapter; stand in for it here.
      adapter: fakeAdapter(),
      prompt: "Each check is a quality gate. Mark passed=false with evidence if it fails.",
      schema: {
        type: "object",
        properties: {
          checks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                passed: { type: "boolean" },
                evidence: { type: "string" },
              },
              required: ["name", "passed"],
            },
          },
        },
        required: ["checks"],
      } as const,
    }),
  });

  return agent({ name: "bug_triager", phases: [triage, plan] });
}

describe("lint calibration", () => {
  it("reports only findings worth acting on in the README example", () => {
    const findings = lint(readmeExample());
    const summary = findings.map((f) => `${f.code} ${f.path}`);
    // Each of these is a field the prompt does not actually describe: the
    // triage prompt asks for a "reproduction signal" without saying it is a
    // list of steps, never mentions a cause at all, and the plan prompt asks
    // for a fix without saying a summary of one. Fields the prompt does
    // explain in prose (filesToTouch, reproTest) must stay unreported — a
    // linter that cries wolf on idiomatic code gets switched off.
    expect(summary).toEqual([
      "deliverable.unexplained-string bug_triager/triage/deliverable#/reproSteps/items",
      "deliverable.unexplained-string bug_triager/triage/deliverable#/suspectedCause",
      "deliverable.unexplained-string bug_triager/plan/deliverable#/fixSummary",
    ]);
  });
});
