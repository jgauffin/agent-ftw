# Interface: ReviewCtx

Defined in: [hooks/index.ts:19](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L19)

Context for a [Hooks.review](Hooks.md#review) callback. The host drives a chat loop with
the user; for each user message it calls `requestRevision`, which re-runs
the phase and returns the revised deliverable. Resolving the callback (with
`void`) signals user approval.

## Properties

### agent

```ts
readonly agent: string;
```

Defined in: [hooks/index.ts:20](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L20)

***

### phase

```ts
readonly phase: string;
```

Defined in: [hooks/index.ts:21](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L21)

## Methods

### requestRevision()

```ts
requestRevision(userMessage: string): Promise<unknown>;
```

Defined in: [hooks/index.ts:27](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L27)

Re-run the phase with a user message appended to the context.
Returns the agent's revised deliverable. Call once per user message during review.
The hook resolves (returns void) when the user approves.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `userMessage` | `string` |

#### Returns

`Promise`\<`unknown`\>
