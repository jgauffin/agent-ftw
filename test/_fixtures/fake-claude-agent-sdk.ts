/**
 * Test fake for `@anthropic-ai/claude-agent-sdk`. Tests mock that module via
 * `vi.mock(...)` and then drive the adapter by setting a script here. The fake
 * mirrors enough of the real SDK shape to exercise the adapter's wiring:
 *   - `tool(name, description, schema, handler)` returns a tool definition
 *   - `createSdkMcpServer({ name, version, tools })` returns an MCP-server config
 *   - `query({ prompt, options })` returns an async iterable of SDK messages,
 *     and along the way invokes registered tool handlers as scripted.
 *
 * The script is a sequence of "steps" the fake SDK should perform on a single
 * `query()` call. Steps either yield a message verbatim (so tests can assert
 * how the adapter consumes them) or instruct the fake to call a registered
 * tool's handler and yield the corresponding assistant/user messages around it.
 */
import { z, type ZodRawShape } from "zod";

export interface FakeSdkTool {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (input: unknown, extra: unknown) => Promise<unknown>;
}

export interface FakeMcpServerConfig {
  type: "sdk";
  name: string;
  instance: { tools: FakeSdkTool[] };
}

/**
 * One step of a scripted query() run.
 *   - "yield-text"      : SDK emits an assistant message containing a text block.
 *   - "tool-call"       : SDK emits an assistant message with a tool_use block,
 *                         invokes the registered handler, then emits the user
 *                         message that carries the tool_result back.
 *   - "yield-raw"       : Pass-through escape hatch for tests asserting on
 *                         odd or partial message shapes.
 */
export type FakeSdkStep =
  | { kind: "yield-text"; text: string; sessionId?: string }
  | { kind: "tool-call"; toolName: string; input: unknown; toolUseId?: string; sessionId?: string }
  | { kind: "yield-raw"; msg: unknown };

export interface FakeQueryCall {
  prompt: unknown;
  options: Record<string, unknown> | undefined;
}

interface FakeState {
  script: FakeSdkStep[];
  calls: FakeQueryCall[];
  /** Captured handler invocations across all tool-call steps. */
  handlerInvocations: Array<{ toolName: string; input: unknown; result: unknown }>;
  /** When set, query() throws this on the next call. */
  throwOnQuery?: Error;
}

const state: FakeState = { script: [], calls: [], handlerInvocations: [] };

export function setSdkScript(script: FakeSdkStep[]): void {
  state.script = [...script];
}

export function resetFakeSdk(): void {
  state.script = [];
  state.calls = [];
  state.handlerInvocations = [];
  state.throwOnQuery = undefined;
}

export function getFakeQueryCalls(): FakeQueryCall[] {
  return state.calls;
}

export function getFakeHandlerInvocations(): Array<{ toolName: string; input: unknown; result: unknown }> {
  return state.handlerInvocations;
}

export const fakeSdkModule = {
  tool(
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    handler: (input: unknown, extra: unknown) => Promise<unknown>
  ): FakeSdkTool {
    // Validate the schema shape is composed of zod schemas — mirrors the real
    // SDK's behavior (it would fail at construction time if you handed it
    // anything other than a ZodRawShape).
    for (const [key, value] of Object.entries(inputSchema)) {
      const isZod =
        value !== null &&
        typeof value === "object" &&
        ("_zod" in value || "_def" in value || typeof (value as { parse?: unknown }).parse === "function");
      if (!isZod) {
        throw new Error(
          `fake-claude-agent-sdk.tool(${name}): inputSchema.${key} is not a zod schema; ` +
            `the real SDK requires a ZodRawShape here.`
        );
      }
    }
    return { name, description, inputSchema, handler };
  },

  createSdkMcpServer(opts: { name: string; version?: string; tools?: FakeSdkTool[] }): FakeMcpServerConfig {
    const tools = opts.tools ?? [];
    return { type: "sdk", name: opts.name, instance: { tools } };
  },

  query(params: { prompt: unknown; options?: Record<string, unknown> }): AsyncIterable<unknown> {
    state.calls.push({ prompt: params.prompt, options: params.options });
    if (state.throwOnQuery) {
      const err = state.throwOnQuery;
      state.throwOnQuery = undefined;
      return (async function* () {
        throw err;
      })();
    }

    const opts = params.options ?? {};
    const abortCtrl = opts.abortController as AbortController | undefined;
    const mcpServers = (opts.mcpServers ?? {}) as Record<string, FakeMcpServerConfig>;
    const allTools: FakeSdkTool[] = [];
    for (const [, server] of Object.entries(mcpServers)) {
      if (server && server.instance && Array.isArray(server.instance.tools)) {
        for (const t of server.instance.tools) allTools.push(t);
      }
    }

    const stepsForCall = [...state.script];
    state.script = [];

    return runScript(stepsForCall, allTools, abortCtrl);
  },
};

async function* runScript(
  steps: FakeSdkStep[],
  tools: FakeSdkTool[],
  abortCtrl: AbortController | undefined
): AsyncIterable<unknown> {
  // Initial system message announces the session id, mirroring the real SDK.
  const sessionId = "session-fake-1";
  yield { type: "system", subtype: "init", session_id: sessionId };

  for (const step of steps) {
    if (abortCtrl?.signal.aborted) return;

    if (step.kind === "yield-raw") {
      yield step.msg;
      continue;
    }

    if (step.kind === "yield-text") {
      yield {
        type: "assistant",
        session_id: step.sessionId ?? sessionId,
        message: {
          id: "msg_" + Math.random().toString(36).slice(2, 9),
          role: "assistant",
          content: [{ type: "text", text: step.text }],
        },
      };
      continue;
    }

    // tool-call: assistant message with tool_use, invoke handler, user
    // message with tool_result.
    const toolUseId = step.toolUseId ?? "toolu_" + Math.random().toString(36).slice(2, 9);
    yield {
      type: "assistant",
      session_id: step.sessionId ?? sessionId,
      message: {
        id: "msg_" + Math.random().toString(36).slice(2, 9),
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: toolUseId,
            name: step.toolName,
            input: step.input,
          },
        ],
      },
    };

    const tool = tools.find((t) => t.name === step.toolName);
    if (!tool) {
      throw new Error(
        `fake-claude-agent-sdk: query() invoked tool "${step.toolName}" but no MCP-registered tool with that name was found. ` +
          `Adapter may have failed to register tools via mcpServers.`
      );
    }
    const handlerResult = await tool.handler(step.input, {});
    state.handlerInvocations.push({ toolName: step.toolName, input: step.input, result: handlerResult });

    yield {
      type: "user",
      session_id: step.sessionId ?? sessionId,
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: toolUseId,
            content: typeof handlerResult === "string" ? handlerResult : JSON.stringify(handlerResult),
          },
        ],
      },
    };
  }

  // Result message terminates the stream, like the real SDK.
  yield {
    type: "result",
    subtype: "success",
    session_id: sessionId,
    is_error: false,
  };
}

// Re-export zod so tests have a convenient handle without separate imports.
export { z };
