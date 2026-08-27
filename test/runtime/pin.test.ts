import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agent, phase } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { pinDeliverables } from "../../src/runtime/pin.js";
import type { TraceEvent } from "../../src/trace/index.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";

// Pinning is how a phase gets iterated on without paying for the phases before
// it every time. What has to hold: a pinned phase consumes no turns, the phase
// after it sees the pinned value, and the trace still reads as a whole run.

const deliverable = {
  type: "object",
  properties: { text: { type: "string", description: "Anything." } },
  required: ["text"],
} as const;

const planner = agent({
  name: "planner",
  phases: [
    phase({ name: "brainstorm", prompt: "Think of something.", deliverable }),
    phase({ name: "refine", prompt: "Improve it.", deliverable }),
  ],
});

let directory: string;
const hooks = { askUser: async () => ({ selected: [] }) };

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-ftw-pin-"));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe("a pinned phase is not run again", () => {
  it("starts at the first unpinned phase and spends no turns on the pinned one", async () => {
    await pinDeliverables({
      directory,
      agentName: "planner",
      sessionId: "pinned",
      deliverables: { brainstorm: { text: "a pinned idea" } },
    });

    // One move only. A script this short proves brainstorm never reached the
    // model: a second phase running would exhaust it.
    const adapter = fakeAdapter([{ finish: { text: "refined" } }]);
    const session = new Session({
      agent: planner,
      defaultAdapter: adapter,
      hooks,
      sessionDirectory: directory,
      sessionId: "pinned",
    });

    try {
      const out = await session.run("go");
      expect(out).toEqual({ text: "refined" });
    } finally {
      await session.dispose();
    }
  });

  it("still reports the pinned phase, so the timeline is not missing a step", async () => {
    await pinDeliverables({
      directory,
      agentName: "planner",
      sessionId: "pinned",
      deliverables: { brainstorm: { text: "a pinned idea" } },
    });

    const events: TraceEvent[] = [];
    const session = new Session({
      agent: planner,
      defaultAdapter: fakeAdapter([{ finish: { text: "refined" } }]),
      hooks: { ...hooks, trace: (e: TraceEvent) => events.push(e) },
      sessionDirectory: directory,
      sessionId: "pinned",
    });

    try {
      await session.run("go");
    } finally {
      await session.dispose();
    }

    const phases = events
      .filter((e) => e.type === "phase.start" || e.type === "phase.end")
      .map((e) => `${e.type} ${(e as { phase: string }).phase}`);

    expect(phases).toEqual([
      "phase.start brainstorm",
      "phase.end brainstorm",
      "phase.start refine",
      "phase.end refine",
    ]);

    const pinnedEnd = events.find((e) => e.type === "phase.end" && (e as { phase: string }).phase === "brainstorm");
    expect((pinnedEnd as { deliverable: unknown }).deliverable).toEqual({ text: "a pinned idea" });
    // No model turn belongs to the pinned phase.
    expect(events.filter((e) => e.type === "model.turn" && (e as { phase: string }).phase === "brainstorm")).toHaveLength(0);
  });
});

describe("an edited pin is what the next phase actually sees", () => {
  it("carries the edited value into the following phase's context", async () => {
    // This is the point of editing a pin: asking what a later phase does when
    // the one before it returns something different, without re-running it.
    await pinDeliverables({
      directory,
      agentName: "planner",
      sessionId: "edited",
      deliverables: { brainstorm: { text: "an idea I typed by hand" } },
    });

    const adapter = fakeAdapter([{ finish: { text: "refined" } }]);
    const session = new Session({
      agent: planner,
      defaultAdapter: adapter,
      hooks,
      sessionDirectory: directory,
      sessionId: "edited",
    });

    try {
      await session.run("go");
    } finally {
      await session.dispose();
    }

    const prompt = adapter.seenSystemPrompts.join("\n");
    expect(prompt).toContain("an idea I typed by hand");
  });
});

describe("pinning nothing leaves an ordinary run", () => {
  it("runs every phase when no deliverable is pinned", async () => {
    await pinDeliverables({
      directory,
      agentName: "planner",
      sessionId: "empty",
      deliverables: {},
    });

    const adapter = fakeAdapter([{ finish: { text: "one" } }, { finish: { text: "two" } }]);
    const session = new Session({
      agent: planner,
      defaultAdapter: adapter,
      hooks,
      sessionDirectory: directory,
      sessionId: "empty",
    });

    try {
      expect(await session.run("go")).toEqual({ text: "two" });
    } finally {
      await session.dispose();
    }
  });
});
