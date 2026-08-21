# Type Alias: JSONSchema

```ts
type JSONSchema = JSTSSchema;
```

Defined in: [schema/index.ts:9](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/schema/index.ts#L9)

JSON Schema type used everywhere in the framework. Re-exported from
`json-schema-to-ts` so authors can write `as const` schemas and (optionally)
derive a TS type via [Infer](Infer.md).
