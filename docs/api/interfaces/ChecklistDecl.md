# Interface: ChecklistDecl

Defined in: [declare/index.ts:169](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L169)

Optional LLM-as-judge gate run after a phase produces its deliverable.

The framework runs an adapter against `schema` with the deliverable as
context. If the result reports a failing check, the phase re-runs with the
failure as feedback. The verifying adapter is `adapter` if set, otherwise the
phase's adapter. Created via [checklist](../functions/checklist.md).

## Properties

### kind

```ts
readonly kind: "checklist";
```

Defined in: [declare/index.ts:170](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L170)

***

### prompt

```ts
readonly prompt: string;
```

Defined in: [declare/index.ts:172](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L172)

System prompt for the checklist run. The deliverable is appended as user context.

***

### schema

```ts
readonly schema: JSONSchema;
```

Defined in: [declare/index.ts:174](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L174)

JSON Schema the checklist run must satisfy. Typical shape: `{ checks: [{ name, passed, evidence }] }`.

***

### adapter?

```ts
readonly optional adapter?: Adapter;
```

Defined in: [declare/index.ts:176](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L176)

Adapter override for the verification run. Falls back to the phase's adapter.
