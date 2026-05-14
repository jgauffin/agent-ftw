import { describe, it, expect } from "vitest";
import { agent, phase, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

describe("tool handler emit()", () => {
  it("emits tool.event entries on the bus, with correct callId binding", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    };

    const stream = tool({
      name: "stream",
      description: "emits multiple updates",
      input: { type: "object" } as const,
      handler: async (_input, ctx) => {
        ctx.emit({ stage: "start" });
        ctx.emit({ stage: "midway", percent: 50 });
        ctx.emit({ stage: "done" });
        return { ok: true };
      },
    });

    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      tools: [stream],
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { calls: [{ name: "stream", input: {} }] },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await s.run("");

    const toolEvents = events.filter(
      (e): e is TraceEvent & { type: "tool.event" } => e.type === "tool.event"
    );
    expect(toolEvents).toHaveLength(3);
    expect(toolEvents[0]?.tool).toBe("stream");
    expect(toolEvents.map((e) => e.payload)).toEqual([
      { stage: "start" },
      { stage: "midway", percent: 50 },
      { stage: "done" },
    ]);

    // All three events should share the same callId (they're from one call).
    const callIds = new Set(toolEvents.map((e) => e.callId));
    expect(callIds.size).toBe(1);

    // Find the matching tool.call event — its callId should match.
    const callEvent = events.find((e) => e.type === "tool.call");
    expect(callEvent && "callId" in callEvent ? callEvent.callId : undefined).toBe(
      [...callIds][0]
    );
  });
});
