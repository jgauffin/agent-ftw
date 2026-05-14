import type { Adapter, RunContext, PhaseEndResult, Turn, ToolCall } from "./types.js";
import {
  seedConversation,
  appendAssistantTurn,
  handleNoToolCalls,
  dispatchAndAppend,
} from "./run-helpers.js";

interface OAToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

interface OAMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: OAToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OAAssistantMessage {
  role: "assistant";
  content?: string | null;
  tool_calls?: OAToolCall[];
}

interface OAResponse {
  choices: Array<{
    message: OAAssistantMessage;
    finish_reason?: string;
  }>;
}

/**
 * Configuration for {@link openaiCompatAdapter}. Works with any endpoint that
 * implements the OpenAI `/chat/completions` shape: OpenAI itself, Ollama
 * (`http://localhost:11434/v1`), LM Studio, vLLM, Together, etc.
 */
export interface OpenAICompatConfig {
  /** Base URL ending in `/v1`. E.g. `http://localhost:11434/v1`. */
  readonly baseUrl: string;
  /** Model id sent in the `model` field of the request. */
  readonly model: string;
  /** Optional bearer token. Skip for local endpoints that don't need auth. */
  readonly apiKey?: string;
  readonly temperature?: number;
  /** Inject a custom `fetch` implementation. Tests use this; production code rarely needs to. */
  readonly fetch?: typeof fetch;
}

/**
 * Build an {@link Adapter} that talks to an OpenAI-style chat endpoint.
 *
 * @example
 * ```ts
 * const adapter = openaiCompatAdapter({
 *   baseUrl: "https://api.openai.com/v1",
 *   model: "gpt-4o-mini",
 *   apiKey: process.env.OPENAI_API_KEY,
 * });
 * ```
 */
export function openaiCompatAdapter(cfg: OpenAICompatConfig): Adapter {
  const f = cfg.fetch ?? fetch;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) headers["Authorization"] = `Bearer ${cfg.apiKey}`;

  async function chat(body: object, signal: AbortSignal): Promise<OAResponse> {
    const res = await f(`${cfg.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`openai-compat ${res.status}: ${text}`);
    }
    return (await res.json()) as OAResponse;
  }

  async function nextAssistantMessage(ctx: RunContext, conversation: readonly Turn[]): Promise<OAAssistantMessage> {
    const body = buildChatBody(cfg, ctx, conversation);
    const resp = await chat(body, ctx.signal);
    const choice = resp.choices[0];
    if (!choice) throw new Error("openai-compat: no choices in response");
    return choice.message;
  }

  return {
    async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
      const conversation = seedConversation(ctx);

      while (true) {
        ctx.signal.throwIfAborted();
        ctx.consumeTurn();

        const msg = await nextAssistantMessage(ctx, conversation);
        const toolCalls = decodeToolCalls(msg);
        appendAssistantTurn(conversation, ctx, msg.content ?? null, toolCalls);

        if (toolCalls.length === 0) {
          await handleNoToolCalls(conversation, ctx, msg.content ?? "");
          continue;
        }

        const phaseEnd = toolCalls.find((c) => c.name === ctx.phaseEndToolName);
        if (phaseEnd) {
          return { payload: phaseEnd.input, conversation };
        }

        await dispatchAndAppend(toolCalls, conversation, ctx);
      }
    },

    async runStructured({ systemPrompt, userText, schema, signal }) {
      // Force structured output via a single function tool.
      const messages: OAMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ];
      const body: Record<string, unknown> = {
        model: cfg.model,
        messages,
        tools: [
          {
            type: "function",
            function: { name: "submit", description: "Submit the result.", parameters: schema },
          },
        ],
        tool_choice: { type: "function", function: { name: "submit" } },
      };
      if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
      const resp = await chat(body, signal);
      const call = resp.choices[0]?.message.tool_calls?.[0];
      if (!call) throw new Error("openai-compat: structured call returned no tool call");
      return parseJsonSafe(call.function.arguments);
    },
  };
}

function buildChatBody(cfg: OpenAICompatConfig, ctx: RunContext, conversation: readonly Turn[]): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages: toOAMessages(ctx.systemPrompt, conversation),
    tools: ctx.tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input },
    })),
    tool_choice: "auto",
  };
  if (cfg.temperature !== undefined) body.temperature = cfg.temperature;
  return body;
}

function decodeToolCalls(msg: OAAssistantMessage): ToolCall[] {
  return (msg.tool_calls ?? []).map((c) => ({
    id: c.id,
    name: c.function.name,
    input: parseJsonSafe(c.function.arguments),
  }));
}

function toOAMessages(systemPrompt: string, conv: readonly Turn[]): OAMessage[] {
  const out: OAMessage[] = [{ role: "system", content: systemPrompt }];
  for (const t of conv) {
    out.push(turnToOAMessage(t));
  }
  return out;
}

function turnToOAMessage(t: Turn): OAMessage {
  if (t.role === "user") {
    return { role: "user", content: t.text };
  }
  if (t.role === "tool") {
    return {
      role: "tool",
      tool_call_id: t.toolCallId,
      content: typeof t.result === "string" ? t.result : JSON.stringify(t.result),
    };
  }
  // assistant
  const m: OAMessage = { role: "assistant", content: t.text ?? "" };
  if (t.toolCalls && t.toolCalls.length > 0) {
    m.tool_calls = t.toolCalls.map((c) => ({
      id: c.id,
      type: "function",
      function: { name: c.name, arguments: JSON.stringify(c.input) },
    }));
  }
  return m;
}

function parseJsonSafe(s: string): unknown {
  if (!s) return {};
  try {
    return JSON.parse(s);
  } catch {
    // Some local models occasionally return malformed JSON; surface the raw string so the model can self-correct.
    return { _raw: s };
  }
}
