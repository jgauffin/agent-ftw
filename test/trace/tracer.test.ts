import { describe, it, expect } from "vitest";
import { createTracer } from "../../src/trace/tracer.js";
import type { TraceEvent } from "../../src/trace/index.js";

function makeEvent(): TraceEvent {
  return {
    type: "tool.call",
    agent: "a",
    phase: "p1",
    runId: "run_1",
    tool: "echo",
    input: { msg: "hi" },
    callId: "c1",
    ts: 1700000000000,
  };
}

describe("createTracer", () => {
  it("emits one JSON line per event by default", () => {
    const lines: string[] = [];
    const tracer = createTracer({ sink: (l) => lines.push(l) });
    tracer(makeEvent());
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.type).toBe("tool.call");
    expect(parsed.tool).toBe("echo");
    expect(parsed.callId).toBe("c1");
    expect(parsed.ts).toBe(1700000000000);
  });

  it("respects format: text and produces a one-line summary", () => {
    const lines: string[] = [];
    const tracer = createTracer({ format: "text", sink: (l) => lines.push(l) });
    tracer(makeEvent());
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("tool.call");
    expect(lines[0]).toContain("tool=");
  });

  it("filters events", () => {
    const lines: string[] = [];
    const tracer = createTracer({
      filter: (e) => e.type === "tool.call",
      sink: (l) => lines.push(l),
    });
    tracer(makeEvent());
    tracer({
      type: "phase.start",
      agent: "a",
      phase: "p1",
      runId: "run_1",
      ts: 1700000000001,
    });
    expect(lines).toHaveLength(1);
  });

  it("uses custom fields projector", () => {
    const lines: string[] = [];
    const tracer = createTracer({
      sink: (l) => lines.push(l),
      fields: (e) => ({ minimal: e.type }),
    });
    tracer(makeEvent());
    const parsed = JSON.parse(lines[0]!);
    expect(Object.keys(parsed).sort()).toEqual(["minimal", "ts", "type"]);
  });

  it("sink: false drops output", () => {
    const tracer = createTracer({ sink: false });
    expect(() => tracer(makeEvent())).not.toThrow();
  });
});
