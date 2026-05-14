# Function: agent()

```ts
function agent(d: {
  name: string;
  adapter?: Adapter;
  tools?: readonly (
     | ToolDecl
     | SubAgentDecl
    | CustomSubAgentDecl)[];
  phases: readonly PhaseDecl[];
  sideQuests?: SideQuestsDecl;
}): AgentDecl;
```

Defined in: declare/index.ts:429

Define an agent: an ordered list of phases and (optionally) global tools
shared by every phase. An optional `adapter` overrides the session default
for every phase in this agent.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `d` | \{ `name`: `string`; `adapter?`: [`Adapter`](../interfaces/Adapter.md); `tools?`: readonly ( \| [`ToolDecl`](../interfaces/ToolDecl.md) \| [`SubAgentDecl`](../interfaces/SubAgentDecl.md) \| [`CustomSubAgentDecl`](../interfaces/CustomSubAgentDecl.md))[]; `phases`: readonly [`PhaseDecl`](../interfaces/PhaseDecl.md)[]; `sideQuests?`: [`SideQuestsDecl`](../interfaces/SideQuestsDecl.md); \} |
| `d.name` | `string` |
| `d.adapter?` | [`Adapter`](../interfaces/Adapter.md) |
| `d.tools?` | readonly ( \| [`ToolDecl`](../interfaces/ToolDecl.md) \| [`SubAgentDecl`](../interfaces/SubAgentDecl.md) \| [`CustomSubAgentDecl`](../interfaces/CustomSubAgentDecl.md))[] |
| `d.phases` | readonly [`PhaseDecl`](../interfaces/PhaseDecl.md)[] |
| `d.sideQuests?` | [`SideQuestsDecl`](../interfaces/SideQuestsDecl.md) |

## Returns

[`AgentDecl`](../interfaces/AgentDecl.md)

## Example

```ts
const triager = agent({
  name: "bug_triager",
  phases: [triagePhase, planPhase],
});
```
