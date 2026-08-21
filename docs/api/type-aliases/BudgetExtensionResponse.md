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

Defined in: [hooks/index.ts:73](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/hooks/index.ts#L73)

Host's reply to a [BudgetExtensionRequest](../interfaces/BudgetExtensionRequest.md): either grant `extendBy`
additional turns or deny (which raises `TurnBudgetExhausted`).
