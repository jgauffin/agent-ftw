# Interface: ToolHandlerCtx

Defined in: declare/index.ts:36

Context passed to a [ToolDecl](ToolDecl.md) handler when the model invokes the tool.

## Properties

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: declare/index.ts:38

Aborts when the phase/session is cancelled. Forward to long-running awaits.

## Methods

### askUser()

```ts
askUser(input: AskUserInput): Promise<AskUserResult>;
```

Defined in: declare/index.ts:43

Prompt the host user mid-handler. Calls go through the session's `Hooks.askUser`,
serialized FIFO so concurrent sub-agents don't race for the user.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`AskUserInput`](AskUserInput.md) |

#### Returns

`Promise`\<[`AskUserResult`](AskUserResult.md)\>

***

### emit()

```ts
emit(payload: unknown): void;
```

Defined in: declare/index.ts:49

Emit a host-visible payload mid-handler. Surfaces as a `tool.event` on the
trace bus so UIs can render incremental progress without folding it into
the model-visible tool result.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payload` | `unknown` |

#### Returns

`void`
