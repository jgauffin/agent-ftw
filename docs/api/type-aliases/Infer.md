# Type Alias: Infer\<S\>

```ts
type Infer<S> = FromSchema<S>;
```

Defined in: schema/index.ts:21

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
