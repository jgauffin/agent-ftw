import { describe, it, expect } from "vitest";
import { agent, phase, subAgent, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { validate } from "../../src/compile/index.js";
import { fakeAdapter, type ScriptedMove } from "../_fixtures/fake-adapter.js";
import type { AgentDecl, ToolDecl } from "../../src/declare/index.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopAskUser: Hooks["askUser"] = async () => ({ selected: [] });
const OBJECT = { type: "object" } as const;

/** What a contracted child must now return: a status envelope, not a bare payload. */
function done(result: unknown = {}, evidence: unknown[] = []): ScriptedMove {
  return { finish: { restatement: "understood the objective", status: "ok", result, evidence } };
}

function worker(name: string, moves: ScriptedMove[], tools: readonly ToolDecl[] = []): AgentDecl {
  return agent({
    name,
    adapter: fakeAdapter(moves),
    phases: [phase({ name: "w", prompt: "work", deliverable: OBJECT, tools, turnBudget: 20 })],
  });
}

function coordinator(children: readonly AgentDecl[], delegable: readonly ToolDecl[] = []): AgentDecl {
  return agent({
    name: "coord",
    role: "coordinator",
    delegable,
    phases: [
      phase({
        name: "plan",
        prompt: "decompose",
        deliverable: OBJECT,
        turnBudget: 20,
        tools: children.map((c) =>
          subAgent({ name: `call_${c.name}`, description: c.name, input: OBJECT, agent: c })
        ),
      }),
    ],
  });
}

interface ContractInput {
  childAgent: string;
  objective: string;
  input: unknown;
  turns: number;
  grants?: string[];
  writeSet?: string[];
}

function delegateCall(contracts: ContractInput[]): ScriptedMove {
  return { calls: [{ name: "delegate", input: { contracts } }] };
}

/** Runs a coordinator that issues the given delegate batches, then finishes. */
async function runCoordinator(
  coord: AgentDecl,
  batches: ContractInput[][],
  sessionOpts: { turnBudget?: number; maxFanOut?: number } = {}
): Promise<{ events: TraceEvent[]; result: unknown; error: Error | null }> {
  const events: TraceEvent[] = [];
  const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
  const fa = fakeAdapter([...batches.map(delegateCall), { finish: {} }]);
  const s = new Session({ agent: coord, defaultAdapter: fa, hooks, ...sessionOpts });
  try {
    return { events, result: await s.run(""), error: null };
  } catch (e) {
    return { events, result: undefined, error: e as Error };
  }
}

function delegateResults(events: readonly TraceEvent[]): Array<{ status: string; childAgent: string }> {
  const call = events.find((e) => e.type === "tool.result" && e.tool === "delegate");
  const out = call && call.type === "tool.result" ? (call.output as { results?: unknown }) : undefined;
  return (out?.results ?? []) as Array<{ status: string; childAgent: string }>;
}

describe("delegate tool availability", () => {
  it("refuses a coordinator with no room beneath it to delegate into", () => {
    // A coordinator exists to delegate, so one that cannot is a broken
    // configuration rather than a coordinator that quietly does nothing.
    expect(() => validate(coordinator([worker("leaf", [done()])]), { maxDepth: 1 })).toThrow(
      /past the limit/
    );
  });

  it("is present for a coordinator with room to delegate", () => {
    const compiled = validate(coordinator([worker("leaf", [done()])]));
    const names = compiled.phases[0]!.exposedTools.map((t) => t.name);
    expect(names).toContain("delegate");
  });

  it("is not given to a worker", () => {
    const compiled = validate(worker("plain", [done()]));
    const names = compiled.phases[0]!.exposedTools.map((t) => t.name);
    expect(names).not.toContain("delegate");
  });

  it("refuses a coordinator with nothing to delegate to", () => {
    const a = agent({
      name: "coord",
      role: "coordinator",
      phases: [phase({ name: "p", prompt: "go", deliverable: OBJECT })],
    });
    expect(() => validate(a)).toThrow(/no sub-agents to delegate to/);
  });
});

describe("batch validation", () => {
  it("starts nothing when the batch asks for more turns than remain", async () => {
    const coord = coordinator([worker("a", [done()]), worker("b", [done()])]);
    const { events } = await runCoordinator(
      coord,
      [
        [
          { childAgent: "call_a", objective: "do a", input: {}, turns: 50 },
          { childAgent: "call_b", objective: "do b", input: {}, turns: 50 },
        ],
      ],
      { turnBudget: 20 }
    );

    const rejected = events.find((e) => e.type === "delegate.rejected");
    expect(rejected).toBeTruthy();
    expect(events.some((e) => e.type === "contract.start")).toBe(false);
    expect(events.some((e) => e.type === "agent.start" && e.agent === "a")).toBe(false);
  });

  it("refuses a grant the coordinator may not hand down", async () => {
    const editFile = tool({
      name: "editFile",
      description: "edit",
      input: OBJECT,
      mutates: true,
      handler: async () => "ok",
    });
    const coord = coordinator([worker("a", [done()])]);
    const { events } = await runCoordinator(coord, [
      [{ childAgent: "call_a", objective: "do a", input: {}, turns: 5, grants: [editFile.name] }],
    ]);

    // The generated schema has no `grants` field at all when nothing is
    // delegable, so the call is rejected before dispatch even runs.
    const failed =
      events.some((e) => e.type === "delegate.rejected") ||
      events.some((e) => e.type === "tool.error" && e.tool === "delegate");
    expect(failed).toBe(true);
    expect(events.some((e) => e.type === "contract.start")).toBe(false);
  });

  it("refuses a contract that grants a mutating tool without saying where it may write", async () => {
    const editFile = tool({
      name: "editFile",
      description: "edit",
      input: OBJECT,
      mutates: true,
      handler: async () => "ok",
    });
    const coord = coordinator([worker("a", [done()], [editFile])], [editFile]);
    const { events } = await runCoordinator(coord, [
      [{ childAgent: "call_a", objective: "do a", input: {}, turns: 5, grants: ["editFile"] }],
    ]);

    const rejected = events.find((e) => e.type === "delegate.rejected");
    expect(rejected && rejected.type === "delegate.rejected" ? rejected.problems[0]!.reason : "").toMatch(
      /must declare a writeSet/
    );
    expect(events.some((e) => e.type === "contract.start")).toBe(false);
  });

  it("refuses an unknown sub-agent by name", async () => {
    const coord = coordinator([worker("a", [done()])]);
    const { events } = await runCoordinator(coord, [
      [{ childAgent: "call_ghost", objective: "x", input: {}, turns: 5 }],
    ]);
    expect(events.some((e) => e.type === "contract.start")).toBe(false);
  });

  it("counts fan-out across batches, not per batch", async () => {
    const children = ["a", "b", "c"].map((n) => worker(n, [done()]));
    const coord = coordinator(children);
    const { events } = await runCoordinator(
      coord,
      [
        [
          { childAgent: "call_a", objective: "1", input: {}, turns: 3 },
          { childAgent: "call_b", objective: "2", input: {}, turns: 3 },
        ],
        [{ childAgent: "call_c", objective: "3", input: {}, turns: 3 }],
      ],
      { maxFanOut: 2 }
    );

    // First batch fits the cap; the second pushes past it and is refused whole.
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(2);
    const rejected = events.find((e) => e.type === "delegate.rejected");
    expect(rejected && rejected.type === "delegate.rejected" ? rejected.problems[0]!.reason : "").toMatch(
      /past the limit of 2/
    );
  });
});

describe("contract execution", () => {
  it("runs contracts that write to different places in one wave", async () => {
    const coord = coordinator([worker("a", [done()]), worker("b", [done()])]);
    const { events } = await runCoordinator(coord, [
      [
        { childAgent: "call_a", objective: "1", input: {}, turns: 5, writeSet: ["src/a.ts"] },
        { childAgent: "call_b", objective: "2", input: {}, turns: 5, writeSet: ["src/b.ts"] },
      ],
    ]);

    const batch = events.find((e) => e.type === "delegate.batch");
    expect(batch && batch.type === "delegate.batch" ? batch.waves : 0).toBe(1);
    expect(delegateResults(events).map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("separates contracts that would write the same place into different waves", async () => {
    const coord = coordinator([worker("a", [done()]), worker("b", [done()])]);
    const { events } = await runCoordinator(coord, [
      [
        { childAgent: "call_a", objective: "1", input: {}, turns: 5, writeSet: ["src/shared.ts"] },
        { childAgent: "call_b", objective: "2", input: {}, turns: 5, writeSet: ["src/shared.ts"] },
      ],
    ]);

    const batch = events.find((e) => e.type === "delegate.batch");
    expect(batch && batch.type === "delegate.batch" ? batch.waves : 0).toBe(2);
    expect(delegateResults(events).map((r) => r.status)).toEqual(["ok", "ok"]);
  });

  it("hands the child its write-set so a mutating tool can refuse anything outside", async () => {
    let seen: readonly string[] | undefined;
    const editFile = tool({
      name: "editFile",
      description: "edit",
      input: OBJECT,
      mutates: true,
      handler: async (_i, ctx) => {
        seen = ctx.writeSet;
        return "ok";
      },
    });
    const child = worker("a", [{ calls: [{ name: "editFile", input: {} }] }, done()], [editFile]);
    const coord = coordinator([child], [editFile]);

    await runCoordinator(coord, [
      [
        {
          childAgent: "call_a",
          objective: "edit it",
          input: {},
          turns: 5,
          grants: ["editFile"],
          writeSet: ["src/a.ts"],
        },
      ],
    ]);

    expect(seen).toEqual(["src/a.ts"]);
  });

  it("withholds a tool the contract did not grant", async () => {
    const editFile = tool({
      name: "editFile",
      description: "edit",
      input: OBJECT,
      mutates: true,
      handler: async () => "ok",
    });
    const readFile = tool({
      name: "readFile",
      description: "read",
      input: OBJECT,
      handler: async () => "contents",
    });
    // The child declares both, but the contract grants only readFile.
    const child = worker("a", [done()], [readFile, editFile]);
    const coord = coordinator([child], [readFile, editFile]);

    const { events } = await runCoordinator(coord, [
      [
        {
          childAgent: "call_a",
          objective: "read only",
          input: {},
          turns: 5,
          grants: ["readFile"],
        },
      ],
    ]);

    const childPhase = events.find((e) => e.type === "phase.start" && e.agent === "a");
    expect(childPhase).toBeTruthy();
    // The child ran, and its tool list came from the grant rather than its own
    // declaration.
    expect(delegateResults(events).map((r) => r.status)).toEqual(["ok"]);
  });

  it("gives the child its objective, not just its input payload", async () => {
    const childAdapter = fakeAdapter([done()]);
    const child = agent({
      name: "a",
      adapter: childAdapter,
      phases: [phase({ name: "w", prompt: "work", deliverable: OBJECT, turnBudget: 5 })],
    });
    const coord = coordinator([child]);

    await runCoordinator(coord, [
      [{ childAgent: "call_a", objective: "summarise the release notes", input: { id: 7 }, turns: 5 }],
    ]);

    expect(childAdapter.seenUserTexts.join("\n")).toContain("summarise the release notes");
  });

  it("returns a child's unspent turns to the coordinator", async () => {
    const coord = coordinator([worker("a", [done()]), worker("b", [done()])]);
    // 10 turns total. Two contracts reserve 4 each; each child spends 1, so the
    // coordinator must get the rest back or the second batch could not run.
    const { events, error } = await runCoordinator(
      coord,
      [
        [{ childAgent: "call_a", objective: "1", input: {}, turns: 4 }],
        [{ childAgent: "call_b", objective: "2", input: {}, turns: 4 }],
      ],
      { turnBudget: 10 }
    );

    expect(error).toBeNull();
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(2);
    expect(events.some((e) => e.type === "delegate.rejected")).toBe(false);
  });
});
