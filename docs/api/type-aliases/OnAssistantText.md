# Type Alias: OnAssistantText

```ts
type OnAssistantText = (text: string, ctx: AssistantTextCtx) => Promise<string>;
```

Defined in: [declare/index.ts:228](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L228)

Host callback invoked when the model emits a turn with text but no tool
calls. The default behavior is to nudge the model with a "you must call X"
message; supplying this callback overrides that. Return the user reply that
should become the next user turn. To terminate the phase, throw or abort the
signal.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |
| `ctx` | [`AssistantTextCtx`](../interfaces/AssistantTextCtx.md) |

## Returns

`Promise`\<`string`\>
