import type { JSONSchema } from "../schema/index.js";

/**
 * Discriminated union of every event the framework emits on the trace bus.
 *
 * Subscribe via `Hooks.trace`. Use {@link createTracer} for
 * a pre-built NDJSON/text sink. Events always include `ts` (ms epoch) and a
 * `type` discriminator; the remaining fields depend on the variant.
 *
 * Categories:
 *  - `agent.*` — lifecycle of a single AgentRun (top-level or sub-agent)
 *  - `phase.*` — phase boundaries, model utterances, nudges, external termination
 *  - `model.turn` — every model/tool turn (mostly for low-level transcripts)
 *  - `tool.*` — tool dispatch, results, errors, and incremental progress
 *  - `deliverable.rejected` — a phase's payload failed its schema and is being retried
 *  - `checklist.*` — checklist runs and outcomes
 *  - `review.*` — human-review chat for `phase.review = true`
 *  - `askUser` — host user prompts (queued FIFO)
 *  - `budget.*` — turn-budget exhaustion and host-granted extensions
 *  - `delegate.*` / `contract.*` — coordinator delegation batches and the children they contract
 *  - `sideQuest.*` — agent-proposed side quests (catalog approval flow)
 *  - `fork.created` — `Session.fork` lineage marker
 *  - `cancelled` — session/run cancellation
 */
export type TraceEvent =
  | { type: "agent.start"; agent: string; runId: string; parentRunId: string | null; input: unknown; ts: number }
  | { type: "agent.end"; agent: string; runId: string; output: unknown; ts: number }
  | { type: "agent.error"; agent: string; runId: string; error: string; ts: number }
  | { type: "phase.start"; agent: string; phase: string; runId: string; ts: number }
  | { type: "phase.end"; agent: string; phase: string; runId: string; deliverable: unknown; ts: number }
  | { type: "model.turn"; agent: string; phase: string; runId: string; turn: unknown; ts: number }
  | { type: "tool.call"; agent: string; phase: string; runId: string; tool: string; input: unknown; callId: string; ts: number }
  | { type: "tool.result"; agent: string; phase: string; runId: string; tool: string; output: unknown; callId: string; ts: number }
  | { type: "tool.error"; agent: string; phase: string; runId: string; tool: string; error: string; callId: string; ts: number }
  | { type: "tool.event"; agent: string; phase: string; runId: string; tool: string; callId: string; payload: unknown; ts: number }
  | { type: "phase.assistantText"; agent: string; phase: string; runId: string; text: string; ts: number }
  | { type: "deliverable.rejected"; agent: string; phase: string; runId: string; attempt: number; errors: readonly string[]; ts: number }
  | { type: "phase.nudged"; agent: string; phase: string; runId: string; text: string; ts: number }
  | { type: "phase.externalTerminated"; agent: string; phase: string; runId: string; ts: number }
  | { type: "checklist.run"; agent: string; phase: string; runId: string; result: unknown; ts: number }
  | { type: "checklist.failed"; agent: string; phase: string; runId: string; failures: unknown; ts: number }
  | { type: "review.start"; agent: string; phase: string; runId: string; deliverable: unknown; ts: number }
  | { type: "review.message"; agent: string; phase: string; runId: string; from: "user" | "agent"; text: string; ts: number }
  | { type: "review.approved"; agent: string; phase: string; runId: string; ts: number }
  | { type: "askUser"; agent: string; phase: string; runId: string; prompt: string; options: readonly string[]; result: unknown; ts: number }
  | { type: "budget.exhausted"; agent: string; phase: string; runId: string; limit: "phase" | "run"; ts: number }
  | { type: "budget.extended"; agent: string; phase: string; runId: string; by: number; limit: "phase" | "run"; ts: number }
  | { type: "sideQuest.proposed"; agent: string; phase: string; runId: string; goal: string; rationale: string; requestedTools: readonly string[]; ts: number }
  | { type: "sideQuest.declined"; agent: string; phase: string; runId: string; reason: string; ts: number }
  | { type: "sideQuest.approved"; agent: string; phase: string; runId: string; approvedTools: readonly string[]; ts: number }
  | { type: "delegate.batch"; agent: string; phase: string; runId: string; contracts: readonly { childAgent: string; objective: string; turns: number; writeSet: readonly string[] }[]; waves: number; ts: number }
  | { type: "delegate.rejected"; agent: string; phase: string; runId: string; problems: readonly { index: number; childAgent: string; reason: string }[]; ts: number }
  | { type: "contract.start"; agent: string; phase: string; runId: string; parentRunId: string; childAgent: string; objective: string; turns: number; ts: number }
  | { type: "contract.end"; agent: string; phase: string; runId: string; parentRunId: string; childAgent: string; ts: number }
  | { type: "contract.accepted"; agent: string; phase: string; runId: string; childAgent: string; objective: string; reason: string; attempt: number; ts: number }
  | { type: "contract.rejected"; agent: string; phase: string; runId: string; childAgent: string; objective: string; reason: string; attempt: number; ts: number }
  | { type: "contract.abandoned"; agent: string; phase: string; runId: string; childAgent: string; objective: string; reason: string; attempt: number; ts: number }
  | { type: "contract.blocked"; agent: string; phase: string; runId: string; childAgent: string; objective: string; reason: string; attempt: number; ts: number }
  | { type: "fork.created"; parentSessionId: string; childSessionId: string; seed: "deliverable" | "summarize"; ts: number }
  | { type: "cancelled"; runId: string; reason: string; ts: number };

/**
 * Subscriber signature for the trace bus. Set as `Hooks.trace` on a `Session`
 * to receive every framework event.
 */
export type TraceCallback = (event: TraceEvent) => void;

// Distributive Omit so each variant of TraceEvent stays intact.
type WithoutTs<T> = T extends unknown ? Omit<T, "ts"> : never;

/**
 * Internal bus that timestamps and dispatches {@link TraceEvent}s to the host's
 * {@link TraceCallback}. Exceptions thrown by the callback are swallowed so
 * tracing never breaks a run.
 *
 * Hosts almost never construct this directly — set `Hooks.trace` instead.
 */
export class TraceBus {
  constructor(private cb: TraceCallback) {}

  /** Emit an event. The bus adds `ts` automatically; pass the rest as-is. */
  emit(event: WithoutTs<TraceEvent>): void {
    const withTs = { ...event, ts: Date.now() } as TraceEvent;
    try {
      this.cb(withTs);
    } catch {
      // Trace failures must not break the run.
    }
  }
}

// Re-exported for convenience in declarations that reference schemas.
export type { JSONSchema };
