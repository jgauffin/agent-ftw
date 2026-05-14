# Class: CompileError

Defined in: compile/index.ts:55

Thrown by [validate](../functions/validate.md) when an agent declaration is structurally invalid:
cycles in the sub-agent graph, duplicate phase/tool names, empty phases, etc.

## Extends

- `Error`

## Constructors

### Constructor

```ts
new CompileError(message: string): CompileError;
```

Defined in: compile/index.ts:56

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
