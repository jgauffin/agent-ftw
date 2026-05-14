# Interface: AskUserResult

Defined in: declare/index.ts:70

Result returned from `askUser`. `selected` lists the predefined options the
user picked (with the synthetic "Other" stripped); `other` is the user's free
text reply when they chose Other.

## Properties

### selected

```ts
readonly selected: readonly string[];
```

Defined in: declare/index.ts:71

***

### other?

```ts
readonly optional other?: string;
```

Defined in: declare/index.ts:72
