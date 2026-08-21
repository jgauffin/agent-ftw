# Class: TraceBus

Defined in: [trace/index.ts:66](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/index.ts#L66)

Internal bus that timestamps and dispatches [TraceEvent](../type-aliases/TraceEvent.md)s to the host's
[TraceCallback](../type-aliases/TraceCallback.md). Exceptions thrown by the callback are swallowed so
tracing never breaks a run.

Hosts almost never construct this directly — set `Hooks.trace` instead.

## Constructors

### Constructor

```ts
new TraceBus(cb: TraceCallback): TraceBus;
```

Defined in: [trace/index.ts:67](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/index.ts#L67)

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `cb` | [`TraceCallback`](../type-aliases/TraceCallback.md) |

#### Returns

`TraceBus`

## Methods

### emit()

```ts
emit(event: 
  | Omit<{
  type: "agent.start";
  agent: string;
  runId: string;
  parentRunId: string | null;
  input: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "agent.end";
  agent: string;
  runId: string;
  output: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "agent.error";
  agent: string;
  runId: string;
  error: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "phase.start";
  agent: string;
  phase: string;
  runId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "phase.end";
  agent: string;
  phase: string;
  runId: string;
  deliverable: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "model.turn";
  agent: string;
  phase: string;
  runId: string;
  turn: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "tool.call";
  agent: string;
  phase: string;
  runId: string;
  tool: string;
  input: unknown;
  callId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "tool.result";
  agent: string;
  phase: string;
  runId: string;
  tool: string;
  output: unknown;
  callId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "tool.error";
  agent: string;
  phase: string;
  runId: string;
  tool: string;
  error: string;
  callId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "tool.event";
  agent: string;
  phase: string;
  runId: string;
  tool: string;
  callId: string;
  payload: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "phase.assistantText";
  agent: string;
  phase: string;
  runId: string;
  text: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "phase.externalTerminated";
  agent: string;
  phase: string;
  runId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "checklist.run";
  agent: string;
  phase: string;
  runId: string;
  result: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "checklist.failed";
  agent: string;
  phase: string;
  runId: string;
  failures: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "review.start";
  agent: string;
  phase: string;
  runId: string;
  deliverable: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "review.message";
  agent: string;
  phase: string;
  runId: string;
  from: "user" | "agent";
  text: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "review.approved";
  agent: string;
  phase: string;
  runId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "askUser";
  agent: string;
  phase: string;
  runId: string;
  prompt: string;
  options: readonly string[];
  result: unknown;
  ts: number;
}, "ts">
  | Omit<{
  type: "budget.exhausted";
  agent: string;
  phase: string;
  runId: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "budget.extended";
  agent: string;
  phase: string;
  runId: string;
  by: number;
  ts: number;
}, "ts">
  | Omit<{
  type: "sideQuest.proposed";
  agent: string;
  phase: string;
  runId: string;
  goal: string;
  rationale: string;
  requestedTools: readonly string[];
  ts: number;
}, "ts">
  | Omit<{
  type: "sideQuest.declined";
  agent: string;
  phase: string;
  runId: string;
  reason: string;
  ts: number;
}, "ts">
  | Omit<{
  type: "sideQuest.approved";
  agent: string;
  phase: string;
  runId: string;
  approvedTools: readonly string[];
  ts: number;
}, "ts">
  | Omit<{
  type: "fork.created";
  parentSessionId: string;
  childSessionId: string;
  seed: "deliverable" | "summarize";
  ts: number;
}, "ts">
  | Omit<{
  type: "cancelled";
  runId: string;
  reason: string;
  ts: number;
}, "ts">): void;
```

Defined in: [trace/index.ts:70](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/index.ts#L70)

Emit an event. The bus adds `ts` automatically; pass the rest as-is.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | \| `Omit`\<\{ `type`: `"agent.start"`; `agent`: `string`; `runId`: `string`; `parentRunId`: `string` \| `null`; `input`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"agent.end"`; `agent`: `string`; `runId`: `string`; `output`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"agent.error"`; `agent`: `string`; `runId`: `string`; `error`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"phase.start"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"phase.end"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `deliverable`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"model.turn"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `turn`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"tool.call"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `tool`: `string`; `input`: `unknown`; `callId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"tool.result"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `tool`: `string`; `output`: `unknown`; `callId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"tool.error"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `tool`: `string`; `error`: `string`; `callId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"tool.event"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `tool`: `string`; `callId`: `string`; `payload`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"phase.assistantText"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `text`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"phase.externalTerminated"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"checklist.run"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `result`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"checklist.failed"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `failures`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"review.start"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `deliverable`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"review.message"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `from`: `"user"` \| `"agent"`; `text`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"review.approved"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"askUser"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `prompt`: `string`; `options`: readonly `string`[]; `result`: `unknown`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"budget.exhausted"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"budget.extended"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `by`: `number`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"sideQuest.proposed"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `goal`: `string`; `rationale`: `string`; `requestedTools`: readonly `string`[]; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"sideQuest.declined"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `reason`: `string`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"sideQuest.approved"`; `agent`: `string`; `phase`: `string`; `runId`: `string`; `approvedTools`: readonly `string`[]; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"fork.created"`; `parentSessionId`: `string`; `childSessionId`: `string`; `seed`: `"deliverable"` \| `"summarize"`; `ts`: `number`; \}, `"ts"`\> \| `Omit`\<\{ `type`: `"cancelled"`; `runId`: `string`; `reason`: `string`; `ts`: `number`; \}, `"ts"`\> |

#### Returns

`void`
