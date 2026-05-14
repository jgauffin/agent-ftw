# Interface: CustomSubAgentCtx

Defined in: declare/index.ts:113

Context passed to a [CustomSubAgentDecl](CustomSubAgentDecl.md) handler. In addition to the
usual `signal` / `emit` / `askUser`, it can spawn a phased child agent run
via [CustomSubAgentCtx.runChild](#runchild).

## Properties

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: declare/index.ts:114

## Methods

### emit()

```ts
emit(payload: unknown): void;
```

Defined in: declare/index.ts:115

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payload` | `unknown` |

#### Returns

`void`

***

### askUser()

```ts
askUser(input: AskUserInput): Promise<AskUserResult>;
```

Defined in: declare/index.ts:116

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`AskUserInput`](AskUserInput.md) |

#### Returns

`Promise`\<[`AskUserResult`](AskUserResult.md)\>

***

### runChild()

```ts
runChild(agent: AgentDecl, input: unknown): Promise<unknown>;
```

Defined in: declare/index.ts:121

Spawn a full child AgentRun against the given declaration and return its
deliverable. Trace nesting and cancellation propagation are wired automatically.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `agent` | [`AgentDecl`](AgentDecl.md) |
| `input` | `unknown` |

#### Returns

`Promise`\<`unknown`\>
