# Interface: AssistantTextCtx

Defined in: declare/index.ts:214

Context passed to [OnAssistantText](../type-aliases/OnAssistantText.md) when the model emits text without
any tool calls.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: declare/index.ts:215

***

### phase

```ts
readonly phase: string;
```

Defined in: declare/index.ts:216

***

### runId

```ts
readonly runId: string;
```

Defined in: declare/index.ts:217

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: declare/index.ts:218
