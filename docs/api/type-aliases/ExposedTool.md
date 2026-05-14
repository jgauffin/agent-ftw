# Type Alias: ExposedTool

```ts
type ExposedTool = 
  | ToolDecl
  | SubAgentDecl
  | CustomSubAgentDecl
  | SideQuestProposalDecl;
```

Defined in: compile/index.ts:17

Anything the model can call as a tool in a compiled phase: plain tools,
sub-agents, custom-handler sub-agents, and the synthetic side-quest proposal.
