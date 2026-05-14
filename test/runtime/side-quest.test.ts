import { describe, it, expect } from "vitest";
import { agent, phase, tool, SIDE_QUEST_TOOL_NAME } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const declineHooks: Hooks = { askUser: async () => ({ selected: [] }) };

describe("agent-triggered side quest (feature B)", () => {
  it("auto-injects propose_side_quest when sideQuests.mode is 'agent'", async () => {
    const lookup = tool({
      name: "lookup",
      description: "fake",
      input: { type: "object" } as const,
      handler: async () => ({}),
    });
    const probe = tool({
      name: "probe",
      description: "fake",
      input: { type: "object" } as const,
      handler: async () => ({}),
    });
    const a = agent({
      name: "with_sq",      phases: [
        phase({
          name: "p",
          prompt: "x",
          deliverable: { type: "object" } as const,
        }),
      ],
      sideQuests: {
        mode: "agent",
        catalog: [lookup, probe],
        deliverable: { type: "object" } as const,
      },
    });

    const fa = fakeAdapter([{ finish: {} }]);
    const seenSpecs: string[] = [];
    const captureAdapter = {
      ...fa,
      async runUntilPhaseEnd(ctx: Parameters<typeof fa.runUntilPhaseEnd>[0]) {
        for (const t of ctx.tools) seenSpecs.push(t.name);
        return fa.runUntilPhaseEnd(ctx);
      },
    };

    const s = new Session({
      agent: a,
      defaultAdapter: captureAdapter as never,
      hooks: declineHooks,
    });
    await s.run("");
    expect(seenSpecs).toContain(SIDE_QUEST_TOOL_NAME);
  });

  it("does not inject the tool when sideQuests is absent or mode is 'off'", async () => {
    const a = agent({
      name: "no_sq",      phases: [phase({ name: "p", prompt: "x", deliverable: { type: "object" } as const })],
    });

    const fa = fakeAdapter([{ finish: {} }]);
    const seen: string[] = [];
    const adapter = {
      ...fa,
      async runUntilPhaseEnd(ctx: Parameters<typeof fa.runUntilPhaseEnd>[0]) {
        for (const t of ctx.tools) seen.push(t.name);
        return fa.runUntilPhaseEnd(ctx);
      },
    };
    const s = new Session({ agent: a, defaultAdapter: adapter as never, hooks: declineHooks });
    await s.run("");
    expect(seen).not.toContain(SIDE_QUEST_TOOL_NAME);
  });

  it("approving a tool subset spawns a synthesized child agent with only those tools", async () => {
    const calls: string[] = [];
    const lookup = tool({
      name: "lookup",
      description: "fake",
      input: { type: "object" } as const,
      handler: async () => { calls.push("lookup"); return { hit: "lookup-result" }; },
    });
    const probe = tool({
      name: "probe",
      description: "fake",
      input: { type: "object" } as const,
      handler: async () => { calls.push("probe"); return { hit: "probe-result" }; },
    });

    const parentAgent = agent({
      name: "parent",
      phases: [
        phase({
          name: "main",
          prompt: "do work",
          deliverable: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } as const,
        }),
      ],
      sideQuests: {
        mode: "agent",
        catalog: [lookup, probe],
        deliverable: { type: "object", properties: { found: { type: "string" } }, required: ["found"] } as const,
        turnBudget: 5,
      },
    });

    // Parent: propose a side quest, then finish.
    const parentFa = fakeAdapter([
      {
        calls: [{
          name: SIDE_QUEST_TOOL_NAME,
          input: { goal: "explore X", rationale: "stumbled on it", requestedTools: ["lookup", "probe"] },
        }],
      },
      { finish: { ok: true } },
    ]);

    // Synthesized side-quest agent: call lookup only (probe was denied), then finish.
    const sqFa = fakeAdapter([
      { calls: [{ name: "lookup", input: {} }] },
      { finish: { found: "lookup-result" } },
    ]);

    const events: TraceEvent[] = [];
    const sqToolSpecs: string[][] = [];
    const composed = composeAdapters(parentFa, {
      ...sqFa,
      async runUntilPhaseEnd(ctx) {
        sqToolSpecs.push(ctx.tools.map((t) => t.name));
        return sqFa.runUntilPhaseEnd(ctx);
      },
    });

    const s = new Session({
      agent: parentAgent,
      defaultAdapter: composed as never,
      hooks: {
        // Approve only lookup, deny probe.
        askUser: async () => ({ selected: ["lookup"] }),
        trace: (e) => events.push(e),
      },
    });
    const out = await s.run("");
    expect(out).toEqual({ ok: true });

    expect(calls).toEqual(["lookup"]); // probe was denied → never invoked
    // Side-quest's tool spec list contains only the approved tool (plus auto-injected finish_explore).
    expect(sqToolSpecs).toHaveLength(1);
    expect(sqToolSpecs[0]).toContain("lookup");
    expect(sqToolSpecs[0]).not.toContain("probe");

    const proposed = events.find((e) => e.type === "sideQuest.proposed");
    const approved = events.find((e) => e.type === "sideQuest.approved");
    expect(proposed).toBeTruthy();
    expect(approved).toBeTruthy();
    if (approved && approved.type === "sideQuest.approved") {
      expect(approved.approvedTools).toEqual(["lookup"]);
    }
  });

  it("denial returns a structured 'declined' result without spawning a child", async () => {
    const lookup = tool({
      name: "lookup",
      description: "fake",
      input: { type: "object" } as const,
      handler: async () => ({}),
    });
    const a = agent({
      name: "p",      phases: [
        phase({
          name: "main",
          prompt: "x",
          deliverable: { type: "object", properties: { saw: { type: "string" } }, required: ["saw"] } as const,
        }),
      ],
      sideQuests: {
        mode: "agent",
        catalog: [lookup],
        deliverable: { type: "object" } as const,
      },
    });

    let toolResult: unknown = undefined;
    const fa = fakeAdapter([
      {
        calls: [{
          name: SIDE_QUEST_TOOL_NAME,
          input: { goal: "side", rationale: "why", requestedTools: ["lookup"] },
        }],
      },
      // After seeing the declined tool result, finish with a marker.
      { finish: { saw: "declined" } },
    ]);
    // Wrap dispatch to capture the tool result.
    const wrapping = {
      ...fa,
      async runUntilPhaseEnd(ctx: Parameters<typeof fa.runUntilPhaseEnd>[0]) {
        const inner = ctx.dispatchTool;
        const wrappedCtx = {
          ...ctx,
          dispatchTool: async (name: string, input: unknown, callId: string) => {
            const r = await inner(name, input, callId);
            if (name === SIDE_QUEST_TOOL_NAME) toolResult = r;
            return r;
          },
        };
        return fa.runUntilPhaseEnd(wrappedCtx);
      },
    };

    const events: TraceEvent[] = [];
    const s = new Session({
      agent: a,
      defaultAdapter: wrapping as never,
      hooks: {
        askUser: async () => ({ selected: [] }), // deny
        trace: (e) => events.push(e),
      },
    });
    const out = await s.run("");
    expect(out).toEqual({ saw: "declined" });
    expect(toolResult).toMatchObject({ declined: true });
    expect(events.some((e) => e.type === "sideQuest.declined")).toBe(true);
  });
});

/**
 * Sequence two scripted adapters: the first runUntilPhaseEnd uses scripts from `a`,
 * the second uses scripts from `b`, etc. Used to give parent and synthesized
 * side-quest agents distinct scripts even though they share one adapter.
 */
function composeAdapters(
  a: ReturnType<typeof fakeAdapter>,
  b: { runUntilPhaseEnd: ReturnType<typeof fakeAdapter>["runUntilPhaseEnd"] }
) {
  let calls = 0;
  return {
    async runUntilPhaseEnd(ctx: Parameters<typeof a.runUntilPhaseEnd>[0]) {
      const adapter = calls === 0 ? a : b;
      calls++;
      return adapter.runUntilPhaseEnd(ctx);
    },
    async runStructured(args: Parameters<typeof a.runStructured>[0]) {
      return a.runStructured(args);
    },
  };
}
