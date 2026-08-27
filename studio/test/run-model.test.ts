import { describe, expect, it } from "vitest";
import { agent, phase, subAgent, tool } from "../../src/declare/index.js";
import type { AgentDecl } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import type { TraceEvent } from "../../src/trace/index.js";
import { fakeAdapter } from "../../test/_fixtures/fake-adapter.js";
import { envelope } from "../src/runner/bridge.js";
import { RunModel, summarize } from "../src/run-model.js";

// Driven by the library's own trace stream rather than hand-written events, so
// a renamed or restructured event breaks these tests instead of silently
// leaving the panel blank.

const hooks = { askUser: async () => ({ selected: [] }) };

function modelFrom(events: TraceEvent[]): RunModel {
  const model = new RunModel();
  for (const e of events) model.apply(envelope(e as unknown as Record<string, unknown>));
  return model;
}

async function record(
  build: () => { agentDecl: AgentDecl; adapter: ReturnType<typeof fakeAdapter> }
): Promise<TraceEvent[]> {
  const { agentDecl, adapter } = build();
  const events: TraceEvent[] = [];
  const session = new Session({
    agent: agentDecl,
    defaultAdapter: adapter,
    hooks: { ...hooks, trace: (e: TraceEvent) => events.push(e) },
  });
  try {
    await session.run("go");
  } finally {
    await session.dispose();
  }
  return events;
}

const simpleDeliverable = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
} as const;

describe("a run's phases are recovered from the trace stream in order", () => {
  it("records one phase per declared phase with its turn count", async () => {
    const events = await record(() => ({
      agentDecl: agent({
        name: "planner",
        phases: [
          phase({ name: "draft", prompt: "draft it", deliverable: simpleDeliverable }),
          phase({ name: "polish", prompt: "polish it", deliverable: simpleDeliverable }),
        ],
      }),
      adapter: fakeAdapter([{ finish: { answer: "a" } }, { finish: { answer: "b" } }]),
    }));

    const model = modelFrom(events);
    const root = model.root;

    expect(root).not.toBeNull();
    expect(root!.agent).toBe("planner");
    expect(root!.status).toBe("done");
    expect(root!.phases.map((p) => p.phase)).toEqual(["draft", "polish"]);
    expect(root!.phases.every((p) => p.status === "done")).toBe(true);
    expect(root!.phases[0]!.deliverable).toEqual({ answer: "a" });
  });
});

describe("a deliverable the model got wrong is counted, not hidden", () => {
  it("counts one attempt per rejected payload and keeps the schema errors", async () => {
    const events = await record(() => ({
      agentDecl: agent({
        name: "planner",
        phases: [phase({ name: "draft", prompt: "draft it", deliverable: simpleDeliverable })],
      }),
      // First payload is missing the required property, so the framework hands
      // the errors back and asks again.
      adapter: fakeAdapter([{ finish: { wrong: 1 } }, { finish: { answer: "ok" } }]),
    }));

    const model = modelFrom(events);
    const draft = model.root!.phases[0]!;

    expect(draft.deliverableAttempts).toBe(2);
    expect(draft.rejections).toHaveLength(1);
    expect(draft.rejections[0]!.join(" ")).toContain("answer");
    expect(draft.deliverable).toEqual({ answer: "ok" });
    expect(summarize(model).rejectedDeliverables).toBe(1);
  });
});

describe("model turns that produce no tool call are counted as nudges", () => {
  it("counts a text-only turn as a nudge", async () => {
    const events = await record(() => ({
      agentDecl: agent({
        name: "planner",
        phases: [phase({ name: "draft", prompt: "draft it", deliverable: simpleDeliverable })],
      }),
      adapter: fakeAdapter([{ text: "let me think about that" }, { finish: { answer: "ok" } }]),
    }));

    const model = modelFrom(events);
    expect(model.root!.phases[0]!.nudges).toBe(1);
    expect(summarize(model).nudges).toBe(1);
  });
});

describe("a sub-agent run nests under the phase that called it", () => {
  it("gives the child its own run keyed by a deeper runId path", async () => {
    const child = agent({
      name: "researcher",
      phases: [phase({ name: "look", prompt: "look it up", deliverable: simpleDeliverable })],
    });

    const events = await record(() => ({
      agentDecl: agent({
        name: "newsroom",
        tools: [
          subAgent({
            name: "research",
            description: "Research a topic.",
            input: { type: "object", properties: { topic: { type: "string" } } } as const,
            agent: child,
          }),
        ],
        phases: [phase({ name: "write", prompt: "write it", deliverable: simpleDeliverable })],
      }),
      // One script feeds both loops: the child runs inside the parent's tool
      // dispatch, so its move sits between the parent's two.
      adapter: fakeAdapter([
        { calls: [{ name: "research", input: { topic: "x" } }] },
        { finish: { answer: "child looked it up" } },
        { finish: { answer: "done" } },
      ]),
    }));

    const model = modelFrom(events);
    const runs = model.all;

    expect(runs).toHaveLength(2);
    expect(runs[0]!.runId).toBe("root");
    expect(runs[1]!.runId).toBe("root.1");
    expect(runs[1]!.parentRunId).toBe("root");
    expect(runs[1]!.agent).toBe("researcher");
    expect(runs[1]!.depth).toBe(1);
    expect(summarize(model).subAgentRuns).toBe(1);
  });
});

describe("a failing tool is counted against the phase that called it", () => {
  it("counts the error without failing the phase", async () => {
    const events = await record(() => ({
      agentDecl: agent({
        name: "planner",
        tools: [
          tool({
            name: "explode",
            description: "Always throws.",
            input: { type: "object", properties: {} } as const,
            handler: async () => {
              throw new Error("boom");
            },
          }),
        ],
        phases: [phase({ name: "draft", prompt: "draft it", deliverable: simpleDeliverable })],
      }),
      adapter: fakeAdapter([
        { calls: [{ name: "explode", input: {} }] },
        { finish: { answer: "recovered" } },
      ]),
    }));

    const model = modelFrom(events);
    const draft = model.root!.phases[0]!;

    expect(draft.toolCalls).toBe(1);
    expect(draft.toolErrors).toBe(1);
    expect(draft.status).toBe("done");
    expect(summarize(model).toolErrors).toBe(1);
  });
});
