# Interface: TerminatorCtx

Defined in: declare/index.ts:182

Context passed to an `external` [PhaseTerminator](../type-aliases/PhaseTerminator.md)'s `await` callback.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: declare/index.ts:183

***

### phase

```ts
readonly phase: string;
```

Defined in: declare/index.ts:184

***

### runId

```ts
readonly runId: string;
```

Defined in: declare/index.ts:185

***

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: declare/index.ts:187

Aborts when the phase is otherwise cancelled (session cancel, parent abort).
