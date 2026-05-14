# Interface: BudgetExtensionRecentActivity

Defined in: hooks/index.ts:58

Compact, host-renderable summary of the last few model/tool actions in a
budget-exhausted phase. Attached to [BudgetExtensionRequest](BudgetExtensionRequest.md) so the
host can show the user "what was it doing?" before deciding to grant turns.

## Properties

### lastAssistantText?

```ts
readonly optional lastAssistantText?: string;
```

Defined in: hooks/index.ts:60

Last assistant text turn, if any.

***

### recentToolCalls

```ts
readonly recentToolCalls: readonly {
  name: string;
  inputSummary: string;
}[];
```

Defined in: hooks/index.ts:62

Most recent tool calls (newest last), capped to a small number.
