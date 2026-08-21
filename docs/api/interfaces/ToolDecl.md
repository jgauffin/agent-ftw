# Interface: ToolDecl

Defined in: [declare/index.ts:18](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L18)

Plain tool the model may call inside a phase. Created via [tool](../functions/tool.md).

The framework validates `input` against the JSON Schema before invoking the
handler, so handlers can trust the shape (but still receive it as `unknown` —
narrow with a type guard or cast).

## Properties

### kind

```ts
readonly kind: "tool";
```

Defined in: [declare/index.ts:19](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L19)

***

### name

```ts
readonly name: string;
```

Defined in: [declare/index.ts:21](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L21)

Name the model sees (and uses to call the tool). Must be unique within an agent.

***

### description

```ts
readonly description: string;
```

Defined in: [declare/index.ts:23](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L23)

Human/model-facing description; this is the model's only documentation for the tool.

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: [declare/index.ts:25](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L25)

JSON Schema for the tool's input. Framework validates calls against this before dispatch.

***

### handler

```ts
readonly handler: (input: unknown, ctx: ToolHandlerCtx) => Promise<unknown>;
```

Defined in: [declare/index.ts:30](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L30)

Implementation. Receives the validated input and a context with cancellation,
`askUser`, and `emit`. Throw to surface an error result to the model.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | `unknown` |
| `ctx` | [`ToolHandlerCtx`](ToolHandlerCtx.md) |

#### Returns

`Promise`\<`unknown`\>
