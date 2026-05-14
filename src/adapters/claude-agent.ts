import type { Adapter, RunContext, PhaseEndResult, Turn, ToolCall, ToolSpec } from "./types.js";
import type { JSONSchema } from "../schema/index.js";
import { seedConversation } from "./run-helpers.js";

/**
 * Configuration for {@link claudeAgentAdapter}.
 *
 * This adapter targets Claude via the **Claude Agent SDK**
 * (`@anthropic-ai/claude-agent-sdk`) — the subscription-authenticated path that
 * drives a spawned Claude Code CLI. It is the only optional peer dep this
 * adapter needs; install it (plus `zod`) only when you use this adapter:
 *
 * ```bash
 * npm install @anthropic-ai/claude-agent-sdk zod
 * ```
 *
 * If you have an Anthropic **API key** rather than a subscription, use
 * `anthropicApiAdapter` instead — it talks to the raw Messages API.
 */
export interface ClaudeAgentConfig {
  /** Model id, e.g. `"claude-sonnet-4-6"`. */
  readonly model: string;
  /** Optional API key. Falls back to `ANTHROPIC_API_KEY` in the environment. */
  readonly apiKey?: string;
  readonly temperature?: number;
}

interface ZodLike {
  parse(input: unknown): unknown;
}
type ZodRawShape = Record<string, ZodLike>;

interface SdkToolDef {
  name: string;
  description: string;
  inputSchema: ZodRawShape;
  handler: (input: unknown, extra: unknown) => Promise<SdkCallToolResult>;
}

interface SdkCallToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface SdkMcpServerConfig {
  type: "sdk";
  name: string;
  instance: unknown;
}

const MCP_SERVER_NAME = "agent-fw";
const STRUCTURED_TOOL_NAME = "submit";

/**
 * Claude Agent SDK adapter — drives the model loop via the SDK's `query()` for
 * both `runUntilPhaseEnd` and `runStructured` (the latter as a one-shot query
 * forced through a single `submit` tool).
 *
 * The SDK (and `zod`) are optional peer deps, imported lazily so users on other
 * adapters don't need them installed.
 *
 * Tool registration: the SDK does not accept a top-level `tools: [{handler}]`
 * array. Custom tools must be wrapped via `tool(...)` and bundled into an
 * in-process MCP server via `createSdkMcpServer(...)`, then handed to
 * `query()` through `options.mcpServers`. `options.allowedTools` carries the
 * fully-qualified `mcp__<server>__<tool>` names and `options.tools: []`
 * disables the SDK's built-in Claude Code tool set so the model only sees
 * the framework's tools.
 *
 * Persistence: when `RunContext.persistence` is set, the adapter records the
 * SDK-emitted session id (one per phase) into adapter meta so a future run can
 * pass `resume: <id>` to the SDK and continue the same transcript. The SDK
 * stores the transcript in its own location — this adapter only tracks the
 * pointer to it.
 */
export function claudeAgentAdapter(cfg: ClaudeAgentConfig): Adapter {
  return {
    async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
      const sdk = await loadAgentSdk();
      const conversation = seedConversation(ctx);
      // The SDK requires a non-empty `prompt`. On resume the framework hands
      // us an empty newUserText (the seed is already in the SDK session) — but
      // passing "" makes the SDK record `{type:"text",text:""}` into the
      // session JSONL, which Anthropic later rejects ("cache_control cannot be
      // set for empty text blocks"). Fall back to a continuation marker so the
      // session stays valid.
      const rawUserText = ctx.newUserText ?? lastUserText(conversation) ?? "";
      const initialUserText = rawUserText.length > 0 ? rawUserText : "Continue.";

      const loop = new SdkPhaseLoop(ctx, conversation);

      const resumeKey = ctx.persistence
        ? `claudeAgent.session.${ctx.persistence.phaseName}`
        : undefined;
      const resumeId =
        resumeKey && ctx.persistence
          ? (ctx.persistence.getAdapterMeta(resumeKey) as string | undefined)
          : undefined;

      const wrappedTools = ctx.tools.map((spec) => loop.toSdkTool(sdk.tool, spec));
      const mcpServer = sdk.createSdkMcpServer({
        name: MCP_SERVER_NAME,
        version: "0.1.0",
        tools: wrappedTools,
      });
      const allowedTools = ctx.tools.map((t) => `mcp__${MCP_SERVER_NAME}__${t.name}`);

      try {
        await sdk.runQuery({
          model: cfg.model,
          systemPrompt: ctx.systemPrompt,
          prompt: initialUserText,
          mcpServers: { [MCP_SERVER_NAME]: mcpServer },
          allowedTools,
          apiKey: cfg.apiKey,
          abortController: loop.abortController,
          ...(resumeId ? { resume: resumeId } : {}),
          onMessage: (msg) => loop.handleMessage(msg),
          onSessionId: async (id: string) => {
            if (ctx.persistence && resumeKey && !resumeId) {
              await ctx.persistence.setAdapterMeta(resumeKey, id);
            }
          },
        });
      } catch (e) {
        if (!loop.finished) throw e;
      }

      return loop.finalize();
    },

    async runStructured({ systemPrompt, userText, schema, signal }) {
      const sdk = await loadAgentSdk();
      const abortController = new AbortController();
      if (signal.aborted) abortController.abort();
      else signal.addEventListener("abort", () => abortController.abort(), { once: true });

      let captured: unknown;
      let capturedFlag = false;
      const submitTool = sdk.tool(
        STRUCTURED_TOOL_NAME,
        "Submit the structured result. Call this exactly once.",
        jsonSchemaToZodShape(schema),
        async (input) => {
          captured = input;
          capturedFlag = true;
          abortController.abort();
          return { content: [{ type: "text", text: "ok" }] };
        }
      );
      const mcpServer = sdk.createSdkMcpServer({
        name: MCP_SERVER_NAME,
        version: "0.1.0",
        tools: [submitTool],
      });

      try {
        await sdk.runQuery({
          model: cfg.model,
          systemPrompt,
          prompt: `${userText}\n\nReply only by calling the \`${STRUCTURED_TOOL_NAME}\` tool with the structured result.`,
          mcpServers: { [MCP_SERVER_NAME]: mcpServer },
          allowedTools: [`mcp__${MCP_SERVER_NAME}__${STRUCTURED_TOOL_NAME}`],
          apiKey: cfg.apiKey,
          abortController,
        });
      } catch (e) {
        if (!capturedFlag) throw e;
      }
      if (!capturedFlag) {
        throw new Error("claude-agent: structured call ended without calling the submit tool");
      }
      return captured;
    },
  };
}

/**
 * Bookkeeping for a single SDK-driven phase: maps framework tools to SDK tool
 * handlers, captures the phase-end payload, and translates SDK tool calls back
 * into the framework's conversation/turn-emit model.
 */
class SdkPhaseLoop {
  private payload: unknown = undefined;
  private payloadSet = false;
  /** Tool-use ids whose tool_result we've already emitted via the handler. */
  private readonly emittedToolUseIds = new Set<string>();
  readonly abortController = new AbortController();
  private outerAbortHandler: (() => void) | undefined;

  constructor(
    private readonly ctx: RunContext,
    private readonly conversation: Turn[]
  ) {
    if (ctx.signal.aborted) {
      this.abortController.abort();
    } else {
      this.outerAbortHandler = () => this.abortController.abort();
      ctx.signal.addEventListener("abort", this.outerAbortHandler, { once: true });
    }
  }

  get finished(): boolean {
    return this.payloadSet;
  }

  finalize(): PhaseEndResult {
    if (this.outerAbortHandler) {
      this.ctx.signal.removeEventListener("abort", this.outerAbortHandler);
    }
    if (!this.payloadSet) {
      throw new Error("claude-agent: SDK loop ended without phase-end tool");
    }
    return { payload: this.payload, conversation: this.conversation };
  }

  toSdkTool(
    toolFn: (
      name: string,
      description: string,
      shape: ZodRawShape,
      handler: (input: unknown, extra: unknown) => Promise<SdkCallToolResult>
    ) => SdkToolDef,
    spec: ToolSpec
  ): SdkToolDef {
    const shape = jsonSchemaToZodShape(spec.input);
    return toolFn(spec.name, spec.description, shape, async (input) => {
      const result = await this.handleCall(spec.name, input);
      return resultToSdkPayload(result);
    });
  }

  /**
   * Receive an SDK message and translate any assistant text / tool_use blocks
   * into framework Turn events. Tool result Turns are emitted from the tool
   * handler itself (where dispatchTool runs) — we suppress them here to avoid
   * double-emitting.
   */
  handleMessage(msg: unknown): void {
    if (!msg || typeof msg !== "object") return;
    const m = msg as { type?: unknown; message?: unknown; error?: unknown };
    if (m.type !== "assistant") return;
    // SDK emits `type: "assistant"` with an `error` field for API failures
    // (e.g. invalid_request). The text content is the API error string, not a
    // model utterance — never persist it as a model turn.
    if (m.error) return;

    const content = extractContentBlocks(m.message);
    if (content.length === 0) return;

    const textBlocks = content.filter((b) => b.type === "text" && typeof b.text === "string");
    const toolUseBlocks = content.filter(
      (b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string"
    );

    if (textBlocks.length === 0 && toolUseBlocks.length === 0) return;

    const text = textBlocks.map((b) => b.text as string).join("\n");
    const toolCalls: ToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id as string,
      name: stripMcpPrefix(b.name as string),
      input: b.input,
    }));

    const turn: Turn =
      toolCalls.length > 0
        ? text
          ? { role: "assistant", text, toolCalls }
          : { role: "assistant", toolCalls }
        : { role: "assistant", text };

    this.conversation.push(turn);
    this.ctx.onTurn(turn);
    this.ctx.consumeTurn();
  }

  private async handleCall(toolName: string, input: unknown): Promise<unknown> {
    if (toolName === this.ctx.phaseEndToolName) {
      this.payload = input;
      this.payloadSet = true;
      this.abortController.abort();
      return { ok: true };
    }
    return this.dispatchAndRecord(toolName, input);
  }

  private async dispatchAndRecord(name: string, input: unknown): Promise<unknown> {
    const callId = findToolCallId(this.conversation, name) ?? `call_${Math.random().toString(36).slice(2, 10)}`;
    if (this.emittedToolUseIds.has(callId)) return { ok: false, error: "duplicate dispatch" };
    this.emittedToolUseIds.add(callId);
    try {
      const out = await this.ctx.dispatchTool(name, input, callId);
      this.recordToolResult(callId, out, false);
      return out;
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      this.recordToolResult(callId, err, true);
      throw e;
    }
  }

  private recordToolResult(callId: string, result: unknown, isError: boolean): void {
    const turn: Turn = isError
      ? { role: "tool", toolCallId: callId, result, isError: true }
      : { role: "tool", toolCallId: callId, result };
    this.conversation.push(turn);
    this.ctx.onTurn(turn);
  }
}

function resultToSdkPayload(result: unknown): SdkCallToolResult {
  // The Anthropic API attaches cache_control to tool_result content blocks
  // and rejects requests where any cached text block is empty. Coerce empty,
  // undefined, or non-serializable results into a non-empty placeholder so
  // we never emit `text: ""` here.
  let text: string;
  if (typeof result === "string") {
    text = result;
  } else if (result === undefined) {
    text = "(no output)";
  } else {
    try {
      const serialized = JSON.stringify(result);
      text = typeof serialized === "string" ? serialized : "(unserializable result)";
    } catch {
      text = "(unserializable result)";
    }
  }
  if (text.length === 0) text = "(empty)";
  return { content: [{ type: "text", text }] };
}

interface ContentBlock {
  type: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
}

function extractContentBlocks(message: unknown): ContentBlock[] {
  if (!message || typeof message !== "object") return [];
  const c = (message as { content?: unknown }).content;
  if (!Array.isArray(c)) return [];
  return c.filter((b): b is ContentBlock => Boolean(b) && typeof b === "object" && typeof (b as { type?: unknown }).type === "string");
}

/** Find the most recent tool-call id matching `name` on an assistant turn we already emitted. */
function findToolCallId(conversation: readonly Turn[], name: string): string | undefined {
  for (let i = conversation.length - 1; i >= 0; i--) {
    const t = conversation[i];
    if (t && t.role === "assistant" && t.toolCalls) {
      const match = t.toolCalls.find((c) => stripMcpPrefix(c.name) === name);
      if (match) return match.id;
    }
  }
  return undefined;
}

function stripMcpPrefix(name: string): string {
  // The model addresses tools as `mcp__<server>__<tool>` when they're
  // registered via createSdkMcpServer. The framework records the bare name.
  const prefix = `mcp__${MCP_SERVER_NAME}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/* ------------------------------------------------------------------------- *
 * JSON Schema → Zod raw shape
 *
 * The SDK's `tool()` requires a ZodRawShape (a Record<string, ZodSchema>) —
 * not a JSON Schema and not a `z.object({...})` wrapper. We support the
 * subset of JSON Schema that the framework actually authors:
 *   { type: "object", properties: {...}, required: [...] }
 *
 * Property values may use any of: string|number|integer|boolean|array|object,
 * with `enum` on strings. Anything we don't recognize falls back to z.unknown(),
 * which is intentionally permissive — the framework still validates the
 * model's actual input against the JSON Schema before dispatching, so the
 * Zod side just has to be loose enough to pass the SDK's own validation.
 * ------------------------------------------------------------------------- */

function jsonSchemaToZodShape(schema: JSONSchema): ZodRawShape {
  const z = getZod();
  if (!schema || typeof schema !== "object") return {};
  const s = schema as { type?: unknown; properties?: unknown; required?: unknown };
  if (s.type !== "object" || !s.properties || typeof s.properties !== "object") {
    // Wrap a non-object schema as `{ value: <schema> }` so the SDK still
    // accepts a raw shape. Real-world tools always declare object inputs.
    return { value: jsonSchemaToZodSchema(schema, z) as ZodLike };
  }
  const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
  const shape: ZodRawShape = {};
  for (const [key, propSchema] of Object.entries(s.properties as Record<string, unknown>)) {
    let zodType = jsonSchemaToZodSchema(propSchema, z);
    if (!required.has(key)) {
      zodType = (zodType as unknown as { optional: () => ZodLike }).optional();
    }
    shape[key] = zodType;
  }
  return shape;
}

interface ZodNamespace {
  string(): ZodLike;
  number(): ZodLike;
  boolean(): ZodLike;
  unknown(): ZodLike;
  any(): ZodLike;
  array(inner: ZodLike): ZodLike;
  object(shape: ZodRawShape): ZodLike;
  enum(values: readonly [string, ...string[]]): ZodLike;
}

let cachedZod: ZodNamespace | undefined;

function getZod(): ZodNamespace {
  if (!cachedZod) {
    throw new Error(
      "claude-agent adapter requires `zod` (peer dep) to be installed for tool schema conversion"
    );
  }
  return cachedZod;
}

function jsonSchemaToZodSchema(schema: unknown, z: ZodNamespace): ZodLike {
  if (!schema || typeof schema !== "object") return z.unknown();
  const s = schema as {
    type?: unknown;
    enum?: unknown;
    items?: unknown;
    properties?: unknown;
    required?: unknown;
  };
  if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === "string")) {
    const values = s.enum as string[];
    if (values.length > 0) {
      return z.enum(values as [string, ...string[]]);
    }
  }
  switch (s.type) {
    case "string":
      return z.string();
    case "number":
    case "integer":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array": {
      const inner = s.items ? jsonSchemaToZodSchema(s.items, z) : z.unknown();
      return z.array(inner);
    }
    case "object": {
      const shape: ZodRawShape = {};
      const required = new Set(Array.isArray(s.required) ? (s.required as string[]) : []);
      const props = (s.properties && typeof s.properties === "object" ? s.properties : {}) as Record<
        string,
        unknown
      >;
      for (const [key, propSchema] of Object.entries(props)) {
        let zt = jsonSchemaToZodSchema(propSchema, z);
        if (!required.has(key)) {
          zt = (zt as unknown as { optional: () => ZodLike }).optional();
        }
        shape[key] = zt;
      }
      return z.object(shape);
    }
    default:
      return z.unknown();
  }
}

/* ------------------------------------------------------------------------- *
 * Lazy SDK loader. The shape is abstracted via a thin facade so the adapter
 * stays decoupled from any specific SDK version.
 * ------------------------------------------------------------------------- */

interface AgentSdkFacade {
  tool: (
    name: string,
    description: string,
    shape: ZodRawShape,
    handler: (input: unknown, extra: unknown) => Promise<SdkCallToolResult>
  ) => SdkToolDef;
  createSdkMcpServer: (opts: { name: string; version?: string; tools: SdkToolDef[] }) => SdkMcpServerConfig;
  runQuery(args: {
    model: string;
    systemPrompt: string;
    prompt: string;
    mcpServers: Record<string, SdkMcpServerConfig>;
    allowedTools: string[];
    apiKey?: string;
    abortController: AbortController;
    /** SDK session id to resume; reuses prior transcript on the SDK's side. */
    resume?: string;
    /** Invoked for every SDK message the iterator yields. */
    onMessage?: (msg: unknown) => void | Promise<void>;
    /** Invoked once with the SDK-issued session id when seen on the message stream. */
    onSessionId?: (id: string) => void | Promise<void>;
  }): Promise<void>;
}

async function loadAgentSdk(): Promise<AgentSdkFacade> {
  // @ts-expect-error — optional peer dep, may not be installed
  const mod = await import("@anthropic-ai/claude-agent-sdk").catch(() => {
    throw new Error("claude-agent adapter requires @anthropic-ai/claude-agent-sdk to be installed");
  });
  const zodMod = await import("zod").catch(() => {
    throw new Error("claude-agent adapter requires `zod` peer dep to be installed");
  });
  cachedZod = (zodMod as { z?: ZodNamespace }).z ?? (zodMod as ZodNamespace);

  const m = mod as {
    query?: unknown;
    tool?: unknown;
    createSdkMcpServer?: unknown;
  };
  if (typeof m.query !== "function") {
    throw new Error("claude-agent: expected `query` export from @anthropic-ai/claude-agent-sdk");
  }
  if (typeof m.tool !== "function") {
    throw new Error("claude-agent: expected `tool` export from @anthropic-ai/claude-agent-sdk");
  }
  if (typeof m.createSdkMcpServer !== "function") {
    throw new Error(
      "claude-agent: expected `createSdkMcpServer` export from @anthropic-ai/claude-agent-sdk"
    );
  }
  const queryFn = m.query as (opts: unknown) => AsyncIterable<unknown>;
  const toolFn = m.tool as (
    name: string,
    description: string,
    shape: ZodRawShape,
    handler: (input: unknown, extra: unknown) => Promise<SdkCallToolResult>
  ) => SdkToolDef;
  const createServerFn = m.createSdkMcpServer as (opts: {
    name: string;
    version?: string;
    tools: SdkToolDef[];
  }) => SdkMcpServerConfig;

  return {
    tool: toolFn,
    createSdkMcpServer: createServerFn,
    async runQuery(args) {
      const options: Record<string, unknown> = {
        model: args.model,
        systemPrompt: args.systemPrompt,
        mcpServers: args.mcpServers,
        allowedTools: args.allowedTools,
        // Disable Claude Code's built-in tools so the model can't call Read/Bash/etc.
        // (They'd otherwise be available by default.)
        tools: [],
        abortController: args.abortController,
      };
      if (args.apiKey) {
        // The SDK has no `apiKey` field; pass through env so the spawned CLI uses it.
        options.env = { ...process.env, ANTHROPIC_API_KEY: args.apiKey };
      }
      if (args.resume) options.resume = args.resume;

      const iter = queryFn({ prompt: args.prompt, options });
      let captured = false;
      for await (const msg of iter) {
        if (!captured && args.onSessionId) {
          const id = readSessionId(msg);
          if (id) {
            captured = true;
            await args.onSessionId(id);
          }
        }
        if (args.onMessage) {
          await args.onMessage(msg);
        }
        if (args.abortController.signal.aborted) break;
      }
    },
  };
}

function readSessionId(msg: unknown): string | undefined {
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as { session_id?: unknown; sessionId?: unknown };
  if (typeof m.session_id === "string") return m.session_id;
  if (typeof m.sessionId === "string") return m.sessionId;
  return undefined;
}

function lastUserText(conv: readonly Turn[]): string | undefined {
  for (let i = conv.length - 1; i >= 0; i--) {
    const t = conv[i];
    if (t && t.role === "user") return t.text;
  }
  return undefined;
}
