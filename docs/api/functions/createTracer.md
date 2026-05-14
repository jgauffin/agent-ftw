# Function: createTracer()

```ts
function createTracer(opts?: TracerOptions): TraceCallback;
```

Defined in: trace/tracer.ts:32

Build a `TraceCallback` suitable for `Hooks.trace`. Useful when bridging the
framework's bus to an external observability system or to stdout — for
example, when running AgentPipeline as a subprocess of a host that consumes
NDJSON on stdout.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `opts` | [`TracerOptions`](../interfaces/TracerOptions.md) |

## Returns

[`TraceCallback`](../type-aliases/TraceCallback.md)
