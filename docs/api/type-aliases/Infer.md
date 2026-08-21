# Type Alias: Infer\<S\>

```ts
type Infer<S> = FromSchema<S>;
```

Defined in: [schema/index.ts:21](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/schema/index.ts#L21)

Derive the TS type of a value that satisfies the given JSON Schema. Schema
must be authored `as const` for inference to work.

## Type Parameters

| Type Parameter |
| ------ |
| `S` *extends* [`JSONSchema`](JSONSchema.md) |

## Example

```ts
const Schema = { type: "object", properties: { x: { type: "number" } }, required: ["x"] } as const;
type T = Infer<typeof Schema>; // { x: number }
```
