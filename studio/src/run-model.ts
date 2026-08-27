/**
 * Folds a trace stream into the shape the timeline renders.
 *
 * The framework emits a flat sequence of events, but a run is a tree: a
 * coordinator's children and a phase's sub-agents interleave in time and only
 * `runId` says which is which. `runId` is a path (`root`, `root.2`,
 * `root.2.1`), so the tree is recoverable from the stream alone, which is what
 * this does.
 *
 * The counters are the point. A phase that took four attempts to produce a
 * valid deliverable, or that spent half its budget being nudged, is a phase
 * whose schema or prompt is wrong; neither shows up in the final output.
 */

import type { TraceEnvelope } from "./protocol.js";

export type PhaseStatus = "running" | "done" | "failed";
export type RunStatusKind = "running" | "done" | "failed" | "cancelled";

/** One phase execution, with the diagnostics that explain how it went. */
export interface PhaseRun {
  readonly phase: string;
  readonly runId: string;
  status: PhaseStatus;
  /** Model turns consumed. Compare against the phase's declared budget. */
  turns: number;
  /**
   * How many payloads the model offered before one validated. 1 is the happy
   * path; more means the deliverable schema and the prompt disagree about what
   * the phase produces.
   */
  deliverableAttempts: number;
  /** Schema errors per rejected attempt, oldest first. */
  rejections: string[][];
  /** Turns where the model talked instead of calling a tool. */
  nudges: number;
  toolCalls: number;
  toolErrors: number;
  checklistFailures: number;
  budgetExhausted: boolean;
  budgetExtendedBy: number;
  /**
   * Tool the phase is inside right now, if any.
   *
   * A handler that takes a while is otherwise indistinguishable from a model
   * that is taking a while, and they are fixed in different places.
   */
  pendingTool: string | null;
  /** True when the phase was replayed from a persisted deliverable rather than run. */
  cached: boolean;
  deliverable: unknown;
  readonly startedAt: number;
  endedAt: number | null;
  readonly events: TraceEnvelope[];
}

/** One agent execution: the root, a sub-agent call, or a delegation contract. */
export interface AgentRun {
  readonly runId: string;
  readonly parentRunId: string | null;
  readonly agent: string;
  /** Distance from the root, derived from the runId path. */
  readonly depth: number;
  status: RunStatusKind;
  /** Set when this run was started by a coordinator's contract. */
  objective: string | null;
  error: string | null;
  readonly phases: PhaseRun[];
  readonly startedAt: number;
  endedAt: number | null;
}

export class RunModel {
  private readonly runs = new Map<string, AgentRun>();
  /** Insertion order, so the timeline reads chronologically rather than by id. */
  private readonly order: string[] = [];
  private readonly loose: TraceEnvelope[] = [];

  /** Runs in the order they started. Children follow their parents naturally. */
  get all(): readonly AgentRun[] {
    return this.order.map((id) => this.runs.get(id)!).filter(Boolean);
  }

  /** Events that belong to no run: `fork.created`, session-level `cancelled`. */
  get sessionEvents(): readonly TraceEnvelope[] {
    return this.loose;
  }

  get root(): AgentRun | null {
    return this.runs.get("root") ?? null;
  }

  reset(): void {
    this.runs.clear();
    this.order.length = 0;
    this.loose.length = 0;
  }

  apply(e: TraceEnvelope): void {
    if (e.type === "agent.start") {
      this.startRun(e);
      return;
    }

    const run = e.runId ? this.runs.get(e.runId) : undefined;
    if (!run) {
      this.loose.push(e);
      return;
    }

    switch (e.type) {
      case "agent.end":
        run.status = "done";
        run.endedAt = e.ts;
        return;
      case "agent.error":
        run.status = "failed";
        run.error = String(e.detail.error ?? "");
        run.endedAt = e.ts;
        return;
      case "cancelled":
        run.status = "cancelled";
        run.endedAt = e.ts;
        return;
      case "contract.start":
        // Emitted on the parent's runId but describes the child about to start.
        this.pendingObjectives.set(String(e.detail.runId ?? ""), String(e.detail.objective ?? ""));
        return;
      case "phase.start":
        this.startPhase(run, e);
        return;
      default:
        this.applyToPhase(run, e);
    }
  }

  /** A contract's objective arrives before the child run it describes. */
  private readonly pendingObjectives = new Map<string, string>();

  private startRun(e: TraceEnvelope): void {
    const runId = e.runId ?? "root";
    if (this.runs.has(runId)) return;
    const parentRunId = typeof e.detail.parentRunId === "string" ? e.detail.parentRunId : null;
    const run: AgentRun = {
      runId,
      parentRunId,
      agent: e.agent ?? "",
      depth: runId.split(".").length - 1,
      status: "running",
      objective: this.pendingObjectives.get(runId) ?? null,
      error: null,
      phases: [],
      startedAt: e.ts,
      endedAt: null,
    };
    this.pendingObjectives.delete(runId);
    this.runs.set(runId, run);
    this.order.push(runId);
  }

  private startPhase(run: AgentRun, e: TraceEnvelope): void {
    run.phases.push({
      phase: e.phase ?? "",
      runId: run.runId,
      status: "running",
      turns: 0,
      deliverableAttempts: 1,
      rejections: [],
      nudges: 0,
      toolCalls: 0,
      toolErrors: 0,
      checklistFailures: 0,
      budgetExhausted: false,
      budgetExtendedBy: 0,
      pendingTool: null,
      cached: false,
      deliverable: undefined,
      startedAt: e.ts,
      endedAt: null,
      events: [e],
    });
  }

  private applyToPhase(run: AgentRun, e: TraceEnvelope): void {
    const phase = lastPhase(run, e.phase);
    if (!phase) {
      this.loose.push(e);
      return;
    }
    phase.events.push(e);

    switch (e.type) {
      case "phase.end":
        phase.status = "done";
        phase.endedAt = e.ts;
        phase.deliverable = e.detail.deliverable;
        // A resumed phase is replayed straight from its stored deliverable, so
        // it ends without ever having consumed a turn. Marking it keeps the
        // timeline from reading as "this phase was free".
        phase.cached = phase.turns === 0 && phase.events.length === 2;
        return;
      case "model.turn":
        phase.turns++;
        return;
      case "deliverable.rejected":
        phase.rejections.push(errorList(e.detail.errors));
        phase.deliverableAttempts = phase.rejections.length + 1;
        return;
      case "phase.nudged":
        phase.nudges++;
        return;
      case "tool.call":
        phase.toolCalls++;
        phase.pendingTool = typeof e.detail.tool === "string" ? e.detail.tool : null;
        return;
      case "tool.result":
        phase.pendingTool = null;
        return;
      case "tool.error":
        phase.toolErrors++;
        phase.pendingTool = null;
        return;
      case "checklist.failed":
        phase.checklistFailures++;
        return;
      case "budget.exhausted":
        phase.budgetExhausted = true;
        return;
      case "budget.extended":
        phase.budgetExtendedBy += typeof e.detail.by === "number" ? e.detail.by : 0;
        phase.budgetExhausted = false;
        return;
      default:
        return;
    }
  }
}

/**
 * Events name their phase, but a phase can run more than once in a run: a
 * review revision re-runs it. The live one is always the last started.
 */
function lastPhase(run: AgentRun, phaseName: string | undefined): PhaseRun | null {
  if (!phaseName) return run.phases[run.phases.length - 1] ?? null;
  for (let i = run.phases.length - 1; i >= 0; i--) {
    const p = run.phases[i];
    if (p && p.phase === phaseName) return p;
  }
  return null;
}

function errorList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/** Rolls a finished model up into the one-line verdict the panel headlines. */
export interface RunSummary {
  readonly phases: number;
  readonly turns: number;
  readonly rejectedDeliverables: number;
  readonly nudges: number;
  readonly toolErrors: number;
  readonly checklistFailures: number;
  readonly budgetExhaustions: number;
  readonly subAgentRuns: number;
}

export function summarize(model: RunModel): RunSummary {
  let phases = 0;
  let turns = 0;
  let rejectedDeliverables = 0;
  let nudges = 0;
  let toolErrors = 0;
  let checklistFailures = 0;
  let budgetExhaustions = 0;

  for (const run of model.all) {
    for (const p of run.phases) {
      phases++;
      turns += p.turns;
      rejectedDeliverables += p.rejections.length;
      nudges += p.nudges;
      toolErrors += p.toolErrors;
      checklistFailures += p.checklistFailures;
      if (p.budgetExhausted) budgetExhaustions++;
    }
  }

  return {
    phases,
    turns,
    rejectedDeliverables,
    nudges,
    toolErrors,
    checklistFailures,
    budgetExhaustions,
    subAgentRuns: Math.max(0, model.all.length - 1),
  };
}
