# Function: checklist()

```ts
function checklist(d: {
  prompt: string;
  schema: JSONSchema;
  adapter?: Adapter;
}): ChecklistDecl;
```

Defined in: declare/index.ts:368

Define a checklist gate for a phase. The session's `localModel` adapter
runs the checklist after the deliverable is produced; failing checks trigger
a phase re-run with the failure attached as feedback.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | \{ `prompt`: `string`; `schema`: `JSONSchema`; `adapter?`: [`Adapter`](../interfaces/Adapter.md); \} |
| `d.prompt` | `string` |
| `d.schema` | `JSONSchema` |
| `d.adapter?` | [`Adapter`](../interfaces/Adapter.md) |

## Returns

[`ChecklistDecl`](../interfaces/ChecklistDecl.md)
