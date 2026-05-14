# Interface: SessionInfo

Defined in: runtime/session-store.ts:30

Read-only snapshot returned by [Session.listSessions](../classes/Session.md#listsessions). Carries the
fields a host UI typically renders (creation/update timestamps, current
phase, completion progress) without exposing adapter-internal metadata.

## Properties

### sessionId

```ts
readonly sessionId: string;
```

Defined in: runtime/session-store.ts:31

***

### agentName

```ts
readonly agentName: string;
```

Defined in: runtime/session-store.ts:32

***

### createdAt

```ts
readonly createdAt: number;
```

Defined in: runtime/session-store.ts:33

***

### updatedAt

```ts
readonly updatedAt: number;
```

Defined in: runtime/session-store.ts:34

***

### status

```ts
readonly status: "error" | "running" | "complete" | "aborted";
```

Defined in: runtime/session-store.ts:35

***

### currentPhase

```ts
readonly currentPhase: string | null;
```

Defined in: runtime/session-store.ts:36

***

### completedPhases

```ts
readonly completedPhases: readonly string[];
```

Defined in: runtime/session-store.ts:37
