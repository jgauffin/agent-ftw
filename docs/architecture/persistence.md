# Session Persistence

Lets a `Session` survive a crash. State is written to disk after every model
turn so a fresh process can pick up at the most recent phase boundary instead
of starting over.

## Activation

Persistence is opt-in. Pass `sessionDirectory` (and optionally `sessionId`) to
`SessionOptions`:

```ts
const session = new Session({
  agent,
  defaultAdapter: adapter,
  hooks,
  sessionDirectory: "./.agent-sessions",
  sessionId: "user-42-task-7",       // omit to mint a fresh id
});
```

When `sessionDirectory` is omitted, nothing is written and the framework
behaves exactly as before.

When `sessionId` is provided AND state already exists for it under
`{sessionDirectory}/{agentName}/{sessionId}/`, the next `session.run()`
**resumes** from the last persisted phase boundary.

## What is persisted

| State                    | Persisted? | Notes                                                       |
|--------------------------|------------|-------------------------------------------------------------|
| Top-level phase deliverables | yes    | Skipped on resume; the cached payload feeds later phases    |
| Per-phase conversation   | yes        | Re-fed to the adapter on resume to continue the same turn   |
| Adapter scratchpad       | yes        | Free-form key/value, e.g. Claude SDK session id per phase   |
| Sub-agent runs           | **no**     | Cheaper to rerun; their tool-result is captured in the parent transcript |
| `askUser` history        | no         | Re-prompted on resume if the interrupted turn needed it     |
| Forks / side-explorations| no         | Independent sibling sessions; persist each separately       |

## Disk layout

```
{sessionDirectory}/
  {agentName}/
    {sessionId}/
      meta.json            ← status, completedPhases, currentPhase, adapterMeta
      deliverables.json    ← { [phaseName]: payload, ... }
      phases/
        {phaseName}.json   ← { conversation: Turn[] }
```

Writes are atomic (`write .tmp` + `rename`). Agent and session names are
sanitized to `[a-zA-Z0-9._-]` before being used as path segments to prevent
traversal.

## How resume works

1. `Session` constructs a `SessionStore` keyed by `(sessionDirectory, agentName, sessionId)`.
2. `AgentRun` (top-level only) calls `store.initIfMissing()` and reads
   `deliverables.json`. Any phase whose deliverable is already there is
   **skipped**, so `phase.start` and `phase.end` events still fire (so trace
   consumers see consistent timelines), but no model call happens.
3. For the next phase to actually run, `PhaseRun` loads its conversation file
   if present and seeds the adapter with it instead of the caller's
   `initialInput`. That input is suppressed because it's already in the
   transcript.
4. After every model turn (`onTurn`), `PhaseRun` chains a save to the phase's
   conversation file. A `flushSaves()` call in the `finally` of `execute()`
   guarantees the tail write lands before the run unwinds, so a crash
   *between* turns leaves the transcript truncated to the last fully-recorded
   turn, never partway through one.

### Trailing-tool-call sanitization

If a process crashes after the framework recorded `assistant: <tool calls>`
but before the matching `tool: <result>` turns, the saved transcript would be
rejected by most provider APIs (every `tool_call` must have a result). On
resume, `PhaseRun` walks the tail and **drops the unmatched assistant turn**
plus any partial results. The model picks up cleanly from the prior boundary
instead of re-emitting a malformed message.

## Adapter integration

The framework exposes a `PersistenceCtx` on `RunContext.persistence` whenever
persistence is active for the current run. Adapters that need to track their
own resumption pointers (e.g. provider-managed session ids) read and write
through it:

```ts
async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
  const key = ctx.persistence
    ? `myProvider.session.${ctx.persistence.phaseName}`
    : undefined;
  const resumeId =
    key && ctx.persistence
      ? (ctx.persistence.getAdapterMeta(key) as string | undefined)
      : undefined;
  // ...invoke provider, capture its session id from the first event...
  if (key && ctx.persistence && !resumeId) {
    await ctx.persistence.setAdapterMeta(key, providerSessionId);
  }
}
```

`setAdapterMeta` writes through to `meta.json` immediately, so a crash mid-run
won't lose the pointer.

### openai-compat adapter

No adapter-side change needed. The conversation seed already comes through
`RunContext.conversation`; the framework loads it from disk and the adapter
continues the same conversation transparently.

### Claude Agent SDK adapter

The adapter captures the SDK's session id from the first message on the
event stream and stores it as `claudeSdk.session.<phase>` adapter meta. On
resume, it reads that id back and passes `resume: <id>` to the SDK's
`query()`. The SDK transcript itself lives in the SDK's own storage location
(typically `~/.claude/projects/...`); our `sessionDirectory` only tracks the
pointer to it. **If the SDK's transcript is wiped, resume cannot reconstruct
the prior turns**, and only our deliverables and our per-phase pointer survive.

## Listing sessions

`Session.listSessions(directory, agentName?)` returns a snapshot of every
session in the directory, sorted most-recently-updated first:

```ts
const all   = await Session.listSessions("./.agent-sessions");
const onlyA = await Session.listSessions("./.agent-sessions", "code-reviewer");
```

Each `SessionInfo` carries `sessionId`, `agentName`, `createdAt`, `updatedAt`,
`status` (`running` | `complete` | `aborted` | `error`), `currentPhase`, and
`completedPhases`. Useful for building a "resume one of these" UI.

## When NOT to use it

- **Sub-agent isolation.** Sub-agents run within a parent's phase as a tool
  call. Their result is already in the parent's persisted transcript. They are
  not separately resumable; on resume, a sub-agent that ran to completion
  appears as a tool result and the parent skips re-running it.
- **Forks.** `Session.fork()` creates an independent sibling Session. Pass it
  its own `sessionDirectory`/`sessionId` if you want it persisted too.
- **`askUser` mid-turn.** The user's reply is part of the transcript only
  *after* it has been incorporated as a turn. If the host crashes while the
  user is still answering, the question is re-asked on resume.

## Related

- [src/runtime/session-store.ts](../../src/runtime/session-store.ts): disk I/O.
- [src/runtime/session.ts](../../src/runtime/session.ts): `SessionOptions`, `Session.listSessions`.
- [src/runtime/agent-run.ts](../../src/runtime/agent-run.ts): phase-skip-on-resume logic.
- [src/runtime/phase-run.ts](../../src/runtime/phase-run.ts): per-turn save chain, sanitization on load.
- [src/adapters/types.ts](../../src/adapters/types.ts): `PersistenceCtx`.
- [src/adapters/claude-agent.ts](../../src/adapters/claude-agent.ts): SDK resume integration.
- [test/runtime/session-persistence.test.ts](../../test/runtime/session-persistence.test.ts): unit coverage.
- [test-integration/persistence.test.ts](../../test-integration/persistence.test.ts): live-backend smoke.
