# Function: phase()

```ts
function phase(d: {
  name: string;
  prompt: string;
  deliverable: JSONSchema;
  tools?: readonly (
     | ToolDecl
     | SubAgentDecl
    | CustomSubAgentDecl)[];
  adapter?: Adapter;
  checklist?: ChecklistDecl;
  turnBudget?: number;
  review?: boolean;
  terminator?: PhaseTerminator;
  onAssistantText?: OnAssistantText;
  phaseEndToolName?: string;
}): PhaseDecl;
```

Defined in: declare/index.ts:387

Define a phase. Optional fields default sensibly:
 - `tools` defaults to `[]` (the agent's global tools are still available)
 - `terminator` defaults to `{ kind: "tool" }`
 - `turnBudget` defaults to the framework default if unset

## Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | \{ `name`: `string`; `prompt`: `string`; `deliverable`: `JSONSchema`; `tools?`: readonly ( \| [`ToolDecl`](../interfaces/ToolDecl.md) \| [`SubAgentDecl`](../interfaces/SubAgentDecl.md) \| [`CustomSubAgentDecl`](../interfaces/CustomSubAgentDecl.md))[]; `adapter?`: [`Adapter`](../interfaces/Adapter.md); `checklist?`: [`ChecklistDecl`](../interfaces/ChecklistDecl.md); `turnBudget?`: `number`; `review?`: `boolean`; `terminator?`: [`PhaseTerminator`](../type-aliases/PhaseTerminator.md); `onAssistantText?`: [`OnAssistantText`](../type-aliases/OnAssistantText.md); `phaseEndToolName?`: `string`; \} |
| `d.name` | `string` |
| `d.prompt` | `string` |
| `d.deliverable` | `JSONSchema` |
| `d.tools?` | readonly ( \| [`ToolDecl`](../interfaces/ToolDecl.md) \| [`SubAgentDecl`](../interfaces/SubAgentDecl.md) \| [`CustomSubAgentDecl`](../interfaces/CustomSubAgentDecl.md))[] |
| `d.adapter?` | [`Adapter`](../interfaces/Adapter.md) |
| `d.checklist?` | [`ChecklistDecl`](../interfaces/ChecklistDecl.md) |
| `d.turnBudget?` | `number` |
| `d.review?` | `boolean` |
| `d.terminator?` | [`PhaseTerminator`](../type-aliases/PhaseTerminator.md) |
| `d.onAssistantText?` | [`OnAssistantText`](../type-aliases/OnAssistantText.md) |
| `d.phaseEndToolName?` | `string` |

## Returns

[`PhaseDecl`](../interfaces/PhaseDecl.md)
