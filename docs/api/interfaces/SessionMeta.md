# Interface: SessionMeta

Defined in: [runtime/session-store.ts:11](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L11)

Mutable persistence record for a single session. Written to
`{sessionDirectory}/{agentName}/{sessionId}/meta.json` after each phase
boundary. Hosts usually don't construct this directly — use
[Session.listSessions](../classes/Session.md#listsessions) to enumerate persisted sessions.

## Properties

### sessionId

```ts
readonly sessionId: string;
```

Defined in: [runtime/session-store.ts:12](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L12)

***

### agentName

```ts
readonly agentName: string;
```

Defined in: [runtime/session-store.ts:13](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L13)

***

### createdAt

```ts
readonly createdAt: number;
```

Defined in: [runtime/session-store.ts:14](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L14)

***

### updatedAt

```ts
updatedAt: number;
```

Defined in: [runtime/session-store.ts:15](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L15)

***

### status

```ts
status: "error" | "running" | "complete" | "aborted";
```

Defined in: [runtime/session-store.ts:16](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L16)

***

### completedPhases

```ts
completedPhases: string[];
```

Defined in: [runtime/session-store.ts:18](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L18)

Phase names whose deliverables are stored in deliverables.json.

***

### currentPhase

```ts
currentPhase: string | null;
```

Defined in: [runtime/session-store.ts:20](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L20)

Phase currently in progress, if any.

***

### adapterMeta

```ts
adapterMeta: Record<string, unknown>;
```

Defined in: [runtime/session-store.ts:22](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L22)

Per-adapter scratchpad (e.g. Claude SDK session ids keyed by phase).
