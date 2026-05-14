import type { Adapter, RunContext, PhaseEndResult, Turn, ToolCall } from "../../src/adapters/types.js";
import type { JSONSchema } from "../../src/schema/index.js";
import { seedConversation } from "../../src/adapters/run-helpers.js";

/**
 * Scripted adapter for tests. The script is a sequence of "moves":
 *   - { calls: [...], finish: payload? } — emit tool calls, optionally finish the phase
 *   - { finish: payload }                — emit phase-end directly
 *
 * Each call to runUntilPhaseEnd consumes moves from the head of the script
 * until one with `finish` is reached.
 */
export interface ScriptedMove {
  calls?: Array<{ name: string; input: unknown }>;
  text?: string;
  finish?: unknown;
}

export interface FakeAdapter extends Adapter {
  /** Replace the script. */
  setScript(script: ScriptedMove[]): void;
  /** Replace the structured-output script (used by checklists). */
  setStructured(script: unknown[]): void;
  /** Snapshots of every RunContext.systemPrompt seen. */
  readonly seenSystemPrompts: string[];
  /** Snapshots of every newUserText that was non-empty. */
  readonly seenUserTexts: string[];
  /** All conversations as observed at the start of each runUntilPhaseEnd. */
  readonly seenConversations: ReadonlyArray<readonly Turn[]>;
}

export function fakeAdapter(initial?: ScriptedMove[]): FakeAdapter {
  let script: ScriptedMove[] = initial ? [...initial] : [];
  let structured: unknown[] = [];
  const systemPrompts: string[] = [];
  const userTexts: string[] = [];
  const conversations: Turn[][] = [];
  let toolCallCounter = 0;

  return {
    setScript(s) { script = [...s]; },
    setStructured(s) { structured = [...s]; },
    seenSystemPrompts: systemPrompts,
    seenUserTexts: userTexts,
    seenConversations: conversations,

    async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
      systemPrompts.push(ctx.systemPrompt);
      if (ctx.newUserText) userTexts.push(ctx.newUserText);
      conversations.push([...ctx.conversation]);

      const conversation = seedConversation(ctx);
      const emitFinish = (payload: unknown): PhaseEndResult => {
        const callId = `call_${++toolCallCounter}`;
        const finishCall: ToolCall = { id: callId, name: ctx.phaseEndToolName, input: payload };
        const turn: Turn = { role: "assistant", toolCalls: [finishCall] };
        conversation.push(turn);
        ctx.onTurn(turn);
        return { payload, conversation };
      };

      while (script.length > 0) {
        // Cooperative yield — lets external terminators / cancellations resolve
        // even when the rest of the loop is synchronous.
        await Promise.resolve();
        ctx.signal.throwIfAborted();
        ctx.consumeTurn();
        const move = script.shift()!;

        // Phase-end short-circuits without dispatching anything else.
        if (move.finish !== undefined && (!move.calls || move.calls.length === 0)) {
          return emitFinish(move.finish);
        }

        const toolCalls: ToolCall[] = (move.calls ?? []).map((c) => ({
          id: `call_${++toolCallCounter}`,
          name: c.name,
          input: c.input,
        }));
        const assistantTurn: Turn = {
          role: "assistant",
          ...(move.text ? { text: move.text } : {}),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        };
        conversation.push(assistantTurn);
        ctx.onTurn(assistantTurn);

        // Pure-text move (text but no tool calls): surface to host or nudge.
        if (toolCalls.length === 0) {
          let userText: string;
          if (ctx.onAssistantText) {
            userText = await ctx.onAssistantText(move.text ?? "");
          } else {
            userText = `You must call ${ctx.phaseEndToolName} or another tool to make progress.`;
          }
          const userTurn: Turn = { role: "user", text: userText };
          conversation.push(userTurn);
          ctx.onTurn(userTurn);
          continue;
        }

        await dispatchScriptedCalls(toolCalls, conversation, ctx);

        if (move.finish !== undefined) return emitFinish(move.finish);
      }

      throw new Error("fake adapter: script exhausted before phase-end");
    },

    async runStructured(_args: { schema: JSONSchema }): Promise<unknown> {
      void _args;
      if (structured.length === 0) {
        throw new Error("fake adapter: no structured script entries left");
      }
      return structured.shift();
    },
  };
}

async function dispatchScriptedCalls(
  toolCalls: readonly ToolCall[],
  conversation: Turn[],
  ctx: RunContext
): Promise<void> {
  for (const call of toolCalls) {
    try {
      const out = await ctx.dispatchTool(call.name, call.input, call.id);
      const t: Turn = { role: "tool", toolCallId: call.id, result: out };
      conversation.push(t);
      ctx.onTurn(t);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const t: Turn = { role: "tool", toolCallId: call.id, result: msg, isError: true };
      conversation.push(t);
      ctx.onTurn(t);
    }
  }
}
