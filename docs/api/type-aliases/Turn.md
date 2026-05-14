# Type Alias: Turn

```ts
type Turn = 
  | {
  role: "user";
  text: string;
}
  | {
  role: "assistant";
  text?: string;
  toolCalls?: readonly ToolCall[];
}
  | {
  role: "tool";
  toolCallId: string;
  result: unknown;
  isError?: boolean;
};
```

Defined in: adapters/types.ts:8

One entry in a phase's conversation transcript. The framework keeps these
for the in-progress phase only — across phase boundaries only structured
deliverables carry forward.
