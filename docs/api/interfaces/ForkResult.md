# Interface: ForkResult

Defined in: runtime/session.ts:45

Return value of [Session.fork](../classes/Session.md#fork): the new sibling Session plus the seed
input the host should pass to `session.run(seed)`.

## Properties

### session

```ts
readonly session: Session;
```

Defined in: runtime/session.ts:47

Independent Session sharing the parent's compiled agent + default adapter. Has its own AbortController.

***

### seed

```ts
readonly seed: unknown;
```

Defined in: runtime/session.ts:49

Seed input prepared from the parent's state — pass to `session.run(seed)`.
