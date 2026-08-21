# Interface: AskUserResult

Defined in: [declare/index.ts:70](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L70)

Result returned from `askUser`. `selected` lists the predefined options the
user picked (with the synthetic "Other" stripped); `other` is the user's free
text reply when they chose Other.

## Properties

### selected

```ts
readonly selected: readonly string[];
```

Defined in: [declare/index.ts:71](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L71)

***

### other?

```ts
readonly optional other?: string;
```

Defined in: [declare/index.ts:72](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L72)
