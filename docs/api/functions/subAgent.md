# Function: subAgent()

```ts
function subAgent(d: {
  name: string;
  description: string;
  input: JSONSchema;
  agent: AgentDecl;
}): SubAgentDecl;
```

Defined in: [declare/index.ts:326](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L326)

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
