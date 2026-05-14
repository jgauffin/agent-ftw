import type { RunContext, Turn, ToolCall } from "./types.js";

/** Seed a fresh conversation array from ctx, appending and emitting any new user text. */
export function seedConversation(ctx: RunContext): Turn[] {
  const conversation: Turn[] = [...ctx.conversation];
  if (ctx.newUserText) {
    const turn: Turn = { role: "user", text: ctx.newUserText };
    conversation.push(turn);
    ctx.onTurn(turn);
  }
  return conversation;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/* ------------------------------------------------------------------------- *
 * Shared model-loop plumbing. Adapters that drive the model→tool loop by hand
 * (openai-compat, anthropic-api) translate provider-native messages into the
 * framework's Turn protocol the same way — these helpers are that protocol.
 * ------------------------------------------------------------------------- */

/** Append (and emit) one assistant Turn built from decoded text + tool calls. */
export function appendAssistantTurn(
  conversation: Turn[],
  ctx: RunContext,
  content: string | null,
  toolCalls: readonly ToolCall[]
): void {
  const turn: Turn = {
    role: "assistant",
    ...(content ? { text: content } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  };
  conversation.push(turn);
  ctx.onTurn(turn);
}

/**
 * Handle a model turn with text but no tool calls: surface it to the host's
 * `onAssistantText` hook (using the reply as the next user turn) or nudge the
 * model back into tool-calling.
 */
export async function handleNoToolCalls(
  conversation: Turn[],
  ctx: RunContext,
  text: string
): Promise<void> {
  let userText: string;
  if (ctx.onAssistantText) {
    userText = await ctx.onAssistantText(text);
  } else {
    userText = `You must call ${ctx.phaseEndToolName} or another tool to make progress.`;
  }
  const turn: Turn = { role: "user", text: userText };
  conversation.push(turn);
  ctx.onTurn(turn);
}

/** Dispatch every tool call (in parallel) and append the resulting tool Turns. */
export async function dispatchAndAppend(
  toolCalls: readonly ToolCall[],
  conversation: Turn[],
  ctx: RunContext
): Promise<void> {
  const results = await Promise.all(
    toolCalls.map(async (c) => {
      try {
        const out = await ctx.dispatchTool(c.name, c.input, c.id);
        return { id: c.id, result: out, isError: false };
      } catch (e) {
        return { id: c.id, result: errorMessage(e), isError: true };
      }
    })
  );
  for (const r of results) {
    const turn: Turn = { role: "tool", toolCallId: r.id, result: r.result, isError: r.isError };
    conversation.push(turn);
    ctx.onTurn(turn);
  }
}
