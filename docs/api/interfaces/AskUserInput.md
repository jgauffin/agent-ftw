# Interface: AskUserInput

Defined in: declare/index.ts:57

Input to an `askUser` call. The host's UI presents `prompt` and `options`;
the framework appends a synthetic "Other" option so the user can always reply
with free text (returned as `result.other`).

## Properties

### prompt

```ts
readonly prompt: string;
```

Defined in: declare/index.ts:58

***

### options?

```ts
readonly optional options?: readonly string[];
```

Defined in: declare/index.ts:60

Predefined options. If omitted, the user gets free text only.

***

### mode?

```ts
readonly optional mode?: "single" | "multi";
```

Defined in: declare/index.ts:62

Whether the user may pick multiple options. Default: `"single"`.
