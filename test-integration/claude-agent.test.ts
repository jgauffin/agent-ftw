/**
 * Integration tests for the claude-agent adapter against the real
 * @anthropic-ai/claude-agent-sdk + Claude CLI.
 *
 * Auto-skips when the Claude CLI is not on PATH or the SDK peer deps are not
 * installed — so this file is safe to keep in the repo and only exercises
 * the adapter when a developer (or CI job) has Claude available.
 *
 * To force-run / force-skip:
 *   AGENT_PIPELINE_SKIP_INTEGRATION=1   skip all integration tests
 *   AGENT_PIPELINE_CLAUDE_MODEL=...     override the model (default claude-sonnet-4-5)
 *   ANTHROPIC_API_KEY=...               passed through to the SDK; if absent the SDK
 *                                       falls back to the CLI's stored credentials.
 *
 * Each test exercises a path that the mocked unit tests cannot validate
 * because they depend on real wire-format behavior:
 *
 *   - tool-result round-trip: a tool returns various edge-case values
 *     (`undefined`, `null`, `""`) and the adapter must produce a non-empty
 *     `text` block. The Anthropic API rejects `cache_control` on empty text,
 *     and a bug here surfaces as
 *     `400 messages.N.content.0.text: cache_control cannot be set for empty
 *     text blocks` after the *second* model turn — only the real backend
 *     attaches cache_control, so a mocked SDK won't catch it.
 *   - assistant text surfacing: the adapter must emit assistant text Turns
 *     so host UIs see chat. Verified by capturing the trace bus.
 *   - phase-end-only: the simplest happy path, with no intermediate tools.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agent, phase, tool } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import type { Hooks } from "../src/hooks/index.js";
import { discoverClaudeCli, type DiscoveredRuntime } from "./_fixtures/runtime.js";
import type { TraceEvent } from "../src/trace/index.js";

const noopHooks: Hooks = {
  askUser: async () => ({ selected: [] }),
};

let runtime: DiscoveredRuntime | null = null;

beforeAll(async () => {
  runtime = await discoverClaudeCli();
  if (runtime) {
    // eslint-disable-next-line no-console
    console.log(`[integration:claude-agent] using ${runtime.describe}`);
  } else {
    // eslint-disable-next-line no-console
    console.log("[integration:claude-agent] skipped — Claude CLI / SDK not detected on this machine");
  }
});

afterAll(() => {
  // Allow the runtime cache to be re-discovered in subsequent suites.
});

const skip = process.env.AGENT_PIPELINE_SKIP_INTEGRATION === "1";

describe.skipIf(skip)("integration: claude-agent adapter", () => {
  it("phase-end-only: returns the deliverable from the model's first finalize call", async () => {
    if (!runtime) return;

    const p = phase({
      name: "echo",
      prompt:
        "Reply by calling the phase-end tool with payload { greeting: 'hello' }. Do not call any other tool.",
      deliverable: {
        type: "object",
        properties: { greeting: { type: "string" } },
        required: ["greeting"],
      } as const,
    });
    const a = agent({ name: "smoke", phases: [p] });
    const session = new Session({
      agent: a,
      defaultAdapter: runtime.adapter,
      hooks: noopHooks,
    });

    const out = (await session.run("Please greet me.")) as { greeting: string };
    expect(typeof out.greeting).toBe("string");
    expect(out.greeting.length).toBeGreaterThan(0);
  }, 60_000);

  it(
    "tool-result round-trip: handles tool returning undefined / null / '' without an empty-text API rejection",
    async () => {
      if (!runtime) return;

      // The model is told to call `probe`, then call phase-end with what it
      // observed. We don't assert on the exact deliverable shape — only that
      // the run completes (i.e. the second API request did NOT 400 with
      // "cache_control cannot be set for empty text blocks").
      const cases: Array<{ label: string; result: unknown }> = [
        { label: "undefined", result: undefined },
        { label: "null", result: null },
        { label: "empty-string", result: "" },
      ];

      for (const c of cases) {
        let probeCalled = 0;
        const probe = tool({
          name: "probe",
          description: "Returns an opaque value. Call exactly once before finalizing.",
          input: {
            type: "object",
            properties: {},
          } as const,
          handler: async () => {
            probeCalled++;
            return c.result;
          },
        });

        const p = phase({
          name: "probe_then_finish",
          prompt:
            "Call the `probe` tool exactly once, then call the phase-end tool with " +
            "payload { ok: true, note: 'probed' }. Do not call any other tool.",
          tools: [probe],
          deliverable: {
            type: "object",
            properties: {
              ok: { type: "boolean" },
              note: { type: "string" },
            },
            required: ["ok", "note"],
          } as const,
        });
        const a = agent({ name: `roundtrip_${c.label}`, phases: [p] });
        const session = new Session({
          agent: a,
          defaultAdapter: runtime.adapter,
          hooks: noopHooks,
        });

        const out = await session.run("Run the probe and finalize.");
        expect(probeCalled, `case ${c.label}: probe handler must have been invoked`).toBeGreaterThanOrEqual(1);
        expect(out, `case ${c.label}: deliverable must come back`).toBeDefined();
      }
    },
    180_000
  );

  it("assistant text surfaces as model.turn events on the trace bus", async () => {
    if (!runtime) return;

    const p = phase({
      name: "talk_then_finish",
      prompt:
        "Briefly say what you're about to do (one short sentence), then call the phase-end tool " +
        "with payload { acknowledged: true }.",
      deliverable: {
        type: "object",
        properties: { acknowledged: { type: "boolean" } },
        required: ["acknowledged"],
      } as const,
    });
    const a = agent({ name: "talker", phases: [p] });
    const seenTextTurns: string[] = [];
    const session = new Session({
      agent: a,
      defaultAdapter: runtime.adapter,
      hooks: {
        ...noopHooks,
        trace: (event: TraceEvent) => {
          if (event.type === "model.turn") {
            const turn = event.turn as { role?: string; text?: string };
            if (turn.role === "assistant" && typeof turn.text === "string" && turn.text.length > 0) {
              seenTextTurns.push(turn.text);
            }
          }
        },
      },
    });

    const out = (await session.run("Acknowledge this.")) as { acknowledged: boolean };
    expect(out.acknowledged).toBe(true);
    expect(
      seenTextTurns.length,
      "adapter should emit at least one assistant text Turn so host UIs see chat"
    ).toBeGreaterThanOrEqual(1);
  }, 60_000);
});
