import { describe, it, expect } from "vitest";
import { agent, phase } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";
import type { Adapter, RunContext, PhaseEndResult } from "../../src/adapters/types.js";

function collect(): { hooks: Hooks; events: TraceEvent[] } {
  const events: TraceEvent[] = [];
  return {
    events,
    hooks: {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    },
  };
}

const NUMBER_DELIVERABLE = {
  type: "object",
  properties: { x: { type: "number" } },
  required: ["x"],
} as const;

describe("diagnostic trace events", () => {
  it("reports every rejected deliverable with its attempt number and schema errors", async () => {
    const p = phase({ name: "p1", prompt: "go", deliverable: NUMBER_DELIVERABLE });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { finish: { wrong: "shape" } },
      { finish: { still: "wrong" } },
      { finish: { x: 1 } },
    ]);
    const { hooks, events } = collect();

    await new Session({ agent: a, defaultAdapter: fa, hooks }).run("");

    const rejects = events.filter((e) => e.type === "deliverable.rejected");
    expect(rejects.map((e) => (e as { attempt: number }).attempt)).toEqual([1, 2]);
    for (const r of rejects) {
      expect((r as { errors: readonly string[] }).errors.length).toBeGreaterThan(0);
      expect((r as { phase: string }).phase).toBe("p1");
    }
  });

  it("reports a nudge when the model talks instead of calling a tool", async () => {
    const p = phase({ name: "p1", prompt: "go", deliverable: NUMBER_DELIVERABLE });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ text: "let me think about this" }, { finish: { x: 1 } }]);
    const { hooks, events } = collect();

    await new Session({ agent: a, defaultAdapter: fa, hooks }).run("");

    const nudges = events.filter((e) => e.type === "phase.nudged");
    expect(nudges).toHaveLength(1);
    expect((nudges[0] as { text: string }).text).toBe("let me think about this");
    expect(events.some((e) => e.type === "phase.assistantText")).toBe(false);
  });

  it("reports assistant text rather than a nudge when the host handles it", async () => {
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: NUMBER_DELIVERABLE,
      onAssistantText: async () => "carry on",
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ text: "let me think about this" }, { finish: { x: 1 } }]);
    const { hooks, events } = collect();

    await new Session({ agent: a, defaultAdapter: fa, hooks }).run("");

    expect(events.filter((e) => e.type === "phase.assistantText")).toHaveLength(1);
    expect(events.some((e) => e.type === "phase.nudged")).toBe(false);
  });

  it("does not nudge toward the phase-end tool when that tool is not exposed", async () => {
    // With an external terminator the phase-end tool is withheld from the model,
    // so naming it in the nudge would point at a tool it cannot call.
    let nudgeText = "";
    const capturingAdapter: Adapter = {
      async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
        nudgeText = await ctx.onAssistantText!("thinking out loud");
        return { payload: { x: 1 }, conversation: [] };
      },
      async runStructured() {
        throw new Error("not used");
      },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: NUMBER_DELIVERABLE,
      terminator: { kind: "external", await: () => new Promise<never>(() => {}) },
    });
    const a = agent({ name: "a", phases: [p] });
    const { hooks } = collect();

    await new Session({ agent: a, defaultAdapter: capturingAdapter, hooks }).run("");

    expect(nudgeText).not.toContain("finish_");
    expect(nudgeText).toContain("make progress");
  });
});
