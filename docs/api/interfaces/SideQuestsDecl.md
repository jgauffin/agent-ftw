# Interface: SideQuestsDecl

Defined in: declare/index.ts:146

Per-agent configuration for agent-triggered side quests (feature B).

When `mode === "agent"`, every phase gets an auto-injected `propose_side_quest`
tool. The model proposes a goal + a subset of the catalog; the host approves
(or edits) via `askUser`; a single-phase child AgentRun is synthesized with
the approved tools and the configured deliverable schema.

## Properties

### mode

```ts
readonly mode: "off" | "agent";
```

Defined in: declare/index.ts:148

`"off"` disables the proposal tool; `"agent"` injects it on every phase.

***

### catalog

```ts
readonly catalog: readonly ToolDecl[];
```

Defined in: declare/index.ts:150

Tools the agent may request. Approved subset is what the side quest actually gets.

***

### deliverable

```ts
readonly deliverable: JSONSchema;
```

Defined in: declare/index.ts:152

JSON schema the side quest's deliverable must satisfy.

***

### turnBudget?

```ts
readonly optional turnBudget?: number;
```

Defined in: declare/index.ts:154

Turn budget for the synthesized side-quest phase. Default 20.

***

### maxDepth?

```ts
readonly optional maxDepth?: number;
```

Defined in: declare/index.ts:156

Maximum nesting; default 1 — synthesized side quests cannot themselves spawn side quests.

***

### adapter?

```ts
readonly optional adapter?: Adapter;
```

Defined in: declare/index.ts:158

Adapter override for the synthesized side-quest agent. Falls back to the parent agent's adapter.
