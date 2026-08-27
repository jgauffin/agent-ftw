# Examples index

The files in [examples/](../examples/) are ordered from simplest to most
complex. Each one is runnable with `npx tsx examples/<file>.ts`.

| #  | File                                                              | Adds                                                   |
|----|-------------------------------------------------------------------|--------------------------------------------------------|
| 01 | [01-simple-agent.ts](../examples/01-simple-agent.ts)              | Single phase. No tools. Structured deliverable.         |
| 02 | [02-agent-with-tool.ts](../examples/02-agent-with-tool.ts)        | One custom `tool()` available in the phase.             |
| 03 | [03-multi-phase.ts](../examples/03-multi-phase.ts)                | Two sequential phases; phase 2 sees phase 1's output.   |
| 04 | [04-multi-phase-tools.ts](../examples/04-multi-phase-tools.ts)    | Agent-wide vs phase-scoped tools; `turnBudget`.         |
| 05 | [05-checklist.ts](../examples/05-checklist.ts)                    | LLM-as-judge `checklist` with one-round revision.       |
| 06 | [06-sub-agents.ts](../examples/06-sub-agents.ts)                  | Outer agent delegates to inner agents via `subAgent()`. |
| 07 | [07-side-quests.ts](../examples/07-side-quests.ts)                | Agent-proposed side quests gated by `askUser`.          |
| 08 | [08-coordinator.ts](../examples/08-coordinator.ts)                | `role: "coordinator"`, `delegable`, delegation contracts. |

## Running

By default the examples talk to a local Ollama at `http://localhost:11434/v1`
with model `llama3.1`. Override via env vars:

```powershell
$env:MODEL_BASE_URL = "https://api.openai.com/v1"
$env:MODEL_NAME     = "gpt-4o-mini"
$env:MODEL_API_KEY  = "sk-..."
npx tsx examples/03-multi-phase.ts
```

To use Claude instead, swap `makeAdapter()` in
[examples/shared.ts](../examples/shared.ts) for either `anthropicApiAdapter({ model: "claude-sonnet-4-6", apiKey: ... })`
(Anthropic API key, needs `@anthropic-ai/sdk`) or `claudeAgentAdapter({ model: "claude-sonnet-4-6" })`
(Claude subscription, needs `@anthropic-ai/claude-agent-sdk` and `zod`).

## Each example is also a module

Every example exports the agents it declares and the adapter it runs against,
and starts its run through `runIfMain(import.meta.url, main)`, which does
nothing unless that file is the one node was told to execute. So importing an
example gives you its declaration without a run starting as a side effect,
which is what lets [the studio](../studio/README.md), a test, or your own code
read them.

If you copy an example as the starting point for your own agent, keep both
habits: export the agent, and guard the run.

## What to read in what order

1. Skim [the architecture notes](./architecture/ReadMe.md) for the data and
   execution model.
2. Read [examples/01-simple-agent.ts](../examples/01-simple-agent.ts), the
   smallest possible program that exercises the whole pipeline.
3. Jump straight to the example that matches your use case; each builds on the
   prior in a small, contained way.
