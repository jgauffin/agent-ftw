# Function: validate()

```ts
function validate(agent: AgentDecl): CompiledAgent;
```

Defined in: [compile/index.ts:71](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L71)

Validate and compile an [AgentDecl](../interfaces/AgentDecl.md). Throws [CompileError](../classes/CompileError.md) on
structural problems (cycles, duplicates, illegal terminator/review combos).

Passing the returned [CompiledAgent](../interfaces/CompiledAgent.md) to `Session` skips re-validation.
Passing the raw `AgentDecl` is fine too — `Session` calls `validate` itself.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `agent` | [`AgentDecl`](../interfaces/AgentDecl.md) |

## Returns

[`CompiledAgent`](../interfaces/CompiledAgent.md)
