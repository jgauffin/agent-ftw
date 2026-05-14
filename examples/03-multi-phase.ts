// 03 — Multi-phase agent.
//
// Phases run sequentially. Each phase starts a fresh model conversation, but
// the system prompt for phase N+1 includes the deliverables of phases 1..N.
// The agent's overall result is the deliverable of the *last* phase.
//
// Here: phase 1 brainstorms ideas, phase 2 picks the best one and explains.
//
// Run with:  npx tsx examples/03-multi-phase.ts

import { agent, phase } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks } from "./shared.js";

const brainstorm = phase({
  name: "brainstorm",
  prompt: "Produce 3 distinct project ideas matching the user's request.",
  deliverable: {
    type: "object",
    properties: {
      ideas: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            title: { type: "string" },
            summary: { type: "string" },
          },
          required: ["title", "summary"],
        },
      },
    },
    required: ["ideas"],
  } as const,
});

const pickBest = phase({
  name: "pick_best",
  prompt:
    "Choose the most promising idea from the previous phase. Justify the pick " +
    "in 1–2 sentences and outline the first three concrete steps.",
  deliverable: {
    type: "object",
    properties: {
      title: { type: "string" },
      rationale: { type: "string" },
      first_steps: {
        type: "array",
        items: { type: "string" },
        minItems: 3,
        maxItems: 3,
      },
    },
    required: ["title", "rationale", "first_steps"],
  } as const,
});

const planner = agent({
  name: "planner",
  phases: [brainstorm, pickBest],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: planner,
    defaultAdapter: makeAdapter(),
    hooks: makeHooks(),
  });
  try {
    const result = await session.run("a weekend hack project for a small team");
    console.log("\n=== Final ===\n", JSON.stringify(result, null, 2));
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(1);
});
