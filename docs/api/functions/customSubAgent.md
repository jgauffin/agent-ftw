# Function: customSubAgent()

```ts
function customSubAgent(d: {
  name: string;
  description: string;
  input: JSONSchema;
  output: JSONSchema;
  handler: (input: unknown, ctx: CustomSubAgentCtx) => Promise<unknown>;
}): CustomSubAgentDecl;
```

Defined in: declare/index.ts:346

Define a custom-handler sub-agent. The handler runs TypeScript directly
(instead of a phased pipeline) and may spawn nested child agents via
`ctx.runChild`. Output is validated against `output` before being returned.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | \{ `name`: `string`; `description`: `string`; `input`: `JSONSchema`; `output`: `JSONSchema`; `handler`: (`input`: `unknown`, `ctx`: [`CustomSubAgentCtx`](../interfaces/CustomSubAgentCtx.md)) => `Promise`\<`unknown`\>; \} |
| `d.name` | `string` |
| `d.description` | `string` |
| `d.input` | `JSONSchema` |
| `d.output` | `JSONSchema` |
| `d.handler` | (`input`: `unknown`, `ctx`: [`CustomSubAgentCtx`](../interfaces/CustomSubAgentCtx.md)) => `Promise`\<`unknown`\> |

## Returns

[`CustomSubAgentDecl`](../interfaces/CustomSubAgentDecl.md)
