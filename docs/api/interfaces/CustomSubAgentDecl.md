# Interface: CustomSubAgentDecl

Defined in: [declare/index.ts:98](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L98)

Sub-agent whose body is a custom TS handler instead of a phased AgentDecl.
Use when coordination is conditional (fail-fast gating, fan-out/join, deterministic
pre/post-processing) and expressing it as phases would be awkward. The handler
receives a context that can spawn full child AgentRuns via `runChild`.

Output is validated against `output` before the result is returned to the caller.

## Properties

### kind

```ts
readonly kind: "customSubAgent";
```

Defined in: [declare/index.ts:99](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L99)

***

### name

```ts
readonly name: string;
```

Defined in: [declare/index.ts:100](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L100)

***

### description

```ts
readonly description: string;
```

Defined in: [declare/index.ts:101](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L101)

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: [declare/index.ts:102](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L102)

***

### output

```ts
readonly output: JSONSchema;
```

Defined in: [declare/index.ts:104](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L104)

JSON Schema for the handler's return value. Validated before the result is exposed to the model.

***

### handler

```ts
readonly handler: (input: unknown, ctx: CustomSubAgentCtx) => Promise<unknown>;
```

Defined in: [declare/index.ts:105](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L105)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `unknown` |
| `ctx` | [`CustomSubAgentCtx`](CustomSubAgentCtx.md) |

#### Returns

`Promise`\<`unknown`\>
