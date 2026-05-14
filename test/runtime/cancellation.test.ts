import { describe, it, expect } from "vitest";
import { agent, phase, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";

const noopHooks: Hooks = { askUser: async () => ({ selected: [] }) };

describe("cancellation", () => {
  it("propagates cancel into running tools via signal", async () => {
    let aborted = false;
    const slow = tool({
      name: "slow",
      description: "waits then resolves",
      input: { type: "object" } as const,
      handler: async (_i, ctx) => {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            aborted = true;
            reject(new Error("aborted"));
          };
          if (ctx.signal.aborted) onAbort();
          else ctx.signal.addEventListener("abort", onAbort, { once: true });
        });
        return "never";
      },
    });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      tools: [slow],
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { calls: [{ name: "slow", input: {} }] },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks: noopHooks });
    const promise = s.run("");
    // Give the loop a tick to start dispatching.
    await new Promise((r) => setTimeout(r, 5));
    s.cancel("test");
    await expect(promise).rejects.toThrow();
    expect(aborted).toBe(true);
  });
});
