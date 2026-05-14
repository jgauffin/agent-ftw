# Type Alias: BudgetExtensionResponse

```ts
type BudgetExtensionResponse = 
  | {
  extendBy: number;
}
  | {
  deny: true;
};
```

Defined in: hooks/index.ts:73

Host's reply to a [BudgetExtensionRequest](../interfaces/BudgetExtensionRequest.md): either grant `extendBy`
additional turns or deny (which raises `TurnBudgetExhausted`).
