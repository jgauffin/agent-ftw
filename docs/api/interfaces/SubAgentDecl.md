# Interface: SubAgentDecl

Defined in: [declare/index.ts:82](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L82)

Sub-agent exposed to the model as a tool. Calling the tool spawns a child
AgentRun against the embedded `agent` declaration and returns its final
phase's deliverable as the tool result.

Use when the sub-task is itself naturally phased.

## Properties

### kind

```ts
readonly kind: "subAgent";
```

Defined in: [declare/index.ts:83](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L83)

***

### name

```ts
readonly name: string;
```

Defined in: [declare/index.ts:84](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L84)

***

### description

```ts
readonly description: string;
```

Defined in: [declare/index.ts:85](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L85)

***

### input

```ts
readonly input: JSONSchema;
```

Defined in: [declare/index.ts:86](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L86)

***

### agent

```ts
readonly agent: AgentDecl;
```

Defined in: [declare/index.ts:87](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/declare/index.ts#L87)
