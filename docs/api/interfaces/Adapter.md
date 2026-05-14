# Interface: Adapter

Defined in: adapters/types.ts:116

Pluggable model backend. The framework ships three implementations:

 - `openaiCompatAdapter` for any OpenAI-style `/chat/completions` endpoint
   (OpenAI, Ollama, LM Studio, vLLM, …)
 - `anthropicApiAdapter` for Claude via the raw Anthropic Messages API
   (API-key auth)
 - `claudeAgentAdapter` for Claude via the Claude Agent SDK (subscription auth)

Implement this to bridge another provider. The framework owns the dispatcher
loop semantics (tool validation, turn budget, trace emission) — adapters
only convert wire formats and drive the provider's tool-loop API.

## Methods

### runUntilPhaseEnd()

```ts
runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult>;
```

Defined in: adapters/types.ts:118

Drive the model loop until the phase-end tool is called. See [RunContext](RunContext.md).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `ctx` | [`RunContext`](RunContext.md) |

#### Returns

`Promise`\<[`PhaseEndResult`](PhaseEndResult.md)\>

***

### runStructured()

```ts
runStructured(args: {
  systemPrompt: string;
  userText: string;
  schema: JSONSchema;
  signal: AbortSignal;
}): Promise<unknown>;
```

Defined in: adapters/types.ts:120

One-shot structured generation; used by checklists.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `args` | \{ `systemPrompt`: `string`; `userText`: `string`; `schema`: `JSONSchema`; `signal`: `AbortSignal`; \} |
| `args.systemPrompt` | `string` |
| `args.userText` | `string` |
| `args.schema` | `JSONSchema` |
| `args.signal` | `AbortSignal` |

#### Returns

`Promise`\<`unknown`\>

***

### dispose()?

```ts
optional dispose(): Promise<void>;
```

Defined in: adapters/types.ts:127

Optional cleanup hook. Called by `Session.dispose`.

#### Returns

`Promise`\<`void`\>
