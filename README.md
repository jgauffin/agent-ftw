# agent-ftw

A small TypeScript framework for **structured, multi-phase LLM agents**. You declare an agent as pure data, the framework compiles and validates it, then a `Session` runs it against a pluggable model adapter.

It is deliberately *not* an autonomous-loop framework. Every phase has a JSON-schema deliverable, a turn budget, optional checklist verification, and an optional human-review hook.

## What it does

- **Fresh context per phase.** Each phase starts clean. Only prior phases' structured deliverables carry forward, not the raw turn history. Input tokens don't balloon as the agent progresses.
- **Free local models where they fit.** Route each phase to its own model: frontier where it matters, free local model (Ollama, LM Studio, vLLM) for everything else. Same pipeline, a fraction of the paid-token spend.
- **Reliable structured output between phases.** Each phase emits JSON that matches a schema you defined, or it doesn't end. The next phase reasons about clean data, not raw chat.
- **Predictable runs.** Turn budgets stop runaway loops. Optional LLM-as-judge checklists catch bad output before it propagates. Optional human review for the steps that need it.
- **Compose without losing the plot.** Sub-agents are tools. Side quests are scoped, user-approved detours. Everything still ends with a typed deliverable.
- **Model-agnostic, no vendor lock-in.** Works with any OpenAI-compatible endpoint and with the Claude SDK. Mix providers freely across phases.

See [docs/architecture/ReadMe.md](docs/architecture/ReadMe.md) for the full architecture writeup.

## Requirements

- **Node.js 22+** and a TypeScript toolchain (the project targets ESM).
- **At least one model backend.** A free local model (Ollama / LM Studio / vLLM) is enough, and no API key is required.
- Runtime dependencies are tiny: `@cfworker/json-schema` and `json-schema-to-ts`.
- The Anthropic SDKs are **optional peer dependencies**. Install only the one your Claude adapter needs:

  | Adapter | Auth | Extra install |
  | --- | --- | --- |
  | `openaiCompatAdapter` | none / bearer token | nothing |
  | `anthropicApiAdapter` | Anthropic API key | `@anthropic-ai/sdk` |
  | `claudeAgentAdapter` | Claude subscription (via Claude Code CLI) | `@anthropic-ai/claude-agent-sdk` `zod` |

## Install

```bash
npm install agent-ftw
```

Then import what you need:

```ts
import { agent, phase, checklist, Session, openaiCompatAdapter } from "agent-ftw";
```

New to the project? [docs/GettingStarted.md](docs/GettingStarted.md) walks from a clean clone to a running agent, and [examples/](examples/) has seven progressive scripts (`01-simple-agent.ts` → `07-side-quests.ts`).

## Core concepts

A handful of terms show up everywhere. Here is the whole vocabulary:

- **Phase**: one stage of the pipeline. It has a prompt, a JSON-schema **deliverable**, and a turn budget. Phases run as a strict sequence.
- **Deliverable**: the JSON output a phase must produce. The phase cannot end until the model emits output matching the schema, and the result is statically typed from that schema.
- **Agent**: a named, ordered list of phases, declared as plain data.
- **Session**: the runner. It takes an agent plus its adapter(s), executes the phases, and returns the final phase's typed deliverable.
- **Adapter**: the model backend for a phase (OpenAI-compatible, Anthropic API, or Claude Agent SDK). It can be set per session, per agent, per phase, or per checklist.
- **Turn budget**: a hard cap on model turns within a phase. It stops runaway loops.
- **Checklist**: an optional LLM-as-judge pass that verifies a phase's deliverable, often on a cheaper or local adapter, before it is accepted.
- **Sub-agent**: another agent exposed to a phase as a tool call.
- **Side quest**: a scoped, user-approved detour from the declared pipeline. It still ends with a typed deliverable.

## Quick taste

A bug-triage agent: phase 1 reads the report and produces a structured triage record, phase 2 sees that record (not the raw chat) and proposes a fix plan. Each phase is forced to emit JSON matching its schema; phase 2 starts with a fresh model context plus phase 1's deliverable.

```ts
import { agent, phase, checklist, Session, openaiCompatAdapter } from "agent-ftw";

const triage = phase({
  name: "triage",
  prompt: "Read the bug report. Classify it and extract the reproduction signal.",
  deliverable: {
    type: "object",
    properties: {
      severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
      area: { type: "string", enum: ["api", "ui", "db", "build", "other"] },
      reproSteps: { type: "array", items: { type: "string" }, minItems: 1 },
      suspectedCause: { type: "string" },
    },
    required: ["severity", "area", "reproSteps", "suspectedCause"],
  } as const,
});

const plan = phase({
  name: "plan",
  prompt:
    "Given the triage, propose a minimal fix. List the files you'd touch and " +
    "the test you'd write first (we always reproduce before fixing).",
  deliverable: {
    type: "object",
    properties: {
      filesToTouch: { type: "array", items: { type: "string" }, minItems: 1 },
      reproTest: { type: "string" },
      fixSummary: { type: "string" },
    },
    required: ["filesToTouch", "reproTest", "fixSummary"],
  } as const,
  // Verify the plan on a separate (here, cheap local) adapter before accepting it.
  checklist: checklist({
    adapter: openaiCompatAdapter({ baseUrl: "http://localhost:11434/v1", model: "llama3.1" }),
    prompt: "Each check is a quality gate. Mark passed=false with evidence if it fails.",
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
  }),
});

const triager = agent({
  name: "bug_triager",
  phases: [triage, plan],
});

const session = new Session({
  agent: triager,
  // Pipeline-wide adapter; any agent/phase/checklist can override it with its own `adapter`.
  defaultAdapter: openaiCompatAdapter({ baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", apiKey: process.env.OPENAI_API_KEY }),
  hooks: { askUser: async (i) => ({ selected: [i.options?.[0] ?? ""] }) },
});

const fixPlan = await session.run(
  "Users report 500s when uploading PNGs > 4MB. Started after Tuesday's deploy."
);
// fixPlan is the *plan* phase's deliverable, typed by its schema.
```

What this snippet demonstrates that a single-loop agent can't:

- **Schema-enforced handoff.** Phase 2 cannot start until phase 1 emits a valid triage record. No "the model forgot to include severity" failure mode.
- **Context isolation.** Phase 2's model context is the system prompt plus phase 1's structured deliverable, not the raw triage chat. The plan phase reasons about clean data.
- **Mixed models per stage, including free local ones.** Triage and planning here use a paid model (the session `defaultAdapter`), while the checklist runs on a local Ollama model via its own `adapter`. Cheap phases stay off your paid quota, so you burn through token and rate limits much more slowly. For a heavier pipeline (say a 5-phase agent), routing the boilerplate phases to a local model can cut paid-token spend by an order of magnitude. Just set `adapter` on those phases.
- **Typed final result.** `fixPlan` is shaped by the last phase's schema, not by hoping the model output parses.

Get going: [docs/GettingStarted.md](docs/GettingStarted.md).

## Honest comparison to other agent frameworks

This isn't a general-purpose agent framework. It picks a narrow shape and commits to it. Whether that's a fit depends on what you're building.

### vs. LangChain / LangGraph

LangChain (and LangGraph, its graph-based successor) gives you a large surface area: chains, retrievers, memory abstractions, dozens of integrations, and arbitrary graph topologies. It's a toolkit for assembling almost any agent shape you can imagine.

- **Where LangChain wins:** ecosystem breadth, retrieval/RAG plumbing, integrations with vector stores and document loaders, arbitrary control flow via graphs, Python-first ecosystem.
- **Where agent-ftw wins:** smaller surface area, no abstractions you don't pay for, JSON-schema deliverables enforced at the framework level (not via brittle output parsers), strict turn budgets, no hidden state. The whole `src/` tree is a few hundred lines.
- **Pick LangGraph if:** you need cyclic or branching control flow, multi-tool RAG, or want the integrations.
- **Pick this if:** your agent is naturally a sequence of structured steps and you'd rather read and own the framework than depend on one.

### vs. Anthropic Claude Agent SDK / OpenAI Agents SDK

Both vendor SDKs give you a polished single-loop runner with built-in tool use, hooks, and (for Claude) sub-agents and slash commands. They're optimized for one model family.

- **Where the vendor SDKs win:** tight model integration, prompt caching done right, vendor-supported features (computer use, file search, code interpreter), production-grade telemetry.
- **Where agent-ftw wins:** model-agnostic by construction (one of the shipped adapters *uses* the Claude Agent SDK under the hood for one phase, while a different phase can hit a local Ollama model), structured multi-phase pipelines as a first-class concept, declarative side-quest catalog with user approval, no vendor lock-in. The biggest practical win: phases that don't need a frontier model run on a free local model, so you bleed paid tokens and rate-limit headroom dramatically slower than a single-loop vendor SDK that sends every turn to the same paid endpoint.
- **Pick a vendor SDK if:** you're committed to one model and want every advanced vendor feature.
- **Pick this if:** you want to mix models per phase (frontier model drafts, free local model verifies / does the boilerplate phases), or you want the pipeline shape enforced rather than implemented as prompts.

### vs. Microsoft AutoGen / CrewAI

AutoGen and CrewAI are multi-agent orchestration frameworks: a "crew" of role-playing agents converse and delegate.

- **Where AutoGen/CrewAI win:** rich multi-agent conversation patterns, role-based design, lots of community examples for "team of specialists" setups.
- **Where agent-ftw wins:** deterministic phase ordering, explicit JSON-schema deliverables instead of free-form chatter, no inter-agent dialogue magic to debug. Sub-agents are tool calls, not chat participants.
- **Pick AutoGen/CrewAI if:** you actually want emergent multi-agent dialogue.
- **Pick this if:** you want one agent that knows what it's doing in stages, with structured handoffs.

### vs. rolling your own loop

Honestly, for a one-off script, you should. A `while` loop, a switch on tool calls, and a JSON parse get you most of the way. This framework starts paying off around the time you want any of the following without writing the plumbing for each: schema-validated phase outputs with auto-revision, turn budgets, checklists, side quests, or human review.

### What this framework deliberately does *not* do

- **No retrieval / RAG.** Bring your own. A tool handler can call whatever vector store you like.
- **No memory abstraction.** Phases pass structured deliverables forward; that's the only "memory."
- **No graph DAGs.** Phases are a strict sequence. Branching is done by sub-agents or side quests, not graph edges.
- **No prompt templates / chains.** Prompts are strings. Schemas do the structure.
- **No autonomous "keep going until done" mode.** Every phase ends explicitly via `finish_<phase>` or runs out of turns.

If those omissions are dealbreakers, one of the larger frameworks is a better fit.

## Contributing / local development

```bash
git clone https://github.com/jgauffin/agent-ftw.git
cd agent-ftw
npm install

npm run typecheck   # tsc --noEmit
npm run test        # vitest run, 84 tests
npm run build       # typecheck + test + emit dist/
npm run docs        # generate API docs via typedoc
```

Integration tests (which hit real model endpoints) live in [test-integration/](test-integration/) and run via `npm run test:integration`.

Two house rules, also in [CLAUDE.md](CLAUDE.md):

- Always write a test that reproduces a bug before fixing it.
- Update tests when features change or are added.

## Status

`0.2.4`. The shape is stable, and the API surface is small enough to read in one sitting (see [src/index.ts](src/index.ts)). Tests are vitest-based and live in [test/](test/). They are the most precise behavior documentation.

## License

[MIT](LICENSE) © Jonas Gauffin
