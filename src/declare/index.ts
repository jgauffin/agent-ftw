import type { JSONSchema } from "../schema/index.js";
import type { Adapter } from "../adapters/types.js";

// Declarations are mostly data, but they carry runtime values too: tools hold a
// `handler` function, and any construct may hold an `adapter` instance. Readonly
// TS types; no runtime freezing.
// Tool input is typed as `unknown` at the handler — devs narrow with a type guard
// or trust the schema (validated by the framework before dispatch). json-schema-to-ts
// inference was attempted but blew TS's depth limit on real-world schemas.

/**
 * Plain tool the model may call inside a phase. Created via {@link tool}.
 *
 * The framework validates `input` against the JSON Schema before invoking the
 * handler, so handlers can trust the shape (but still receive it as `unknown` —
 * narrow with a type guard or cast).
 */
export interface ToolDecl {
  readonly kind: "tool";
  /** Name the model sees (and uses to call the tool). Must be unique within an agent. */
  readonly name: string;
  /** Human/model-facing description; this is the model's only documentation for the tool. */
  readonly description: string;
  /** JSON Schema for the tool's input. Framework validates calls against this before dispatch. */
  readonly input: JSONSchema;
  /**
   * Implementation. Receives the validated input and a context with cancellation,
   * `askUser`, and `emit`. Throw to surface an error result to the model.
   */
  readonly handler: (input: unknown, ctx: ToolHandlerCtx) => Promise<unknown>;
}

/**
 * Context passed to a {@link ToolDecl} handler when the model invokes the tool.
 */
export interface ToolHandlerCtx {
  /** Aborts when the phase/session is cancelled. Forward to long-running awaits. */
  readonly signal: AbortSignal;
  /**
   * Prompt the host user mid-handler. Calls go through the session's `Hooks.askUser`,
   * serialized FIFO so concurrent sub-agents don't race for the user.
   */
  askUser(input: AskUserInput): Promise<AskUserResult>;
  /**
   * Emit a host-visible payload mid-handler. Surfaces as a `tool.event` on the
   * trace bus so UIs can render incremental progress without folding it into
   * the model-visible tool result.
   */
  emit(payload: unknown): void;
}

/**
 * Input to an `askUser` call. The host's UI presents `prompt` and `options`;
 * the framework appends a synthetic "Other" option so the user can always reply
 * with free text (returned as `result.other`).
 */
export interface AskUserInput {
  readonly prompt: string;
  /** Predefined options. If omitted, the user gets free text only. */
  readonly options?: readonly string[];
  /** Whether the user may pick multiple options. Default: `"single"`. */
  readonly mode?: "single" | "multi";
}

/**
 * Result returned from `askUser`. `selected` lists the predefined options the
 * user picked (with the synthetic "Other" stripped); `other` is the user's free
 * text reply when they chose Other.
 */
export interface AskUserResult {
  readonly selected: readonly string[];
  readonly other?: string;
}

/**
 * Sub-agent exposed to the model as a tool. Calling the tool spawns a child
 * AgentRun against the embedded `agent` declaration and returns its final
 * phase's deliverable as the tool result.
 *
 * Use when the sub-task is itself naturally phased.
 */
export interface SubAgentDecl {
  readonly kind: "subAgent";
  readonly name: string;
  readonly description: string;
  readonly input: JSONSchema;
  readonly agent: AgentDecl;
}

/**
 * Sub-agent whose body is a custom TS handler instead of a phased AgentDecl.
 * Use when coordination is conditional (fail-fast gating, fan-out/join, deterministic
 * pre/post-processing) and expressing it as phases would be awkward. The handler
 * receives a context that can spawn full child AgentRuns via `runChild`.
 *
 * Output is validated against `output` before the result is returned to the caller.
 */
export interface CustomSubAgentDecl {
  readonly kind: "customSubAgent";
  readonly name: string;
  readonly description: string;
  readonly input: JSONSchema;
  /** JSON Schema for the handler's return value. Validated before the result is exposed to the model. */
  readonly output: JSONSchema;
  readonly handler: (input: unknown, ctx: CustomSubAgentCtx) => Promise<unknown>;
}

/**
 * Context passed to a {@link CustomSubAgentDecl} handler. In addition to the
 * usual `signal` / `emit` / `askUser`, it can spawn a phased child agent run
 * via {@link CustomSubAgentCtx.runChild}.
 */
export interface CustomSubAgentCtx {
  readonly signal: AbortSignal;
  emit(payload: unknown): void;
  askUser(input: AskUserInput): Promise<AskUserResult>;
  /**
   * Spawn a full child AgentRun against the given declaration and return its
   * deliverable. Trace nesting and cancellation propagation are wired automatically.
   */
  runChild(agent: AgentDecl, input: unknown): Promise<unknown>;
}

/**
 * Framework-internal: the auto-injected `propose_side_quest` tool. Created by
 * compile when an AgentDecl declares `sideQuests.mode === "agent"`. The model
 * sees it as a normal tool spec; dispatch handles it specially (askUser gate +
 * synthesized child AgentRun against the approved tool subset).
 */
export interface SideQuestProposalDecl {
  readonly kind: "sideQuestProposal";
  readonly name: string;
  readonly description: string;
  readonly input: JSONSchema;
  readonly spec: SideQuestsDecl;
}

/**
 * Per-agent configuration for agent-triggered side quests (feature B).
 *
 * When `mode === "agent"`, every phase gets an auto-injected `propose_side_quest`
 * tool. The model proposes a goal + a subset of the catalog; the host approves
 * (or edits) via `askUser`; a single-phase child AgentRun is synthesized with
 * the approved tools and the configured deliverable schema.
 */
export interface SideQuestsDecl {
  /** `"off"` disables the proposal tool; `"agent"` injects it on every phase. */
  readonly mode: "off" | "agent";
  /** Tools the agent may request. Approved subset is what the side quest actually gets. */
  readonly catalog: readonly ToolDecl[];
  /** JSON schema the side quest's deliverable must satisfy. */
  readonly deliverable: JSONSchema;
  /** Turn budget for the synthesized side-quest phase. Default 20. */
  readonly turnBudget?: number;
  /** Maximum nesting; default 1 — synthesized side quests cannot themselves spawn side quests. */
  readonly maxDepth?: number;
  /** Adapter override for the synthesized side-quest agent. Falls back to the parent agent's adapter. */
  readonly adapter?: Adapter;
}

/**
 * Optional LLM-as-judge gate run after a phase produces its deliverable.
 *
 * The framework runs an adapter against `schema` with the deliverable as
 * context. If the result reports a failing check, the phase re-runs with the
 * failure as feedback. The verifying adapter is `adapter` if set, otherwise the
 * phase's adapter. Created via {@link checklist}.
 */
export interface ChecklistDecl {
  readonly kind: "checklist";
  /** System prompt for the checklist run. The deliverable is appended as user context. */
  readonly prompt: string;
  /** JSON Schema the checklist run must satisfy. Typical shape: `{ checks: [{ name, passed, evidence }] }`. */
  readonly schema: JSONSchema;
  /** Adapter override for the verification run. Falls back to the phase's adapter. */
  readonly adapter?: Adapter;
}

/**
 * Context passed to an `external` {@link PhaseTerminator}'s `await` callback.
 */
export interface TerminatorCtx {
  readonly agent: string;
  readonly phase: string;
  readonly runId: string;
  /** Aborts when the phase is otherwise cancelled (session cancel, parent abort). */
  readonly signal: AbortSignal;
}

/**
 * How a phase decides it is finished.
 *
 *   - `tool` (default): the framework injects a `finish_<phase>` tool; the model
 *     calls it with the deliverable and the loop ends.
 *
 *   - `external`: the host resolves a promise with the deliverable. Useful when
 *     the deliverable is lifted from a host-managed live state (UI button, IPC,
 *     etc.) rather than produced by the agent. In this mode the phase-end tool
 *     is NOT exposed to the model — the model is expected to act on the live
 *     state via other tools and the host completes the phase out-of-band.
 *     The system prompt is also shortened (no "call finish_X" line).
 */
export type PhaseTerminator =
  | { readonly kind: "tool" }
  | {
      readonly kind: "external";
      readonly await: (ctx: TerminatorCtx) => Promise<unknown>;
    };

/**
 * Context passed to {@link OnAssistantText} when the model emits text without
 * any tool calls.
 */
export interface AssistantTextCtx {
  readonly agent: string;
  readonly phase: string;
  readonly runId: string;
  readonly signal: AbortSignal;
}

/**
 * Host callback invoked when the model emits a turn with text but no tool
 * calls. The default behavior is to nudge the model with a "you must call X"
 * message; supplying this callback overrides that. Return the user reply that
 * should become the next user turn. To terminate the phase, throw or abort the
 * signal.
 */
export type OnAssistantText = (text: string, ctx: AssistantTextCtx) => Promise<string>;

/**
 * A single stage in an agent pipeline. Created via {@link phase}.
 *
 * A phase runs against a fresh model context (system prompt + `prompt` + prior
 * phases' deliverables, *not* prior phases' raw chat). It ends when the model
 * calls the auto-injected `finish_<name>` tool with a JSON payload that
 * validates against `deliverable`, or when the turn budget is exhausted, or
 * (for `external` terminators) when the host resolves the await callback.
 */
export interface PhaseDecl {
  readonly kind: "phase";
  /** Phase name. Unique within an agent. Used to derive the `finish_<name>` tool. */
  readonly name: string;
  /** The phase's user-visible task description. Appended after the framework's system prompt. */
  readonly prompt: string;
  /** JSON Schema the deliverable must satisfy. Phase doesn't end until the model emits a valid payload. */
  readonly deliverable: JSONSchema;
  /** Tools available to the model during this phase, in addition to the agent's global tools. */
  readonly tools: readonly (ToolDecl | SubAgentDecl | CustomSubAgentDecl)[];
  /** Adapter override for this phase's model loop. Falls back to the agent's adapter, then the session default. */
  readonly adapter?: Adapter;
  /** Optional LLM-as-judge gate. Failing checks trigger a re-run with feedback. */
  readonly checklist?: ChecklistDecl;
  /** Max model turns before `TurnBudgetExhausted` is raised. Framework default applies if unset. */
  readonly turnBudget?: number;
  /** If `true`, the host's `Hooks.review` callback drives a review chat after the deliverable validates. Top-level phases only. */
  readonly review?: boolean;
  /** How the phase decides it is done. Defaults to `{ kind: "tool" }`. */
  readonly terminator?: PhaseTerminator;
  /** Override for model turns that emit text without tool calls. See {@link OnAssistantText}. */
  readonly onAssistantText?: OnAssistantText;
  /** Override the auto-generated phase-end tool name. Defaults to `finish_<name>`. */
  readonly phaseEndToolName?: string;
}

/**
 * An agent: a named pipeline of phases. Created via {@link agent}.
 *
 * Sub-agents are themselves `AgentDecl`s wrapped in a {@link SubAgentDecl}.
 * The compile step validates the whole tree (cycle detection, name collisions,
 * etc.) before the Session can run it.
 */
export interface AgentDecl {
  readonly kind: "agent";
  /** Agent name. Surfaces in traces and persistence paths. */
  readonly name: string;
  /**
   * Adapter override for every phase in this agent. Falls back to the session's
   * `defaultAdapter`; for a sub-agent, falls back to the parent agent's adapter.
   * Individual phases and checklists can override it further.
   */
  readonly adapter?: Adapter;
  /** Tools available to every phase. Merged with per-phase tools. */
  readonly tools: readonly (ToolDecl | SubAgentDecl | CustomSubAgentDecl)[];
  readonly phases: readonly PhaseDecl[];
  /** Configures agent-triggered side quests. See {@link SideQuestsDecl}. */
  readonly sideQuests?: SideQuestsDecl;
}

// Factories — typed at the call site for the handler param, then erase to ToolDecl.

/**
 * Define a plain tool the model may call. The handler's return value is
 * passed back to the model as the tool result (stringified if not already
 * a string).
 *
 * @example
 * ```ts
 * const search = tool({
 *   name: "search",
 *   description: "Search the bug database.",
 *   input: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } as const,
 *   handler: async (input) => searchDb((input as { query: string }).query),
 * });
 * ```
 */
export function tool<O>(d: {
  name: string;
  description: string;
  input: JSONSchema;
  handler: (input: unknown, ctx: ToolHandlerCtx) => Promise<O>;
}): ToolDecl {
  return {
    kind: "tool",
    name: d.name,
    description: d.description,
    input: d.input,
    handler: d.handler as ToolDecl["handler"],
  };
}

/**
 * Define a sub-agent the parent can call as a tool. The sub-agent's pipeline
 * runs as a child AgentRun; its final phase's deliverable becomes the tool
 * result returned to the parent model.
 */
export function subAgent(d: {
  name: string;
  description: string;
  input: JSONSchema;
  agent: AgentDecl;
}): SubAgentDecl {
  return {
    kind: "subAgent",
    name: d.name,
    description: d.description,
    input: d.input,
    agent: d.agent,
  };
}

/**
 * Define a custom-handler sub-agent. The handler runs TypeScript directly
 * (instead of a phased pipeline) and may spawn nested child agents via
 * `ctx.runChild`. Output is validated against `output` before being returned.
 */
export function customSubAgent(d: {
  name: string;
  description: string;
  input: JSONSchema;
  output: JSONSchema;
  handler: (input: unknown, ctx: CustomSubAgentCtx) => Promise<unknown>;
}): CustomSubAgentDecl {
  return {
    kind: "customSubAgent",
    name: d.name,
    description: d.description,
    input: d.input,
    output: d.output,
    handler: d.handler,
  };
}

/**
 * Define a checklist gate for a phase. The session's `localModel` adapter
 * runs the checklist after the deliverable is produced; failing checks trigger
 * a phase re-run with the failure attached as feedback.
 */
export function checklist(d: {
  prompt: string;
  schema: JSONSchema;
  adapter?: Adapter;
}): ChecklistDecl {
  return {
    kind: "checklist",
    prompt: d.prompt,
    schema: d.schema,
    ...(d.adapter !== undefined ? { adapter: d.adapter } : {}),
  };
}

/**
 * Define a phase. Optional fields default sensibly:
 *  - `tools` defaults to `[]` (the agent's global tools are still available)
 *  - `terminator` defaults to `{ kind: "tool" }`
 *  - `turnBudget` defaults to the framework default if unset
 */
export function phase(d: {
  name: string;
  prompt: string;
  deliverable: JSONSchema;
  tools?: readonly (ToolDecl | SubAgentDecl | CustomSubAgentDecl)[];
  adapter?: Adapter;
  checklist?: ChecklistDecl;
  turnBudget?: number;
  review?: boolean;
  terminator?: PhaseTerminator;
  onAssistantText?: OnAssistantText;
  phaseEndToolName?: string;
}): PhaseDecl {
  return {
    kind: "phase",
    name: d.name,
    prompt: d.prompt,
    deliverable: d.deliverable,
    tools: d.tools ?? [],
    ...(d.adapter !== undefined ? { adapter: d.adapter } : {}),
    ...(d.checklist !== undefined ? { checklist: d.checklist } : {}),
    ...(d.turnBudget !== undefined ? { turnBudget: d.turnBudget } : {}),
    ...(d.review !== undefined ? { review: d.review } : {}),
    ...(d.terminator !== undefined ? { terminator: d.terminator } : {}),
    ...(d.onAssistantText !== undefined ? { onAssistantText: d.onAssistantText } : {}),
    ...(d.phaseEndToolName !== undefined ? { phaseEndToolName: d.phaseEndToolName } : {}),
  };
}

/**
 * Define an agent: an ordered list of phases and (optionally) global tools
 * shared by every phase. An optional `adapter` overrides the session default
 * for every phase in this agent.
 *
 * @example
 * ```ts
 * const triager = agent({
 *   name: "bug_triager",
 *   phases: [triagePhase, planPhase],
 * });
 * ```
 */
export function agent(d: {
  name: string;
  adapter?: Adapter;
  tools?: readonly (ToolDecl | SubAgentDecl | CustomSubAgentDecl)[];
  phases: readonly PhaseDecl[];
  sideQuests?: SideQuestsDecl;
}): AgentDecl {
  return {
    kind: "agent",
    name: d.name,
    ...(d.adapter !== undefined ? { adapter: d.adapter } : {}),
    tools: d.tools ?? [],
    phases: d.phases,
    ...(d.sideQuests !== undefined ? { sideQuests: d.sideQuests } : {}),
  };
}

/** Well-known name for the auto-injected agent-triggered side-quest proposal tool. */
export const SIDE_QUEST_TOOL_NAME = "propose_side_quest";
