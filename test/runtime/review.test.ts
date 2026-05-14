import { describe, it, expect } from "vitest";
import { agent, phase } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";

describe("review gate", () => {
  it("approves immediately when hook returns without revisions", async () => {
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      review: async () => { /* approve immediately */ },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const,
      review: true,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ finish: { x: 1 } }]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    const out = await s.run("");
    expect(out).toEqual({ x: 1 });
  });

  it("revises on user message and returns latest deliverable", async () => {
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      review: async (_d, ctx) => {
        const revised = await ctx.requestRevision("change x to 99");
        expect(revised).toEqual({ x: 99 });
      },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const,
      review: true,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { finish: { x: 1 } },   // initial
      { finish: { x: 99 } },  // after user message
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    const out = await s.run("");
    expect(out).toEqual({ x: 99 });
  });
});
