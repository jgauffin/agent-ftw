# Interface: ToolCall

Defined in: [adapters/types.ts:17](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L17)

A model-issued tool call. Adapter implementations translate provider-native
tool-call shapes into this normalized form.

## Properties

### id

```ts
readonly id: string;
```

Defined in: [adapters/types.ts:18](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L18)

***

### name

```ts
readonly name: string;
```

Defined in: [adapters/types.ts:19](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L19)

***

### input

```ts
readonly input: unknown;
```

Defined in: [adapters/types.ts:20](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L20)
