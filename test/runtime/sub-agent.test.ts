import { describe, it, expect } from "vitest";
import { agent, phase, subAgent, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopHooks: Hooks = { askUser: async () => ({ selected: [] }) };

describe("sub-agent", () => {
  it("invokes a sub-agent as a tool and returns its deliverable", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = { ...noopHooks, trace: (e) => events.push(e) };

    const innerFa = fakeAdapter([
      { finish: { v: "inner-done" } },
    ]);
    const innerPhase = phase({
      name: "ip",
      prompt: "do inner",
      deliverable: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } as const,
    });
    // Sub-agent with its own adapter override.
    const inner = agent({ name: "inner", adapter: innerFa, phases: [innerPhase] });
    const sa = subAgent({
      name: "callInner",
      description: "call inner",
      input: { type: "object", properties: { q: { type: "string" } }, required: ["q"] } as const,
      agent: inner,
    });

    const outerPhase = phase({
      name: "op",
      prompt: "do outer",
      deliverable: { type: "object", properties: { result: { type: "string" } }, required: ["result"] } as const,
      tools: [sa],
    });
    // Outer agent has no adapter — uses the session default.
    const outer = agent({ name: "outer", phases: [outerPhase] });

    const outerFa = fakeAdapter([
      { calls: [{ name: "callInner", input: { q: "hello" } }] },
      { finish: { result: "done" } },
    ]);

    const s = new Session({
      agent: outer,
      defaultAdapter: outerFa,
      hooks,
    });
    const out = await s.run("");
    expect(out).toEqual({ result: "done" });

    // Trace shows nested agent runs.
    const agentStarts = events.filter((e) => e.type === "agent.start");
    expect(agentStarts).toHaveLength(2);
    const inner_ = agentStarts.find((e: any) => e.agent === "inner");
    const outer_ = agentStarts.find((e: any) => e.agent === "outer");
    expect(inner_).toBeTruthy();
    expect((inner_ as any).parentRunId).toBe((outer_ as any).runId);
  });

  it("sub-agent failures surface as tool errors to the parent", async () => {
    const failingTool = tool({
      name: "fail",
      description: "always fails",
      input: { type: "object" } as const,
      handler: async () => { throw new Error("boom"); },
    });
    const innerPhase = phase({
      name: "ip",
      prompt: "go",
      deliverable: { type: "object" } as const,
      tools: [failingTool],
    });
    const innerFa = fakeAdapter([
      { calls: [{ name: "fail", input: {} }] },
      { finish: {} },
    ]);
    const inner = agent({ name: "inner", adapter: innerFa, phases: [innerPhase] });
    const sa = subAgent({
      name: "callInner",
      description: "",
      input: { type: "object" } as const,
      agent: inner,
    });
    const outerPhase = phase({
      name: "op",
      prompt: "go",
      deliverable: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] } as const,
      tools: [sa],
    });
    // The inner agent may only hold tools the outer agent hands down.
    const outer = agent({ name: "outer", delegable: [failingTool], phases: [outerPhase] });

    const outerFa = fakeAdapter([
      { calls: [{ name: "callInner", input: {} }] },
      { finish: { ok: false } },
    ]);

    const s = new Session({
      agent: outer,
      defaultAdapter: outerFa,
      hooks: noopHooks,
    });
    const result = await s.run("");
    expect(result).toEqual({ ok: false });
  });
});
