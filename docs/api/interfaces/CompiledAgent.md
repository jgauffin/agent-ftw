# Interface: CompiledAgent

Defined in: [compile/index.ts:24](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L24)

The output of [validate](../functions/validate.md) — an [AgentDecl](AgentDecl.md) that has been
structurally checked, with every phase's exposed tools resolved. Pass this
to `new Session({ agent, ... })` to skip re-validation.

## Properties

### decl

```ts
readonly decl: AgentDecl;
```

Defined in: [compile/index.ts:26](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L26)

The original (unchanged) declaration.

***

### phases

```ts
readonly phases: readonly CompiledPhase[];
```

Defined in: [compile/index.ts:27](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L27)

***

### toolsByName

```ts
readonly toolsByName: ReadonlyMap<string, ExposedTool>;
```

Defined in: [compile/index.ts:29](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/compile/index.ts#L29)

All tools the agent and its phases expose, indexed by name.
