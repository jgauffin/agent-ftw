# Interface: ToolSpec

Defined in: [adapters/types.ts:28](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L28)

Per-tool descriptor adapters receive on `RunContext.tools`. This is the
framework-normalized view; adapters convert it to provider-native shapes
(OpenAI function tools, MCP tool defs, etc.) before sending it to the model.

## Properties

### name

```ts
readonly name: string;
```

Defined in: [adapters/types.ts:29](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L29)

***

### description

```ts
readonly description: string;
```

Defined in: [adapters/types.ts:30](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L30)

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: [adapters/types.ts:31](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L31)
