# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Pre-1.0, so minor versions may break.

## 0.3.0

Governed coordinator/sub-agent trees, plus static and runtime diagnostics.

### Added

- **Coordinators.** `role: "coordinator"` injects a `delegate` tool taking a batch of contracts, validated as a unit before any of it starts.
- **`delegable`.** What an agent may hand down, separate from `tools` (what it may call). A sub-agent may only declare tools its parent listed. Checked at compile.
- **`mutates` on tools.** A coordinator may not hold one, so it cannot start doing the work itself.
- **Conserved turn budgets.** `SessionOptions.turnBudget` caps the whole tree. A contract's allocation leaves the parent's balance and returns unspent.
- **Acceptance.** Contracted children return status + result + evidence + a restatement of the objective. The parent checks shape, checks evidence against the write-set, then runs `SubAgentDecl.accept` (host TypeScript). Outcomes: accept, reject and retry within the same allocation (`maxRejects`), or abandon as partial. `blocked` escalates without a retry.
- **Artifact store.** Accepted results are keyed by run path; a later contract's `reads` grants a scoped `read_artifact` tool. Siblings share work without talking to each other.
- **Drift guards.** Duplicate contracts refused, `maxBatches` caps re-planning, `maxEmptyBatches` caps fruitless rounds. Failed contracts stay retryable.
- **Journal.** Delegations and outcomes appended as NDJSON when persistence is on.
- **`lint(agent)`.** Static checks for deliverables an empty object satisfies, unexplained free-form strings, unbounded objects, single-value enums, non-object deliverables, self-judging checklists, and budgets too small for the tools exposed. Advisory; separate from `validate`.
- **Lint checks that span the tree.** `pipeline.misspelled-reference` (a prompt names something close to a declared field but not it), `coordinator.unused-delegable` (authority handed down that no sub-agent can use), `subagent.unchecked` (a coordinator's child with no `accept`, so anything shape-valid is accepted). These need the tree's edges declared, which contracts now do.
- **Lint calibration against the shipped examples.** Every example is linted in the test suite, snapshotting what fires. Exact checks are asserted never to fire on code we ship.
- **Trace events.** `deliverable.rejected` (previously silent), `phase.nudged`, `delegate.batch`, `delegate.rejected`, `contract.{start,end,accepted,rejected,abandoned,blocked}`. A run that stops because the tree's shared balance is empty reports it as `budget.exhausted` with `limit: "run"`, which is what tells it apart from a phase running out of its own turns.
- **Session options.** `turnBudget`, `maxDepth` (3), `maxFanOut` (8), `maxBatches` (4), `maxEmptyBatches` (2).
- **`agent-ftw` command.** `check <file>` compiles and lints every agent a file exports and prints the phase tree with the injected tools in it. `dry-run <file>` runs the pipeline against values built from the schemas, so handoffs, tool wiring, `accept` predicates and budgets are exercised with no model and no key. `--json` on either gives the report as data. Exit codes: 0 clean, 1 problems, 2 bad usage.
- **`describeAgent(decl)`.** The compiled tree as plain, serializable data, including the tools no one wrote. What the CLI prints and what any other host should project from rather than reimplementing.
- **`synthesize(schema)`.** The smallest value a JSON Schema accepts, plus the places the schema did not say enough to build one (an unresolved `$ref`, a `pattern` no placeholder matches). Deterministic.
- **`dryRunAdapter` / `stripAdapters` / `callableTools`.** An `Adapter` that answers from schemas instead of a model, the declaration transform that keeps a declared adapter from being reached during one, and the policy for which tool handlers a dry run may actually call (none by default).

### Fixed

- **A deliverable failing validation twice was silently accepted.** The retry was never re-checked, so a malformed payload became the deliverable and broke something downstream instead. Now bounded retries, then throws. Expect this to surface latent failures.
- **The nudge named a withheld tool.** With an external terminator the phase-end tool is not exposed, but the no-tool-call nudge told the model to call it.

### Changed (breaking)

- `delegable` defaults to `[]`: an agent whose sub-agents declare tools no longer compiles until the parent grants them.
- Depth limit applies (root plus two levels). A coordinator with no room below it fails to compile.
- Run ids are hierarchical paths (`root.2.1`) instead of a global counter.
- `BudgetExtensionRequest` gained `depth` and `limit` (`"phase"` | `"run"`); `runId` is now a path.
- `TurnBudgetExhausted` carries `limit`.
- Contracted children return an envelope instead of a bare deliverable.
- `RunContext.onAssistantText` is now always supplied, so nudge wording is framework-owned.
- `ToolHandlerCtx` gained `writeSet`. Mutating tools should refuse paths outside it: the framework does not own the filesystem, so the handler is the only place a stray write is actually stopped.
- `DEFAULT_TURN_BUDGET` moved to the declaration module.

## Earlier versions

Not recorded; this changelog starts at 0.3.0.
