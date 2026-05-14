import type { CompiledAgent } from "../compile/index.js";
import type { SubAgentDecl } from "../declare/index.js";
import { validate } from "../compile/index.js";
import type { Session } from "./session.js";
import type { Adapter } from "../adapters/types.js";
import { PhaseRun } from "./phase-run.js";
import type { TraceBus } from "../trace/index.js";

let runIdCounter = 0;
function nextRunId(): string {
  return `run_${++runIdCounter}`;
}

export class AgentRun {
  readonly runId: string;
  readonly agentName: string;
  readonly signal: AbortSignal;
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
    readonly parent: AgentRun | null
  ) {
    this.runId = nextRunId();
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

  spawnChild(sub: SubAgentDecl): AgentRun {
    const childCompiled = validate(sub.agent);
    return new AgentRun(this.session, childCompiled, this);
  }

  /**
   * Spawn a child AgentRun against a CompiledAgent that was synthesized at runtime
   * (e.g. by side-quest dispatch). Caller is responsible for compiling/validating.
   */
  spawnRuntimeChild(compiled: CompiledAgent): AgentRun {
    return new AgentRun(this.session, compiled, this);
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
      let initialInput = serializeInput(input);

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
