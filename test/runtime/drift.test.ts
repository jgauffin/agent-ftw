import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { agent, phase, subAgent } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter, type ScriptedMove } from "../_fixtures/fake-adapter.js";
import type { AcceptanceCtx, AgentDecl } from "../../src/declare/index.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopAskUser: Hooks["askUser"] = async () => ({ selected: [] });
const OBJECT = { type: "object" } as const;

function envelope(body: Record<string, unknown>): ScriptedMove {
  return { finish: { restatement: "understood the objective", status: "ok", result: {}, evidence: [], ...body } };
}

interface ContractInput {
  childAgent: string;
  objective: string;
  input: unknown;
  turns: number;
}

function build(opts: {
  childMoves: ScriptedMove[];
  batches: ContractInput[][];
  accept?: (ctx: AcceptanceCtx) => { ok: true } | { ok: false; reason: string };
  session?: { maxBatches?: number; maxEmptyBatches?: number };
}) {
  const child: AgentDecl = agent({
    name: "child",
    adapter: fakeAdapter(opts.childMoves),
    phases: [phase({ name: "w", prompt: "work", deliverable: OBJECT, turnBudget: 20 })],
  });
  const coord = agent({
    name: "coord",
    role: "coordinator",
    phases: [
      phase({
        name: "plan",
        prompt: "decompose",
        deliverable: OBJECT,
        turnBudget: 30,
        tools: [
          subAgent({
            name: "call_child",
            description: "child",
            input: OBJECT,
            agent: child,
            ...(opts.accept ? { accept: async (_r, _e, ctx) => opts.accept!(ctx) } : {}),
            maxRejects: 0,
          }),
        ],
      }),
    ],
  });
  const events: TraceEvent[] = [];
  const coordAdapter = fakeAdapter([
    ...opts.batches.map((contracts) => ({ calls: [{ name: "delegate", input: { contracts } }] })),
    { finish: {} },
  ]);
  const session = new Session({
    agent: coord,
    defaultAdapter: coordAdapter,
    hooks: { askUser: noopAskUser, trace: (e) => events.push(e) },
    turnBudget: 500,
    ...opts.session,
  });
  return { session, events };
}

function problems(events: readonly TraceEvent[]): string[] {
  return events
    .filter((e) => e.type === "delegate.rejected")
    .flatMap((e) => (e.type === "delegate.rejected" ? e.problems.map((p) => p.reason) : []));
}

const ONE: ContractInput = { childAgent: "call_child", objective: "do the thing", input: {}, turns: 5 };

describe("drift guards", () => {
  it("makes the child restate the objective and shows it to the acceptance check", async () => {
    let seen: AcceptanceCtx | null = null;
    const { session } = build({
      childMoves: [envelope({ restatement: "I am to rewrite the database layer" })],
      batches: [[ONE]],
      accept: (ctx) => {
        seen = ctx;
        return { ok: true };
      },
    });
    await session.run("");

    expect(seen!.objective).toBe("do the thing");
    expect(seen!.restatement).toBe("I am to rewrite the database layer");
  });

  it("lets a mismatched restatement be rejected even when the result looks fine", async () => {
    const { session, events } = build({
      childMoves: [envelope({ restatement: "I am to delete the test suite", result: {} })],
      batches: [[ONE]],
      accept: (ctx) =>
        ctx.restatement.includes("the thing")
          ? { ok: true }
          : { ok: false, reason: "that is not the job you were given" },
    });
    await session.run("");

    const rejected = events.find((e) => e.type === "contract.rejected");
    expect(rejected && rejected.type === "contract.rejected" ? rejected.reason : "").toBe(
      "that is not the job you were given"
    );
  });

  it("refuses a contract identical to one already run", async () => {
    const { session, events } = build({
      childMoves: [envelope({}), envelope({})],
      batches: [[ONE], [{ ...ONE }]],
    });
    await session.run("");

    expect(problems(events).join(" ")).toMatch(/already run this exact contract/);
    // Only the first one ever started.
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(1);
  });

  it("allows a contract to be retried after it failed rather than ran", async () => {
    // A contract that never produced a result has not been "already run". A
    // transport failure or a crash is not the tree going in circles, and
    // refusing the retry strands work that would have succeeded.
    const { session, events } = build({
      childMoves: [
        { finish: { bad: 1 } },
        { finish: { bad: 2 } },
        { finish: { bad: 3 } },
        envelope({}),
      ],
      batches: [[ONE], [{ ...ONE }]],
    });
    await session.run("");

    expect(problems(events).join(" ")).not.toMatch(/already run this exact contract/);
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(2);
    expect(events.some((e) => e.type === "contract.accepted")).toBe(true);
  });

  it("allows the same child again for genuinely different work", async () => {
    const { session, events } = build({
      childMoves: [envelope({}), envelope({})],
      batches: [[ONE], [{ ...ONE, objective: "do a different thing" }]],
    });
    await session.run("");

    expect(problems(events)).toEqual([]);
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(2);
  });

  it("stops a coordinator that keeps re-planning", async () => {
    const { session, events } = build({
      childMoves: [envelope({}), envelope({}), envelope({})],
      batches: [
        [{ ...ONE, objective: "first" }],
        [{ ...ONE, objective: "second" }],
        [{ ...ONE, objective: "third" }],
      ],
      session: { maxBatches: 2 },
    });
    await session.run("");

    expect(problems(events).join(" ")).toMatch(/already delegated 2 times/);
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(2);
  });

  it("stops a coordinator whose batches keep coming back with nothing", async () => {
    const { session, events } = build({
      // Every child returns blocked, so no batch ever yields an accepted result.
      childMoves: [
        envelope({ status: "blocked", note: "cannot tell" }),
        envelope({ status: "blocked", note: "cannot tell" }),
        envelope({ status: "blocked", note: "cannot tell" }),
      ],
      batches: [
        [{ ...ONE, objective: "first" }],
        [{ ...ONE, objective: "second" }],
        [{ ...ONE, objective: "third" }],
      ],
      session: { maxEmptyBatches: 2 },
    });
    await session.run("");

    expect(problems(events).join(" ")).toMatch(/produced nothing usable/);
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(2);
  });

  it("records every delegation so a finished tree can be read back", async () => {
    const dir = await fs.mkdtemp(path.join(tmpdir(), "agent-ftw-journal-"));
    const child = agent({
      name: "child",
      adapter: fakeAdapter([envelope({})]),
      phases: [phase({ name: "w", prompt: "work", deliverable: OBJECT, turnBudget: 20 })],
    });
    const coord = agent({
      name: "coord",
      role: "coordinator",
      phases: [
        phase({
          name: "plan",
          prompt: "go",
          deliverable: OBJECT,
          turnBudget: 20,
          tools: [subAgent({ name: "call_child", description: "c", input: OBJECT, agent: child })],
        }),
      ],
    });
    const session = new Session({
      agent: coord,
      defaultAdapter: fakeAdapter([
        { calls: [{ name: "delegate", input: { contracts: [ONE] } }] },
        { finish: {} },
      ]),
      hooks: { askUser: noopAskUser },
      turnBudget: 200,
      sessionDirectory: dir,
    });
    await session.run("");

    const journal = await session.store!.loadJournal();
    expect(journal).toHaveLength(1);
    expect(journal[0]).toMatchObject({
      runPath: "root.1",
      parentRunPath: "root",
      childAgent: "call_child",
      objective: "do the thing",
      turns: 5,
      outcome: "accepted",
    });
  });

  it("clears the fruitless streak once a batch produces something", async () => {
    const { session, events } = build({
      childMoves: [
        envelope({ status: "blocked", note: "cannot tell" }),
        envelope({ status: "ok" }),
        envelope({ status: "blocked", note: "cannot tell" }),
      ],
      batches: [
        [{ ...ONE, objective: "first" }],
        [{ ...ONE, objective: "second" }],
        [{ ...ONE, objective: "third" }],
      ],
      session: { maxEmptyBatches: 2, maxBatches: 5 },
    });
    await session.run("");

    expect(problems(events)).toEqual([]);
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(3);
  });
});
