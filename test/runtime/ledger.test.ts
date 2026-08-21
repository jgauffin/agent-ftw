import { describe, it, expect } from "vitest";
import { agent, phase, subAgent } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter, type ScriptedMove } from "../_fixtures/fake-adapter.js";
import type { BudgetExtensionRequest, Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopAskUser: Hooks["askUser"] = async () => ({ selected: [] });

/** Model turns actually spent, across every agent in the tree. */
function turnsSpent(events: readonly TraceEvent[]): number {
  return events.filter(
    (e) => e.type === "model.turn" && (e.turn as { role: string }).role === "assistant"
  ).length;
}

/**
 * A parent that calls a sub-agent and then finishes. Each agent drives its own
 * adapter so the two scripts stay independent. Phase budgets are set high so
 * only the session-wide ledger can be what stops anything.
 */
function twoLevelTree(outerMoves: ScriptedMove[], innerMoves: ScriptedMove[]) {
  const inner = agent({
    name: "inner",
    adapter: fakeAdapter(innerMoves),
    phases: [
      phase({
        name: "ip",
        prompt: "inner work",
        deliverable: { type: "object" } as const,
        turnBudget: 50,
      }),
    ],
  });
  const outer = agent({
    name: "outer",
    phases: [
      phase({
        name: "op",
        prompt: "outer work",
        deliverable: { type: "object" } as const,
        turnBudget: 50,
        tools: [
          subAgent({
            name: "callInner",
            description: "delegate",
            input: { type: "object" } as const,
            agent: inner,
          }),
        ],
      }),
    ],
  });
  return { outer, outerAdapter: fakeAdapter(outerMoves) };
}

describe("turn ledger", () => {
  it("stops a sub-agent tree from spending more turns than the session was given", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
    const { outer, outerAdapter } = twoLevelTree(
      [{ calls: [{ name: "callInner", input: {} }] }, { finish: {} }],
      [{ text: "a" }, { text: "b" }, { text: "c" }, { finish: {} }]
    );

    const s = new Session({ agent: outer, defaultAdapter: outerAdapter, hooks, turnBudget: 3 });

    await expect(s.run("")).rejects.toThrow(/run turn budget exhausted/);
    // The phases would happily have spent six turns between them.
    expect(turnsSpent(events)).toBe(3);
  });

  it("lets the same tree finish when the session budget covers it", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
    const { outer, outerAdapter } = twoLevelTree(
      [{ calls: [{ name: "callInner", input: {} }] }, { finish: {} }],
      [{ text: "a" }, { text: "b" }, { text: "c" }, { finish: {} }]
    );

    const s = new Session({ agent: outer, defaultAdapter: outerAdapter, hooks, turnBudget: 10 });

    await s.run("");
    expect(turnsSpent(events)).toBe(6);
  });

  it("leaves the tree ungoverned when no session budget is set", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
    const { outer, outerAdapter } = twoLevelTree(
      [{ calls: [{ name: "callInner", input: {} }] }, { finish: {} }],
      [{ text: "a" }, { text: "b" }, { text: "c" }, { finish: {} }]
    );

    const s = new Session({ agent: outer, defaultAdapter: outerAdapter, hooks });

    await s.run("");
    expect(turnsSpent(events)).toBe(6);
  });

  it("addresses each run by its position in the tree", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
    const { outer, outerAdapter } = twoLevelTree(
      [{ calls: [{ name: "callInner", input: {} }] }, { finish: {} }],
      [{ finish: {} }]
    );

    await new Session({ agent: outer, defaultAdapter: outerAdapter, hooks }).run("");

    const starts = events.filter((e) => e.type === "agent.start") as Array<
      Extract<TraceEvent, { type: "agent.start" }>
    >;
    expect(starts.map((e) => `${e.agent}:${e.runId}`)).toEqual(["outer:root", "inner:root.1"]);
    expect(starts[1]!.parentRunId).toBe("root");
  });

  it("asks the host to fund the run pool, not the phase, when the pool is what ran dry", async () => {
    const seen: BudgetExtensionRequest[] = [];
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: noopAskUser,
      trace: (e) => events.push(e),
      requestBudgetExtension: async (req) => {
        seen.push(req);
        return { extendBy: 5 };
      },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 50,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ text: "thinking" }, { finish: {} }]);

    await new Session({ agent: a, defaultAdapter: fa, hooks, turnBudget: 1 }).run("");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.limit).toBe("run");
    expect(seen[0]!.runId).toBe("root");
    expect(seen[0]!.depth).toBe(0);
    const extended = events.find((e) => e.type === "budget.extended");
    expect(extended && extended.type === "budget.extended" ? extended.limit : null).toBe("run");
  });

  it("still reports a phase budget as the phase's own when the run pool is healthy", async () => {
    const seen: BudgetExtensionRequest[] = [];
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async (req) => {
        seen.push(req);
        return { extendBy: 5 };
      },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 1,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ text: "thinking" }, { finish: {} }]);

    await new Session({ agent: a, defaultAdapter: fa, hooks, turnBudget: 100 }).run("");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.limit).toBe("phase");
  });

  it("reports a sub-agent's exhaustion at its own place in the tree", async () => {
    const seen: BudgetExtensionRequest[] = [];
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async (req) => {
        seen.push(req);
        return { deny: true };
      },
    };
    const inner = agent({
      name: "inner",
      adapter: fakeAdapter([{ text: "a" }, { text: "b" }, { finish: {} }]),
      phases: [
        phase({ name: "ip", prompt: "go", deliverable: { type: "object" } as const, turnBudget: 1 }),
      ],
    });
    const outer = agent({
      name: "outer",
      phases: [
        phase({
          name: "op",
          prompt: "go",
          deliverable: { type: "object" } as const,
          tools: [
            subAgent({
              name: "callInner",
              description: "delegate",
              input: { type: "object" } as const,
              agent: inner,
            }),
          ],
        }),
      ],
    });
    const outerFa = fakeAdapter([{ calls: [{ name: "callInner", input: {} }] }, { finish: {} }]);

    await new Session({ agent: outer, defaultAdapter: outerFa, hooks }).run("");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.agent).toBe("inner");
    expect(seen[0]!.runId).toBe("root.1");
    expect(seen[0]!.depth).toBe(1);
  });
});
