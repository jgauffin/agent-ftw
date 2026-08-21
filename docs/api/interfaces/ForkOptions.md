# Interface: ForkOptions

Defined in: [runtime/session.ts:25](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L25)

Options for [Session.fork](../classes/Session.md#fork).

Forking spawns a sibling Session running the same compiled pipeline so the
host can pursue a side exploration without disturbing the original run.

## Properties

### seed

```ts
readonly seed: "deliverable" | "summarize";
```

Defined in: [runtime/session.ts:31](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L31)

What to seed the forked Session with as input to its first phase.
  "deliverable" — the parent's most recently completed phase deliverable (cheap, default).
  "summarize"   — call the session's `defaultAdapter.runStructured` to compress the parent's run state to JSON.

***

### summarizeInstructions?

```ts
readonly optional summarizeInstructions?: string;
```

Defined in: [runtime/session.ts:33](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L33)

Extra instructions for the summarizer. Only used when seed === "summarize".

***

### hooks?

```ts
readonly optional hooks?: Hooks;
```

Defined in: [runtime/session.ts:38](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L38)

Hooks for the forked Session. Defaults to the parent's hooks. Useful when the
host wants the side-exploration to surface askUser to a different UI surface.
