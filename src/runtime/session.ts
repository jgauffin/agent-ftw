import type { CompiledAgent } from "../compile/index.js";
import { validate } from "../compile/index.js";
import type { AgentDecl, AskUserInput, AskUserResult } from "../declare/index.js";
import type { Adapter } from "../adapters/types.js";
import { TraceBus } from "../trace/index.js";
import type { Hooks } from "../hooks/index.js";
import { AgentRun } from "./agent-run.js";
import { SessionStore } from "./session-store.js";
import type { SessionInfo } from "./session-store.js";

const OTHER_OPTION = "Other";

let sessionIdCounter = 0;
function nextSessionId(): string {
  // Time + counter keeps ids unique across runs (so resume is possible) without a uuid dep.
  return `s_${Date.now().toString(36)}_${++sessionIdCounter}`;
}

/**
 * Options for {@link Session.fork}.
 *
 * Forking spawns a sibling Session running the same compiled pipeline so the
 * host can pursue a side exploration without disturbing the original run.
 */
export interface ForkOptions {
  /**
   * What to seed the forked Session with as input to its first phase.
   *   "deliverable" — the parent's most recently completed phase deliverable (cheap, default).
   *   "summarize"   — call the session's `defaultAdapter.runStructured` to compress the parent's run state to JSON.
   */
  readonly seed: "deliverable" | "summarize";
  /** Extra instructions for the summarizer. Only used when seed === "summarize". */
  readonly summarizeInstructions?: string;
  /**
   * Hooks for the forked Session. Defaults to the parent's hooks. Useful when the
   * host wants the side-exploration to surface askUser to a different UI surface.
   */
  readonly hooks?: Hooks;
}

/**
 * Return value of {@link Session.fork}: the new sibling Session plus the seed
 * input the host should pass to `session.run(seed)`.
 */
export interface ForkResult {
  /** Independent Session sharing the parent's compiled agent + default adapter. Has its own AbortController. */
  readonly session: Session;
  /** Seed input prepared from the parent's state — pass to `session.run(seed)`. */
  readonly seed: unknown;
}

/**
 * Constructor options for {@link Session}.
 */
export interface SessionOptions {
  /** Compiled or raw agent declaration. */
  agent: AgentDecl | CompiledAgent;
  /**
   * Adapter used for the whole pipeline unless a construct overrides it. Any
   * agent, phase, or checklist may carry its own `adapter` to override this.
   */
  defaultAdapter: Adapter;
  hooks: Hooks;
  /**
   * Enables session persistence. State is written under
   * `{sessionDirectory}/{agentName}/{sessionId}/`. Only the top-level agent run
   * is persisted — sub-agents are rerun on resume.
   */
  sessionDirectory?: string;
  /**
   * Stable session id. When omitted, a fresh id is generated. When provided
   * AND the directory contains existing state for it, the next `run()` resumes
   * from the persisted phase boundary. Has no effect without `sessionDirectory`.
   */
  sessionId?: string;
}

/**
 * Single root for an agent invocation. Owns the cancellation tree, trace bus,
 * AskUser FIFO queue, and agent-run tree.
 *
 * Lifecycle:
 *  - `new Session(opts)` — validates the agent (if not already compiled),
 *    optionally opens the persistence store.
 *  - `await session.run(input)` — runs the top-level pipeline; returns the
 *    last phase's deliverable.
 *  - `session.cancel(reason?)` — aborts the run tree.
 *  - `await session.dispose()` — cancels and disposes all adapters.
 *
 * Persistence: pass `sessionDirectory` to enable. Pair with a stable `sessionId`
 * to resume from the last persisted phase boundary.
 */
export class Session {
  readonly id: string;
  readonly bus: TraceBus;
  readonly hooks: Hooks;
  /** Pipeline-wide adapter; any construct may override it with its own `adapter`. */
  readonly defaultAdapter: Adapter;
  readonly signal: AbortSignal;
  /**
   * Persistence store for the top-level agent run. Undefined when persistence is off.
   * @internal
   */
  readonly store: SessionStore | undefined;
  private readonly abort: AbortController;
  private readonly compiled: CompiledAgent;
  /** Every distinct adapter referenced anywhere in the pipeline — disposed together. */
  private readonly allAdapters: ReadonlySet<Adapter>;
  private readonly askQueue: Promise<unknown>[] = [];
  private lastDeliverable: { agent: string; phase: string; payload: unknown } | undefined;

  constructor(opts: SessionOptions) {
    const a = opts.agent;
    this.compiled = "phases" in a && Array.isArray((a as { phases: unknown }).phases) && "toolsByName" in (a as object)
      ? (a as CompiledAgent)
      : validate(a as AgentDecl);
    this.defaultAdapter = opts.defaultAdapter;
    this.allAdapters = collectAdapters(this.compiled, this.defaultAdapter);
    this.hooks = opts.hooks;
    this.id = opts.sessionId ?? nextSessionId();
    this.store = opts.sessionDirectory
      ? new SessionStore(opts.sessionDirectory, this.compiled.decl.name, this.id)
      : undefined;
    const userTrace = opts.hooks.trace ?? (() => {});
    this.bus = new TraceBus((event) => {
      if (event.type === "phase.end") {
        this.lastDeliverable = {
          agent: event.agent,
          phase: event.phase,
          payload: event.deliverable,
        };
      }
      userTrace(event);
    });
    this.abort = new AbortController();
    this.signal = this.abort.signal;
  }

  /**
   * List persisted sessions in a session directory, optionally filtered by
   * agent name. Returns most-recently-updated first.
   */
  static async listSessions(
    sessionDirectory: string,
    agentName?: string
  ): Promise<readonly SessionInfo[]> {
    return await SessionStore.list(sessionDirectory, agentName);
  }

  /**
   * Run the agent pipeline to completion. Returns the final phase's deliverable
   * (shaped by that phase's `deliverable` JSON Schema).
   *
   * If `sessionDirectory` + a previously-used `sessionId` were provided, the
   * run resumes from the last persisted phase boundary instead of starting over.
   */
  async run(input: unknown): Promise<unknown> {
    const root = new AgentRun(this, this.compiled, null);
    return await root.execute(input);
  }

  /**
   * Spawn a sibling Session running the same compiled pipeline (feature A:
   * host-triggered side exploration). The fork is independent — its own
   * AbortController, its own deliverable tracker — and shares the parent's
   * compiled agent + default adapter.
   *
   * Returns the new Session and a `seed` value the host should pass to
   * `session.run(seed)`. The host owns lifecycle: `await fork.session.run(fork.seed)`,
   * `fork.session.cancel()`, `await fork.session.dispose()`.
   */
  async fork(opts: ForkOptions): Promise<ForkResult> {
    const seed = opts.seed === "deliverable"
      ? this.seedFromDeliverable()
      : await this.seedFromSummary(opts.summarizeInstructions);

    const child = new Session({
      agent: this.compiled,
      defaultAdapter: this.defaultAdapter,
      hooks: opts.hooks ?? this.hooks,
    });

    this.bus.emit({
      type: "fork.created",
      parentSessionId: this.id,
      childSessionId: child.id,
      seed: opts.seed,
    });

    return { session: child, seed };
  }

  private seedFromDeliverable(): unknown {
    if (!this.lastDeliverable) {
      throw new Error(
        "Session.fork({ seed: \"deliverable\" }) called before any phase completed — nothing to hand off"
      );
    }
    return this.lastDeliverable.payload;
  }

  private async seedFromSummary(instructions: string | undefined): Promise<unknown> {
    const lastPart = this.lastDeliverable
      ? `Most recent completed phase "${this.lastDeliverable.phase}" of agent "${this.lastDeliverable.agent}" produced: ${JSON.stringify(this.lastDeliverable.payload)}`
      : `No phase has completed yet.`;
    const userText =
      `Summarize the current state of an agent run so a fresh side-exploration ` +
      `can start from it. ${instructions ?? ""}\n\n${lastPart}`;
    return await this.defaultAdapter.runStructured({
      systemPrompt: "You compress agent run state into a structured handoff. Reply with structured output only.",
      userText,
      schema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "1-2 sentence recap of where the parent run is." },
          openQuestions: { type: "array", items: { type: "string" } },
          carryOver: {
            type: "object",
            description: "Any structured data the new run should start with.",
            additionalProperties: true,
          },
        },
        required: ["summary"],
      },
      signal: this.signal,
    });
  }

  /**
   * Abort the run tree. Idempotent — subsequent calls are no-ops. Emits a
   * `cancelled` trace event the first time.
   */
  cancel(reason = "cancelled"): void {
    if (this.abort.signal.aborted) return;
    this.abort.abort();
    this.bus.emit({ type: "cancelled", runId: "session", reason });
  }

  /**
   * Cancel and dispose all adapters. Safe to call multiple times.
   * Call this when the session is no longer needed so adapter resources
   * (HTTP clients, SDK subprocesses) are released.
   */
  async dispose(): Promise<void> {
    this.cancel("disposed");
    await Promise.allSettled(
      [...this.allAdapters].map((a) => a.dispose?.() ?? Promise.resolve())
    );
  }

  /**
   * Serialized FIFO so concurrent sub-agents don't race for the user.
   * The model never sees the appended "Other" option; if the user picks Other,
   * it surfaces as `result.other` only.
   */
  async askUser(
    input: AskUserInput,
    ctx: { agent: string; phase: string; runId: string }
  ): Promise<AskUserResult> {
    this.signal.throwIfAborted();
    const prior = this.askQueue[this.askQueue.length - 1];
    let release!: () => void;
    const slot = new Promise<void>((r) => (release = r));
    this.askQueue.push(slot);
    if (prior) await prior;
    try {
      const presentedOptions = input.options ? [...input.options, OTHER_OPTION] : [OTHER_OPTION];
      const result = await this.hooks.askUser(
        { ...input, options: presentedOptions },
        { agent: ctx.agent, phase: ctx.phase }
      );
      // Strip Other from `selected`; surface free text via `other`.
      const selected = result.selected.filter((s) => s !== OTHER_OPTION);
      const sanitized: AskUserResult =
        result.other !== undefined ? { selected, other: result.other } : { selected };
      this.bus.emit({
        type: "askUser",
        agent: ctx.agent,
        phase: ctx.phase,
        runId: ctx.runId,
        prompt: input.prompt,
        options: input.options ?? [],
        result: sanitized,
      });
      return sanitized;
    } finally {
      release();
      // Drop completed slot from the front when it was first.
      const idx = this.askQueue.indexOf(slot);
      if (idx >= 0) this.askQueue.splice(idx, 1);
    }
  }
}

/**
 * Walk the compiled agent tree and gather every distinct `Adapter` instance
 * referenced by any construct (agent, phase, checklist, side-quest spec, and
 * nested sub-agents), plus the session default. Used so `dispose()` can release
 * every adapter the pipeline might touch. Adapters that a `customSubAgent`
 * handler spawns dynamically via `runChild` are not visible here.
 */
function collectAdapters(compiled: CompiledAgent, defaultAdapter: Adapter): ReadonlySet<Adapter> {
  const adapters = new Set<Adapter>([defaultAdapter]);
  const seenAgents = new Set<AgentDecl>();

  const visitAgent = (a: AgentDecl): void => {
    if (seenAgents.has(a)) return;
    seenAgents.add(a);
    if (a.adapter) adapters.add(a.adapter);
    if (a.sideQuests?.adapter) adapters.add(a.sideQuests.adapter);
    for (const t of a.tools) {
      if (t.kind === "subAgent") visitAgent(t.agent);
    }
    for (const p of a.phases) {
      if (p.adapter) adapters.add(p.adapter);
      if (p.checklist?.adapter) adapters.add(p.checklist.adapter);
      for (const t of p.tools) {
        if (t.kind === "subAgent") visitAgent(t.agent);
      }
    }
  };

  visitAgent(compiled.decl);
  return adapters;
}
