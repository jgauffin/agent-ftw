import type { TraceCallback, TraceEvent } from "./index.js";

/**
 * Configuration for {@link createTracer}.
 */
export interface TracerOptions {
  /**
   * Where to write log lines. Default: `(line) => console.log(line)`.
   * Pass `false` to drop output entirely (useful when you only care about
   * `filter`/`fields` side effects via a custom `sink`).
   */
  readonly sink?: ((line: string) => void) | false;
  /** Drop events for which this returns false. */
  readonly filter?: (event: TraceEvent) => boolean;
  /**
   * Project structured fields per event. Defaults to a sensible
   * per-type projection (see `defaultFields`). The returned object is
   * merged with `{ ts, type }` for json output, or rendered next to the
   * one-line summary for text output.
   */
  readonly fields?: (event: TraceEvent) => Record<string, unknown>;
  /** "json" emits one JSON object per line; "text" emits a human summary. Default: "json". */
  readonly format?: "json" | "text";
}

/**
 * Build a `TraceCallback` suitable for `Hooks.trace`. Useful when bridging the
 * framework's bus to an external observability system or to stdout — for
 * example, when running AgentPipeline as a subprocess of a host that consumes
 * NDJSON on stdout.
 */
export function createTracer(opts: TracerOptions = {}): TraceCallback {
  const sink: (line: string) => void =
    opts.sink === false ? () => {} : (opts.sink ?? ((line) => console.log(line)));
  const format = opts.format ?? "json";
  const project = opts.fields ?? defaultFields;
  const filter = opts.filter;

  return (event: TraceEvent) => {
    if (filter && !filter(event)) return;
    const fields = project(event);
    if (format === "json") {
      sink(JSON.stringify({ ts: event.ts, type: event.type, ...fields }));
      return;
    }
    sink(formatText(event, fields));
  };
}

function defaultFields(event: TraceEvent): Record<string, unknown> {
  // Strip ts/type (already separated) and pass everything else through.
  const { ts: _ts, type: _type, ...rest } = event as TraceEvent & { ts: number; type: string };
  void _ts;
  void _type;
  return rest as Record<string, unknown>;
}

function formatText(event: TraceEvent, fields: Record<string, unknown>): string {
  const ts = new Date(event.ts).toISOString();
  const tail = compactFields(fields);
  return tail ? `${ts} ${event.type} ${tail}` : `${ts} ${event.type}`;
}

function compactFields(fields: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(" ");
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v.length > 80 ? JSON.stringify(v.slice(0, 77) + "...") : JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean" || v === null) return String(v);
  // Objects/arrays: compact JSON, truncated to keep one-line output bounded.
  const json = JSON.stringify(v);
  if (json === undefined) return "<unserializable>";
  return json.length > 120 ? json.slice(0, 117) + "..." : json;
}
