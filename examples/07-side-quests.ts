// 07 — Side quests: two ways to branch off the main pipeline.
//
//   A) Host-triggered fork — the host UI decides to spawn a *side exploration*
//      using the same pipeline. The fork inherits the parent's last completed
//      phase deliverable as its seed input. The fork is an independent Session
//      with its own AbortController.
//
//   B) Agent-triggered side quest — the agent calls the auto-injected
//      `propose_side_quest` tool with a goal + a subset of the configured
//      catalog. The host approves (or narrows) the requested toolset via
//      `askUser`. A single-phase child agent runs with the approved tools and
//      its result returns to the parent's current phase as the tool's output.
//
// Run with:  npx tsx examples/07-side-quests.ts

import { agent, phase, tool, SIDE_QUEST_TOOL_NAME } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks } from "./shared.js";

// ---------- catalog tools the agent may request for a side quest ----------
const lookup = tool({
  name: "lookup",
  description: "Stub knowledge-base lookup.",
  input: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  } as const,
  handler: async (input) => {
    const { query } = input as { query: string };
    return { query, hit: `(stub) result for "${query}"` };
  },
});

const probe = tool({
  name: "probe",
  description: "Stub network probe.",
  input: {
    type: "object",
    properties: { target: { type: "string" } },
    required: ["target"],
  } as const,
  handler: async (input) => {
    const { target } = input as { target: string };
    return { target, status: "(stub) reachable" };
  },
});

// ---------- main agent ----------
const planner = agent({
  name: "planner",
  phases: [
    phase({
      name: "plan",
      prompt:
        `You are planning an investigation. Outline the steps. If something ` +
        `unrelated catches your attention and you want to dig in, you may call ` +
        `${SIDE_QUEST_TOOL_NAME} to launch a bounded side quest. The host will ` +
        `confirm before any side quest runs.`,
      deliverable: {
        type: "object",
        properties: {
          steps: { type: "array", items: { type: "string" }, minItems: 1 },
          notes: { type: "string" },
        },
        required: ["steps", "notes"],
      } as const,
      turnBudget: 10,
    }),
  ],
  // Opt in to agent-triggered side quests (feature B).
  sideQuests: {
    mode: "agent",
    catalog: [lookup, probe],
    deliverable: {
      type: "object",
      properties: {
        finding: { type: "string" },
        confidence: { type: "string", enum: ["low", "medium", "high"] },
      },
      required: ["finding", "confidence"],
    } as const,
    turnBudget: 6,
  },
});

async function main(): Promise<void> {
  const session = new Session({
    agent: planner,
    defaultAdapter: makeAdapter(),
    hooks: makeHooks(),
  });

  try {
    const result = await session.run("Investigate why the deploy queue is backed up.");
    console.log("\n=== Main run ===\n", JSON.stringify(result, null, 2));

    // Feature A: host-triggered fork. The host UI decided to spawn a side
    // exploration of the same pipeline, seeded with the parent's deliverable.
    const { session: forked, seed } = await session.fork({ seed: "deliverable" });
    try {
      const forkResult = await forked.run(seed);
      console.log("\n=== Forked side-exploration ===\n", JSON.stringify(forkResult, null, 2));
    } finally {
      await forked.dispose();
    }
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(1);
});
