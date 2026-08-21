# Interface: CustomSubAgentCtx

Defined in: [declare/index.ts:113](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L113)

Context passed to a [CustomSubAgentDecl](CustomSubAgentDecl.md) handler. In addition to the
usual `signal` / `emit` / `askUser`, it can spawn a phased child agent run
via [CustomSubAgentCtx.runChild](#runchild).

## Properties

### signal

```ts
readonly signal: AbortSignal;
```

Defined in: [declare/index.ts:114](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L114)

## Methods

### emit()

```ts
emit(payload: unknown): void;
```

Defined in: [declare/index.ts:115](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L115)

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

Defined in: [declare/index.ts:116](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L116)

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

Defined in: [declare/index.ts:121](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L121)

Spawn a full child AgentRun against the given declaration and return its
deliverable. Trace nesting and cancellation propagation are wired automatically.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `agent` | [`AgentDecl`](AgentDecl.md) |
| `input` | `unknown` |

#### Returns

`Promise`\<`unknown`\>
