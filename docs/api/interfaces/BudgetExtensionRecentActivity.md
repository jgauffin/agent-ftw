# Interface: BudgetExtensionRecentActivity

Defined in: [hooks/index.ts:58](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L58)

Compact, host-renderable summary of the last few model/tool actions in a
budget-exhausted phase. Attached to [BudgetExtensionRequest](BudgetExtensionRequest.md) so the
host can show the user "what was it doing?" before deciding to grant turns.

## Properties

### lastAssistantText?

```ts
readonly optional lastAssistantText?: string;
```

Defined in: [hooks/index.ts:60](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L60)

Last assistant text turn, if any.

***

### recentToolCalls

```ts
readonly recentToolCalls: readonly {
  name: string;
  inputSummary: string;
}[];
```

Defined in: [hooks/index.ts:62](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L62)

Most recent tool calls (newest last), capped to a small number.
