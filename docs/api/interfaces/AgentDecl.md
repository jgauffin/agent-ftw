# Interface: AgentDecl

Defined in: declare/index.ts:272

An agent: a named pipeline of phases. Created via [agent](../functions/agent.md).

Sub-agents are themselves `AgentDecl`s wrapped in a [SubAgentDecl](SubAgentDecl.md).
The compile step validates the whole tree (cycle detection, name collisions,
etc.) before the Session can run it.

## Properties

### kind

```ts
readonly kind: "agent";
```

Defined in: declare/index.ts:273

***

### name

```ts
readonly name: string;
```

Defined in: declare/index.ts:275

Agent name. Surfaces in traces and persistence paths.

***

### adapter?

```ts
readonly optional adapter?: Adapter;
```

Defined in: declare/index.ts:281

Adapter override for every phase in this agent. Falls back to the session's
`defaultAdapter`; for a sub-agent, falls back to the parent agent's adapter.
Individual phases and checklists can override it further.

***

### tools

```ts
readonly tools: readonly (
  | ToolDecl
  | SubAgentDecl
  | CustomSubAgentDecl)[];
```

Defined in: declare/index.ts:283

Tools available to every phase. Merged with per-phase tools.

***

### phases

```ts
readonly phases: readonly PhaseDecl[];
```

Defined in: declare/index.ts:284

***

### sideQuests?

```ts
readonly optional sideQuests?: SideQuestsDecl;
```

Defined in: declare/index.ts:286

Configures agent-triggered side quests. See [SideQuestsDecl](SideQuestsDecl.md).
