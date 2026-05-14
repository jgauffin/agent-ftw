// 04 — Multi-phase agent with tools per phase.
//
// Tools can be declared at two scopes:
//   1. agent-level — available in every phase
//   2. phase-level — available only in that phase
//
// Both lists are merged when the phase runs. This example also uses
// `turnBudget` to cap how many model calls a phase may spend. When the budget
// is exhausted, the framework calls the optional `requestBudgetExtension` hook
// (see [shared.ts](./shared.ts)) — the host decides whether to grant more
// turns, and how many. Without that hook, an exhausted phase fails outright.
//
// Run with:  npx tsx examples/04-multi-phase-tools.ts

import { agent, phase, tool } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks } from "./shared.js";

// --- agent-wide tool: a tiny scratchpad for notes ---
const notes: string[] = [];
const writeNote = tool({
  name: "write_note",
  description: "Append a short note to the agent's scratchpad.",
  input: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  } as const,
  handler: async (input) => {
    const { text } = input as { text: string };
    notes.push(text);
    return { ok: true, count: notes.length };
  },
});

// --- phase-1 tool: fetch a (fake) competitor list ---
const fetchCompetitors = tool({
  name: "fetch_competitors",
  description: "Returns a list of competitor product names for a given market.",
  input: {
    type: "object",
    properties: { market: { type: "string" } },
    required: ["market"],
  } as const,
  handler: async (input) => {
    const { market } = input as { market: string };
    return { market, competitors: ["Acme", "Globex", "Initech"] };
  },
});

// --- phase-2 tool: estimate effort ---
const estimateEffort = tool({
  name: "estimate_effort",
  description: "Estimate engineering weeks for a feature description.",
  input: {
    type: "object",
    properties: { feature: { type: "string" } },
    required: ["feature"],
  } as const,
  handler: async (input) => {
    const { feature } = input as { feature: string };
    return { feature, weeks: 1 + (feature.length % 5) };
  },
});

const research = phase({
  name: "research",
  prompt:
    "Identify competitors in the user's market. Use write_note to record any " +
    "interesting observations as you go.",
  tools: [fetchCompetitors],
  turnBudget: 6,
  deliverable: {
    type: "object",
    properties: {
      market: { type: "string" },
      competitors: { type: "array", items: { type: "string" } },
      observations: { type: "array", items: { type: "string" } },
    },
    required: ["market", "competitors", "observations"],
  } as const,
});

const plan = phase({
  name: "plan",
  prompt:
    "Propose 2–3 differentiating features for the product. Estimate effort " +
    "for each using estimate_effort.",
  tools: [estimateEffort],
  turnBudget: 8,
  deliverable: {
    type: "object",
    properties: {
      features: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            why: { type: "string" },
            weeks: { type: "number" },
          },
          required: ["name", "why", "weeks"],
        },
      },
    },
    required: ["features"],
  } as const,
});

const productAgent = agent({
  name: "product",
  tools: [writeNote], // agent-wide; available in every phase
  phases: [research, plan],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: productAgent,
    defaultAdapter: makeAdapter(),
    hooks: makeHooks(),
  });
  try {
    const result = await session.run("an AI-assisted note-taking app");
    console.log("\n=== Final ===\n", JSON.stringify(result, null, 2));
    console.log("\n=== Notes captured ===\n", notes);
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(1);
});
