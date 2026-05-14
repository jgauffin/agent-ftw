import { describe, it, expect } from "vitest";
import { tool, subAgent, phase, agent, checklist } from "../../src/declare/index.js";

describe("declarations", () => {
  it("tool factory passes through", () => {
    const t = tool({
      name: "echo",
      description: "echo input",
      input: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } as const,
      handler: async (i) => (i as { msg: string }).msg,
    });
    expect(t.kind).toBe("tool");
    expect(t.name).toBe("echo");
  });

  it("phase has empty tools array by default", () => {
    const p = phase({
      name: "p1",
      prompt: "do something",
      deliverable: { type: "object" } as const,
    });
    expect(p.tools).toEqual([]);
    expect(p.kind).toBe("phase");
  });

  it("agent declarations carry through adapter and phases", () => {
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
    });
    const fakeAdapter = {
      runUntilPhaseEnd: async () => ({ payload: {}, conversation: [] }),
      runStructured: async () => ({}),
    };
    const a = agent({ name: "a", adapter: fakeAdapter, phases: [p] });
    expect(a.adapter).toBe(fakeAdapter);
    expect(a.phases).toHaveLength(1);
    expect(a.tools).toEqual([]);

    // adapter is optional — omitting it leaves the field unset.
    const b = agent({ name: "b", phases: [p] });
    expect(b.adapter).toBeUndefined();
  });

  it("checklist factory works", () => {
    const cl = checklist({
      prompt: "verify",
      schema: { type: "object", properties: { checks: { type: "array" } } } as const,
    });
    expect(cl.kind).toBe("checklist");
  });

  it("subAgent factory works", () => {
    const inner = agent({
      name: "inner",
      phases: [phase({ name: "p", prompt: "x", deliverable: { type: "object" } as const })],
    });
    const sa = subAgent({
      name: "sa",
      description: "sub",
      input: { type: "object" } as const,
      agent: inner,
    });
    expect(sa.kind).toBe("subAgent");
    expect(sa.agent).toBe(inner);
  });
});
