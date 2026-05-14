# Function: validateAgainstSchema()

```ts
function validateAgainstSchema(schema: JSONSchema, value: unknown): ValidationResult;
```

Defined in: schema/index.ts:34

Validate a value against a JSON Schema using `@cfworker/json-schema`.
Returns a structured result; errors are stringified as `"<location>: <message>"`.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `schema` | `JSONSchema` |
| `value` | `unknown` |

## Returns

[`ValidationResult`](../type-aliases/ValidationResult.md)
