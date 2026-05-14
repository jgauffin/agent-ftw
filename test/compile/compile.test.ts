import { describe, it, expect } from "vitest";
import { agent, phase, tool, subAgent } from "../../src/declare/index.js";
import { validate, CompileError } from "../../src/compile/index.js";

const okPhase = phase({
  name: "p1",
  prompt: "go",
  deliverable: { type: "object" } as const,
});

describe("compiler", () => {
  it("rejects agent with no phases", () => {
    const a = agent({ name: "a", phases: [] });
    expect(() => validate(a)).toThrow(CompileError);
  });

  it("rejects duplicate phase names", () => {
    const a = agent({
      name: "a",
      phases: [okPhase, { ...okPhase }],
    });
    expect(() => validate(a)).toThrow(/duplicate phase/);
  });

  it("auto-generates phase-end tool", () => {
    const a = agent({ name: "a", phases: [okPhase] });
    const c = validate(a);
    expect(c.phases[0]!.phaseEndToolName).toBe("finish_p1");
    expect(c.phases[0]!.exposedTools.some((t) => t.name === "finish_p1")).toBe(true);
  });

  it("rejects tool name colliding with phase-end", () => {
    const t = tool({
      name: "finish_p1",
      description: "x",
      input: { type: "object" } as const,
      handler: async () => null,
    });
    const a = agent({ name: "a", tools: [t], phases: [okPhase] });
    expect(() => validate(a)).toThrow(/phase-end/);
  });

  it("honors phaseEndToolName override", () => {
    const p = phase({
      name: "spec",
      prompt: "go",
      deliverable: { type: "object" } as const,
      phaseEndToolName: "submit_spec",
    });
    const a = agent({ name: "a", phases: [p] });
    const c = validate(a);
    expect(c.phases[0]!.phaseEndToolName).toBe("submit_spec");
    expect(c.phases[0]!.exposedTools.some((t) => t.name === "submit_spec")).toBe(true);
    expect(c.phases[0]!.exposedTools.some((t) => t.name === "finish_spec")).toBe(false);
  });

  it("rejects tool name colliding with overridden phase-end name", () => {
    const t = tool({
      name: "submit_spec",
      description: "x",
      input: { type: "object" } as const,
      handler: async () => null,
    });
    const p = phase({
      name: "spec",
      prompt: "go",
      deliverable: { type: "object" } as const,
      phaseEndToolName: "submit_spec",
    });
    const a = agent({ name: "a", tools: [t], phases: [p] });
    expect(() => validate(a)).toThrow(/phase-end/);
  });

  it("rejects review on sub-agent phase", () => {
    const subPhase = phase({
      name: "sp",
      prompt: "x",
      deliverable: { type: "object" } as const,
      review: true,
    });
    const inner = agent({ name: "inner", phases: [subPhase] });
    const sa = subAgent({ name: "sa", description: "x", input: { type: "object" } as const, agent: inner });
    const outer = agent({ name: "outer", tools: [sa], phases: [okPhase] });
    expect(() => validate(outer)).toThrow(/review is top-level only/);
  });

  it("detects self-cycle via mutation", () => {
    // Cycles can only exist if someone mutates the tools array after construction.
    // The validator must catch that anyway.
    const p = phase({ name: "p", prompt: "x", deliverable: { type: "object" } as const });
    const a = agent({ name: "A", phases: [p] });
    const selfRef = subAgent({
      name: "callSelf",
      description: "",
      input: { type: "object" } as const,
      agent: a,
    });
    (a.tools as unknown as unknown[]).push(selfRef);
    expect(() => validate(a)).toThrow(/cycle/);
  });

  it("accepts linear nested sub-agents", () => {
    const p = phase({ name: "p", prompt: "x", deliverable: { type: "object" } as const });
    const inner = agent({ name: "inner", phases: [p] });
    const sa = subAgent({ name: "sa", description: "", input: { type: "object" } as const, agent: inner });
    const outer = agent({ name: "outer", tools: [sa], phases: [p] });
    expect(() => validate(outer)).not.toThrow();
  });
});
