# Architecture

Read this file before exploring `src/`. It is the authoritative orientation
document for the framework.

## What this is

A small TypeScript framework for **structured, multi-phase LLM agents**. You
declare an agent as pure data (an `AgentDecl`), the framework compiles and
validates it, then a `Session` runs it against a pluggable model adapter.

It is deliberately *not* an autonomous-loop framework. Every phase has a
JSON-schema deliverable, a turn budget, optional checklist verification, and an
optional human-review hook. A tree of agents is governed the same way: by what
each node is structurally able to do, checked at compile time, rather than by
what its prompt asks it to do.

## Directory layout

```
src/
  declare/   - pure-data factories: agent(), phase(), tool(), subAgent(),
               customSubAgent(), checklist(); plus the Contract/Evidence types
  schema/    - JSONSchema type + validator (uses @cfworker/json-schema)
  compile/   - validate(AgentDecl) -> CompiledAgent. Cycle and duplicate
               detection, authority checks, and the injected tools: the
               `finish_<phase>` tool, `delegate`, `propose_side_quest`
  lint/      - lint(AgentDecl) -> LintFinding[]. Advisory quality checks,
               separate from validate. Never throws, calls no model
  adapters/  - types.ts (Adapter interface), run-helpers.ts (shared loop
               plumbing), openai-compat.ts, anthropic-api.ts, claude-agent.ts
  runtime/
    session.ts        - root: cancellation tree, trace bus, askUser FIFO, fork()
    agent-run.ts      - one node in the run tree (top-level, sub-agent, or contracted)
    phase-run.ts      - drives a phase: model loop -> validate -> checklist -> review
    dispatch.ts       - tool dispatch, sub-agent invocation, side-quest dispatch
    delegate.ts       - the `delegate` tool: batch validation, waves, acceptance
    ledger.ts         - TurnLedger: turn accounting across the whole run tree
    artifact-store.ts - accepted contract results, keyed by run path
    side-quest.ts     - agent-triggered side quest: askUser gate + synthesized run
    session-store.ts  - on-disk session state and the delegation journal
    pin.ts            - prepare a session that starts partway through an agent
  hooks/     - Hooks interface: askUser, review, requestBudgetExtension, trace
  trace/     - TraceEvent union + TraceBus, and createTracer (NDJSON/text sink)
  index.ts   - public surface

test/             - vitest specs; _fixtures/fake-adapter.ts is a scripted Adapter
test-integration/ - specs that need a real model; skipped when none is reachable
examples/         - progressive examples, simplest first
studio/           - VS Code extension for designing trees. Not part of the package
docs/             - this folder
```

## Core data model

```
AgentDecl
├── name
├── role?            "worker" | "coordinator"    (default "worker")
├── adapter?         Adapter                     (overrides the session defaultAdapter)
├── tools            what this agent may CALL     (agent-wide; merged into every phase)
├── delegable?       what this agent may HAND DOWN (default: nothing)
├── sideQuests?      SideQuestsDecl
└── phases[]
    └── PhaseDecl
        ├── name, prompt
        ├── deliverable       JSONSchema      (becomes the `finish_<name>` tool's input)
        ├── adapter?          Adapter         (overrides the agent's, for this phase)
        ├── tools             phase-only tools
        ├── checklist?        ChecklistDecl   (its own adapter? overrides the phase's)
        ├── turnBudget?       number          (default 30)
        ├── review?           boolean         (top-level phases only)
        ├── terminator?       tool | external (default tool)
        ├── onAssistantText?  overrides the framework's nudge
        └── phaseEndToolName? overrides `finish_<name>`
```

`tools` and `delegable` are separate lists on purpose. A coordinator that holds
nothing mutating can still put edit authority in a leaf, and a sub-agent may
only declare tools its parent listed in `delegable`, so authority narrows going
down and a leaf can never hold something no ancestor was allowed to grant. Both
are checked at compile.

Adapter resolution is most-specific-wins:
`checklist.adapter ?? phase.adapter ?? agent.adapter ?? session.defaultAdapter`.
A sub-agent inherits the parent run's resolved adapter unless it sets its own.

The factories in [src/declare/index.ts](../../src/declare/index.ts) return plain
readonly objects with a `kind` discriminator. No classes, no freezing. The
declarations are mostly data but carry live values too: a tool's `handler`, an
`adapter` instance, an external terminator's `await`. That is why a declaration
cannot simply be serialized.

## Execution model

```
Session.run(input)
  └── AgentRun (root)          ← one per AgentDecl invocation; nested for children
       └── for each phase:
            PhaseRun.execute(initialInput)
              ├── runLoop          → adapter.runUntilPhaseEnd → payload
              ├── ensureValidDeliverable  (bounded retries with the schema errors
              │                            as feedback, then throws)
              ├── runChecklist?    (one revision round on failure, then accept)
              ├── runReview?       (top-level only; chats via hooks.review)
              └── emit phase.end
       └── return the last phase's deliverable
```

**Key behaviors that aren't obvious from reading individual files:**

- The framework auto-injects `finish_<phaseName>` as a tool whose input schema
  IS the deliverable. The model finishes a phase by calling it. With an
  `external` terminator the tool is **not** exposed and the host resolves the
  phase out of band instead.
- Tool name collisions are caught at compile: agent-wide, phase, and the
  injected names must all be unique.
- Multi-phase: phase N+1's system prompt is rebuilt from scratch and includes a
  `Prior phase deliverables:` block. No model context crosses a phase boundary,
  only the structured deliverables.
- Tool input is validated against its JSON schema **before** the handler runs.
  Handlers receive `unknown` and narrow themselves.
- Tool errors become tool-result turns marked `isError: true` and go back to the
  model, which decides how to react. Sub-agent failures surface the same way.
- Cancellation: `Session` owns a root AbortController; each AgentRun creates a
  child linked to its parent. Cancelling the session cascades.
- `askUser` is FIFO-serialized at the Session level so concurrent children do
  not race for the user. The framework appends an `"Other"` option the model
  never sees; free text comes back as `result.other`.
- `runId` is a path: `root`, `root.2`, `root.2.1`. Ledger nodes, trace events,
  and artifact keys all address a run by it, so the whole run tree is
  reconstructible from the event stream alone.

## Turn budgets: two gates

A phase's `turnBudget` limits that one phase's model loop. It says nothing about
the tree, so a phase that spawns children could respect its own budget while the
tree underneath it spent without limit. `SessionOptions.turnBudget` is the second
and harder gate: a ceiling on the whole run tree.

[TurnLedger](../../src/runtime/ledger.ts) holds one node per `AgentRun`, keyed by
runId path. A node either holds a balance or draws from the nearest ancestor
that does. A contract's allocation **leaves** the parent's balance when it is
reserved and the unspent remainder returns when the child finishes, so turns are
conserved rather than merely counted. Nothing inside a run can mint turns; only
`Hooks.requestBudgetExtension` can, which is what makes the root budget an actual
ceiling rather than a suggestion.

Both gates raise `TurnBudgetExhausted`, whose `limit` says which one ran out.
A run stopped by the shared tree balance reports `budget.exhausted` with
`limit: "run"`, and raising a phase budget will not help it.

Tool calls do not count toward either budget, only model turns.

## Coordinators and contracts

`role: "coordinator"` changes what an agent can do rather than what it is told
to do:

- It may not hold a tool declared `mutates`, checked at compile, so it cannot
  quietly abandon its own plan and start doing the work itself.
- Compile injects a `delegate` tool on every phase, except at the depth limit
  where it is withheld entirely. That withholding is what stops a coordinator
  tree recursing without bound.

`delegate` takes a **batch** of `Contract`s and validates the whole batch before
any of it starts: turns must fit the ledger, `grants` must be a subset of
`delegable`, a granted mutating tool requires a `writeSet`, and fan-out is
capped. A batch that does not add up is refused as a structured result the model
can read, not an exception, so a bad decomposition costs one turn instead of a
run. Accepted contracts are split into **waves** by write-set disjointness, so
two children never write the same place at once.

A contracted child returns a `ContractEnvelope`: a status, the result, the
evidence for it, and a restatement of the objective in its own words. The parent
checks the shape, checks the evidence against the write-set, then runs
`SubAgentDecl.accept`, which is **host TypeScript rather than another model
call**: a check that can be talked out of its verdict is not a check. The
outcomes are accept, reject and retry within the same allocation (`maxRejects`),
or abandon as partial. `blocked` escalates without a retry, and is a first-class
outcome rather than a failure: a child that cannot resolve an ambiguity says so
instead of inventing an answer.

Accepted results go into the [artifact store](../../src/runtime/artifact-store.ts)
keyed by run path. A later contract's `reads` grants that child a scoped
`read_artifact` tool, so one child's output reaches another without the two of
them talking and without the payload passing through the coordinator's context.

Drift guards: duplicate contracts are refused, `maxBatches` caps re-planning, and
`maxEmptyBatches` caps fruitless rounds. Failed contracts stay retryable.

When persistence is on, every delegation and outcome is appended to a
`journal.ndjson` in the session directory. Sub-agent runs are not otherwise
persisted, so without it a finished tree leaves no record of who was asked to do
what, which is exactly what a post-mortem needs.

## Side quests

Two flavors, from opposite directions:

- **Host-triggered:** `Session.fork({ seed: "deliverable" | "summarize" })`
  returns `{ session, seed }`. The host gets an independent child Session on the
  *same* compiled pipeline, seeded either with the parent's last phase
  deliverable (free) or with a `runStructured` summary call. The fork has its own
  AbortController and is not started for you.
- **Agent-triggered:** opt in per `AgentDecl` with
  `sideQuests: { mode: "agent", catalog, deliverable, ... }`. Compile injects
  `propose_side_quest`. When the model calls it, dispatch surfaces an `askUser`
  showing the **full catalog** rather than just the requested subset, so the user
  can widen as well as narrow. On approval a single-phase child run is
  synthesized with the approved tools. Depth is enforced declaratively: the
  synthesized agent has no `sideQuests`, so it cannot spawn one itself.

## Checking a declaration: validate and lint

Two separate passes, deliberately.

[`validate`](../../src/compile/index.ts) rejects a structurally invalid agent and
throws. Cycles, duplicate names, authority violations, a coordinator holding a
mutating tool, depth overruns.

[`lint`](../../src/lint/index.ts) never throws and calls no model. It reports
quality problems that make a run fail somewhere other than where the mistake is:
a deliverable an empty object satisfies, a free-form string nothing explains, an
unbounded object, a single-value enum, a checklist with no adapter of its own
(so the model grades its own work), a turn budget too small to call the tools the
phase was given, a prompt that nearly names a declared field, authority handed
down that no child can use, a coordinator child with no `accept`.

Every finding carries a `path` addressing the exact construct, and an `example`:
the fix written out against the names in the declaration being linted. Findings
are advisory. The call is the author's.

## Adapters

`Adapter` ([src/adapters/types.ts](../../src/adapters/types.ts)) has two methods:

- `runUntilPhaseEnd(ctx)` drives the model-to-tool loop until the phase-end tool
  is called, the budget is exhausted, or the signal aborts.
- `runStructured(args)` makes a one-shot forced tool call, used by checklists and
  by `Session.fork({ seed: "summarize" })`.

`RunContext` is for **adapter implementers**, not for hosts. Its sync callbacks
(`onTurn`, `consumeTurn`) run on the adapter's hot loop. A host that wants to
render chat or react to turns implements `Hooks.trace` and listens for
`model.turn`.

Three adapters ship, each self-contained on one auth model and package:

- [openai-compat.ts](../../src/adapters/openai-compat.ts): generic
  OpenAI-compatible HTTP (Ollama, LM Studio, OpenAI, vLLM). Zero deps.
- [anthropic-api.ts](../../src/adapters/anthropic-api.ts): Claude via the raw
  Messages API. Optional peer dep `@anthropic-ai/sdk`.
- [claude-agent.ts](../../src/adapters/claude-agent.ts): Claude via the Claude
  Agent SDK (subscription auth). Optional peer deps
  `@anthropic-ai/claude-agent-sdk` and `zod`.

The hand-driven loop shared by openai-compat and anthropic-api lives in
[run-helpers.ts](../../src/adapters/run-helpers.ts). That trio *is* the
framework's Turn protocol. Optional peer deps are imported lazily, so an adapter
you do not use costs nothing.

The fake adapter in
[test/_fixtures/fake-adapter.ts](../../test/_fixtures/fake-adapter.ts) is a
scripted `Adapter`. Read it before writing tests; the script is a list of
`{ calls?, text?, finish? }` moves.

## Hooks

[Hooks](../../src/hooks/index.ts) is the integration boundary for a host app:

- `askUser(input, ctx)`: required.
- `review(deliverable, ctx)`: optional. Drives chat-with-revisions on a
  reviewable phase. Call `ctx.requestRevision(text)` per user message; resolve
  when the user approves.
- `requestBudgetExtension(req)`: optional. Return `{ extendBy: N }` or
  `{ deny: true }`. The request carries `limit`, `originalBudget`, `turnsUsed`,
  `extensionsGranted`, `suggestedExtension`, `recentActivity`, and
  `deliverableSchema`, which is enough for a policy or a meaningful prompt. If
  unset, exhaustion fails; the framework never falls back to `askUser` for this.
  `extendBy <= 0` is treated as a deny so a misconfigured hook cannot loop.
- `trace(event)`: optional. Receives every `TraceEvent`
  ([src/trace/index.ts](../../src/trace/index.ts)). `createTracer` is a pre-built
  NDJSON or text sink.

## Session options

| Option | Meaning |
|---|---|
| `agent` | Declaration or an already-compiled agent |
| `defaultAdapter` | Used wherever nothing more specific is declared |
| `hooks` | Host integration |
| `sessionDirectory` | Enables persistence |
| `sessionId` | Stable id; with a directory, resumes from the last phase boundary |
| `turnBudget` | Ceiling on model turns for the entire run tree |
| `maxDepth` | How deep the run tree may go (default 3) |
| `maxFanOut` | Children one coordinator run may contract, across all batches (default 8) |
| `maxBatches` | Delegate batches one coordinator run may issue (default 4) |
| `maxEmptyBatches` | Consecutive fruitless batches tolerated (default 2) |

## Public API surface

Everything is re-exported from [src/index.ts](../../src/index.ts). The surface is
intentionally small: the declaration factories, `validate`, `lint`, `Session`,
`pinDeliverables`, the three adapters, `createTracer`, `TurnBudgetExhausted`, and
the types those need.

## Session persistence

Pass `sessionDirectory` (and optionally a stable `sessionId`) to persist and
resume. Only top-level runs are persisted; sub-agents are rerun on resume,
because their result is already captured in the parent's transcript. A phase
whose deliverable is stored is skipped on the next run and still emits its
cached `phase.start`/`phase.end`, so a resumed run's trace reads as a whole run.

[`pinDeliverables`](../../src/runtime/pin.ts) writes that state directly rather
than requiring a previous run to have produced it, which is how a run can be
started partway through an agent with earlier phases answered by hand.

See [persistence.md](./persistence.md) for the disk layout, the adapter
integration contract, and `Session.listSessions`.

## See also

- [examples/](../../examples/): progressive examples, simplest first. Each one
  exports its agents and guards its own run, so they can be imported as well as
  executed.
- [test/](../../test/): the vitest specs are the most precise behavior documentation.
- [persistence.md](./persistence.md): session persistence and resume.
- [studio/](../../studio/): a VS Code panel for designing trees, built on
  `Hooks.trace`, `lint`, and the persistence resume path.
