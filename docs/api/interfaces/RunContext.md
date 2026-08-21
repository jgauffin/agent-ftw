# Interface: RunContext

Defined in: [adapters/types.ts:56](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L56)

The contract between the framework and an [Adapter](Adapter.md). The framework
builds one per phase invocation, hands it to `adapter.runUntilPhaseEnd`,
and expects the adapter to drive the model loop until the phase-end tool
is called (or `signal` aborts).

Adapters MUST:
 - call `consumeTurn()` before each model turn (raises on budget exhaustion)
 - call `onTurn(turn)` for every model assistant turn and tool result they
   materialize, so trace/persistence observe them
 - dispatch tool calls via `dispatchTool(name, input, callId)` — never run
   handlers themselves
 - return when (and only when) the model calls `phaseEndToolName`

NOT a UI surface. `RunContext` is for **adapter implementers**. The sync
callbacks (`onTurn`, `consumeTurn`) run on the adapter's hot loop and must
stay sync — they are not subscription points. Hosts that need to render
chat, stream tokens, or react to turns should implement `Hooks.trace` and
listen for `model.turn` events instead (see `src/trace/index.ts`). To grant
more turns when the budget is exhausted, implement
`Hooks.requestBudgetExtension` — there is no extension knob on `RunContext`.

## Properties

### systemPrompt

```ts
readonly systemPrompt: string;
```

Defined in: [adapters/types.ts:57](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L57)

***

### conversation

```ts
readonly conversation: readonly Turn[];
```

Defined in: [adapters/types.ts:58](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L58)

***

### newUserText?

```ts
readonly optional newUserText?: string;
```

Defined in: [adapters/types.ts:59](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L59)

***

### tools

```ts
readonly tools: readonly ToolSpec[];
```

Defined in: [adapters/types.ts:60](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L60)

***

### phaseEndToolName

```ts
readonly phaseEndToolName: string;
```

Defined in: [adapters/types.ts:61](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L61)

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: [adapters/types.ts:62](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L62)

***

### persistence?

```ts
readonly optional persistence?: PersistenceCtx;
```

Defined in: [adapters/types.ts:90](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L90)

Persistence hooks. Set only when session persistence is enabled and the
current run is top-level (sub-agents are not persisted). Adapters that
maintain external state (e.g. Claude SDK session ids) read/write via these.

## Methods

### dispatchTool()

```ts
dispatchTool(
   name: string, 
   input: unknown, 
callId: string): Promise<unknown>;
```

Defined in: [adapters/types.ts:64](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L64)

Framework dispatches the tool. Adapter never executes handlers.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `name` | `string` |
| `input` | `unknown` |
| `callId` | `string` |

#### Returns

`Promise`\<`unknown`\>

***

### onTurn()

```ts
onTurn(turn: Turn): void;
```

Defined in: [adapters/types.ts:70](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L70)

Adapter calls this for every model/tool turn so trace and persistence can
observe. Sync by design — runs on the adapter's hot loop. Hosts must not
use this as a UI hook; subscribe to `Hooks.trace` (`model.turn`) instead.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `turn` | [`Turn`](../type-aliases/Turn.md) |

#### Returns

`void`

***

### consumeTurn()

```ts
consumeTurn(): void;
```

Defined in: [adapters/types.ts:77](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L77)

Adapter calls before each model turn; throws `TurnBudgetExhausted` if the
budget is exhausted. Sync — do not await UI here. To make exhaustion
recoverable, implement `Hooks.requestBudgetExtension`; the framework calls
it after this throws and retries on grant.

#### Returns

`void`

***

### onAssistantText()?

```ts
optional onAssistantText(text: string): Promise<string>;
```

Defined in: [adapters/types.ts:84](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L84)

If set, the adapter MUST call this when the model emits a turn that has
text but no tool calls — instead of nudging the model with a "you must call
X" message. The returned string becomes the next user turn. To abort,
throw or fire the abort signal.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

`Promise`\<`string`\>
