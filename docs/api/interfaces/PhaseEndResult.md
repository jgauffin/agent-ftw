# Interface: PhaseEndResult

Defined in: adapters/types.ts:98

Value an adapter returns from [Adapter.runUntilPhaseEnd](Adapter.md#rununtilphaseend). `payload` is
the raw deliverable the model passed to the phase-end tool (still
pre-validation); `conversation` is the full transcript the adapter built
for the phase (persistence reads this on resume).

## Properties

### payload

```ts
readonly payload: unknown;
```

Defined in: adapters/types.ts:99

***

### conversation

```ts
readonly conversation: readonly Turn[];
```

Defined in: adapters/types.ts:100
