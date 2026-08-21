# Interface: PersistenceCtx

Defined in: [adapters/types.ts:99](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L99)

Adapter-facing slice of session persistence. Provides a per-(session, phase)
scratchpad for adapter-private state (e.g. the Claude SDK's resumable session
id). Available only when the session has persistence enabled AND the run is
top-level — sub-agent runs do not persist.

## Properties

### sessionId

```ts
readonly sessionId: string;
```

Defined in: [adapters/types.ts:100](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L100)

***

### agentName

```ts
readonly agentName: string;
```

Defined in: [adapters/types.ts:101](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L101)

***

### phaseName

```ts
readonly phaseName: string;
```

Defined in: [adapters/types.ts:102](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L102)

## Methods

### getAdapterMeta()

```ts
getAdapterMeta(key: string): unknown;
```

Defined in: [adapters/types.ts:104](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L104)

Read an adapter-specific scratchpad value (typed at the adapter's discretion).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |

#### Returns

`unknown`

***

### setAdapterMeta()

```ts
setAdapterMeta(key: string, value: unknown): Promise<void>;
```

Defined in: [adapters/types.ts:106](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L106)

Write an adapter-specific scratchpad value; persisted before the call resolves.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `value` | `unknown` |

#### Returns

`Promise`\<`void`\>
