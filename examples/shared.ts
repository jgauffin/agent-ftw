// Shared helpers for the example scripts.
//
// Each example builds an AgentDecl and runs it through a Session. The Session
// needs an Adapter (the thing that actually talks to a model) plus Hooks
// (askUser callback, optional review callback, optional trace callback).
//
// To keep the examples runnable without an API key, we default to an
// OpenAI-compatible local endpoint (Ollama on localhost:11434). Override with:
//
//   $env:MODEL_BASE_URL = "https://api.openai.com/v1"
//   $env:MODEL_NAME     = "gpt-4o-mini"
//   $env:MODEL_API_KEY  = "sk-..."
//
// To use Claude instead, swap `makeAdapter()` for one of:
//   - `anthropicApiAdapter({ model: "claude-sonnet-4-6", apiKey: ... })` — raw
//     Messages API (you have an Anthropic API key).
//   - `claudeAgentAdapter({ model: "claude-sonnet-4-6" })` — Claude Agent SDK
//     (you have a Claude subscription; auth goes through the Claude Code CLI).
//
// Each construct (Session default, agent, phase, checklist) takes a direct
// `Adapter` instance, so `makeAdapter(...)` can be called per construct to mix
// models across a pipeline.

import { openaiCompatAdapter } from "../src/adapters/openai-compat.js";
import type { Adapter } from "../src/adapters/types.js";
import type { Hooks } from "../src/hooks/index.js";
import type { TraceEvent } from "../src/trace/index.js";

declare const process: { env: Record<string, string | undefined> };

export const MODEL_NAME = process.env.MODEL_NAME ?? "llama3.1";

export function makeAdapter(model = MODEL_NAME): Adapter {
  return openaiCompatAdapter({
    baseUrl: process.env.MODEL_BASE_URL ?? "http://localhost:11434/v1",
    model,
    ...(process.env.MODEL_API_KEY !== undefined ? { apiKey: process.env.MODEL_API_KEY } : {}),
    temperature: 0,
  });
}

// Minimal hooks: auto-pick the first option for askUser, auto-grant up to two
// budget extensions, and log every trace event. In a real app, askUser would
// surface a UI prompt, `review` would drive a chat-with-revisions flow, and
// `requestBudgetExtension` would let the user decide based on the snapshot.
export function makeHooks(): Hooks {
  return {
    askUser: async (input) => {
      const choice = input.options?.[0] ?? "";
      console.log(`[askUser] ${input.prompt} -> auto-selected "${choice}"`);
      return { selected: choice ? [choice] : [] };
    },
    requestBudgetExtension: async (req) => {
      // Demo policy: grant up to two extensions of the suggested size, then deny.
      // A real host would surface req.recentActivity to its user and let them
      // decide whether to keep going.
      if (req.extensionsGranted >= 2) {
        console.log(
          `[budget] ${req.agent}/${req.phase} exhausted (used=${req.turnsUsed}, ext=${req.extensionsGranted}) -> deny`
        );
        return { deny: true };
      }
      console.log(
        `[budget] ${req.agent}/${req.phase} exhausted (used=${req.turnsUsed}) -> extend by ${req.suggestedExtension}`
      );
      return { extendBy: req.suggestedExtension };
    },
    trace: (event: TraceEvent) => {
      // One-line summary per event so you can see the agent's progress.
      const base = `[trace] ${event.type}`;
      switch (event.type) {
        case "agent.start":
          console.log(`${base} ${event.agent} input=${preview(event.input)}`);
          break;
        case "agent.end":
          console.log(`${base} ${event.agent} output=${preview(event.output)}`);
          break;
        case "phase.start":
          console.log(`${base} ${event.agent}/${event.phase}`);
          break;
        case "phase.end":
          console.log(`${base} ${event.agent}/${event.phase} deliverable=${preview(event.deliverable)}`);
          break;
        case "tool.call":
          console.log(`${base} ${event.tool} input=${preview(event.input)}`);
          break;
        case "tool.result":
          console.log(`${base} ${event.tool} output=${preview(event.output)}`);
          break;
        case "tool.error":
          console.log(`${base} ${event.tool} error=${event.error}`);
          break;
        case "checklist.run":
          console.log(`${base} ${event.agent}/${event.phase} result=${preview(event.result)}`);
          break;
        case "checklist.failed":
          console.log(`${base} ${event.agent}/${event.phase} failures=${preview(event.failures)}`);
          break;
        default:
          console.log(base);
      }
    },
  };
}

function preview(value: unknown): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s && s.length > 120 ? s.slice(0, 117) + "..." : s ?? "";
}
