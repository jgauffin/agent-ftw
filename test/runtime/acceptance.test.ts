import { describe, it, expect } from "vitest";
import { agent, phase, subAgent } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter, type ScriptedMove } from "../_fixtures/fake-adapter.js";
import type { AcceptanceVerdict, AgentDecl, Evidence } from "../../src/declare/index.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopAskUser: Hooks["askUser"] = async () => ({ selected: [] });
const OBJECT = { type: "object" } as const;
const RESULT_SCHEMA = {
  type: "object",
  properties: { answer: { type: "string", description: "what was found" } },
  required: ["answer"],
} as const;

function envelope(body: Record<string, unknown>): ScriptedMove {
  return { finish: { restatement: "understood the objective", ...body } };
}

/**
 * A coordinator delegating one contract to a child whose scripted returns are
 * given move by move, so a test can make it fail then succeed.
 */
function setup(opts: {
  childMoves: ScriptedMove[];
  accept?: (
    result: unknown,
    evidence: readonly Evidence[]
  ) => Promise<AcceptanceVerdict>;
  maxRejects?: number;
  writeSet?: string[];
  turns?: number;
  maxTurns?: number;
}) {
  const child: AgentDecl = agent({
    name: "child",
    adapter: fakeAdapter(opts.childMoves),
    phases: [
      phase({ name: "w", prompt: "work", deliverable: RESULT_SCHEMA, turnBudget: 20 }),
    ],
  });

  const coord = agent({
    name: "coord",
    role: "coordinator",
    phases: [
      phase({
        name: "plan",
        prompt: "decompose",
        deliverable: OBJECT,
        turnBudget: 20,
        tools: [
          subAgent({
            name: "call_child",
            description: "child",
            input: OBJECT,
            agent: child,
            ...(opts.accept
              ? { accept: async (r, e) => await opts.accept!(r, e) }
              : {}),
            ...(opts.maxRejects !== undefined ? { maxRejects: opts.maxRejects } : {}),
          }),
        ],
      }),
    ],
  });

  const events: TraceEvent[] = [];
  const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
  const coordAdapter = fakeAdapter([
    {
      calls: [
        {
          name: "delegate",
          input: {
            contracts: [
              {
                childAgent: "call_child",
                objective: "find the answer",
                input: {},
                turns: opts.turns ?? 10,
                ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
                ...(opts.writeSet ? { writeSet: opts.writeSet } : {}),
              },
            ],
          },
        },
      ],
    },
    { finish: {} },
  ]);

  const session = new Session({
    agent: coord,
    defaultAdapter: coordAdapter,
    hooks,
    turnBudget: 200,
  });
  return { session, events };
}

function results(events: readonly TraceEvent[]): Array<Record<string, unknown>> {
  const call = events.find((e) => e.type === "tool.result" && e.tool === "delegate");
  const out = call && call.type === "tool.result" ? (call.output as { results?: unknown }) : undefined;
  return (out?.results ?? []) as Array<Record<string, unknown>>;
}

describe("acceptance", () => {
  it("accepts a well-formed result that satisfies the host's check", async () => {
    const { session, events } = await setup({
      childMoves: [envelope({ status: "ok", result: { answer: "42" }, evidence: [] })],
      accept: async () => ({ ok: true }),
    });
    await session.run("");

    expect(results(events)[0]).toMatchObject({ status: "ok", result: { answer: "42" } });
    expect(events.some((e) => e.type === "contract.accepted")).toBe(true);
  });

  it("sends a rejected child back with the reason and accepts the corrected work", async () => {
    let seen = 0;
    const { session, events } = await setup({
      childMoves: [
        envelope({ status: "ok", result: { answer: "guess" }, evidence: [] }),
        envelope({ status: "ok", result: { answer: "42" }, evidence: [{ kind: "note", ref: "checked" }] }),
      ],
      accept: async (_r, evidence) => {
        seen++;
        return evidence.length > 0 ? { ok: true } : { ok: false, reason: "no evidence given" };
      },
    });
    await session.run("");

    expect(seen).toBe(2);
    expect(results(events)[0]).toMatchObject({ status: "ok", result: { answer: "42" } });
    const rejected = events.find((e) => e.type === "contract.rejected");
    expect(rejected && rejected.type === "contract.rejected" ? rejected.reason : "").toBe(
      "no evidence given"
    );
  });

  it("tells the child why it was sent back", async () => {
    const childAdapter = fakeAdapter([
      envelope({ status: "ok", result: { answer: "guess" }, evidence: [] }),
      envelope({ status: "ok", result: { answer: "42" }, evidence: [{ kind: "note", ref: "x" }] }),
    ]);
    const child = agent({
      name: "child",
      adapter: childAdapter,
      phases: [phase({ name: "w", prompt: "work", deliverable: RESULT_SCHEMA, turnBudget: 20 })],
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
          tools: [
            subAgent({
              name: "call_child",
              description: "c",
              input: OBJECT,
              agent: child,
              accept: async (_r, e) => (e.length > 0 ? { ok: true } : { ok: false, reason: "show your working" }),
            }),
          ],
        }),
      ],
    });
    const coordAdapter = fakeAdapter([
      {
        calls: [
          {
            name: "delegate",
            input: {
              contracts: [
                { childAgent: "call_child", objective: "find it", input: {}, turns: 10 },
              ],
            },
          },
        ],
      },
      { finish: {} },
    ]);
    await new Session({
      agent: coord,
      defaultAdapter: coordAdapter,
      hooks: { askUser: noopAskUser },
      turnBudget: 200,
    }).run("");

    // The reason travels in the child's input, which becomes its opening user turn.
    expect(childAdapter.seenUserTexts.join("\n")).toContain("show your working");
  });

  it("abandons and reports partial once the rejection limit is spent", async () => {
    const { session, events } = await setup({
      childMoves: [
        envelope({ status: "ok", result: { answer: "one" }, evidence: [] }),
        envelope({ status: "ok", result: { answer: "two" }, evidence: [] }),
      ],
      accept: async () => ({ ok: false, reason: "never good enough" }),
      maxRejects: 1,
    });
    await session.run("");

    expect(results(events)[0]).toMatchObject({ status: "partial", reason: "never good enough" });
    expect(events.some((e) => e.type === "contract.abandoned")).toBe(true);
  });

  it("passes a blocked child straight up without spending turns on a retry", async () => {
    let acceptCalls = 0;
    const { session, events } = await setup({
      childMoves: [
        envelope({ status: "blocked", evidence: [], note: "two schemas claim to be canonical" }),
        envelope({ status: "ok", result: { answer: "42" }, evidence: [] }),
      ],
      accept: async () => {
        acceptCalls++;
        return { ok: true };
      },
    });
    await session.run("");

    expect(results(events)[0]).toMatchObject({
      status: "blocked",
      note: "two schemas claim to be canonical",
    });
    // Neither judged nor retried: it asked a question, it did not fail.
    expect(acceptCalls).toBe(0);
    expect(events.filter((e) => e.type === "contract.start")).toHaveLength(1);
    expect(events.some((e) => e.type === "contract.blocked")).toBe(true);
  });

  it("stops a malformed result inside the child rather than passing it up", async () => {
    // The child's declared deliverable is embedded in the envelope, so a result
    // of the wrong shape fails the child's own phase-end check and is corrected
    // there. The parent never sees it, which is the cheaper place to catch it.
    const { session, events } = await setup({
      childMoves: [
        envelope({ status: "ok", result: { wrong: "field" }, evidence: [] }),
        envelope({ status: "ok", result: { wrong: "again" }, evidence: [] }),
        envelope({ status: "ok", result: { answer: "finally" }, evidence: [] }),
      ],
    });
    await session.run("");

    const rejections = events.filter((e) => e.type === "deliverable.rejected");
    expect(rejections.length).toBeGreaterThan(0);
    expect(results(events)[0]).toMatchObject({ status: "ok", result: { answer: "finally" } });
  });

  it("refuses evidence of writing outside the contract's write-set", async () => {
    const { session, events } = await setup({
      writeSet: ["src/allowed.ts"],
      childMoves: [
        envelope({
          status: "ok",
          result: { answer: "done" },
          evidence: [{ kind: "file", ref: "src/elsewhere.ts" }],
        }),
        envelope({
          status: "ok",
          result: { answer: "done" },
          evidence: [{ kind: "file", ref: "src/allowed.ts" }],
        }),
      ],
    });
    await session.run("");

    const rejected = events.find((e) => e.type === "contract.rejected");
    expect(rejected && rejected.type === "contract.rejected" ? rejected.reason : "").toMatch(
      /outside the write-set/
    );
    // The corrected attempt stayed inside and was accepted.
    expect(results(events)[0]!["status"]).toBe("ok");
  });

  it("turns a child that runs out of turns into a partial rather than a crash", async () => {
    const { session, events } = await setup({
      turns: 2,
      childMoves: [{ text: "still working" }, { text: "still working" }, { text: "still working" }],
      maxRejects: 0,
    });
    await session.run("");

    expect(results(events)[0]).toMatchObject({ status: "partial" });
    expect(events.some((e) => e.type === "contract.abandoned")).toBe(true);
  });

  it("tops a child up to the ceiling the contract authorised, without asking anyone", async () => {
    let hookCalls = 0;
    const child = agent({
      name: "child",
      adapter: fakeAdapter([
        { text: "working" },
        { text: "working" },
        envelope({ status: "ok", result: { answer: "42" }, evidence: [] }),
      ]),
      phases: [phase({ name: "w", prompt: "work", deliverable: RESULT_SCHEMA, turnBudget: 20 })],
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
          tools: [
            subAgent({ name: "call_child", description: "c", input: OBJECT, agent: child }),
          ],
        }),
      ],
    });
    const coordAdapter = fakeAdapter([
      {
        calls: [
          {
            name: "delegate",
            input: {
              contracts: [
                // Two turns to start, allowed to reach six without asking.
                { childAgent: "call_child", objective: "find it", input: {}, turns: 2, maxTurns: 6 },
              ],
            },
          },
        ],
      },
      { finish: {} },
    ]);
    const events: TraceEvent[] = [];
    await new Session({
      agent: coord,
      defaultAdapter: coordAdapter,
      hooks: {
        askUser: noopAskUser,
        trace: (e) => events.push(e),
        requestBudgetExtension: async () => {
          hookCalls++;
          return { deny: true };
        },
      },
      turnBudget: 200,
    }).run("");

    expect(results(events)[0]).toMatchObject({ status: "ok", result: { answer: "42" } });
    // The host was never consulted: the coordinator authorised this in advance.
    expect(hookCalls).toBe(0);
  });
});
