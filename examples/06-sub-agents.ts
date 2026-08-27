// 06 — Multi-phase agent that delegates to sub-agents.
//
// A `subAgent()` is a tool the parent model can call. When invoked, the
// framework runs the inner AgentDecl as a nested Session run and returns its
// final deliverable as the tool result.
//
// Key properties:
//   - Sub-agents can use a different adapter than the parent: set `adapter` on
//     the inner AgentDecl. When unset, a sub-agent inherits the parent agent's
//     adapter, which itself falls back to the Session's `defaultAdapter`.
//   - Cancellation cascades from parent to sub-agents.
//   - Sub-agent failures surface to the parent as tool errors (the parent
//     model can decide how to react).
//   - Each sub-agent has its own phase list, deliverable schemas, and tools.
//     Tools and turn budgets do NOT inherit from the parent.
//
// Here: a "newsroom" agent runs in two phases. The first phase fans out to
// two specialist sub-agents (researcher + fact-checker). The second phase
// summarizes their findings into a publishable brief.
//
// Run with:  npx tsx examples/06-sub-agents.ts

import { agent, phase, subAgent, tool } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks, runIfMain } from "./shared.js";

// Exported so tooling that reads this file (the studio, a test) gets the same
// model this example runs against, instead of substituting one of its own.
export const adapter = makeAdapter();

// ---------- shared fake "data source" tool ----------
const search = tool({
  name: "search",
  description: "Stub knowledge-base search. Returns a few snippets for a query.",
  input: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  } as const,
  handler: async (input) => {
    const { query } = input as { query: string };
    return {
      query,
      hits: [
        { source: "wiki",  text: `(stub) overview of ${query}` },
        { source: "press", text: `(stub) recent press release about ${query}` },
      ],
    };
  },
});

// ---------- inner agent #1: researcher ----------
export const researcher = agent({
  name: "researcher",
  // Sub-agent with its own adapter override — runs on a separate instance.
  adapter: makeAdapter(),
  phases: [
    phase({
      name: "gather",
      prompt: "Use the search tool to gather 3 facts about the topic.",
      tools: [search],
      turnBudget: 6,
      deliverable: {
        type: "object",
        properties: {
          topic: { type: "string" },
          facts: { type: "array", items: { type: "string" }, minItems: 3 },
        },
        required: ["topic", "facts"],
      } as const,
    }),
  ],
});

// ---------- inner agent #2: fact-checker ----------
export const factChecker = agent({
  name: "fact_checker",
  // No adapter set — inherits the parent agent's adapter (the Session default).
  phases: [
    phase({
      name: "verify",
      prompt:
        "For each claim provided, mark it 'supported' or 'unverified' and " +
        "explain in one sentence.",
      deliverable: {
        type: "object",
        properties: {
          findings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                claim: { type: "string" },
                status: { type: "string", enum: ["supported", "unverified"] },
                note: { type: "string" },
              },
              required: ["claim", "status", "note"],
            },
          },
        },
        required: ["findings"],
      } as const,
    }),
  ],
});

// ---------- expose them as sub-agent tools ----------
const callResearcher = subAgent({
  name: "research_topic",
  description: "Delegate research on a topic to the researcher sub-agent.",
  input: {
    type: "object",
    properties: { topic: { type: "string" } },
    required: ["topic"],
  } as const,
  agent: researcher,
});

const callFactChecker = subAgent({
  name: "verify_claims",
  description: "Delegate claim verification to the fact-checker sub-agent.",
  input: {
    type: "object",
    properties: {
      claims: { type: "array", items: { type: "string" }, minItems: 1 },
    },
    required: ["claims"],
  } as const,
  agent: factChecker,
});

// ---------- outer agent: orchestrates the sub-agents ----------
const investigate = phase({
  name: "investigate",
  prompt:
    "First call research_topic to gather facts about the user's topic. " +
    "Then call verify_claims with those facts. Return both results.",
  tools: [callResearcher, callFactChecker],
  turnBudget: 10,
  deliverable: {
    type: "object",
    properties: {
      topic: { type: "string" },
      facts: { type: "array", items: { type: "string" } },
      verifications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            claim: { type: "string" },
            status: { type: "string" },
            note: { type: "string" },
          },
          required: ["claim", "status", "note"],
        },
      },
    },
    required: ["topic", "facts", "verifications"],
  } as const,
});

const publish = phase({
  name: "publish",
  prompt:
    "Write a 4-sentence editorial brief based on the investigation. Lead " +
    "with the strongest supported fact; flag any unverified claims.",
  deliverable: {
    type: "object",
    properties: {
      headline: { type: "string" },
      brief: { type: "string" },
      caveats: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "brief", "caveats"],
  } as const,
});

export const newsroom = agent({
  name: "newsroom",
  // Authority narrows going down: a sub-agent may only declare tools its parent
  // hands down here. The researcher uses `search`, so the newsroom has to grant
  // it. The fact-checker declares no tools, so it needs no grant.
  delegable: [search],
  phases: [investigate, publish],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: newsroom,
    defaultAdapter: adapter,
    hooks: makeHooks(),
  });
  try {
    const result = await session.run("the rise of small open-source LLMs in 2025");
    console.log("\n=== Final ===\n", JSON.stringify(result, null, 2));
  } finally {
    await session.dispose();
  }
}

runIfMain(import.meta.url, main);
