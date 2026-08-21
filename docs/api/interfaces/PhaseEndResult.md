# Interface: PhaseEndResult

Defined in: [adapters/types.ts:115](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L115)

Value an adapter returns from [Adapter.runUntilPhaseEnd](Adapter.md#rununtilphaseend). `payload` is
the raw deliverable the model passed to the phase-end tool (still
pre-validation); `conversation` is the full transcript the adapter built
for the phase (persistence reads this on resume).

## Properties

### payload

```ts
readonly payload: unknown;
```

Defined in: [adapters/types.ts:116](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L116)

***

### conversation

```ts
readonly conversation: readonly Turn[];
```

Defined in: [adapters/types.ts:117](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L117)
