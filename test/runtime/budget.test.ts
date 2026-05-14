import { describe, it, expect } from "vitest";
import { agent, phase } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { BudgetExtensionRequest, Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopAskUser: Hooks["askUser"] = async () => ({ selected: [] });

describe("turn budget", () => {
  it("calls requestBudgetExtension when exhausted and applies the granted amount", async () => {
    const events: TraceEvent[] = [];
    const seenRequests: BudgetExtensionRequest[] = [];
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async (req) => {
        seenRequests.push(req);
        return { extendBy: 2 };
      },
      trace: (e) => events.push(e),
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 2,
    });
    const a = agent({ name: "a", phases: [p] });
    // Needs 3 turns to finish. Initial 2 → exhausted → +2 → finish.
    const fa = fakeAdapter([
      { text: "thinking" },
      { text: "still thinking" },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await s.run("");

    expect(seenRequests).toHaveLength(1);
    const req = seenRequests[0]!;
    expect(req.agent).toBe("a");
    expect(req.phase).toBe("p1");
    expect(req.originalBudget).toBe(2);
    expect(req.suggestedExtension).toBe(2);
    expect(req.extensionsGranted).toBe(0);
    expect(req.turnsUsed).toBe(2);
    expect(req.recentActivity.lastAssistantText).toBe("still thinking");

    expect(events.find((e) => e.type === "budget.exhausted")).toBeTruthy();
    const ext = events.find((e) => e.type === "budget.extended");
    expect(ext && ext.type === "budget.extended" ? ext.by : null).toBe(2);
  });

  it("fails with TurnBudgetExhausted when no requestBudgetExtension hook is set", async () => {
    const hooks: Hooks = { askUser: noopAskUser };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 1,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { text: "1" },
      { text: "2" },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await expect(s.run("")).rejects.toThrow(/budget/);
  });

  it("fails when requestBudgetExtension denies", async () => {
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async () => ({ deny: true }),
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 1,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ text: "1" }, { finish: {} }]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await expect(s.run("")).rejects.toThrow(/budget/);
  });

  it("treats extendBy <= 0 as a deny rather than looping forever", async () => {
    let calls = 0;
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async () => {
        calls++;
        return { extendBy: 0 };
      },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 1,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([{ text: "1" }, { finish: {} }]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await expect(s.run("")).rejects.toThrow(/budget/);
    expect(calls).toBe(1);
  });

  it("tracks extensionsGranted and turnsUsed across multiple extensions", async () => {
    const seenRequests: BudgetExtensionRequest[] = [];
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async (req) => {
        seenRequests.push(req);
        return { extendBy: 1 };
      },
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      turnBudget: 1,
    });
    const a = agent({ name: "a", phases: [p] });
    // Needs 3 turns. Initial 1 → +1 → +1 → finish.
    const fa = fakeAdapter([
      { text: "1" },
      { text: "2" },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await s.run("");

    expect(seenRequests).toHaveLength(2);
    expect(seenRequests[0]!.extensionsGranted).toBe(0);
    expect(seenRequests[0]!.turnsUsed).toBe(1);
    expect(seenRequests[1]!.extensionsGranted).toBe(1);
    expect(seenRequests[1]!.turnsUsed).toBe(2);
  });

  it("surfaces recent tool calls in the request snapshot", async () => {
    const seenRequests: BudgetExtensionRequest[] = [];
    const hooks: Hooks = {
      askUser: noopAskUser,
      requestBudgetExtension: async (req) => {
        seenRequests.push(req);
        return { deny: true };
      },
    };
    const noopTool = {
      kind: "tool" as const,
      name: "noop",
      description: "n",
      input: { type: "object" } as const,
      handler: async () => ({ ok: true }),
    };
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
      tools: [noopTool],
      turnBudget: 2,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { calls: [{ name: "noop", input: { x: 1 } }] },
      { calls: [{ name: "noop", input: { x: 2 } }] },
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    await expect(s.run("")).rejects.toThrow(/budget/);

    expect(seenRequests).toHaveLength(1);
    const calls = seenRequests[0]!.recentActivity.recentToolCalls;
    expect(calls.map((c) => c.name)).toEqual(["noop", "noop"]);
    expect(calls[0]!.inputSummary).toBe('{"x":1}');
    expect(calls[1]!.inputSummary).toBe('{"x":2}');
  });
});
