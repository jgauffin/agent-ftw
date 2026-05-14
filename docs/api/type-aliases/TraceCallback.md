# Type Alias: TraceCallback

```ts
type TraceCallback = (event: TraceEvent) => void;
```

Defined in: trace/index.ts:54

Subscriber signature for the trace bus. Set as `Hooks.trace` on a `Session`
to receive every framework event.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | [`TraceEvent`](TraceEvent.md) |

## Returns

`void`
