# Interface: TerminatorCtx

Defined in: [declare/index.ts:182](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L182)

Context passed to an `external` [PhaseTerminator](../type-aliases/PhaseTerminator.md)'s `await` callback.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: [declare/index.ts:183](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L183)

***

### phase

```ts
readonly phase: string;
```

Defined in: [declare/index.ts:184](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L184)

***

### runId

```ts
readonly runId: string;
```

Defined in: [declare/index.ts:185](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L185)

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: [declare/index.ts:187](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L187)

Aborts when the phase is otherwise cancelled (session cancel, parent abort).
