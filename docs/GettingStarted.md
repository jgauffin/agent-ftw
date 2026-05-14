# Getting Started

This guide walks you from a clean clone to a running multi-phase agent. If you'd rather read code, the [examples/](../examples/) folder has six progressive scripts (`01-simple-agent.ts` → `06-sub-agents.ts`); the [architecture writeup](architecture/ReadMe.md) is the precise reference.

## 1. Install

```bash
npm install
```

The framework's runtime deps are tiny (`@cfworker/json-schema`, `json-schema-to-ts`). The Anthropic SDKs are **optional peer dependencies**. Install only the one your Claude adapter needs:

| Adapter | Auth | Install |
| --- | --- | --- |
| `openaiCompatAdapter` | none / bearer token | nothing extra |
| `anthropicApiAdapter` | Anthropic **API key** | `npm install @anthropic-ai/sdk` |
| `claudeAgentAdapter` | Claude **subscription** (via Claude Code CLI) | `npm install @anthropic-ai/claude-agent-sdk zod` |

You pick the Claude adapter by which credential you have: an API key *or* a subscription, never both.

## 2. Pick a model backend

You need at least one model. Three common setups:

### Option A: Local model via Ollama (zero cost, no API key)

1. Install [Ollama](https://ollama.com).
2. `ollama pull llama3.1`
3. Done. The default settings in [examples/shared.ts](../examples/shared.ts) target `http://localhost:11434/v1`.

### Option B: OpenAI (or any OpenAI-compatible endpoint)

```powershell
$env:MODEL_BASE_URL = "https://api.openai.com/v1"
$env:MODEL_NAME     = "gpt-4o-mini"
$env:MODEL_API_KEY  = "sk-..."
```

The same env vars work for vLLM, LM Studio, Together, Groq, and anything else that is OpenAI-compatible.

### Option C: Claude

Two adapters, picked by your credential:

- **API key** → `anthropicApiAdapter({ model: "claude-sonnet-4-6", apiKey: ... })` talks to the raw Messages API. See [src/adapters/anthropic-api.ts](../src/adapters/anthropic-api.ts).
- **Subscription** → `claudeAgentAdapter({ model: "claude-sonnet-4-6" })` drives the Claude Agent SDK, and auth goes through the Claude Code CLI. See [src/adapters/claude-agent.ts](../src/adapters/claude-agent.ts).

Install the matching peer dep (see the table in §1), then use it in place of `openaiCompatAdapter`.

## 3. Run an example

```bash
npx tsx examples/01-simple-agent.ts
```

You should see trace output and a final JSON deliverable. If it hangs on the first turn, your model endpoint isn't reachable, so check `MODEL_BASE_URL`.

Walk through the rest in order:

| Example | Concept |
| --- | --- |
| [01-simple-agent.ts](../examples/01-simple-agent.ts) | One phase, one deliverable. |
| [02-agent-with-tool.ts](../examples/02-agent-with-tool.ts) | Adding a custom `tool()`. |
| [03-multi-phase.ts](../examples/03-multi-phase.ts) | Sequential phases; later phases see earlier deliverables. |
| [04-multi-phase-tools.ts](../examples/04-multi-phase-tools.ts) | Per-phase vs agent-wide tools. |
| [05-checklist.ts](../examples/05-checklist.ts) | LLM-as-judge verification with one revision round. |
| [06-sub-agents.ts](../examples/06-sub-agents.ts) | Sub-agents as tools. |
| [07-side-quests.ts](../examples/07-side-quests.ts) | Agent-triggered side quests with user approval. |

## 4. Build your own

The minimum is three concepts: **phase**, **agent**, **session**.

### A phase

```ts
import { phase } from "agent-ftw";

const draft = phase({
  name: "draft",
  prompt: "Write a 3-sentence product blurb.",
  deliverable: {
    type: "object",
    properties: { description: { type: "string" } },
    required: ["description"],
  } as const,
});
```

The `as const` matters because it preserves literal types so `json-schema-to-ts` can infer the deliverable shape.

### An agent

```ts
import { agent } from "agent-ftw";

const writer = agent({
  name: "writer",
  phases: [draft],
});
```

Phases run in order. The agent's final result is the **last** phase's deliverable.

### A session

```ts
import { Session, openaiCompatAdapter } from "agent-ftw";

const session = new Session({
  agent: writer,
  defaultAdapter: openaiCompatAdapter({
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.1",
  }),
  hooks: {
    askUser: async (input) => {
      // Surface this to your UI. Return the user's selection.
      return { selected: [input.options?.[0] ?? ""] };
    },
  },
});

try {
  const result = await session.run("a habit-tracking app for busy parents");
  console.log(result);
} finally {
  await session.dispose();
}
```

That's the whole loop.

### Picking an adapter per construct

`defaultAdapter` drives the whole pipeline, but **any construct can carry its
own `adapter`** to override it: an `agent`, a `phase`, a `checklist`, or a
`sideQuests` spec. Resolution is most-specific-wins:

```
checklist.adapter  ?? phase.adapter ?? agent.adapter ?? session.defaultAdapter
```

A sub-agent (an `agent` with its own `adapter`) overrides for its whole subtree;
when unset it inherits the parent agent's adapter. This is how you mix models,
for example a cheap local model for a draft phase and Claude for the verification step:

```ts
const draft = phase({
  name: "draft",
  prompt: "Write a 3-sentence product blurb.",
  deliverable: { /* ... */ } as const,
  checklist: checklist({
    prompt: "Verify the blurb.",
    schema: { /* ... */ } as const,
    adapter: anthropicApiAdapter({ model: "claude-sonnet-4-6" }), // verify on Claude
  }),
});
```

## 5. Add a tool

```ts
import { tool } from "agent-ftw";

const lookupCity = tool({
  name: "lookup_city",
  description: "Returns latitude and longitude for a city name.",
  input: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  } as const,
  handler: async (input) => {
    const { city } = input as { city: string };
    return { lat: 59.33, lon: 18.07 };
  },
});

const geocode = phase({
  name: "geocode",
  prompt: "Look up the user's city.",
  tools: [lookupCity],
  deliverable: { /* ... */ } as const,
});
```

The framework validates the model's tool-call input against the `input` schema **before** invoking your handler. Handlers receive `unknown` and must narrow the shape themselves (TypeScript depth limits prevent automatic inference here, so see the comment in [src/declare/index.ts](../src/declare/index.ts)).

Tool errors become `isError: true` tool-result turns and are fed back to the model, which then decides what to do.

## 6. Hooks

A host app integrates via these hooks (see [src/hooks/index.ts](../src/hooks/index.ts)):

- `askUser(input, ctx)`: **required.** Surface a prompt with options. The framework appends an `"Other"` option that the model never sees; if the user picks it, free text comes back as `result.other`.
- `review(deliverable, ctx)`: optional. Drives chat-with-revisions for any phase marked `review: true`. Call `ctx.requestRevision(text)` per user message, and resolve when the user approves.
- `requestBudgetExtension(req)`: optional. Called when a phase exhausts its `turnBudget`. The host returns `{ extendBy: N }` to grant N more turns or `{ deny: true }` to let the phase fail. The request includes `originalBudget`, `turnsUsed`, `extensionsGranted`, `suggestedExtension`, the phase's `deliverableSchema`, and a `recentActivity` snapshot (last assistant text plus recent tool calls) so the host can decide on facts. If the hook is unset, exhaustion throws `TurnBudgetExhausted`.
- `trace(event)`: optional. Receives every `TraceEvent` (see [src/trace/index.ts](../src/trace/index.ts) for the full union).

## 7. Where to go next

- [Architecture](architecture/ReadMe.md): the authoritative tour of `src/`. Read this before exploring the source.
- [examples.md](examples.md): narrated walkthrough of the example scripts.
- [test/](../test/): vitest specs are the most precise behavior documentation. The fake adapter in [test/fake-adapter.ts](../test/fake-adapter.ts) is a scripted `Adapter` you can copy when writing your own tests.

## Common gotchas

- **Forgot `as const` on a deliverable schema.** Type inference collapses to `string`/`number`. Add `as const` after the schema literal.
- **`askUser` not implemented.** It's required. The framework calls it for side-quest approval and any tool that uses `ctx.askUser`. Provide a real implementation or auto-pick the first option in dev (see [examples/shared.ts](../examples/shared.ts)).
- **Phase fails with `TurnBudgetExhausted`.** If you want exhausted phases to be extendable, implement the optional `requestBudgetExtension` hook (see [examples/shared.ts](../examples/shared.ts)). Without it, the phase just fails, and the framework does not prompt the user.
- **Tool name collision.** Agent-wide tools, phase tools, and the auto-generated `finish_<phaseName>` must all be unique. Caught at compile.
- **Wrong adapter ran for a phase.** Resolution is most-specific-wins: `checklist.adapter ?? phase.adapter ?? agent.adapter ?? session.defaultAdapter`. A sub-agent inherits the parent agent's adapter unless it sets its own.
- **Checklist always runs now.** A `checklist` runs on `checklist.adapter ?? <the phase's adapter>`, and there's always a `defaultAdapter`, so there is no "skip" path. To verify on a different model, set `adapter` on the `checklist`.
