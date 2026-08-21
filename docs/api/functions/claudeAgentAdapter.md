# Function: claudeAgentAdapter()

```ts
function claudeAgentAdapter(cfg: ClaudeAgentConfig): Adapter;
```

Defined in: [adapters/claude-agent.ts:76](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/claude-agent.ts#L76)

Claude Agent SDK adapter — drives the model loop via the SDK's `query()` for
both `runUntilPhaseEnd` and `runStructured` (the latter as a one-shot query
forced through a single `submit` tool).

The SDK (and `zod`) are optional peer deps, imported lazily so users on other
adapters don't need them installed.

Tool registration: the SDK does not accept a top-level `tools: [{handler}]`
array. Custom tools must be wrapped via `tool(...)` and bundled into an
in-process MCP server via `createSdkMcpServer(...)`, then handed to
`query()` through `options.mcpServers`. `options.allowedTools` carries the
fully-qualified `mcp__<server>__<tool>` names and `options.tools: []`
disables the SDK's built-in Claude Code tool set so the model only sees
the framework's tools.

Persistence: when `RunContext.persistence` is set, the adapter records the
SDK-emitted session id (one per phase) into adapter meta so a future run can
pass `resume: <id>` to the SDK and continue the same transcript. The SDK
stores the transcript in its own location — this adapter only tracks the
pointer to it.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `cfg` | [`ClaudeAgentConfig`](../interfaces/ClaudeAgentConfig.md) |

## Returns

[`Adapter`](../interfaces/Adapter.md)
