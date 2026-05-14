# Interface: CompiledPhase

Defined in: compile/index.ts:36

A phase after compilation. Carries the synthesized phase-end tool and the
full set of tools exposed to the model during this phase.

## Properties

### decl

```ts
readonly decl: PhaseDecl;
```

Defined in: compile/index.ts:37

***

### phaseEndTool

```ts
readonly phaseEndTool: ToolDecl;
```

Defined in: compile/index.ts:39

Synthesized phase-end tool. Always generated, but only exposed to the model when terminator is `tool` (the default).

***

### exposedTools

```ts
readonly exposedTools: readonly ExposedTool[];
```

Defined in: compile/index.ts:40

***

### phaseEndToolName

```ts
readonly phaseEndToolName: string;
```

Defined in: compile/index.ts:46

Name of the synthesized phase-end tool. With external terminators the tool
is NOT in `exposedTools`, so this name will never match a model tool call —
adapters can still reference it harmlessly.

***

### hasExternalTerminator

```ts
readonly hasExternalTerminator: boolean;
```

Defined in: compile/index.ts:48

True when the phase uses an external (host-driven) terminator.
