# Function: subAgent()

```ts
function subAgent(d: {
  name: string;
  description: string;
  input: JSONSchema;
  agent: AgentDecl;
}): SubAgentDecl;
```

Defined in: declare/index.ts:326

Define a sub-agent the parent can call as a tool. The sub-agent's pipeline
runs as a child AgentRun; its final phase's deliverable becomes the tool
result returned to the parent model.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | \{ `name`: `string`; `description`: `string`; `input`: `JSONSchema`; `agent`: [`AgentDecl`](../interfaces/AgentDecl.md); \} |
| `d.name` | `string` |
| `d.description` | `string` |
| `d.input` | `JSONSchema` |
| `d.agent` | [`AgentDecl`](../interfaces/AgentDecl.md) |

## Returns

[`SubAgentDecl`](../interfaces/SubAgentDecl.md)
