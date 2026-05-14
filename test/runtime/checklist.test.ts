import { describe, it, expect } from "vitest";
import { agent, phase, checklist } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const checklistSchema = {
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
} as const;

describe("checklist", () => {
  it("passes when all checks pass, verifying on the checklist's own adapter", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    };

    const verifier = fakeAdapter();
    verifier.setStructured([{ checks: [{ name: "shape", passed: true }] }]);
    const cl = checklist({ prompt: "verify", schema: checklistSchema, adapter: verifier });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const,
      checklist: cl,
    });
    const a = agent({ name: "a", phases: [p] });

    const main = fakeAdapter([{ finish: { x: 1 } }]);

    const s = new Session({ agent: a, defaultAdapter: main, hooks });
    const out = await s.run("");
    expect(out).toEqual({ x: 1 });
    expect(events.find((e) => e.type === "checklist.run")).toBeTruthy();
    expect(events.find((e) => e.type === "checklist.failed")).toBeUndefined();
  });

  it("triggers one revision round on failure, no re-check", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    };

    const verifier = fakeAdapter();
    verifier.setStructured([
      { checks: [{ name: "must be even", passed: false, evidence: "x=1 is odd" }] },
    ]);
    const cl = checklist({ prompt: "verify", schema: checklistSchema, adapter: verifier });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const,
      checklist: cl,
    });
    const a = agent({ name: "a", phases: [p] });

    const main = fakeAdapter([
      { finish: { x: 1 } },  // first deliverable
      { finish: { x: 2 } },  // revision after failure
    ]);

    const s = new Session({ agent: a, defaultAdapter: main, hooks });
    const out = await s.run("");
    expect(out).toEqual({ x: 2 });
    // Only one checklist run (no re-check after revision).
    const runs = events.filter((e) => e.type === "checklist.run");
    expect(runs).toHaveLength(1);
    expect(events.find((e) => e.type === "checklist.failed")).toBeTruthy();
  });

  it("falls back to the phase's adapter when the checklist has no adapter", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    };

    // No checklist-level adapter — verification runs on the phase/default adapter.
    const cl = checklist({ prompt: "verify", schema: checklistSchema });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const,
      checklist: cl,
    });
    const a = agent({ name: "a", phases: [p] });

    const main = fakeAdapter([{ finish: { x: 1 } }]);
    main.setStructured([{ checks: [{ name: "shape", passed: true }] }]);

    const s = new Session({ agent: a, defaultAdapter: main, hooks });
    const out = await s.run("");
    expect(out).toEqual({ x: 1 });
    expect(events.find((e) => e.type === "checklist.run")).toBeTruthy();
  });
});
