# Interface: AnthropicApiConfig

Defined in: adapters/anthropic-api.ts:24

Configuration for [anthropicApiAdapter](../functions/anthropicApiAdapter.md).

This adapter targets Claude via the **raw Anthropic Messages API**
(`@anthropic-ai/sdk`) — the API-key-authenticated path. It is the only
optional peer dep this adapter needs; install it only when you use this
adapter:

```bash
npm install @anthropic-ai/sdk
```

If you have a Claude **subscription** rather than an API key, use
`claudeAgentAdapter` instead — it drives the Claude Agent SDK.

## Properties

### model

```ts
readonly model: string;
```

Defined in: adapters/anthropic-api.ts:26

Model id, e.g. `"claude-sonnet-4-6"`.

***

### apiKey?

```ts
readonly optional apiKey?: string;
```

Defined in: adapters/anthropic-api.ts:28

Optional API key. Falls back to `ANTHROPIC_API_KEY` in the environment.

***

### maxTokens?

```ts
readonly optional maxTokens?: number;
```

Defined in: adapters/anthropic-api.ts:30

`max_tokens` for each Messages API request. Defaults to 4096.

***

### temperature?

```ts
readonly optional temperature?: number;
```

Defined in: adapters/anthropic-api.ts:31
