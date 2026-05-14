# Architecture

Read this file before exploring `src/`. It is the authoritative orientation
document for the framework.

## What this is

A small TypeScript framework for **structured, multi-phase LLM agents**. You
declare an agent as pure data (an `AgentDecl`), the framework compiles &
validates it, then a `Session` runs it against a pluggable model adapter.

It is deliberately *not* an autonomous-loop framework: every phase has a
JSON-schema deliverable, a turn budget, optional checklist verification, and an
optional human-review hook.

## Directory layout

```
src/
  declare/   - pure-data factories: agent(), phase(), tool(), subAgent(), checklist()
  schema/    - JSONSchema type + validator (uses @cfworker/json-schema)
  compile/   - validate(AgentDecl) -> CompiledAgent (cycle/duplicate detection,
               injects auto-generated `finish_<phase>` tool)
  adapters/  - types.ts (Adapter interface), run-helpers.ts (shared loop plumbing),
               openai-compat.ts, anthropic-api.ts, claude-agent.ts
  runtime/
    session.ts    - root: owns cancellation tree, trace bus, askUser FIFO, fork()
    agent-run.ts  - one node in the run tree (top-level or sub-agent)
    phase-run.ts  - drives a single phase: model loop -> validate -> checklist -> review
    dispatch.ts   - tool dispatch + sub-agent invocation + side-quest dispatch
    side-quest.ts - agent-triggered side quest: askUser gate + synthesized child run
  hooks/     - Hooks interface: askUser, review, requestBudgetExtension, trace
  trace/     - TraceEvent union + TraceBus
  index.ts   - public surface

test/        - vitest specs; fake-adapter.ts is a scripted Adapter for tests
examples/    - progressive examples (01 simple -> 07 side-quests)
docs/        - this folder
```

## Core data model

```
AgentDecl
├── name
├── adapter?         Adapter                    (overrides the session defaultAdapter)
├── tools            ToolDecl | SubAgentDecl     (agent-wide; merged into every phase)
└── phases[]
    └── PhaseDecl
        ├── name, prompt
        ├── deliverable    JSONSchema             (becomes the auto `finish_<name>` tool's input)
        ├── adapter?       Adapter                (overrides the agent's adapter for this phase)
        ├── tools          ToolDecl | SubAgentDecl  (phase-only)
        ├── checklist?     ChecklistDecl          (ChecklistDecl.adapter? overrides the phase's)
        ├── turnBudget?    number                 (default 30)
        └── review?        boolean                (top-level only)
```

Adapter resolution is most-specific-wins:
`checklist.adapter ?? phase.adapter ?? agent.adapter ?? session.defaultAdapter`.
A sub-agent inherits the parent agent's resolved adapter unless it sets its own.

`agent()`, `phase()`, `tool()`, `subAgent()`, `checklist()` are factories in
[src/declare/index.ts](../src/declare/index.ts). They return plain readonly
objects with a discriminator (`kind: "tool" | "subAgent" | ...`), with no classes
and no freezing.

## Execution model

```
Session.run(input)
  └── AgentRun (root)              ← one per AgentDecl invocation; nested for sub-agents
       └── for each phase:
            PhaseRun.execute(initialInput)
              ├── runLoop          → adapter.runUntilPhaseEnd → payload
              ├── ensureValidDeliverable  (re-loops with feedback if schema fails)
              ├── runChecklist?    (one revision round on failure, then accept)
              ├── runReview?       (top-level only; chats via hooks.review)
              └── emit phase.end
       └── return last phase's deliverable
```

**Key behaviors that aren't obvious from reading individual files:**

- The framework auto-injects `finish_<phaseName>` as a tool whose input schema
  IS the deliverable. The model finishes a phase by calling this tool, and the
  adapter intercepts that call and short-circuits the loop with the payload.
  See [src/compile/index.ts:94](../src/compile/index.ts#L94) and
  [src/adapters/openai-compat.ts:113](../src/adapters/openai-compat.ts#L113).
- Tool name collisions are caught at compile: agent-wide + phase + the auto
  `finish_<name>` must all be unique.
- Sub-agents are validated **lazily** at the parent's compile, but a fresh
  `validate()` is run when each sub-agent is actually spawned (see
  [src/runtime/agent-run.ts:42](../src/runtime/agent-run.ts#L42)).
- Multi-phase: phase N+1's system prompt is rebuilt from scratch and includes a
  `Prior phase deliverables:` block listing every prior phase's payload as JSON.
  No model context is carried across phases, only the structured deliverables.
- Tool input is validated against its JSON schema **before** the handler runs.
  Handlers receive `unknown` and must narrow themselves (the project tried
  json-schema-to-ts inference and hit TS depth limits, so see the comment in
  [src/declare/index.ts](../src/declare/index.ts)).
- Tool errors are converted to tool-result turns marked `isError: true` and fed
  back to the model, which then decides how to react. Sub-agent failures
  surface as tool errors to the parent.
- Cancellation: `Session` owns a root AbortController; each AgentRun creates a
  child controller linked to its parent. Cancelling the session cascades.
- `askUser` is FIFO-serialized at the Session level so concurrent sub-agents
  don't race for the user. The framework appends an `"Other"` option that the
  model never sees; if the user picks it, the free text comes back as
  `result.other` (not in `selected`).
- Turn budget: every model turn calls `ctx.consumeTurn()`. When exhausted, the
  framework invokes the optional `Hooks.requestBudgetExtension` with a snapshot
  (original budget, turns used, prior extensions, suggested extension, recent
  assistant text + tool calls, deliverable schema). The host returns
  `{ extendBy: N }` to grant N more turns or `{ deny: true }` to let the phase
  fail. If the hook is unset the phase fails with `TurnBudgetExhausted`, and the
  framework never falls back to `askUser` for this. `extendBy <= 0` is treated
  as a deny so a misconfigured hook can't loop forever. Tool calls don't count
  toward the budget, only model turns.
- Side quests come in two flavors:
  - **Host-triggered (A)**: `Session.fork({ seed: "deliverable" | "summarize" })`
    returns `{ session, seed }`. The host gets an independent child Session
    running the *same* compiled pipeline, seeded either with the parent's last
    phase deliverable (free) or with a `runStructured` summary call against the
    session's `defaultAdapter`. The fork has its own AbortController.
  - **Agent-triggered (B)**: opt-in per `AgentDecl` via
    `sideQuests: { mode: "agent", catalog, deliverable, turnBudget?, maxDepth? }`.
    Compile injects a `propose_side_quest` tool (well-known name in
    `SIDE_QUEST_TOOL_NAME`). When the model calls it, dispatch surfaces an
    `askUser` showing the *full catalog* (not just the requested subset) so the
    user can widen or narrow the toolset. On approval, a single-phase child
    `AgentRun` is synthesized with the approved tools and the configured
    deliverable schema; its result returns to the parent as the tool result.
    Depth is enforced declaratively: the synthesized agent has no `sideQuests`,
    so it cannot itself spawn one (`maxDepth: 1` is the default).

## Adapters

`Adapter` (in [src/adapters/types.ts](../src/adapters/types.ts)) has just two
methods:

- `runUntilPhaseEnd(ctx)` drives the model-to-tool loop until the phase-end tool
  is called (or the budget is exhausted).
- `runStructured(args)` makes a one-shot forced tool call, used for checklists and
  for `Session.fork({ seed: "summarize" })`.

A `Session` takes one `defaultAdapter`. Any `AgentDecl`, `PhaseDecl`,
`ChecklistDecl`, or `SideQuestsDecl` may carry its own `adapter` to override it
(see "Core data model" for the resolution order). `Session.dispose()` walks the
compiled tree and disposes every distinct adapter it finds.

Three adapters ship, each self-contained on one auth model and package:

- [openai-compat.ts](../src/adapters/openai-compat.ts) is generic
  OpenAI-compatible HTTP (Ollama, LM Studio, OpenAI, vLLM, …). Zero deps.
- [anthropic-api.ts](../src/adapters/anthropic-api.ts) is Claude via the raw
  Messages API (API-key auth). Optional peer dep: `@anthropic-ai/sdk`.
- [claude-agent.ts](../src/adapters/claude-agent.ts) is Claude via the Claude
  Agent SDK (subscription auth, through the Claude Code CLI). Optional peer
  deps: `@anthropic-ai/claude-agent-sdk` and `zod`.

The hand-driven model loop shared by openai-compat and anthropic-api lives in
[run-helpers.ts](../src/adapters/run-helpers.ts) (`appendAssistantTurn`,
`handleNoToolCalls`, `dispatchAndAppend`). That trio *is* the framework's Turn
protocol. Optional peer deps are imported lazily, so an adapter you don't use
costs nothing.

The fake adapter in [test/fake-adapter.ts](../test/fake-adapter.ts) is a
scripted `Adapter`. Read it before writing tests; the script format is a list
of `{ calls?, finish? }` moves.

## Hooks

[Hooks](../src/hooks/index.ts) is the integration boundary for a host app:

- `askUser(input, ctx)`: required. Surface a prompt with options to the user.
- `review(deliverable, ctx)`: optional. Drives chat-with-revisions during a
  reviewable phase. Call `ctx.requestRevision(text)` per user message; resolve
  when the user approves.
- `requestBudgetExtension(req)`: optional. Called when a phase's `turnBudget`
  is exhausted. The host returns `{ extendBy: N }` to grant N more turns or
  `{ deny: true }` to let the phase fail. The request carries enough context
  (`originalBudget`, `turnsUsed`, `extensionsGranted`, `suggestedExtension`,
  `recentActivity`, `deliverableSchema`) for the host to apply its own policy
  or surface a meaningful prompt to its user. If unset, exhaustion fails.
- `trace(event)`: optional. Receives every `TraceEvent` (see
  [src/trace/index.ts](../src/trace/index.ts) for the full discriminated union).

## Public API surface

Everything is re-exported from [src/index.ts](../src/index.ts). The public
surface is intentionally small: factories, types, `Session`,
`openaiCompatAdapter`, `anthropicApiAdapter`, `claudeAgentAdapter`,
`TurnBudgetExhausted`.

## Session persistence

Sessions can be persisted to disk and resumed after a crash by passing
`sessionDirectory` (and optionally a stable `sessionId`) to `SessionOptions`.
Only top-level runs are persisted; sub-agents are rerun on resume because
their tool-result is already captured in the parent's transcript. See
[persistence.md](./persistence.md) for the disk layout, adapter integration
contract, and `Session.listSessions` API.

## See also

- [examples/](../examples/): seven progressive examples, 01 to 07.
- [test/](../test/): vitest specs are the most precise behavior documentation.
- [persistence.md](./persistence.md): session persistence and resume.
