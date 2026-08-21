# Class: TurnBudgetExhausted

Defined in: [adapters/types.ts:151](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L151)

Raised when a phase exceeds its `turnBudget` and the host either has no
`requestBudgetExtension` hook or denies the request.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new TurnBudgetExhausted(): TurnBudgetExhausted;
```

Defined in: [adapters/types.ts:152](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/adapters/types.ts#L152)

#### Returns

`TurnBudgetExhausted`

#### Overrides

```ts
Error.constructor
```
