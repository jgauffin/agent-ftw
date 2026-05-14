# Interface: RunContext

Defined in: adapters/types.ts:48

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

## Properties

### systemPrompt

```ts
readonly systemPrompt: string;
```

Defined in: adapters/types.ts:49

***

### conversation

```ts
readonly conversation: readonly Turn[];
```

Defined in: adapters/types.ts:50

***

### newUserText?

```ts
readonly optional newUserText?: string;
```

Defined in: adapters/types.ts:51

***

### tools

```ts
readonly tools: readonly ToolSpec[];
```

Defined in: adapters/types.ts:52

***

### phaseEndToolName

```ts
readonly phaseEndToolName: string;
```

Defined in: adapters/types.ts:53

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: adapters/types.ts:54

***

### persistence?

```ts
readonly optional persistence?: PersistenceCtx;
```

Defined in: adapters/types.ts:73

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

Defined in: adapters/types.ts:56

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

Defined in: adapters/types.ts:58

Adapter calls this for every model/tool turn so trace can observe.

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

Defined in: adapters/types.ts:60

Adapter calls before each model turn; throws if budget is exhausted. Returns granted turns.

#### Returns

`void`

***

### onAssistantText()?

```ts
optional onAssistantText(text: string): Promise<string>;
```

Defined in: adapters/types.ts:67

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
