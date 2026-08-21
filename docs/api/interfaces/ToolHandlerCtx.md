# Interface: ToolHandlerCtx

Defined in: [declare/index.ts:36](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L36)

Context passed to a [ToolDecl](ToolDecl.md) handler when the model invokes the tool.

## Properties

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: [declare/index.ts:38](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L38)

Aborts when the phase/session is cancelled. Forward to long-running awaits.

## Methods

### askUser()

```ts
askUser(input: AskUserInput): Promise<AskUserResult>;
```

Defined in: [declare/index.ts:43](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L43)

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

Defined in: [declare/index.ts:49](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L49)

Emit a host-visible payload mid-handler. Surfaces as a `tool.event` on the
trace bus so UIs can render incremental progress without folding it into
the model-visible tool result.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payload` | `unknown` |

#### Returns

`void`
