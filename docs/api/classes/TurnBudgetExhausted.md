# Class: TurnBudgetExhausted

Defined in: adapters/types.ts:134

Raised when a phase exceeds its `turnBudget` and the host either has no
`requestBudgetExtension` hook or denies the request.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new TurnBudgetExhausted(): TurnBudgetExhausted;
```

Defined in: adapters/types.ts:135

#### Returns

`TurnBudgetExhausted`

#### Overrides

```ts
Error.constructor
```
