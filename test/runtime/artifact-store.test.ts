import { describe, it, expect } from "vitest";
import { agent, phase, subAgent } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter, type FakeAdapter, type ScriptedMove } from "../_fixtures/fake-adapter.js";
import type { AgentDecl } from "../../src/declare/index.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopAskUser: Hooks["askUser"] = async () => ({ selected: [] });
const OBJECT = { type: "object" } as const;
const ANSWER = {
  type: "object",
  properties: { answer: { type: "string", description: "what was found" } },
  required: ["answer"],
} as const;

function ok(result: unknown): ScriptedMove {
  return { finish: { restatement: "understood the objective", status: "ok", result, evidence: [] } };
}

function child(name: string, adapter: FakeAdapter): AgentDecl {
  return agent({
    name,
    adapter,
    phases: [phase({ name: "w", prompt: "work", deliverable: ANSWER, turnBudget: 20 })],
  });
}

interface ContractInput {
  childAgent: string;
  objective: string;
  input: unknown;
  turns: number;
  reads?: string[];
}

/** A coordinator that issues the given batches in order, then finishes. */
async function run(children: readonly AgentDecl[], batches: ContractInput[][]) {
  const coord = agent({
    name: "coord",
    role: "coordinator",
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
  const events: TraceEvent[] = [];
  const hooks: Hooks = { askUser: noopAskUser, trace: (e) => events.push(e) };
  const coordAdapter = fakeAdapter([
    ...batches.map((contracts) => ({ calls: [{ name: "delegate", input: { contracts } }] })),
    { finish: {} },
  ]);
  const session = new Session({
    agent: coord,
    defaultAdapter: coordAdapter,
    hooks,
    turnBudget: 200,
  });
  await session.run("");
  return { events, session };
}

function resultsOf(events: readonly TraceEvent[], nth = 0): Array<Record<string, unknown>> {
  const calls = events.filter((e) => e.type === "tool.result" && e.tool === "delegate");
  const call = calls[nth];
  const out = call && call.type === "tool.result" ? (call.output as { results?: unknown }) : undefined;
  return (out?.results ?? []) as Array<Record<string, unknown>>;
}

describe("artifact store", () => {
  it("keys an accepted result by the run that produced it", async () => {
    const { events, session } = await run(
      [child("a", fakeAdapter([ok({ answer: "42" })]))],
      [[{ childAgent: "call_a", objective: "find it", input: {}, turns: 5 }]]
    );

    const key = resultsOf(events)[0]!["artifactKey"] as string;
    expect(key).toBe("root.1");
    expect(session.artifacts.get(key)?.value).toEqual({ answer: "42" });
  });

  it("lets a later child read an earlier one's result without it passing through the coordinator", async () => {
    const readerAdapter = fakeAdapter([
      { calls: [{ name: "read_artifact", input: { key: "root.1" } }] },
      ok({ answer: "built on 42" }),
    ]);
    const { events } = await run(
      [child("a", fakeAdapter([ok({ answer: "42" })])), child("b", readerAdapter)],
      [
        [{ childAgent: "call_a", objective: "find it", input: {}, turns: 5 }],
        [{ childAgent: "call_b", objective: "use it", input: {}, turns: 5, reads: ["root.1"] }],
      ]
    );

    const readResult = events.find((e) => e.type === "tool.result" && e.tool === "read_artifact");
    expect(readResult && readResult.type === "tool.result" ? readResult.output : null).toEqual({
      answer: "42",
    });
    expect(resultsOf(events, 1)[0]).toMatchObject({ status: "ok", result: { answer: "built on 42" } });
  });

  it("gives no reader at all to a child whose contract names no keys", async () => {
    const plain = fakeAdapter([ok({ answer: "x" })]);
    await run(
      [child("a", plain)],
      [[{ childAgent: "call_a", objective: "work alone", input: {}, turns: 5 }]]
    );

    // The tool list a child sees is built from its contract, so a child with
    // nothing to read cannot ask for anything.
    expect(JSON.stringify(plain.seenSystemPrompts)).not.toContain("read_artifact");
  });

  it("refuses a contract naming a key that does not exist", async () => {
    const { events } = await run(
      [child("a", fakeAdapter([ok({ answer: "x" })]))],
      [[{ childAgent: "call_a", objective: "read the void", input: {}, turns: 5, reads: ["root.99"] }]]
    );

    const rejected = events.find((e) => e.type === "delegate.rejected");
    expect(rejected && rejected.type === "delegate.rejected" ? rejected.problems[0]!.reason : "").toMatch(
      /no result exists under "root.99"/
    );
    expect(events.some((e) => e.type === "contract.start")).toBe(false);
  });

  it("stores nothing for a child whose work was not accepted", async () => {
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
              name: "call_a",
              description: "a",
              input: OBJECT,
              agent: child("a", fakeAdapter([ok({ answer: "no good" }), ok({ answer: "still no good" })])),
              accept: async () => ({ ok: false, reason: "not good enough" }),
              maxRejects: 1,
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
            input: { contracts: [{ childAgent: "call_a", objective: "x", input: {}, turns: 5 }] },
          },
        ],
      },
      { finish: {} },
    ]);
    const session = new Session({
      agent: coord,
      defaultAdapter: coordAdapter,
      hooks: { askUser: noopAskUser },
      turnBudget: 200,
    });
    await session.run("");

    expect(session.artifacts.index()).toEqual([]);
  });
});
