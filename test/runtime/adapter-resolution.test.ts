import { describe, it, expect } from "vitest";
import { agent, phase, subAgent, checklist } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { ScriptedMove } from "../_fixtures/fake-adapter.js";
import type { Adapter, RunContext } from "../../src/adapters/types.js";
import type { Hooks } from "../../src/hooks/index.js";

const noopHooks: Hooks = { askUser: async () => ({ selected: [] }) };

/**
 * Adapter whose Nth `runUntilPhaseEnd` call is driven by `scripts[N]` on a fresh
 * fakeAdapter — so it stays correct under the re-entrant calls a sub-agent makes
 * when it inherits the parent's adapter. Records the agent name seen per call.
 */
function trackingAdapter(scripts: ScriptedMove[][]): Adapter & { seenAgents: string[] } {
  const seenAgents: string[] = [];
  let i = 0;
  return {
    seenAgents,
    async runUntilPhaseEnd(ctx: RunContext) {
      const idx = i++;
      seenAgents.push(/Agent: (\S+)/.exec(ctx.systemPrompt)?.[1] ?? "?");
      return fakeAdapter(scripts[idx] ?? []).runUntilPhaseEnd(ctx);
    },
    async runStructured() {
      throw new Error("trackingAdapter: runStructured not used");
    },
  };
}

const numDeliverable = {
  type: "object",
  properties: { x: { type: "number" } },
  required: ["x"],
} as const;

const checklistSchema = {
  type: "object",
  properties: {
    checks: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, passed: { type: "boolean" } },
        required: ["name", "passed"],
      },
    },
  },
  required: ["checks"],
} as const;

describe("adapter resolution chain", () => {
  it("uses the session defaultAdapter when no construct overrides it", async () => {
    const def = fakeAdapter([{ finish: { x: 1 } }]);
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a = agent({ name: "a", phases: [p] });

    const s = new Session({ agent: a, defaultAdapter: def, hooks: noopHooks });
    await s.run("");
    expect(def.seenSystemPrompts).toHaveLength(1);
  });

  it("agent adapter overrides the session default", async () => {
    const def = fakeAdapter([{ finish: { x: 9 } }]);
    const agentAdapter = fakeAdapter([{ finish: { x: 1 } }]);
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a = agent({ name: "a", adapter: agentAdapter, phases: [p] });

    const s = new Session({ agent: a, defaultAdapter: def, hooks: noopHooks });
    await s.run("");
    expect(agentAdapter.seenSystemPrompts).toHaveLength(1);
    expect(def.seenSystemPrompts).toHaveLength(0);
  });

  it("phase adapter overrides both agent and session adapters", async () => {
    const def = fakeAdapter([{ finish: { x: 9 } }]);
    const agentAdapter = fakeAdapter([{ finish: { x: 8 } }]);
    const phaseAdapter = fakeAdapter([{ finish: { x: 1 } }]);
    const inherited = phase({ name: "inherited", prompt: "go", deliverable: numDeliverable });
    const overridden = phase({
      name: "overridden",
      prompt: "go",
      deliverable: numDeliverable,
      adapter: phaseAdapter,
    });
    const a = agent({ name: "a", adapter: agentAdapter, phases: [inherited, overridden] });

    const s = new Session({ agent: a, defaultAdapter: def, hooks: noopHooks });
    await s.run("");
    // First phase inherits the agent adapter; second uses its own.
    expect(agentAdapter.seenSystemPrompts).toHaveLength(1);
    expect(agentAdapter.seenSystemPrompts[0]).toContain("Phase: inherited");
    expect(phaseAdapter.seenSystemPrompts).toHaveLength(1);
    expect(phaseAdapter.seenSystemPrompts[0]).toContain("Phase: overridden");
    expect(def.seenSystemPrompts).toHaveLength(0);
  });

  it("checklist adapter overrides the phase adapter for verification", async () => {
    // The phase adapter has NO structured script — if the checklist ran on it,
    // runStructured would throw. The verifier carries the structured script.
    const phaseAdapter = fakeAdapter([{ finish: { x: 1 } }]);
    const verifier = fakeAdapter();
    verifier.setStructured([{ checks: [{ name: "ok", passed: true }] }]);

    const cl = checklist({ prompt: "verify", schema: checklistSchema, adapter: verifier });
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable, checklist: cl });
    const a = agent({ name: "a", phases: [p] });

    const s = new Session({ agent: a, defaultAdapter: phaseAdapter, hooks: noopHooks });
    const out = await s.run("");
    expect(out).toEqual({ x: 1 });
    expect(phaseAdapter.seenSystemPrompts).toHaveLength(1);
  });

  it("sub-agent adapter override is honored; otherwise it inherits the parent", async () => {
    // trackingAdapter call 0: parent phase "p1"; call 1: the inheriting sub-agent
    // re-enters the same (parent) adapter.
    const parentAdapter = trackingAdapter([
      [
        { calls: [{ name: "callOverride", input: {} }] },
        { calls: [{ name: "callInherit", input: {} }] },
        { finish: { x: 0 } },
      ],
      [{ finish: { x: 2 } }],
    ]);
    const subAdapter = fakeAdapter([{ finish: { x: 1 } }]);

    const subPhase = phase({ name: "sp", prompt: "sub", deliverable: numDeliverable });
    const overrideSub = agent({ name: "override_sub", adapter: subAdapter, phases: [subPhase] });
    const inheritSub = agent({ name: "inherit_sub", phases: [subPhase] });

    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: numDeliverable,
      tools: [
        subAgent({ name: "callOverride", description: "x", input: { type: "object" } as const, agent: overrideSub }),
        subAgent({ name: "callInherit", description: "x", input: { type: "object" } as const, agent: inheritSub }),
      ],
    });
    const a = agent({ name: "a", phases: [p] });

    const s = new Session({ agent: a, defaultAdapter: parentAdapter, hooks: noopHooks });
    await s.run("");
    // override_sub ran on its own adapter; inherit_sub fell back to the parent adapter.
    expect(subAdapter.seenSystemPrompts).toHaveLength(1);
    expect(subAdapter.seenSystemPrompts[0]).toContain("Agent: override_sub");
    expect(parentAdapter.seenAgents).toEqual(["a", "inherit_sub"]);
  });
});
