# Interface: AssistantTextCtx

Defined in: [declare/index.ts:214](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L214)

Context passed to [OnAssistantText](../type-aliases/OnAssistantText.md) when the model emits text without
any tool calls.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: [declare/index.ts:215](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L215)

***

### phase

```ts
readonly phase: string;
```

Defined in: [declare/index.ts:216](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L216)

***

### runId

```ts
readonly runId: string;
```

Defined in: [declare/index.ts:217](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L217)

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: [declare/index.ts:218](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L218)
