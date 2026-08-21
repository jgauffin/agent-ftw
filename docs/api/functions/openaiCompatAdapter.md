# Function: openaiCompatAdapter()

```ts
function openaiCompatAdapter(cfg: OpenAICompatConfig): Adapter;
```

Defined in: [adapters/openai-compat.ts:65](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/openai-compat.ts#L65)

Build an [Adapter](../interfaces/Adapter.md) that talks to an OpenAI-style chat endpoint.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `cfg` | [`OpenAICompatConfig`](../interfaces/OpenAICompatConfig.md) |

## Returns

[`Adapter`](../interfaces/Adapter.md)

## Example

```ts
const adapter = openaiCompatAdapter({
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  apiKey: process.env.OPENAI_API_KEY,
});
```
