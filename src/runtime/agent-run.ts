import type { CompiledAgent } from "../compile/index.js";
import type { AgentDecl, SubAgentDecl } from "../declare/index.js";
import { validate } from "../compile/index.js";
import type { Session } from "./session.js";
import type { Adapter } from "../adapters/types.js";
import { PhaseRun } from "./phase-run.js";
import type { TraceBus } from "../trace/index.js";

/** Path id of the run at the top of a session's tree. */
export const ROOT_RUN_PATH = "root";

export class AgentRun {
  /**
   * Position in the run tree, e.g. `root.2.1`. Ledger nodes, traces and (later)
   * artifact keys all address a run by this, so one identity locates a node
   * everywhere it appears.
   */
  readonly runId: string;
  /** Distance from the root run. The root is 0. */
  readonly depth: number;
  readonly agentName: string;
  readonly signal: AbortSignal;
  /**
   * Paths this run may write to, from the contract that created it. Mutating
   * tools receive it and refuse anything outside. Inherited from the parent
   * when a contract does not narrow it further.
   */
  readonly writeSet: readonly string[] | undefined;
  /** What this run was contracted to achieve, when it came from a contract. */
  readonly objective: string | undefined;
  /** Total turns the contract pre-authorised for this run, top-ups included. */
  readonly maxTurns: number | undefined;
  private reserved = 0;
  /** Children contracted so far, counted across every batch. */
  contractsSpawned = 0;
  /** Delegate batches issued, so a coordinator cannot re-plan without end. */
  batchesIssued = 0;
  /** Consecutive batches that produced nothing accepted. */
  emptyBatchStreak = 0;
  /** Contracts already issued, so the same one is not run twice. */
  readonly contractHashes = new Set<string>();
  private childCount = 0;
  /**
   * Adapter for this agent's phases unless a phase overrides it. Resolved from
   * the agent's own `adapter`, else the parent run's `effectiveAdapter`, else
   * the session default.
   */
  readonly effectiveAdapter: Adapter;
  private readonly abort: AbortController;

  constructor(
    readonly session: Session,
    readonly compiled: CompiledAgent,
    readonly parent: AgentRun | null,
    contract?: { objective?: string; writeSet?: readonly string[]; maxTurns?: number }
  ) {
    this.objective = contract?.objective;
    this.maxTurns = contract?.maxTurns;
    this.writeSet = contract?.writeSet ?? parent?.writeSet;
    this.runId = parent ? parent.nextChildPath() : ROOT_RUN_PATH;
    this.depth = parent ? parent.depth + 1 : 0;
    if (parent) session.ledger.createChild(this.runId, parent.runId);
    this.agentName = compiled.decl.name;
    this.effectiveAdapter =
      compiled.decl.adapter ?? (parent ? parent.effectiveAdapter : session.defaultAdapter);
    this.abort = new AbortController();
    const parentSignal = parent ? parent.signal : session.signal;
    if (parentSignal.aborted) this.abort.abort();
    else parentSignal.addEventListener("abort", () => this.abort.abort(), { once: true });
    this.signal = this.abort.signal;
  }

  get bus(): TraceBus {
    return this.session.bus;
  }

  get isTopLevel(): boolean {
    return this.parent === null;
  }

  private nextChildPath(): string {
    return `${this.runId}.${++this.childCount}`;
  }

  /** Record turns reserved for this run, so top-ups know the ceiling. */
  noteReserved(turns: number): void {
    this.reserved += turns;
  }

  /**
   * Draw more turns from the parent, up to the ceiling the contract authorised
   * in advance. Returns false at the ceiling, which is what turns an overrun
   * into a `partial` return instead of an open-ended request for more.
   */
  tryTopUpFromParent(want: number): boolean {
    if (this.maxTurns === undefined || this.parent === null) return false;
    const headroom = this.maxTurns - this.reserved;
    if (headroom <= 0) return false;
    const take = Math.min(want, headroom);
    if (!this.session.ledger.reserve(this.runId, take)) return false;
    this.reserved += take;
    return true;
  }

  spawnChild(sub: SubAgentDecl): AgentRun {
    // Re-compiled at the depth it will actually run at, so the limit means the
    // same thing here as it did when the whole tree was validated.
    const childCompiled = validate(sub.agent, {
      maxDepth: this.session.maxDepth,
      depth: this.depth + 1,
    });
    return new AgentRun(this.session, childCompiled, this);
  }

  /**
   * Spawn a child AgentRun against a CompiledAgent that was synthesized at runtime
   * (e.g. by side-quest dispatch). Caller is responsible for compiling/validating.
   */
  spawnRuntimeChild(compiled: CompiledAgent): AgentRun {
    return new AgentRun(this.session, compiled, this);
  }

  /**
   * Spawn a child for one delegation contract. The declaration arrives already
   * narrowed to the granted tools, and the contract's objective and write-set
   * travel with the run.
   */
  spawnContractChild(
    childDecl: AgentDecl,
    contract: { objective: string; writeSet: readonly string[] | undefined; maxTurns?: number }
  ): AgentRun {
    this.contractsSpawned++;
    const compiled = validate(childDecl, {
      maxDepth: this.session.maxDepth,
      depth: this.depth + 1,
    });
    return new AgentRun(this.session, compiled, this, {
      objective: contract.objective,
      ...(contract.writeSet !== undefined ? { writeSet: contract.writeSet } : {}),
      ...(contract.maxTurns !== undefined ? { maxTurns: contract.maxTurns } : {}),
    });
  }

  async execute(input: unknown): Promise<unknown> {
    this.bus.emit({
      type: "agent.start",
      agent: this.agentName,
      runId: this.runId,
      parentRunId: this.parent ? this.parent.runId : null,
      input,
    });

    try {
      const deliverables = new Map<string, unknown>();
      let lastDeliverable: unknown = undefined;
      // A contracted run leads with its objective so the first phase is working
      // to the goal it was given, not just to the payload it received.
      let initialInput = this.objective
        ? `Objective: ${this.objective}\n\nInput: ${serializeInput(input)}`
        : serializeInput(input);

      // Persistence: only the top-level run is persisted. Sub-agents are rerun on resume.
      const store = this.isTopLevel ? this.session.store : undefined;
      const meta = store ? await store.initIfMissing() : null;
      if (store && meta) {
        const stored = await store.loadDeliverables();
        for (const phaseName of meta.completedPhases) {
          if (phaseName in stored) {
            deliverables.set(phaseName, stored[phaseName]);
            lastDeliverable = stored[phaseName];
          }
        }
      }

      for (const phase of this.compiled.phases) {
        if (deliverables.has(phase.decl.name)) {
          // Already completed in a prior run — skip and emit the cached deliverable.
          this.bus.emit({
            type: "phase.start",
            agent: this.agentName,
            phase: phase.decl.name,
            runId: this.runId,
          });
          this.bus.emit({
            type: "phase.end",
            agent: this.agentName,
            phase: phase.decl.name,
            runId: this.runId,
            deliverable: deliverables.get(phase.decl.name),
          });
          initialInput = `Continue to phase "${nextPhaseName(this.compiled, phase.decl.name) ?? "(none)"}". Prior deliverable for "${phase.decl.name}" is in your context.`;
          continue;
        }

        if (store) {
          const fresh = await store.loadMeta();
          if (fresh) {
            fresh.currentPhase = phase.decl.name;
            await store.saveMeta(fresh);
          }
        }

        const run = new PhaseRun(this, phase, deliverables, store ?? undefined);
        const out = await run.execute(initialInput);
        deliverables.set(phase.decl.name, out);
        lastDeliverable = out;

        if (store) {
          await store.saveDeliverable(phase.decl.name, out);
          // Reload meta because the adapter may have written into adapterMeta
          // during the phase; using the stale in-memory copy would clobber it.
          const fresh = await store.loadMeta();
          if (fresh) {
            if (!fresh.completedPhases.includes(phase.decl.name)) {
              fresh.completedPhases.push(phase.decl.name);
            }
            await store.saveMeta(fresh);
          }
        }

        // Subsequent phases see the agent input + prior deliverables in their system prompt;
        // the per-phase user text is just a short pointer.
        initialInput = `Continue to phase "${nextPhaseName(this.compiled, phase.decl.name) ?? "(none)"}". Prior deliverable for "${phase.decl.name}" is in your context.`;
      }

      if (store) {
        const fresh = await store.loadMeta();
        if (fresh) {
          fresh.status = "complete";
          fresh.currentPhase = null;
          await store.saveMeta(fresh);
        }
      }

      this.bus.emit({
        type: "agent.end",
        agent: this.agentName,
        runId: this.runId,
        output: lastDeliverable,
      });
      return lastDeliverable;
    } catch (e) {
      const store = this.isTopLevel ? this.session.store : undefined;
      if (store) {
        const meta = await store.loadMeta();
        if (meta) {
          meta.status = this.session.signal.aborted ? "aborted" : "error";
          await store.saveMeta(meta);
        }
      }
      this.bus.emit({
        type: "agent.error",
        agent: this.agentName,
        runId: this.runId,
        error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

function serializeInput(input: unknown): string {
  if (typeof input === "string") return input;
  return JSON.stringify(input);
}

function nextPhaseName(compiled: CompiledAgent, current: string): string | null {
  const idx = compiled.phases.findIndex((p) => p.decl.name === current);
  if (idx < 0 || idx >= compiled.phases.length - 1) return null;
  return compiled.phases[idx + 1]!.decl.name;
}
