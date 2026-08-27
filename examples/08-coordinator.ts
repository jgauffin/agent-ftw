// 08 — Coordinator and contracts
//
// A coordinator decides who does the work; workers do it. What keeps the tree
// under control is not the prompt, it is what each node is physically able to
// do:
//
//   - The coordinator holds no mutating tool, so it cannot quietly abandon its
//     own plan and start editing files itself. It can still hand that authority
//     down, which is why `tools` and `delegable` are separate lists.
//   - Turns are conserved. The Session's `turnBudget` covers the whole tree;
//     each contract's allocation comes out of the coordinator's own balance, so
//     no arrangement of children can spend more than the root was given.
//   - `delegate` takes the whole batch at once. It is checked as a unit before
//     anything starts, so a decomposition that does not add up costs nothing.
//   - Contracts that write to the same place are run one after another rather
//     than together.
//
// Run: npx tsx examples/08-coordinator.ts

import { agent, phase, subAgent, tool } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks, runIfMain } from "./shared.js";

// Exported so tooling that reads this file (the studio, a test) gets the same
// model this example runs against, instead of substituting one of its own.
export const adapter = makeAdapter();

// ---------- tools ----------

// A stand-in for a real repo, so reads see what writes actually did. Tools that
// disagree with each other are their own kind of drift: a child whose writes
// vanish is right to report that it is blocked, and this example is about the
// control mechanics rather than that.
const repo = new Map<string, string>([
  ["src/util/time.ts", "// src/util/time.ts\nexport function now(): number {\n  return Date.now();\n}\n"],
]);

// Read-only: safe for anyone to hold, including the coordinator.
const readSource = tool({
  name: "readSource",
  description: "Read a source file. Returns an empty string if it does not exist yet.",
  input: {
    type: "object",
    properties: { path: { type: "string", description: "Repo-relative path." } },
    required: ["path"],
  } as const,
  handler: async (input) => {
    const { path } = input as { path: string };
    return repo.get(path) ?? "";
  },
});

// `mutates: true` is the author saying this changes things. A coordinator may
// not hold it, and any contract granting it must say where it may write.
const writeSource = tool({
  name: "writeSource",
  description: "Write a source file.",
  input: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repo-relative path." },
      contents: { type: "string", description: "Full new contents of the file." },
    },
    required: ["path", "contents"],
  } as const,
  mutates: true,
  handler: async (input, ctx) => {
    const { path, contents } = input as { path: string; contents: string };
    // The contract's write-set reaches the handler, and the handler is the only
    // place a stray path can actually be stopped. The framework checks that
    // concurrent contracts do not overlap and that reported evidence stays
    // inside the set, but it does not own the filesystem.
    if (ctx.writeSet && !ctx.writeSet.includes(path)) {
      throw new Error(`refusing to write ${path}: outside this contract's write-set`);
    }
    repo.set(path, contents);
    return `wrote ${path} (${contents.length} bytes)`;
  },
});

// ---------- workers ----------

export const implementer = agent({
  name: "implementer",
  phases: [
    phase({
      name: "implement",
      prompt:
        "Make the change described in your objective. Read what you need, then write the file. " +
        "Record every file you write as evidence.",
      tools: [readSource, writeSource],
      turnBudget: 8,
      deliverable: {
        type: "object",
        properties: {
          summary: { type: "string", description: "What you changed, in one sentence." },
          filesWritten: {
            type: "array",
            items: { type: "string", description: "Repo-relative path you wrote." },
          },
        },
        required: ["summary", "filesWritten"],
      } as const,
    }),
  ],
});

export const reviewer = agent({
  name: "reviewer",
  phases: [
    phase({
      name: "review",
      prompt:
        "Review the change described in your objective. Read the file and say whether it does what was asked.",
      tools: [readSource],
      turnBudget: 6,
      deliverable: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: ["approve", "revise"] },
          notes: { type: "string", description: "What is wrong, or why it is fine." },
        },
        required: ["verdict", "notes"],
      } as const,
    }),
  ],
});

// ---------- coordinator ----------

export const lead = agent({
  name: "lead",
  role: "coordinator",
  // What the coordinator may call itself. Nothing here changes anything.
  tools: [readSource],
  // What it may hand down. Authority narrows going down: a sub-agent may only
  // declare tools that appear here.
  delegable: [readSource, writeSource],
  phases: [
    phase({
      name: "deliver",
      prompt:
        "You are leading a small change. Break it into contracts and call `delegate` ONCE with all " +
        "of them. Give each child a narrow objective, the tools it needs and nothing more, the paths " +
        "it may write, and a turn allocation out of your own balance. Then summarise what came back. " +
        "You cannot edit anything yourself.",
      turnBudget: 12,
      tools: [
        subAgent({
          name: "call_implementer",
          description: "Make a code change.",
          input: {
            type: "object",
            properties: { task: { type: "string", description: "What to change." } },
            required: ["task"],
          } as const,
          agent: implementer,
          // Host TypeScript, deliberately not another model call: a check that
          // can be talked out of its verdict is not a check.
          accept: async (result, evidence, ctx) => {
            const written = (result as { filesWritten?: string[] }).filesWritten ?? [];
            if (written.length === 0) {
              return { ok: false, reason: "you reported no files written; nothing was changed" };
            }
            if (evidence.length === 0) {
              return { ok: false, reason: "give evidence for what you changed" };
            }
            if (!ctx.restatement.trim()) {
              return { ok: false, reason: "restate the objective so I can check you understood it" };
            }
            return { ok: true };
          },
          maxRejects: 1,
        }),
        subAgent({
          name: "call_reviewer",
          description: "Review a change someone else made.",
          input: {
            type: "object",
            properties: { task: { type: "string", description: "What to review." } },
            required: ["task"],
          } as const,
          agent: reviewer,
          // A reviewer that says "revise" without saying what is wrong has not
          // reviewed anything, and the coordinator has nothing to act on.
          accept: async (result) => {
            const { verdict, notes } = result as { verdict: string; notes: string };
            if (verdict === "revise" && notes.trim().length === 0) {
              return { ok: false, reason: "say what needs revising, not just that it does" };
            }
            return { ok: true };
          },
        }),
      ],
      deliverable: {
        type: "object",
        properties: {
          outcome: { type: "string", description: "What was delivered, in one sentence." },
          contractsRun: { type: "number", description: "How many children you contracted." },
        },
        required: ["outcome", "contractsRun"],
      } as const,
    }),
  ],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: lead,
    defaultAdapter: adapter,
    hooks: makeHooks(),
    // Covers the whole tree, sub-agents included.
    turnBudget: 60,
    // Root plus two levels below it.
    maxDepth: 3,
    // Children any one coordinator run may contract, across all its batches.
    maxFanOut: 4,
  });
  try {
    const result = await session.run(
      "Add a `formatDuration(ms)` helper to src/util/time.ts and have it reviewed."
    );
    console.log("\n=== Final ===\n", JSON.stringify(result, null, 2));
  } finally {
    await session.dispose();
  }
}

runIfMain(import.meta.url, main);
