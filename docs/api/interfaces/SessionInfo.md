# Interface: SessionInfo

Defined in: [runtime/session-store.ts:30](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L30)

Read-only snapshot returned by [Session.listSessions](../classes/Session.md#listsessions). Carries the
fields a host UI typically renders (creation/update timestamps, current
phase, completion progress) without exposing adapter-internal metadata.

## Properties

### sessionId

```ts
readonly sessionId: string;
```

Defined in: [runtime/session-store.ts:31](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L31)

***

### agentName

```ts
readonly agentName: string;
```

Defined in: [runtime/session-store.ts:32](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L32)

***

### createdAt

```ts
readonly createdAt: number;
```

Defined in: [runtime/session-store.ts:33](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L33)

***

### updatedAt

```ts
readonly updatedAt: number;
```

Defined in: [runtime/session-store.ts:34](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L34)

***

### status

```ts
readonly status: "error" | "running" | "complete" | "aborted";
```

Defined in: [runtime/session-store.ts:35](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L35)

***

### currentPhase

```ts
readonly currentPhase: string | null;
```

Defined in: [runtime/session-store.ts:36](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L36)

***

### completedPhases

```ts
readonly completedPhases: readonly string[];
```

Defined in: [runtime/session-store.ts:37](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/runtime/session-store.ts#L37)
