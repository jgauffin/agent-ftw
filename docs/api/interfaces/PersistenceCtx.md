# Interface: PersistenceCtx

Defined in: adapters/types.ts:82

Adapter-facing slice of session persistence. Provides a per-(session, phase)
scratchpad for adapter-private state (e.g. the Claude SDK's resumable session
id). Available only when the session has persistence enabled AND the run is
top-level — sub-agent runs do not persist.

## Properties

### sessionId

```ts
readonly sessionId: string;
```

Defined in: adapters/types.ts:83

***

### agentName

```ts
readonly agentName: string;
```

Defined in: adapters/types.ts:84

***

### phaseName

```ts
readonly phaseName: string;
```

Defined in: adapters/types.ts:85

## Methods

### getAdapterMeta()

```ts
getAdapterMeta(key: string): unknown;
```

Defined in: adapters/types.ts:87

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

Defined in: adapters/types.ts:89

Write an adapter-specific scratchpad value; persisted before the call resolves.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `key` | `string` |
| `value` | `unknown` |

#### Returns

`Promise`\<`void`\>
