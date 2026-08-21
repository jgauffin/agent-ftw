# Function: createTracer()

```ts
function createTracer(opts?: TracerOptions): TraceCallback;
```

Defined in: [trace/tracer.ts:32](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/tracer.ts#L32)

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
