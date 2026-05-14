import type { Adapter, RunContext, PhaseEndResult, Turn, ToolCall } from "./types.js";
import {
  seedConversation,
  appendAssistantTurn,
  handleNoToolCalls,
  dispatchAndAppend,
} from "./run-helpers.js";

/**
 * Configuration for {@link anthropicApiAdapter}.
 *
 * This adapter targets Claude via the **raw Anthropic Messages API**
 * (`@anthropic-ai/sdk`) — the API-key-authenticated path. It is the only
 * optional peer dep this adapter needs; install it only when you use this
 * adapter:
 *
 * ```bash
 * npm install @anthropic-ai/sdk
 * ```
 *
 * If you have a Claude **subscription** rather than an API key, use
 * `claudeAgentAdapter` instead — it drives the Claude Agent SDK.
 */
export interface AnthropicApiConfig {
  /** Model id, e.g. `"claude-sonnet-4-6"`. */
  readonly model: string;
  /** Optional API key. Falls back to `ANTHROPIC_API_KEY` in the environment. */
  readonly apiKey?: string;
  /** `max_tokens` for each Messages API request. Defaults to 4096. */
  readonly maxTokens?: number;
  readonly temperature?: number;
}

interface AnthropicContentBlock {
  type: string;
  text?: unknown;
  id?: unknown;
  name?: unknown;
  input?: unknown;
}

/** A request-side content block — shape varies by `type`, so it's left open. */
type RequestBlock = Record<string, unknown>;

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | RequestBlock[];
}

/**
 * Raw Anthropic Messages API adapter — drives the model→tool loop by hand with
 * `messages.create` for `runUntilPhaseEnd`, and a single forced-tool call for
 * `runStructured`.
 *
 * `@anthropic-ai/sdk` is an optional peer dep, imported lazily so users on other
 * adapters don't need it installed.
 */
export function anthropicApiAdapter(cfg: AnthropicApiConfig): Adapter {
  async function createClient(): Promise<RawAnthropicClient> {
    const raw = await loadRawAnthropic();
    return new raw.Anthropic({ apiKey: cfg.apiKey });
  }

  return {
    async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
      const client = await createClient();
      const conversation = seedConversation(ctx);

      while (true) {
        ctx.signal.throwIfAborted();
        ctx.consumeTurn();

        const body: Record<string, unknown> = {
          model: cfg.model,
          max_tokens: cfg.maxTokens ?? 4096,
          system: ctx.systemPrompt,
          messages: toAnthropicMessages(conversation),
          tools: ctx.tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.input,
          })),
        };
        if (cfg.temperature !== undefined) body.temperature = cfg.temperature;

        const resp = await client.messages.create(body, { signal: ctx.signal });
        const blocks = Array.isArray(resp.content) ? (resp.content as AnthropicContentBlock[]) : [];
        const text = blocks
          .filter((b) => b.type === "text" && typeof b.text === "string")
          .map((b) => b.text as string)
          .join("\n");
        const toolCalls: ToolCall[] = blocks
          .filter((b) => b.type === "tool_use" && typeof b.id === "string" && typeof b.name === "string")
          .map((b) => ({ id: b.id as string, name: b.name as string, input: b.input }));

        appendAssistantTurn(conversation, ctx, text || null, toolCalls);

        if (toolCalls.length === 0) {
          await handleNoToolCalls(conversation, ctx, text);
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
      const client = await createClient();
      const resp = await client.messages.create(
        {
          model: cfg.model,
          max_tokens: cfg.maxTokens ?? 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userText }],
          tools: [
            {
              name: "submit",
              description: "Submit the result.",
              input_schema: schema,
            },
          ],
          tool_choice: { type: "tool", name: "submit" },
          ...(cfg.temperature !== undefined ? { temperature: cfg.temperature } : {}),
        },
        { signal }
      );
      const blocks = Array.isArray(resp.content) ? (resp.content as AnthropicContentBlock[]) : [];
      const block = blocks.find((b) => b.type === "tool_use");
      if (!block || block.input === undefined) {
        throw new Error("anthropic-api: structured call returned no tool_use block");
      }
      return block.input;
    },
  };
}

/**
 * Translate the framework's flat `Turn[]` into Anthropic's `messages` shape.
 * Consecutive `tool` turns are merged into a single `user` message carrying
 * multiple `tool_result` blocks, as the API expects.
 */
function toAnthropicMessages(conv: readonly Turn[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let pendingToolResults: RequestBlock[] | null = null;

  const flushToolResults = (): void => {
    if (pendingToolResults && pendingToolResults.length > 0) {
      out.push({ role: "user", content: pendingToolResults });
    }
    pendingToolResults = null;
  };

  for (const t of conv) {
    if (t.role === "tool") {
      // The API rejects empty cached text blocks — coerce to a non-empty string.
      (pendingToolResults ??= []).push({
        type: "tool_result",
        tool_use_id: t.toolCallId,
        content: toResultText(t.result),
        ...(t.isError ? { is_error: true } : {}),
      });
      continue;
    }

    flushToolResults();

    if (t.role === "user") {
      out.push({ role: "user", content: t.text });
      continue;
    }

    // assistant
    const blocks: RequestBlock[] = [];
    if (t.text) blocks.push({ type: "text", text: t.text });
    if (t.toolCalls) {
      for (const c of t.toolCalls) {
        blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.input });
      }
    }
    // Skip a wholly empty assistant turn — the API rejects empty content.
    if (blocks.length > 0) {
      out.push({ role: "assistant", content: blocks });
    }
  }

  flushToolResults();
  return out;
}

/** Coerce a tool result into a non-empty string for a `tool_result` content block. */
function toResultText(result: unknown): string {
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
  return text.length === 0 ? "(empty)" : text;
}

interface RawAnthropicClient {
  messages: {
    create(
      body: unknown,
      opts: { signal: AbortSignal }
    ): Promise<{ content: unknown }>;
  };
}

interface RawAnthropic {
  Anthropic: new (opts: { apiKey?: string }) => RawAnthropicClient;
}

async function loadRawAnthropic(): Promise<RawAnthropic> {
  // @ts-expect-error — optional peer dep, may not be installed
  const mod = await import("@anthropic-ai/sdk").catch(() => {
    throw new Error("anthropic-api adapter requires @anthropic-ai/sdk to be installed");
  });
  return mod as unknown as RawAnthropic;
}
