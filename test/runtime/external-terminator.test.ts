import { describe, it, expect } from "vitest";
import { agent, phase, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";
import type { Adapter, RunContext } from "../../src/adapters/types.js";

const noopHooks: Hooks = {
  askUser: async () => ({ selected: [] }),
};

/**
 * Adapter that records what it was given and hangs until its signal aborts.
 * Used to verify the external-terminator path without racing the fake adapter.
 */
function hangingAdapter(): Adapter & { capturedTools: readonly { name: string }[] | null; capturedSystemPrompt: string | null; aborted: boolean } {
  const state = {
    capturedTools: null as readonly { name: string }[] | null,
    capturedSystemPrompt: null as string | null,
    aborted: false,
  };
  return {
    ...state,
    async runUntilPhaseEnd(ctx: RunContext) {
      state.capturedTools = ctx.tools;
      state.capturedSystemPrompt = ctx.systemPrompt;
      return await new Promise<never>((_, reject) => {
        ctx.signal.addEventListener(
          "abort",
          () => {
            state.aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          },
          { once: true }
        );
      });
    },
    async runStructured() {
      throw new Error("not used");
    },
    get capturedTools() { return state.capturedTools; },
    get capturedSystemPrompt() { return state.capturedSystemPrompt; },
    get aborted() { return state.aborted; },
  };
}

describe("external terminator", () => {
  it("returns the host-supplied payload and aborts the adapter via signal", async () => {
    const p = phase({
      name: "planner",
      prompt: "wait for the user",
      deliverable: {
        type: "object",
        properties: { decision: { type: "string" } },
        required: ["decision"],
      } as const,
      terminator: { kind: "external", await: async () => ({ decision: "approved" }) },
    });
    const a = agent({ name: "a", phases: [p] });
    const ad = hangingAdapter();
    const s = new Session({ agent: a, defaultAdapter: ad, hooks: noopHooks });

    const out = await s.run("");
    expect(out).toEqual({ decision: "approved" });
    // Inner abort fired after external resolved.
    expect(ad.aborted).toBe(true);
  });

  it("does not expose the phase-end tool when terminator is external", async () => {
    const probe = tool({
      name: "probe",
      description: "x",
      input: { type: "object" } as const,
      handler: async () => "ok",
    });
    const p = phase({
      name: "planner",
      prompt: "noop",
      deliverable: { type: "object" } as const,
      tools: [probe],
      terminator: { kind: "external", await: async () => ({}) },
    });
    const a = agent({ name: "a", phases: [p] });
    const ad = hangingAdapter();
    const s = new Session({ agent: a, defaultAdapter: ad, hooks: noopHooks });
    await s.run("");

    const tools = ad.capturedTools ?? [];
    expect(tools.some((t) => t.name === "probe")).toBe(true);
    expect(tools.some((t) => t.name === "finish_planner")).toBe(false);
  });

  it("emits phase.externalTerminated on the bus", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    };
    const p = phase({
      name: "planner",
      prompt: "noop",
      deliverable: { type: "object" } as const,
      terminator: { kind: "external", await: async () => ({}) },
    });
    const a = agent({ name: "a", phases: [p] });
    const ad = hangingAdapter();
    const s = new Session({ agent: a, defaultAdapter: ad, hooks });
    await s.run("");
    expect(events.some((e) => e.type === "phase.externalTerminated")).toBe(true);
  });

  it("rejects an invalid host payload without model retry", async () => {
    const p = phase({
      name: "planner",
      prompt: "noop",
      deliverable: {
        type: "object",
        properties: { decision: { type: "string" } },
        required: ["decision"],
      } as const,
      terminator: { kind: "external", await: async () => ({ wrong: "shape" }) },
    });
    const a = agent({ name: "a", phases: [p] });
    const ad = hangingAdapter();
    const s = new Session({ agent: a, defaultAdapter: ad, hooks: noopHooks });
    await expect(s.run("")).rejects.toThrow(/invalid deliverable/);
  });

  it("omits the `call finish_X` line from the system prompt", async () => {
    const p = phase({
      name: "planner",
      prompt: "noop",
      deliverable: { type: "object" } as const,
      terminator: { kind: "external", await: async () => ({}) },
    });
    const a = agent({ name: "a", phases: [p] });
    const ad = hangingAdapter();
    const s = new Session({ agent: a, defaultAdapter: ad, hooks: noopHooks });
    await s.run("");
    expect(ad.capturedSystemPrompt ?? "").not.toContain("finish_planner");
  });
});
