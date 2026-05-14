# Function: openaiCompatAdapter()

```ts
function openaiCompatAdapter(cfg: OpenAICompatConfig): Adapter;
```

Defined in: adapters/openai-compat.ts:65

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
