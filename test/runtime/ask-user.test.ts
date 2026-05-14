import { describe, it, expect } from "vitest";
import { agent, phase, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";

describe("askUser", () => {
  it("appends Other but strips it from selected", async () => {
    let presentedOptions: readonly string[] = [];
    const hooks: Hooks = {
      askUser: async (input) => {
        presentedOptions = input.options ?? [];
        return { selected: ["A", "Other"], other: "free text" };
      },
    };

    const ask = tool({
      name: "ask",
      description: "asks user",
      input: { type: "object" } as const,
      handler: async (_i, ctx) => {
        return await ctx.askUser({
          prompt: "pick one",
          options: ["A", "B"],
          mode: "single",
        });
      },
    });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      tools: [ask],
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { calls: [{ name: "ask", input: {} }] },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await s.run("");

    expect(presentedOptions).toEqual(["A", "B", "Other"]);
  });

  it("returns selection without other field when user did not pick Other", async () => {
    const hooks: Hooks = {
      askUser: async () => ({ selected: ["A"] }),
    };
    let captured: unknown;
    const ask = tool({
      name: "ask",
      description: "x",
      input: { type: "object" } as const,
      handler: async (_i, ctx) => {
        captured = await ctx.askUser({
          prompt: "?",
          options: ["A", "B"],
          mode: "single",
        });
        return captured;
      },
    });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      tools: [ask],
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { calls: [{ name: "ask", input: {} }] },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await s.run("");
    expect(captured).toEqual({ selected: ["A"] });
  });
});
