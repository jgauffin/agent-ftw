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
   * Whether the tool changes anything outside the run: writes a file, calls a
   * write API, runs a command with side effects. Only the tool's author knows,
   * so it is declared rather than guessed.
   *
   * A coordinator may not hold a mutating tool — it delegates that authority
   * instead of exercising it — so this is enforced at compile time.
   */
  readonly mutates?: boolean;
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
   * Paths the current run is allowed to write to, from the contract that
   * created it. `undefined` means no contract narrowed it.
   *
   * A tool declared `mutates` should refuse anything outside this list. The
   * framework checks that concurrent contracts do not overlap and that returned
   * evidence stays inside, but it does not own the filesystem: this handler is
   * the only place a write outside the set can actually be stopped.
   */
  readonly writeSet: readonly string[] | undefined;
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
  /**
   * Checks a contracted child's return before the parent accepts it.
   *
   * Deliberately host TypeScript rather than another model call: a check that
   * can be fooled by confident prose is not a check. Returning `ok: false`
   * sends the child back with the reason, up to {@link SubAgentDecl.maxRejects}
   * times, after which the work is abandoned and reported upward as partial.
   *
   * Only consulted when the child was started by a `delegate` contract.
   */
  readonly accept?: (
    result: unknown,
    evidence: readonly Evidence[],
    ctx: AcceptanceCtx
  ) => Promise<AcceptanceVerdict>;
  /** How many times a rejected child may be sent back. Defaults to 1. */
  readonly maxRejects?: number;
}

/**
 * Something checkable a child offers in support of what it claims to have done:
 * a file it wrote, a command it ran, a location it read. The parent verifies
 * against these rather than against the child's description of its own work.
 */
export interface Evidence {
  /** What kind of thing this points at. */
  readonly kind: "file" | "command" | "citation" | "note";
  /** The path, command line, or location. */
  readonly ref: string;
  /** Outcome or excerpt: an exit code, a matched line, a short quote. */
  readonly detail?: string;
}

/** Context handed to {@link SubAgentDecl.accept}. */
export interface AcceptanceCtx {
  readonly childAgent: string;
  /** What this child was contracted to achieve. */
  readonly objective: string;
  /**
   * The objective as the child restated it. Compare against `objective`: a
   * child that describes a different job than the one it was given has
   * misread it, whatever its result looks like.
   */
  readonly restatement: string;
  /** Paths the contract allowed it to write, if any. */
  readonly writeSet: readonly string[] | undefined;
  /** How many times this contract has already been rejected. */
  readonly rejects: number;
}

/** Verdict from {@link SubAgentDecl.accept}. */
export type AcceptanceVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** How a contracted child finished. */
export type ContractStatus = "ok" | "partial" | "blocked";

/**
 * What a contracted child returns: its declared deliverable wrapped in a status
 * and the evidence for it.
 *
 * `blocked` is a first-class outcome, not a failure. A child that cannot
 * resolve an ambiguity says so and hands the decision up, rather than inventing
 * an answer and burying the guess in a plausible result.
 */
export interface ContractEnvelope {
  /** The objective as the child understood it. Compare against what you asked. */
  readonly restatement?: string;
  readonly status: ContractStatus;
  readonly result?: unknown;
  readonly evidence?: readonly Evidence[];
  /** Why it is blocked, or what is missing from a partial result. */
  readonly note?: string;
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
 * Framework-internal: the auto-injected `delegate` tool. Created by compile for
 * every phase of a `role: "coordinator"` agent, except at the depth limit where
 * it is withheld entirely — that is what stops a coordinator tree from
 * recursing without bound.
 *
 * The model sees a normal tool taking a batch of {@link Contract}s. Dispatch
 * validates the whole batch before starting any of it.
 */
export interface DelegateDecl {
  readonly kind: "delegate";
  readonly name: string;
  readonly description: string;
  readonly input: JSONSchema;
  /** Sub-agents this coordinator may contract, by tool name. */
  readonly children: ReadonlyMap<string, SubAgentDecl>;
  /** Tools this coordinator may grant, by name. */
  readonly delegable: ReadonlyMap<string, ToolDecl>;
}

/**
 * One unit of delegated work, filled in by the coordinator model.
 *
 * Every field is bounded by what the coordinator statically declared, so the
 * model can only ever narrow: it cannot grant a tool the agent may not hand
 * down, and it cannot allocate turns the agent does not hold.
 */
export interface Contract {
  /** Which declared sub-agent does the work. */
  readonly childAgent: string;
  /** This child's narrow goal, in the coordinator's own words. */
  readonly objective: string;
  /** Validated against the sub-agent's declared input schema. */
  readonly input: unknown;
  /**
   * Tools the child may use, a subset of the coordinator's `delegable`.
   * Omitted means "everything the child declares", which compile already
   * bounded.
   */
  readonly grants?: readonly string[];
  /**
   * Paths the child may write to. Required once any granted tool mutates.
   * Contracts with overlapping write-sets are run one after another rather
   * than together, so two children never write the same place at once.
   */
  readonly writeSet?: readonly string[];
  /**
   * Keys of earlier children's results this child may read, using the
   * `read_artifact` tool. This is how one child's output reaches another
   * without the two of them talking, and without the payload passing through
   * the coordinator's own context.
   *
   * A key it was not given is not readable.
   */
  readonly reads?: readonly string[];
  /** Turns allocated to this child, taken from the coordinator's balance. */
  readonly turns: number;
  /**
   * Ceiling the framework may top the child up to, drawn from the
   * coordinator's remaining balance, without asking anyone.
   *
   * Authorising this up front is deliberate: waking a coordinator's model loop
   * to adjudicate a child's overrun costs turns and turns into an open-ended
   * negotiation that a stuck child always wins. Past the ceiling the child
   * stops and returns `partial`, and the coordinator decides what to do.
   *
   * Defaults to `turns`, meaning no top-up.
   */
  readonly maxTurns?: number;
}

/** Well-known name for the auto-injected delegation tool. */
export const DELEGATE_TOOL_NAME = "delegate";

/** Well-known name for the reader a contract's `reads` grants a child. */
export const READ_ARTIFACT_TOOL_NAME = "read_artifact";

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
   * What this agent is for. A `worker` does the work. A `coordinator` decides
   * who does it: it may not hold a mutating tool, so it cannot quietly abandon
   * its own plan and start editing things itself.
   *
   * Defaults to `"worker"`.
   */
  readonly role?: AgentRole;
  /**
   * Tools this agent may hand **down** to its sub-agents, as opposed to
   * `tools`, which is what it may call itself. A sub-agent may only declare
   * tools its parent listed here, so authority narrows with depth and a leaf
   * can never hold something no ancestor was allowed to grant.
   *
   * The two lists are separate so a coordinator that holds nothing mutating can
   * still put edit authority in a leaf.
   *
   * Defaults to `[]`, which means "hands nothing down".
   */
  readonly delegable?: readonly ToolDecl[];
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
  mutates?: boolean;
  handler: (input: unknown, ctx: ToolHandlerCtx) => Promise<O>;
}): ToolDecl {
  return {
    kind: "tool",
    name: d.name,
    description: d.description,
    input: d.input,
    ...(d.mutates !== undefined ? { mutates: d.mutates } : {}),
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
  accept?: (
    result: unknown,
    evidence: readonly Evidence[],
    ctx: AcceptanceCtx
  ) => Promise<AcceptanceVerdict>;
  maxRejects?: number;
}): SubAgentDecl {
  return {
    kind: "subAgent",
    name: d.name,
    description: d.description,
    input: d.input,
    agent: d.agent,
    ...(d.accept !== undefined ? { accept: d.accept } : {}),
    ...(d.maxRejects !== undefined ? { maxRejects: d.maxRejects } : {}),
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
  role?: AgentRole;
  adapter?: Adapter;
  tools?: readonly (ToolDecl | SubAgentDecl | CustomSubAgentDecl)[];
  delegable?: readonly ToolDecl[];
  phases: readonly PhaseDecl[];
  sideQuests?: SideQuestsDecl;
}): AgentDecl {
  return {
    kind: "agent",
    name: d.name,
    ...(d.role !== undefined ? { role: d.role } : {}),
    ...(d.adapter !== undefined ? { adapter: d.adapter } : {}),
    tools: d.tools ?? [],
    ...(d.delegable !== undefined ? { delegable: d.delegable } : {}),
    phases: d.phases,
    ...(d.sideQuests !== undefined ? { sideQuests: d.sideQuests } : {}),
  };
}

/**
 * Whether an agent does the work or decides who does it. See
 * {@link AgentDecl.role}.
 */
export type AgentRole = "worker" | "coordinator";

/** Well-known name for the auto-injected agent-triggered side-quest proposal tool. */
export const SIDE_QUEST_TOOL_NAME = "propose_side_quest";

/** Turn budget applied to a phase that does not declare its own. */
export const DEFAULT_TURN_BUDGET = 30;
