# Interface: SessionOptions

Defined in: [runtime/session.ts:55](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L55)

Constructor options for [Session](../classes/Session.md).

## Properties

### agent

```ts
agent: AgentDecl | CompiledAgent;
```

Defined in: [runtime/session.ts:57](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L57)

Compiled or raw agent declaration.

***

### defaultAdapter

```ts
defaultAdapter: Adapter;
```

Defined in: [runtime/session.ts:62](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L62)

Adapter used for the whole pipeline unless a construct overrides it. Any
agent, phase, or checklist may carry its own `adapter` to override this.

***

### hooks

```ts
hooks: Hooks;
```

Defined in: [runtime/session.ts:63](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L63)

***

### sessionDirectory?

```ts
optional sessionDirectory?: string;
```

Defined in: [runtime/session.ts:69](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L69)

Enables session persistence. State is written under
`{sessionDirectory}/{agentName}/{sessionId}/`. Only the top-level agent run
is persisted — sub-agents are rerun on resume.

***

### sessionId?

```ts
optional sessionId?: string;
```

Defined in: [runtime/session.ts:75](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session.ts#L75)

Stable session id. When omitted, a fresh id is generated. When provided
AND the directory contains existing state for it, the next `run()` resumes
from the persisted phase boundary. Has no effect without `sessionDirectory`.
