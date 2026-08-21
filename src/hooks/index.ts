import type { AskUserInput, AskUserResult } from "../declare/index.js";
import type { JSONSchema } from "../schema/index.js";
import type { TraceEvent } from "../trace/index.js";

/**
 * Context passed to {@link Hooks.askUser} so the host knows which agent/phase is asking.
 */
export interface AskCtx {
  readonly agent: string;
  readonly phase: string;
}

/**
 * Context for a {@link Hooks.review} callback. The host drives a chat loop with
 * the user; for each user message it calls `requestRevision`, which re-runs
 * the phase and returns the revised deliverable. Resolving the callback (with
 * `void`) signals user approval.
 */
export interface ReviewCtx {
  readonly agent: string;
  readonly phase: string;
  /**
   * Re-run the phase with a user message appended to the context.
   * Returns the agent's revised deliverable. Call once per user message during review.
   * The hook resolves (returns void) when the user approves.
   */
  requestRevision(userMessage: string): Promise<unknown>;
}

/**
 * Snapshot handed to `Hooks.requestBudgetExtension` so the host can decide
 * whether to grant more turns. The host owns the policy — it may consult its
 * own user, apply a fixed cap, or refuse outright.
 */
export interface BudgetExtensionRequest {
  readonly agent: string;
  readonly phase: string;
  /** Position in the run tree, e.g. `root.2.1`. */
  readonly runId: string;
  /** Distance from the root run; 0 is the top-level agent. */
  readonly depth: number;
  /**
   * Which ceiling ran out. `"phase"` is this phase's own `turnBudget`;
   * `"run"` is the session-wide budget shared by the whole tree. Granting
   * against a `"run"` exhaustion adds turns the entire tree can spend, so it
   * is the one worth thinking hard about.
   */
  readonly limit: "phase" | "run";
  /** The phase's configured turn budget (or framework default if unset). */
  readonly originalBudget: number;
  /** Total turns the phase has consumed so far (original + prior extensions). */
  readonly turnsUsed: number;
  /** How many extensions have already been granted in this phase. */
  readonly extensionsGranted: number;
  /** What the framework would grant by default (= originalBudget). */
  readonly suggestedExtension: number;
  /** Most recent activity, summarized for display. */
  readonly recentActivity: BudgetExtensionRecentActivity;
  /** JSON schema the phase is trying to produce — useful context for the decision. */
  readonly deliverableSchema: JSONSchema;
}

/**
 * Compact, host-renderable summary of the last few model/tool actions in a
 * budget-exhausted phase. Attached to {@link BudgetExtensionRequest} so the
 * host can show the user "what was it doing?" before deciding to grant turns.
 */
export interface BudgetExtensionRecentActivity {
  /** Last assistant text turn, if any. */
  readonly lastAssistantText?: string;
  /** Most recent tool calls (newest last), capped to a small number. */
  readonly recentToolCalls: ReadonlyArray<{
    readonly name: string;
    /** JSON-stringified input, truncated. */
    readonly inputSummary: string;
  }>;
}

/**
 * Host's reply to a {@link BudgetExtensionRequest}: either grant `extendBy`
 * additional turns or deny (which raises `TurnBudgetExhausted`).
 */
export type BudgetExtensionResponse =
  | { readonly extendBy: number }
  | { readonly deny: true };

/**
 * Host callbacks the framework invokes during a run. Required: `askUser`.
 * Everything else is optional.
 *
 * The same `Hooks` instance is shared by every agent and phase in the session;
 * the framework supplies an {@link AskCtx} / {@link ReviewCtx} so the host can
 * route the call appropriately.
 */
export interface Hooks {
  /** Prompt the user. Calls are queued FIFO across concurrent agents in the same session. */
  askUser(input: AskUserInput, ctx: AskCtx): Promise<AskUserResult>;
  /**
   * Drives the review chat. Resolves when the user approves the current deliverable.
   * For each user chat message, call ctx.requestRevision(text) and surface the
   * returned deliverable in the UI.
   */
  review?(deliverable: unknown, ctx: ReviewCtx): Promise<void>;
  /**
   * Called when a phase exhausts its turn budget. The host decides whether to
   * grant more turns (and how many), or to let the phase fail. If unset, an
   * exhausted phase fails with TurnBudgetExhausted — the framework does not
   * fall back to a generic askUser prompt.
   */
  requestBudgetExtension?(req: BudgetExtensionRequest): Promise<BudgetExtensionResponse>;
  /** Receives every {@link TraceEvent} the framework emits. See `createTracer`. */
  trace?(event: TraceEvent): void;
}
