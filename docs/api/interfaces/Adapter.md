# Interface: Adapter

Defined in: [adapters/types.ts:133](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L133)

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

Defined in: [adapters/types.ts:135](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L135)

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

Defined in: [adapters/types.ts:137](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L137)

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

Defined in: [adapters/types.ts:144](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L144)

Optional cleanup hook. Called by `Session.dispose`.

#### Returns

`Promise`\<`void`\>
