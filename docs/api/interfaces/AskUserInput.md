# Interface: AskUserInput

Defined in: [declare/index.ts:57](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L57)

Input to an `askUser` call. The host's UI presents `prompt` and `options`;
the framework appends a synthetic "Other" option so the user can always reply
with free text (returned as `result.other`).

## Properties

### prompt

```ts
readonly prompt: string;
```

Defined in: [declare/index.ts:58](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L58)

***

### options?

```ts
readonly optional options?: readonly string[];
```

Defined in: [declare/index.ts:60](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L60)

Predefined options. If omitted, the user gets free text only.

***

### mode?

```ts
readonly optional mode?: "single" | "multi";
```

Defined in: [declare/index.ts:62](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L62)

Whether the user may pick multiple options. Default: `"single"`.
