import { execSync } from "node:child_process";
import type { Adapter } from "../../src/adapters/types.js";
import { claudeAgentAdapter } from "../../src/adapters/claude-agent.js";
import { openaiCompatAdapter } from "../../src/adapters/openai-compat.js";

export type RuntimeKind = "claude-cli" | "ollama";

export interface DiscoveredRuntime {
  readonly kind: RuntimeKind;
  readonly model: string;
  readonly adapter: Adapter;
  /** Human-readable description of what was discovered, surfaced in skip messages. */
  readonly describe: string;
}

let cached: DiscoveredRuntime | null | undefined;

/**
 * Discovers a usable LLM runtime for integration tests.
 *
 * Resolution order:
 *   1. Claude Code CLI on PATH + @anthropic-ai/* peer deps installed
 *      (auth is delegated to the CLI's own credential store, or ANTHROPIC_API_KEY).
 *   2. A reachable Ollama server (defaults to http://localhost:11434), with at
 *      least one pulled model.
 *
 * Override hooks for CI / local config:
 *   AGENT_PIPELINE_RUNTIME            "claude-cli" | "ollama"  (force one)
 *   AGENT_PIPELINE_CLAUDE_MODEL       e.g. "claude-sonnet-4-5"
 *   AGENT_PIPELINE_OLLAMA_URL         e.g. "http://localhost:11434/v1"
 *   AGENT_PIPELINE_OLLAMA_MODEL       e.g. "llama3.1"
 *
 * Returns null if nothing usable is available; tests should skip in that case.
 * The result is cached for the process lifetime.
 */
export async function discoverRuntime(): Promise<DiscoveredRuntime | null> {
  if (cached !== undefined) return cached;
  const force = process.env.AGENT_PIPELINE_RUNTIME?.toLowerCase();

  if (force === "claude-cli") {
    cached = (await tryClaudeCli()) ?? null;
    return cached;
  }
  if (force === "ollama") {
    cached = (await tryOllama()) ?? null;
    return cached;
  }

  cached = (await tryClaudeCli()) ?? (await tryOllama()) ?? null;
  return cached;
}

/** Public hook for tests that want a Claude-specific runtime regardless of the resolution order. */
export async function discoverClaudeCli(): Promise<DiscoveredRuntime | null> {
  return tryClaudeCli();
}

async function tryClaudeCli(): Promise<DiscoveredRuntime | null> {
  if (!hasCommandOnPath("claude")) return null;
  try {
    // claudeAgentAdapter needs the Agent SDK + zod (both optional peer deps).
    // @ts-expect-error — optional peer dep, may not be installed
    await import("@anthropic-ai/claude-agent-sdk");
    await import("zod");
  } catch {
    return null;
  }
  const model = process.env.AGENT_PIPELINE_CLAUDE_MODEL ?? "claude-sonnet-4-5";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return {
    kind: "claude-cli",
    model,
    describe: `Claude CLI (model=${model})`,
    adapter: claudeAgentAdapter({ model, ...(apiKey ? { apiKey } : {}) }),
  };
}

async function tryOllama(): Promise<DiscoveredRuntime | null> {
  const baseUrl = (process.env.AGENT_PIPELINE_OLLAMA_URL ?? "http://localhost:11434/v1").replace(/\/+$/, "");
  const tagsUrl = baseUrl.replace(/\/v1$/, "") + "/api/tags";
  let body: { models?: Array<{ name: string }> };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(tagsUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    body = (await res.json()) as { models?: Array<{ name: string }> };
  } catch {
    return null;
  }
  const model = process.env.AGENT_PIPELINE_OLLAMA_MODEL ?? body.models?.[0]?.name;
  if (!model) return null;
  return {
    kind: "ollama",
    model,
    describe: `Ollama (model=${model}, url=${baseUrl})`,
    adapter: openaiCompatAdapter({ baseUrl, model }),
  };
}

function hasCommandOnPath(cmd: string): boolean {
  try {
    const probe = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
    execSync(probe, { stdio: "ignore", shell: process.platform === "win32" ? "cmd.exe" : "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}
