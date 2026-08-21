# Interface: TracerOptions

Defined in: [trace/tracer.ts:6](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/tracer.ts#L6)

Configuration for [createTracer](../functions/createTracer.md).

## Properties

### sink?

```ts
readonly optional sink?: false | ((line: string) => void);
```

Defined in: [trace/tracer.ts:12](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/tracer.ts#L12)

Where to write log lines. Default: `(line) => console.log(line)`.
Pass `false` to drop output entirely (useful when you only care about
`filter`/`fields` side effects via a custom `sink`).

***

### filter?

```ts
readonly optional filter?: (event: TraceEvent) => boolean;
```

Defined in: [trace/tracer.ts:14](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/tracer.ts#L14)

Drop events for which this returns false.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | [`TraceEvent`](../type-aliases/TraceEvent.md) |

#### Returns

`boolean`

***

### fields?

```ts
readonly optional fields?: (event: TraceEvent) => Record<string, unknown>;
```

Defined in: [trace/tracer.ts:21](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/tracer.ts#L21)

Project structured fields per event. Defaults to a sensible
per-type projection (see `defaultFields`). The returned object is
merged with `{ ts, type }` for json output, or rendered next to the
one-line summary for text output.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `event` | [`TraceEvent`](../type-aliases/TraceEvent.md) |

#### Returns

`Record`\<`string`, `unknown`\>

***

### format?

```ts
readonly optional format?: "text" | "json";
```

Defined in: [trace/tracer.ts:23](https://github.com/jgauffin/agent-ftw/blob/2fa588093ad3cc257029a5a0e892ba05c841dcf3/src/trace/tracer.ts#L23)

"json" emits one JSON object per line; "text" emits a human summary. Default: "json".
