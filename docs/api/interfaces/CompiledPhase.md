# Interface: CompiledPhase

Defined in: [compile/index.ts:36](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L36)

A phase after compilation. Carries the synthesized phase-end tool and the
full set of tools exposed to the model during this phase.

## Properties

### decl

```ts
readonly decl: PhaseDecl;
```

Defined in: [compile/index.ts:37](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L37)

***

### phaseEndTool

```ts
readonly phaseEndTool: ToolDecl;
```

Defined in: [compile/index.ts:39](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L39)

Synthesized phase-end tool. Always generated, but only exposed to the model when terminator is `tool` (the default).

***

### exposedTools

```ts
readonly exposedTools: readonly ExposedTool[];
```

Defined in: [compile/index.ts:40](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L40)

***

### phaseEndToolName

```ts
readonly phaseEndToolName: string;
```

Defined in: [compile/index.ts:46](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L46)

Name of the synthesized phase-end tool. With external terminators the tool
is NOT in `exposedTools`, so this name will never match a model tool call —
adapters can still reference it harmlessly.

***

### hasExternalTerminator

```ts
readonly hasExternalTerminator: boolean;
```

Defined in: [compile/index.ts:48](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L48)

True when the phase uses an external (host-driven) terminator.
