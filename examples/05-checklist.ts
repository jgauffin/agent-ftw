// 05 — Multi-phase agent with a checklist (LLM-as-judge verification).
//
// Attaching `checklist` to a phase makes the framework run the deliverable
// through a structured pass/fail verification. The verification runs on the
// checklist's own `adapter` if set, otherwise the phase's adapter — so you can
// point verification at a different (e.g. stronger, or cheaper) model than the
// one that produced the deliverable.
//
// Behavior:
//   - All checks pass  → phase completes, agent moves on.
//   - Any check fails  → the failures are fed back to the main model as a user
//                        message; the phase loop runs once more to revise the
//                        deliverable. The checklist is NOT re-run on the
//                        revision (one round only by design).
//
// Run with:  npx tsx examples/05-checklist.ts

import { agent, checklist, phase } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks } from "./shared.js";

const qualityChecklist = checklist({
  // Verification override: runs on its own adapter instead of the phase's.
  adapter: makeAdapter(),
  prompt:
    "Verify the deliverable. Each `check` represents a quality requirement; " +
    "set passed=false with concrete evidence for any that fail.",
  schema: {
    type: "object",
    properties: {
      checks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            passed: { type: "boolean" },
            evidence: { type: "string" },
          },
          required: ["name", "passed"],
        },
      },
    },
    required: ["checks"],
  } as const,
});

const draftPhase = phase({
  name: "draft",
  prompt:
    "Write a 3-sentence product description. It MUST mention the target " +
    "audience, name a concrete benefit, and end with a call to action.",
  deliverable: {
    type: "object",
    properties: { description: { type: "string" } },
    required: ["description"],
  } as const,
  checklist: qualityChecklist,
});

const polishPhase = phase({
  name: "polish",
  prompt: "Tighten the wording. Keep the same three required elements.",
  deliverable: {
    type: "object",
    properties: { description: { type: "string" } },
    required: ["description"],
  } as const,
});

const copywriter = agent({
  name: "copywriter",
  phases: [draftPhase, polishPhase],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: copywriter,
    defaultAdapter: makeAdapter(),
    hooks: makeHooks(),
  });
  try {
    const result = await session.run("a habit-tracking app for busy parents");
    console.log("\n=== Final ===\n", JSON.stringify(result, null, 2));
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(1);
});
