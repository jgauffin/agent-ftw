# Function: validateAgainstSchema()

```ts
function validateAgainstSchema(schema: JSONSchema, value: unknown): ValidationResult;
```

Defined in: [schema/index.ts:34](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/schema/index.ts#L34)

Validate a value against a JSON Schema using `@cfworker/json-schema`.
Returns a structured result; errors are stringified as `"<location>: <message>"`.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `schema` | `JSONSchema` |
| `value` | `unknown` |

## Returns

[`ValidationResult`](../type-aliases/ValidationResult.md)
