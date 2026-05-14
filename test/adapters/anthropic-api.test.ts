/**
 * Tests for the anthropic-api adapter. The real `@anthropic-ai/sdk` is mocked
 * via `vi.mock` so these tests run hermetically without the SDK installed.
 *
 * Exercised:
 *   1. `runUntilPhaseEnd` drives the model→tool loop by hand: tool_use blocks
 *      are dispatched via ctx.dispatchTool, phase-end returns its payload.
 *   2. Assistant text with no tool calls is surfaced and the model is nudged.
 *   3. Tool results are encoded as non-empty `tool_result` content blocks.
 *   4. `runStructured` is a one-shot forced `submit` tool call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Anthropic,
  setAnthropicResponses,
  resetFakeAnthropic,
  getStructuredCalls,
} from "../_fixtures/fake-anthropic-sdk.js";

vi.mock("@anthropic-ai/sdk", () => ({ Anthropic, default: { Anthropic } }));

import { anthropicApiAdapter } from "../../src/adapters/anthropic-api.js";
import type { RunContext, Turn, ToolSpec } from "../../src/adapters/types.js";

interface HarnessOpts {
  tools?: ToolSpec[];
  phaseEndToolName?: string;
  newUserText?: string;
  dispatchTool?: (name: string, input: unknown, callId: string) => Promise<unknown>;
  onAssistantText?: (text: string) => Promise<string>;
}

interface Harness {
  ctx: RunContext;
  turns: Turn[];
  consumed: number;
  dispatched: Array<{ name: string; input: unknown; callId: string }>;
}

function makeHarness(opts: HarnessOpts = {}): Harness {
  const turns: Turn[] = [];
  const dispatched: Array<{ name: string; input: unknown; callId: string }> = [];
  const harness: Harness = {
    ctx: undefined as unknown as RunContext,
    turns,
    consumed: 0,
    dispatched,
  };
  harness.ctx = {
    systemPrompt: "system",
    conversation: [],
    newUserText: opts.newUserText ?? "user prompt",
    tools: opts.tools ?? [],
    phaseEndToolName: opts.phaseEndToolName ?? "end_phase_test",
    signal: new AbortController().signal,
    dispatchTool:
      opts.dispatchTool ??
      (async (name, input, callId) => {
        dispatched.push({ name, input, callId });
        return { ok: true, echoed: input };
      }),
    onTurn: (t) => {
      turns.push(t);
    },
    consumeTurn: () => {
      harness.consumed++;
    },
    ...(opts.onAssistantText ? { onAssistantText: opts.onAssistantText } : {}),
  };
  return harness;
}

const phaseEndTool: ToolSpec = {
  name: "end_phase_test",
  description: "Submit phase deliverable.",
  input: {
    type: "object",
    properties: { greeting: { type: "string" } },
    required: ["greeting"],
  },
};

const echoTool: ToolSpec = {
  name: "echo",
  description: "Echo back the message.",
  input: {
    type: "object",
    properties: { msg: { type: "string" } },
    required: ["msg"],
  },
};

beforeEach(() => {
  resetFakeAnthropic();
});
afterEach(() => {
  resetFakeAnthropic();
});

describe("anthropicApiAdapter — runUntilPhaseEnd", () => {
  it("returns the phase-end tool's input as the payload", async () => {
    setAnthropicResponses([
      { content: [{ type: "tool_use", id: "t1", name: "end_phase_test", input: { greeting: "hello" } }] },
    ]);

    const adapter = anthropicApiAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [phaseEndTool] });

    const result = await adapter.runUntilPhaseEnd(h.ctx);
    expect(result.payload).toEqual({ greeting: "hello" });
    expect(h.consumed).toBe(1);

    // The request carried the framework tools as Anthropic tool specs.
    const body = getStructuredCalls()[0]!.body as { tools: Array<{ name: string }>; model: string };
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.tools.map((t) => t.name)).toContain("end_phase_test");
  });

  it("dispatches a non-phase-end tool, then finishes; tool result feeds the next request", async () => {
    setAnthropicResponses([
      { content: [{ type: "tool_use", id: "t1", name: "echo", input: { msg: "hi" } }] },
      { content: [{ type: "tool_use", id: "t2", name: "end_phase_test", input: { greeting: "done" } }] },
    ]);

    const adapter = anthropicApiAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [echoTool, phaseEndTool] });

    const result = await adapter.runUntilPhaseEnd(h.ctx);
    expect(result.payload).toEqual({ greeting: "done" });
    expect(h.dispatched).toEqual([{ name: "echo", input: { msg: "hi" }, callId: "t1" }]);

    // Second request must carry a user message with the tool_result for t1.
    const secondBody = getStructuredCalls()[1]!.body as {
      messages: Array<{ role: string; content: unknown }>;
    };
    const toolResultMsg = secondBody.messages.find(
      (m) =>
        m.role === "user" &&
        Array.isArray(m.content) &&
        (m.content as Array<{ type: string }>).some((b) => b.type === "tool_result")
    );
    expect(toolResultMsg, "second request must include the tool_result").toBeDefined();
    const block = (toolResultMsg!.content as Array<{ type: string; tool_use_id: string; content: string }>)[0]!;
    expect(block.tool_use_id).toBe("t1");
    expect(JSON.parse(block.content)).toMatchObject({ ok: true, echoed: { msg: "hi" } });
  });

  it("surfaces assistant text with no tool calls, then nudges and finishes", async () => {
    setAnthropicResponses([
      { content: [{ type: "text", text: "Let me think about this." }] },
      { content: [{ type: "tool_use", id: "t1", name: "end_phase_test", input: { greeting: "ok" } }] },
    ]);

    const adapter = anthropicApiAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [phaseEndTool] });

    await adapter.runUntilPhaseEnd(h.ctx);

    const assistantText = h.turns.find(
      (t): t is Turn & { role: "assistant"; text: string } =>
        t.role === "assistant" && typeof t.text === "string" && t.text.length > 0
    );
    expect(assistantText?.text).toBe("Let me think about this.");
    // A nudge user turn was appended after the text-only turn.
    expect(h.turns.some((t) => t.role === "user" && /must call/.test(t.text))).toBe(true);
  });

  it("uses onAssistantText reply instead of nudging when the host provides it", async () => {
    setAnthropicResponses([
      { content: [{ type: "text", text: "Should I proceed?" }] },
      { content: [{ type: "tool_use", id: "t1", name: "end_phase_test", input: { greeting: "ok" } }] },
    ]);

    const seen: string[] = [];
    const adapter = anthropicApiAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({
      tools: [phaseEndTool],
      onAssistantText: async (text) => {
        seen.push(text);
        return "yes, finish";
      },
    });

    await adapter.runUntilPhaseEnd(h.ctx);
    expect(seen).toEqual(["Should I proceed?"]);
    expect(h.turns.some((t) => t.role === "user" && t.text === "yes, finish")).toBe(true);
  });

  it("encodes empty / undefined / null tool results as non-empty tool_result content", async () => {
    for (const dispatched of [undefined, null, ""]) {
      resetFakeAnthropic();
      setAnthropicResponses([
        { content: [{ type: "tool_use", id: "t1", name: "echo", input: {} }] },
        { content: [{ type: "tool_use", id: "t2", name: "end_phase_test", input: { greeting: "ok" } }] },
      ]);

      const adapter = anthropicApiAdapter({ model: "claude-sonnet-4-6" });
      const h = makeHarness({ tools: [echoTool, phaseEndTool], dispatchTool: async () => dispatched });
      await adapter.runUntilPhaseEnd(h.ctx);

      const secondBody = getStructuredCalls()[1]!.body as {
        messages: Array<{ role: string; content: unknown }>;
      };
      const toolResultMsg = secondBody.messages.find(
        (m) => Array.isArray(m.content) && (m.content as Array<{ type: string }>)[0]?.type === "tool_result"
      )!;
      const block = (toolResultMsg.content as Array<{ content: string }>)[0]!;
      expect(typeof block.content === "string" && block.content.length > 0).toBe(true);
    }
  });
});

describe("anthropicApiAdapter — runStructured", () => {
  it("returns the tool_use input from the forced submit call", async () => {
    setAnthropicResponses([
      {
        content: [
          { type: "text", text: "ignored" },
          { type: "tool_use", id: "t1", name: "submit", input: { greeting: "hi" } },
        ],
      },
    ]);

    const adapter = anthropicApiAdapter({ model: "claude-sonnet-4-6" });
    const out = await adapter.runStructured({
      systemPrompt: "sys",
      userText: "say hi",
      schema: {
        type: "object",
        properties: { greeting: { type: "string" } },
        required: ["greeting"],
      },
      signal: new AbortController().signal,
    });

    expect(out).toEqual({ greeting: "hi" });
    const body = getStructuredCalls()[0]!.body as { tool_choice: unknown };
    expect(body.tool_choice).toEqual({ type: "tool", name: "submit" });
  });
});
