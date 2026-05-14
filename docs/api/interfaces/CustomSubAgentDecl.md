# Interface: CustomSubAgentDecl

Defined in: declare/index.ts:98

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

Defined in: declare/index.ts:99

***

### name

```ts
readonly name: string;
```

Defined in: declare/index.ts:100

***

### description

```ts
readonly description: string;
```

Defined in: declare/index.ts:101

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: declare/index.ts:102

***

### output

```ts
readonly output: JSONSchema;
```

Defined in: declare/index.ts:104

JSON Schema for the handler's return value. Validated before the result is exposed to the model.

***

### handler

```ts
readonly handler: (input: unknown, ctx: CustomSubAgentCtx) => Promise<unknown>;
```

Defined in: declare/index.ts:105

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `unknown` |
| `ctx` | [`CustomSubAgentCtx`](CustomSubAgentCtx.md) |

#### Returns

`Promise`\<`unknown`\>
