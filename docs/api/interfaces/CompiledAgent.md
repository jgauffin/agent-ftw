# Interface: CompiledAgent

Defined in: compile/index.ts:24

The output of [validate](../functions/validate.md) — an [AgentDecl](AgentDecl.md) that has been
structurally checked, with every phase's exposed tools resolved. Pass this
to `new Session({ agent, ... })` to skip re-validation.

## Properties

### decl

```ts
readonly decl: AgentDecl;
```

Defined in: compile/index.ts:26

The original (unchanged) declaration.

***

### phases

```ts
readonly phases: readonly CompiledPhase[];
```

Defined in: compile/index.ts:27

***

### toolsByName

```ts
readonly toolsByName: ReadonlyMap<string, ExposedTool>;
```

Defined in: compile/index.ts:29

All tools the agent and its phases expose, indexed by name.
