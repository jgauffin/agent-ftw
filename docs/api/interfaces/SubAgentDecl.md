# Interface: SubAgentDecl

Defined in: declare/index.ts:82

Sub-agent exposed to the model as a tool. Calling the tool spawns a child
AgentRun against the embedded `agent` declaration and returns its final
phase's deliverable as the tool result.

Use when the sub-task is itself naturally phased.

## Properties

### kind

```ts
readonly kind: "subAgent";
```

Defined in: declare/index.ts:83

***

### name

```ts
readonly name: string;
```

Defined in: declare/index.ts:84

***

### description

```ts
readonly description: string;
```

Defined in: declare/index.ts:85

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: declare/index.ts:86

***

### agent

```ts
readonly agent: AgentDecl;
```

Defined in: declare/index.ts:87
