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

Defined in: [adapters/types.ts:8](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L8)

One entry in a phase's conversation transcript. The framework keeps these
for the in-progress phase only — across phase boundaries only structured
deliverables carry forward.
