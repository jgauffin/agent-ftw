# Interface: SideQuestProposalDecl

Defined in: declare/index.ts:130

Framework-internal: the auto-injected `propose_side_quest` tool. Created by
compile when an AgentDecl declares `sideQuests.mode === "agent"`. The model
sees it as a normal tool spec; dispatch handles it specially (askUser gate +
synthesized child AgentRun against the approved tool subset).

## Properties

### kind

```ts
readonly kind: "sideQuestProposal";
```

Defined in: declare/index.ts:131

***

### name

```ts
readonly name: string;
```

Defined in: declare/index.ts:132

***

### description

```ts
readonly description: string;
```

Defined in: declare/index.ts:133

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: declare/index.ts:134

***

### spec

```ts
readonly spec: SideQuestsDecl;
```

Defined in: declare/index.ts:135
