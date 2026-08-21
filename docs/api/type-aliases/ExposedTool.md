# Type Alias: ExposedTool

```ts
type ExposedTool = 
  | ToolDecl
  | SubAgentDecl
  | CustomSubAgentDecl
  | SideQuestProposalDecl;
```

Defined in: [compile/index.ts:17](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L17)

Anything the model can call as a tool in a compiled phase: plain tools,
sub-agents, custom-handler sub-agents, and the synthetic side-quest proposal.
