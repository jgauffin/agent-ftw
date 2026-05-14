# Type Alias: ValidationResult

```ts
type ValidationResult = 
  | {
  valid: true;
}
  | {
  valid: false;
  errors: string[];
};
```

Defined in: schema/index.ts:26

Result of [validateAgainstSchema](../functions/validateAgainstSchema.md). Pattern-match on `valid` to access errors.
