/**
 * Tests for the claude-agent adapter. The real `@anthropic-ai/claude-agent-sdk`
 * is mocked via `vi.mock` so these tests run hermetically without the SDK
 * actually installed; the fake mirrors the SDK's tool/MCP-server/query shape.
 *
 * These tests exercise the wiring between the adapter and the SDK:
 *   1. Tool registration must happen via createSdkMcpServer + mcpServers, not
 *      via a plain top-level `tools: [{handler}]` array.
 *   2. Assistant text emitted by the SDK must be surfaced as Turn events to
 *      ctx.onTurn — otherwise host UIs receive no chat.
 *   3. Tool calls dispatched by the SDK must reach ctx.dispatchTool and the
 *      result must reach the SDK handler.
 *   4. The outer signal must propagate to the SDK's abortController.
 *   5. `runStructured` is a one-shot query forced through a single `submit` tool.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeSdkModule,
  setSdkScript,
  resetFakeSdk,
  getFakeQueryCalls,
  getFakeHandlerInvocations,
} from "../_fixtures/fake-claude-agent-sdk.js";

vi.mock("@anthropic-ai/claude-agent-sdk", () => fakeSdkModule);

import { claudeAgentAdapter } from "../../src/adapters/claude-agent.js";
import type { RunContext, Turn, ToolSpec } from "../../src/adapters/types.js";

interface HarnessOpts {
  tools?: ToolSpec[];
  phaseEndToolName?: string;
  newUserText?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  dispatchTool?: (name: string, input: unknown, callId: string) => Promise<unknown>;
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
    systemPrompt: opts.systemPrompt ?? "system",
    conversation: [],
    newUserText: opts.newUserText ?? "user prompt",
    tools: opts.tools ?? [],
    phaseEndToolName: opts.phaseEndToolName ?? "end_phase_test",
    signal: opts.signal ?? new AbortController().signal,
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
  resetFakeSdk();
});
afterEach(() => {
  resetFakeSdk();
});

describe("claudeAgentAdapter — runUntilPhaseEnd", () => {
  it("registers tools via mcpServers and reaches phase-end via the registered handler", async () => {
    setSdkScript([
      { kind: "tool-call", toolName: "end_phase_test", input: { greeting: "hello" } },
    ]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [phaseEndTool] });

    const result = await adapter.runUntilPhaseEnd(h.ctx);

    expect(result.payload).toEqual({ greeting: "hello" });

    const calls = getFakeQueryCalls();
    expect(calls).toHaveLength(1);
    const opts = calls[0]!.options ?? {};
    expect(opts.mcpServers, "tools must be registered via options.mcpServers").toBeDefined();
    expect(opts.model, "model must live under options").toBe("claude-sonnet-4-6");
    expect(opts.systemPrompt ?? opts.system, "systemPrompt must live under options").toBeDefined();
    expect(opts.abortController, "signal must propagate via options.abortController").toBeInstanceOf(
      AbortController
    );

    const handlerCalls = getFakeHandlerInvocations();
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0]!.toolName).toBe("end_phase_test");
    expect(handlerCalls[0]!.input).toEqual({ greeting: "hello" });
  });

  it("emits assistant text turns from SDK messages to ctx.onTurn", async () => {
    setSdkScript([
      { kind: "yield-text", text: "Thinking about your request..." },
      { kind: "tool-call", toolName: "end_phase_test", input: { greeting: "hi" } },
    ]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [phaseEndTool] });

    const result = await adapter.runUntilPhaseEnd(h.ctx);

    expect(result.payload).toEqual({ greeting: "hi" });

    const assistantTextTurns = h.turns.filter(
      (t): t is Turn & { role: "assistant"; text: string } =>
        t.role === "assistant" && typeof t.text === "string" && t.text.length > 0
    );
    expect(assistantTextTurns).toHaveLength(1);
    expect(assistantTextTurns[0]!.text).toBe("Thinking about your request...");
  });

  it("dispatches non-phase-end tool calls through ctx.dispatchTool and records turns", async () => {
    setSdkScript([
      { kind: "tool-call", toolName: "echo", input: { msg: "hi" } },
      { kind: "tool-call", toolName: "end_phase_test", input: { greeting: "done" } },
    ]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [echoTool, phaseEndTool] });

    const result = await adapter.runUntilPhaseEnd(h.ctx);

    expect(result.payload).toEqual({ greeting: "done" });

    expect(h.dispatched).toHaveLength(1);
    expect(h.dispatched[0]!.name).toBe("echo");
    expect(h.dispatched[0]!.input).toEqual({ msg: "hi" });

    const handlerCalls = getFakeHandlerInvocations();
    const echoCall = handlerCalls.find((c) => c.toolName === "echo");
    expect(echoCall, "echo handler must have been invoked by SDK").toBeDefined();
    const wrapped = echoCall!.result as { content: Array<{ type: string; text: string }> };
    expect(wrapped.content[0]!.type).toBe("text");
    expect(JSON.parse(wrapped.content[0]!.text)).toMatchObject({ ok: true, echoed: { msg: "hi" } });

    const toolTurns = h.turns.filter((t) => t.role === "tool");
    expect(toolTurns.length).toBeGreaterThanOrEqual(1);
    const echoToolTurn = toolTurns.find(
      (t) => t.role === "tool" && JSON.stringify(t.result).includes("echoed")
    );
    expect(echoToolTurn, "echo dispatch result must appear as a tool Turn").toBeDefined();
  });

  it("propagates the outer signal to the SDK abortController", async () => {
    setSdkScript([{ kind: "yield-text", text: "won't matter, we abort first" }]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
    const ac = new AbortController();
    const h = makeHarness({ tools: [phaseEndTool], signal: ac.signal });
    ac.abort();

    await expect(adapter.runUntilPhaseEnd(h.ctx)).rejects.toThrow();

    const calls = getFakeQueryCalls();
    expect(calls).toHaveLength(1);
    const passedAc = calls[0]!.options!.abortController as AbortController | undefined;
    expect(passedAc?.signal.aborted, "outer abort must reach the SDK abortController").toBe(true);
  });

  it("never produces an empty-text tool_result content block", async () => {
    const cases: Array<{ name: string; dispatched: unknown }> = [
      { name: "undefined", dispatched: undefined },
      { name: "empty-string", dispatched: "" },
      { name: "null", dispatched: null },
    ];

    for (const c of cases) {
      resetFakeSdk();
      setSdkScript([
        { kind: "tool-call", toolName: "echo", input: {} },
        { kind: "tool-call", toolName: "end_phase_test", input: { greeting: "ok" } },
      ]);

      const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
      const h = makeHarness({
        tools: [echoTool, phaseEndTool],
        dispatchTool: async () => c.dispatched,
      });

      await adapter.runUntilPhaseEnd(h.ctx);

      const handlerCalls = getFakeHandlerInvocations();
      const echoInvocation = handlerCalls.find((x) => x.toolName === "echo");
      expect(echoInvocation, `case ${c.name}: echo handler should have run`).toBeDefined();
      const wrapped = echoInvocation!.result as { content: Array<{ type: string; text: string }> };
      const textBlock = wrapped.content.find((b) => b.type === "text");
      expect(textBlock, `case ${c.name}: a text block must be present`).toBeDefined();
      expect(
        typeof textBlock!.text === "string" && textBlock!.text.length > 0,
        `case ${c.name}: tool_result text block must be non-empty`
      ).toBe(true);
    }
  });

  it("throws a clear error if SDK ends without phase-end being called", async () => {
    setSdkScript([{ kind: "yield-text", text: "I forgot to finalize." }]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
    const h = makeHarness({ tools: [phaseEndTool] });

    await expect(adapter.runUntilPhaseEnd(h.ctx)).rejects.toThrow(/phase-end/);
  });
});

describe("claudeAgentAdapter — runStructured", () => {
  it("returns the input the model passes to the forced `submit` tool", async () => {
    setSdkScript([
      { kind: "tool-call", toolName: "submit", input: { greeting: "hi" } },
    ]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
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

    // The structured call goes through query() with a single registered tool.
    const calls = getFakeQueryCalls();
    expect(calls).toHaveLength(1);
    const opts = calls[0]!.options ?? {};
    expect(opts.allowedTools).toEqual(["mcp__agent-fw__submit"]);
  });

  it("throws if the model never calls `submit`", async () => {
    setSdkScript([{ kind: "yield-text", text: "I won't submit." }]);

    const adapter = claudeAgentAdapter({ model: "claude-sonnet-4-6" });
    await expect(
      adapter.runStructured({
        systemPrompt: "sys",
        userText: "go",
        schema: { type: "object", properties: {} },
        signal: new AbortController().signal,
      })
    ).rejects.toThrow(/submit/);
  });
});
