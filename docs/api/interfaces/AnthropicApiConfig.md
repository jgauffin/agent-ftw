# Interface: AnthropicApiConfig

Defined in: [adapters/anthropic-api.ts:24](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/anthropic-api.ts#L24)

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

Defined in: [adapters/anthropic-api.ts:26](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/anthropic-api.ts#L26)

Model id, e.g. `"claude-sonnet-4-6"`.

***

### apiKey?

```ts
readonly optional apiKey?: string;
```

Defined in: [adapters/anthropic-api.ts:28](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/anthropic-api.ts#L28)

Optional API key. Falls back to `ANTHROPIC_API_KEY` in the environment.

***

### maxTokens?

```ts
readonly optional maxTokens?: number;
```

Defined in: [adapters/anthropic-api.ts:30](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/anthropic-api.ts#L30)

`max_tokens` for each Messages API request. Defaults to 4096.

***

### temperature?

```ts
readonly optional temperature?: number;
```

Defined in: [adapters/anthropic-api.ts:31](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/anthropic-api.ts#L31)
