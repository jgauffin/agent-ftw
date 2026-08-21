# Interface: ClaudeAgentConfig

Defined in: [adapters/claude-agent.ts:20](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/claude-agent.ts#L20)

Configuration for [claudeAgentAdapter](../functions/claudeAgentAdapter.md).

This adapter targets Claude via the **Claude Agent SDK**
(`@anthropic-ai/claude-agent-sdk`) — the subscription-authenticated path that
drives a spawned Claude Code CLI. It is the only optional peer dep this
adapter needs; install it (plus `zod`) only when you use this adapter:

```bash
npm install @anthropic-ai/claude-agent-sdk zod
```

If you have an Anthropic **API key** rather than a subscription, use
`anthropicApiAdapter` instead — it talks to the raw Messages API.

## Properties

### model

```ts
readonly model: string;
```

Defined in: [adapters/claude-agent.ts:22](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/claude-agent.ts#L22)

Model id, e.g. `"claude-sonnet-4-6"`.

***

### apiKey?

```ts
readonly optional apiKey?: string;
```

Defined in: [adapters/claude-agent.ts:24](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/claude-agent.ts#L24)

Optional API key. Falls back to `ANTHROPIC_API_KEY` in the environment.

***

### temperature?

```ts
readonly optional temperature?: number;
```

Defined in: [adapters/claude-agent.ts:25](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/claude-agent.ts#L25)
