import type { JSONSchema } from "../schema/index.js";

/**
 * One entry in a phase's conversation transcript. The framework keeps these
 * for the in-progress phase only — across phase boundaries only structured
 * deliverables carry forward.
 */
export type Turn =
  | { role: "user"; text: string }
  | { role: "assistant"; text?: string; toolCalls?: readonly ToolCall[] }
  | { role: "tool"; toolCallId: string; result: unknown; isError?: boolean };

/**
 * A model-issued tool call. Adapter implementations translate provider-native
 * tool-call shapes into this normalized form.
 */
export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/**
 * Per-tool descriptor adapters receive on `RunContext.tools`. This is the
 * framework-normalized view; adapters convert it to provider-native shapes
 * (OpenAI function tools, MCP tool defs, etc.) before sending it to the model.
 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input: JSONSchema;
}

/**
 * The contract between the framework and an {@link Adapter}. The framework
 * builds one per phase invocation, hands it to `adapter.runUntilPhaseEnd`,
 * and expects the adapter to drive the model loop until the phase-end tool
 * is called (or `signal` aborts).
 *
 * Adapters MUST:
 *  - call `consumeTurn()` before each model turn (raises on budget exhaustion)
 *  - call `onTurn(turn)` for every model assistant turn and tool result they
 *    materialize, so trace/persistence observe them
 *  - dispatch tool calls via `dispatchTool(name, input, callId)` — never run
 *    handlers themselves
 *  - return when (and only when) the model calls `phaseEndToolName`
 *
 * NOT a UI surface. `RunContext` is for **adapter implementers**. The sync
 * callbacks (`onTurn`, `consumeTurn`) run on the adapter's hot loop and must
 * stay sync — they are not subscription points. Hosts that need to render
 * chat, stream tokens, or react to turns should implement `Hooks.trace` and
 * listen for `model.turn` events instead (see `src/trace/index.ts`). To grant
 * more turns when the budget is exhausted, implement
 * `Hooks.requestBudgetExtension` — there is no extension knob on `RunContext`.
 */
export interface RunContext {
  readonly systemPrompt: string;
  readonly conversation: readonly Turn[];
  readonly newUserText?: string;
  readonly tools: readonly ToolSpec[];
  readonly phaseEndToolName: string;
  readonly signal: AbortSignal;
  /** Framework dispatches the tool. Adapter never executes handlers. */
  dispatchTool(name: string, input: unknown, callId: string): Promise<unknown>;
  /**
   * Adapter calls this for every model/tool turn so trace and persistence can
   * observe. Sync by design — runs on the adapter's hot loop. Hosts must not
   * use this as a UI hook; subscribe to `Hooks.trace` (`model.turn`) instead.
   */
  onTurn(turn: Turn): void;
  /**
   * Adapter calls before each model turn; throws `TurnBudgetExhausted` if the
   * budget is exhausted. Sync — do not await UI here. To make exhaustion
   * recoverable, implement `Hooks.requestBudgetExtension`; the framework calls
   * it after this throws and retries on grant.
   */
  consumeTurn(): void;
  /**
   * The adapter MUST call this when the model emits a turn that has text but
   * no tool calls, instead of composing its own "you must call X" nudge. The
   * returned string becomes the next user turn. To abort, throw or fire the
   * abort signal.
   *
   * The framework always supplies it, so nudge wording and the resulting
   * `phase.nudged` / `phase.assistantText` trace events stay framework-owned.
   * Optional only so a hand-built `RunContext` (adapter tests) can omit it.
   */
  onAssistantText?(text: string): Promise<string>;
  /**
   * Persistence hooks. Set only when session persistence is enabled and the
   * current run is top-level (sub-agents are not persisted). Adapters that
   * maintain external state (e.g. Claude SDK session ids) read/write via these.
   */
  readonly persistence?: PersistenceCtx;
}

/**
 * Adapter-facing slice of session persistence. Provides a per-(session, phase)
 * scratchpad for adapter-private state (e.g. the Claude SDK's resumable session
 * id). Available only when the session has persistence enabled AND the run is
 * top-level — sub-agent runs do not persist.
 */
export interface PersistenceCtx {
  readonly sessionId: string;
  readonly agentName: string;
  readonly phaseName: string;
  /** Read an adapter-specific scratchpad value (typed at the adapter's discretion). */
  getAdapterMeta(key: string): unknown;
  /** Write an adapter-specific scratchpad value; persisted before the call resolves. */
  setAdapterMeta(key: string, value: unknown): Promise<void>;
}

/**
 * Value an adapter returns from {@link Adapter.runUntilPhaseEnd}. `payload` is
 * the raw deliverable the model passed to the phase-end tool (still
 * pre-validation); `conversation` is the full transcript the adapter built
 * for the phase (persistence reads this on resume).
 */
export interface PhaseEndResult {
  readonly payload: unknown;
  readonly conversation: readonly Turn[];
}

/**
 * Pluggable model backend. The framework ships three implementations:
 *
 *  - `openaiCompatAdapter` for any OpenAI-style `/chat/completions` endpoint
 *    (OpenAI, Ollama, LM Studio, vLLM, …)
 *  - `anthropicApiAdapter` for Claude via the raw Anthropic Messages API
 *    (API-key auth)
 *  - `claudeAgentAdapter` for Claude via the Claude Agent SDK (subscription auth)
 *
 * Implement this to bridge another provider. The framework owns the dispatcher
 * loop semantics (tool validation, turn budget, trace emission) — adapters
 * only convert wire formats and drive the provider's tool-loop API.
 */
export interface Adapter {
  /** Drive the model loop until the phase-end tool is called. See {@link RunContext}. */
  runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult>;
  /** One-shot structured generation; used by checklists. */
  runStructured(args: {
    systemPrompt: string;
    userText: string;
    schema: JSONSchema;
    signal: AbortSignal;
  }): Promise<unknown>;
  /** Optional cleanup hook. Called by `Session.dispose`. */
  dispose?(): Promise<void>;
}

/**
 * Raised when a turn budget runs out and the host either has no
 * `requestBudgetExtension` hook or denies the request.
 *
 * `limit` says which ceiling was hit: `"phase"` is the phase's own
 * `turnBudget`, `"run"` is the session-wide budget shared by the entire run
 * tree. The distinction matters because raising a phase budget does nothing
 * when the run budget is what ran dry.
 */
export class TurnBudgetExhausted extends Error {
  constructor(readonly limit: "phase" | "run" = "phase") {
    super(limit === "run" ? "run turn budget exhausted" : "turn budget exhausted");
    this.name = "TurnBudgetExhausted";
  }
}
