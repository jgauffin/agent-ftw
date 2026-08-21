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

Defined in: [schema/index.ts:26](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/schema/index.ts#L26)

Result of [validateAgainstSchema](../functions/validateAgainstSchema.md). Pattern-match on `valid` to access errors.
