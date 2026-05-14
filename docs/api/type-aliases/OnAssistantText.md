# Type Alias: OnAssistantText

```ts
type OnAssistantText = (text: string, ctx: AssistantTextCtx) => Promise<string>;
```

Defined in: declare/index.ts:228

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
