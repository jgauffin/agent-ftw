// 01 — Simplest possible agent: one phase, no tools.
//
// The agent has a single "phase" with a prompt and a JSON-schema "deliverable".
// The framework auto-injects an `end_phase_<phaseName>` tool whose input matches
// the deliverable schema. The model picks values, calls that tool, and the phase
// returns those values as its output.
//
// Run with:  npx tsx examples/01-simple-agent.ts

import { agent, phase } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks } from "./shared.js";

const greetingPhase = phase({
  name: "greet",
  prompt: "Greet the user and pick a friendly tone.",
  deliverable: {
    type: "object",
    properties: {
      message: { type: "string" },
      tone: { type: "string", enum: ["formal", "casual", "playful"] },
    },
    required: ["message", "tone"],
  } as const,
});

const greeter = agent({
  name: "greeter",
  phases: [greetingPhase],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: greeter,
    defaultAdapter: makeAdapter(),
    hooks: makeHooks(),
  });
  try {
    const result = await session.run("My name is Jonas.");
    console.log("\n=== Final ===\n", result);
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).process?.exit?.(1);
});
