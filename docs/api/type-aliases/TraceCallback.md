# Type Alias: TraceCallback

```ts
type TraceCallback = (event: TraceEvent) => void;
```

Defined in: [trace/index.ts:54](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/index.ts#L54)

Subscriber signature for the trace bus. Set as `Hooks.trace` on a `Session`
to receive every framework event.

## Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | [`TraceEvent`](TraceEvent.md) |

## Returns

`void`
