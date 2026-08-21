# Class: CompileError

Defined in: [compile/index.ts:55](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L55)

Thrown by [validate](../functions/validate.md) when an agent declaration is structurally invalid:
cycles in the sub-agent graph, duplicate phase/tool names, empty phases, etc.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new CompileError(message: string): CompileError;
```

Defined in: [compile/index.ts:56](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L56)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `message` | `string` |

#### Returns

`CompileError`

#### Overrides

```ts
Error.constructor
```
