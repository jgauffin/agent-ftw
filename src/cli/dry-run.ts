/**
 * `agent-ftw dry-run`: run the whole pipeline with values built from the
 * schemas instead of a model.
 *
 * What this proves is everything that is not the model: that phases hand off in
 * the order declared, that deliverable schemas can be satisfied at all, that
 * tool handlers run, that `accept` predicates return what the parent expects,
 * and that the budgets add up. What it cannot prove is whether a model would
 * produce anything sensible, and it does not pretend to.
 */

import { describeAgent, type AgentSummary } from "../inspect/describe.js";
import {
  callableTools,
  dryRunAdapter,
  stripAdapters,
  type SynthesisNote,
  type ToolPolicy,
} from "../inspect/dry-run.js";
import { Session } from "../runtime/session.js";
import type { TraceEvent } from "../trace/index.js";
import type { FoundAgent } from "./load.js";

export interface DryRunOptions {
  readonly tools?: ToolPolicy;
  /** Deliverables to use instead of synthesized ones, keyed by phase-end tool name. */
  readonly deliverables?: Readonly<Record<string, unknown>>;
  /** Value handed to the first phase. */
  readonly input?: unknown;
  readonly maxDepth?: number;
  /** Ceiling for the whole run tree. Keeps a misdeclared pipeline from spinning. */
  readonly turnBudget?: number;
}

/** One phase that actually ran, in the order it ended. */
export interface PhaseRecord {
  readonly agent: string;
  readonly phase: string;
  readonly runId: string;
  readonly deliverable: unknown;
}

/** A deliverable the framework refused. The schema could not be satisfied as written. */
export interface RejectionRecord {
  readonly agent: string;
  readonly phase: string;
  readonly attempt: number;
  readonly errors: readonly string[];
}

export interface ToolRecord {
  readonly agent: string;
  readonly phase: string;
  readonly tool: string;
  readonly error: string | null;
}

export interface DryRunReport {
  readonly file: string;
  readonly exportName: string;
  readonly agent: string;
  readonly ok: boolean;
  readonly error: string | null;
  readonly output: unknown;
  readonly phases: readonly PhaseRecord[];
  readonly toolCalls: readonly ToolRecord[];
  readonly rejections: readonly RejectionRecord[];
  /** Schemas that did not say enough to build a value from. */
  readonly gaps: readonly SynthesisNote[];
  /** Tools the policy allowed the run to call. */
  readonly calledUnderPolicy: readonly string[];
  readonly tools: ToolPolicy;
}

export async function dryRun(
  file: string,
  found: FoundAgent,
  opts: DryRunOptions = {}
): Promise<DryRunReport> {
  const policy = opts.tools ?? "none";
  // A phase carrying its own adapter would otherwise reach a real model, which
  // is the one thing a dry run must not do.
  const decl = stripAdapters(found.decl);
  const compileOpts = opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {};
  const summary: AgentSummary = describeAgent(decl, compileOpts);
  const allowed = callableTools(summary, policy);

  const notes: SynthesisNote[] = [];
  const phases: PhaseRecord[] = [];
  const toolCalls: ToolRecord[] = [];
  const rejections: RejectionRecord[] = [];

  const adapter = dryRunAdapter({
    callTools: allowed,
    ...(opts.deliverables ? { deliverables: opts.deliverables } : {}),
    onSynthesis: (n) => notes.push(n),
  });

  const session = new Session({
    agent: decl,
    defaultAdapter: adapter,
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(opts.turnBudget !== undefined ? { turnBudget: opts.turnBudget } : {}),
    hooks: {
      // The first option is the only deterministic answer available; a dry run
      // has no user to ask and must not block.
      askUser: async (input) => {
        const first = input.options?.[0];
        return first !== undefined ? { selected: [first] } : { selected: [], other: "<dry run>" };
      },
      // Resolving is approval. A review that hung would stall the run.
      review: async () => {},
      trace: (e) => record(e, phases, toolCalls, rejections),
    },
  });

  try {
    const output = await session.run(opts.input ?? "<dry run>");
    return {
      file,
      exportName: found.exportName,
      agent: decl.name,
      ok: true,
      error: null,
      output,
      phases,
      toolCalls,
      rejections,
      gaps: notes.filter((n) => n.gaps.length > 0),
      calledUnderPolicy: allowed,
      tools: policy,
    };
  } catch (e) {
    return {
      file,
      exportName: found.exportName,
      agent: decl.name,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      output: undefined,
      phases,
      toolCalls,
      rejections,
      gaps: notes.filter((n) => n.gaps.length > 0),
      calledUnderPolicy: allowed,
      tools: policy,
    };
  } finally {
    await session.dispose();
  }
}

function record(
  e: TraceEvent,
  phases: PhaseRecord[],
  toolCalls: ToolRecord[],
  rejections: RejectionRecord[]
): void {
  switch (e.type) {
    case "phase.end":
      phases.push({ agent: e.agent, phase: e.phase, runId: e.runId, deliverable: e.deliverable });
      return;
    case "tool.result":
      toolCalls.push({ agent: e.agent, phase: e.phase, tool: e.tool, error: null });
      return;
    case "tool.error":
      toolCalls.push({ agent: e.agent, phase: e.phase, tool: e.tool, error: e.error });
      return;
    case "deliverable.rejected":
      rejections.push({ agent: e.agent, phase: e.phase, attempt: e.attempt, errors: e.errors });
      return;
    default:
      return;
  }
}
