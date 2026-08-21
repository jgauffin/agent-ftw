# Class: Session

Defined in: [runtime/session.ts:93](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L93)

Single root for an agent invocation. Owns the cancellation tree, trace bus,
AskUser FIFO queue, and agent-run tree.

Lifecycle:
 - `new Session(opts)` — validates the agent (if not already compiled),
   optionally opens the persistence store.
 - `await session.run(input)` — runs the top-level pipeline; returns the
   last phase's deliverable.
 - `session.cancel(reason?)` — aborts the run tree.
 - `await session.dispose()` — cancels and disposes all adapters.

Persistence: pass `sessionDirectory` to enable. Pair with a stable `sessionId`
to resume from the last persisted phase boundary.

## Constructors

### Constructor

```ts
new Session(opts: SessionOptions): Session;
```

Defined in: [runtime/session.ts:112](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L112)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`SessionOptions`](../interfaces/SessionOptions.md) |

#### Returns

`Session`

## Properties

### id

```ts
readonly id: string;
```

Defined in: [runtime/session.ts:94](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L94)

***

### bus

```ts
readonly bus: TraceBus;
```

Defined in: [runtime/session.ts:95](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L95)

***

### hooks

```ts
readonly hooks: Hooks;
```

Defined in: [runtime/session.ts:96](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L96)

***

### defaultAdapter

```ts
readonly defaultAdapter: Adapter;
```

Defined in: [runtime/session.ts:98](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L98)

Pipeline-wide adapter; any construct may override it with its own `adapter`.

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: [runtime/session.ts:99](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L99)

## Methods

### listSessions()

```ts
static listSessions(sessionDirectory: string, agentName?: string): Promise<readonly SessionInfo[]>;
```

Defined in: [runtime/session.ts:143](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L143)

List persisted sessions in a session directory, optionally filtered by
agent name. Returns most-recently-updated first.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `sessionDirectory` | `string` |
| `agentName?` | `string` |

#### Returns

`Promise`\<readonly [`SessionInfo`](../interfaces/SessionInfo.md)[]\>

***

### run()

```ts
run(input: unknown): Promise<unknown>;
```

Defined in: [runtime/session.ts:157](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L157)

Run the agent pipeline to completion. Returns the final phase's deliverable
(shaped by that phase's `deliverable` JSON Schema).

If `sessionDirectory` + a previously-used `sessionId` were provided, the
run resumes from the last persisted phase boundary instead of starting over.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `unknown` |

#### Returns

`Promise`\<`unknown`\>

***

### fork()

```ts
fork(opts: ForkOptions): Promise<ForkResult>;
```

Defined in: [runtime/session.ts:172](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L172)

Spawn a sibling Session running the same compiled pipeline (feature A:
host-triggered side exploration). The fork is independent — its own
AbortController, its own deliverable tracker — and shares the parent's
compiled agent + default adapter.

Returns the new Session and a `seed` value the host should pass to
`session.run(seed)`. The host owns lifecycle: `await fork.session.run(fork.seed)`,
`fork.session.cancel()`, `await fork.session.dispose()`.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`ForkOptions`](../interfaces/ForkOptions.md) |

#### Returns

`Promise`\<[`ForkResult`](../interfaces/ForkResult.md)\>

***

### cancel()

```ts
cancel(reason?: string): void;
```

Defined in: [runtime/session.ts:233](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L233)

Abort the run tree. Idempotent — subsequent calls are no-ops. Emits a
`cancelled` trace event the first time.

#### Parameters

| Parameter | Type | Default value |
| ------ | ------ | ------ |
| `reason` | `string` | `"cancelled"` |

#### Returns

`void`

***

### dispose()

```ts
dispose(): Promise<void>;
```

Defined in: [runtime/session.ts:244](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L244)

Cancel and dispose all adapters. Safe to call multiple times.
Call this when the session is no longer needed so adapter resources
(HTTP clients, SDK subprocesses) are released.

#### Returns

`Promise`\<`void`\>

***

### askUser()

```ts
askUser(input: AskUserInput, ctx: {
  agent: string;
  phase: string;
  runId: string;
}): Promise<AskUserResult>;
```

Defined in: [runtime/session.ts:256](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L256)

Serialized FIFO so concurrent sub-agents don't race for the user.
The model never sees the appended "Other" option; if the user picks Other,
it surfaces as `result.other` only.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`AskUserInput`](../interfaces/AskUserInput.md) |
| `ctx` | \{ `agent`: `string`; `phase`: `string`; `runId`: `string`; \} |
| `ctx.agent` | `string` |
| `ctx.phase` | `string` |
| `ctx.runId` | `string` |

#### Returns

`Promise`\<[`AskUserResult`](../interfaces/AskUserResult.md)\>
