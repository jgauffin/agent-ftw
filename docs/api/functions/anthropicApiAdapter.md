# Function: anthropicApiAdapter()

```ts
function anthropicApiAdapter(cfg: AnthropicApiConfig): Adapter;
```

Defined in: adapters/anthropic-api.ts:58

Raw Anthropic Messages API adapter — drives the model→tool loop by hand with
`messages.create` for `runUntilPhaseEnd`, and a single forced-tool call for
`runStructured`.

`@anthropic-ai/sdk` is an optional peer dep, imported lazily so users on other
adapters don't need it installed.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `cfg` | [`AnthropicApiConfig`](../interfaces/AnthropicApiConfig.md) |

## Returns

[`Adapter`](../interfaces/Adapter.md)
