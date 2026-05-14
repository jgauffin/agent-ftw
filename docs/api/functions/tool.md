# Function: tool()

```ts
function tool<O>(d: {
  name: string;
  description: string;
  input: JSONSchema;
  handler: (input: unknown, ctx: ToolHandlerCtx) => Promise<O>;
}): ToolDecl;
```

Defined in: declare/index.ts:306

Define a plain tool the model may call. The handler's return value is
passed back to the model as the tool result (stringified if not already
a string).

## Type Parameters

| Type Parameter |
| ------ |
| `O` |

## Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | \{ `name`: `string`; `description`: `string`; `input`: `JSONSchema`; `handler`: (`input`: `unknown`, `ctx`: [`ToolHandlerCtx`](../interfaces/ToolHandlerCtx.md)) => `Promise`\<`O`\>; \} |
| `d.name` | `string` |
| `d.description` | `string` |
| `d.input` | `JSONSchema` |
| `d.handler` | (`input`: `unknown`, `ctx`: [`ToolHandlerCtx`](../interfaces/ToolHandlerCtx.md)) => `Promise`\<`O`\> |

## Returns

[`ToolDecl`](../interfaces/ToolDecl.md)

## Example

```ts
const search = tool({
  name: "search",
  description: "Search the bug database.",
  input: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } as const,
  handler: async (input) => searchDb((input as { query: string }).query),
});
```
