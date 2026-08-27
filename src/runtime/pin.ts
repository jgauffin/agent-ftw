import { SessionStore } from "./session-store.js";
import type { SessionMeta } from "./session-store.js";

/**
 * Arguments for {@link pinDeliverables}.
 */
export interface PinOptions {
  /** Same directory the Session will be given as `sessionDirectory`. */
  readonly directory: string;
  /** Agent whose phases these are. Must match the agent that will run. */
  readonly agentName: string;
  /** Id to give the prepared session. Pass the same one to `new Session({ sessionId })`. */
  readonly sessionId: string;
  /**
   * Deliverables to treat as already produced, keyed by phase name.
   *
   * Only phases the agent actually declares are honoured, and a phase is
   * skipped only if every phase before it is pinned too: the run resumes at a
   * boundary rather than skipping a hole in the middle.
   */
  readonly deliverables: Readonly<Record<string, unknown>>;
}

/**
 * Prepare a session that starts partway through an agent, with earlier phases
 * already answered.
 *
 * Designing a phase means running it repeatedly, and each run otherwise pays
 * for every phase before it again. The pieces to avoid that already exist:
 * a run with persistence enabled skips any phase whose deliverable is stored,
 * emitting its cached `phase.start`/`phase.end` so the trace stays whole. This
 * writes that state directly instead of requiring a previous run to have
 * produced it, which also means a pinned deliverable can be edited first to ask
 * what a later phase does with different input.
 *
 * Pass `sessionId` to `new Session({ sessionDirectory, sessionId })` and the
 * next `run()` starts at the first unpinned phase.
 *
 * @returns The phase names that were pinned, in the order they were written.
 */
export async function pinDeliverables(opts: PinOptions): Promise<readonly string[]> {
  const store = new SessionStore(opts.directory, opts.agentName, opts.sessionId);
  const pinned = Object.keys(opts.deliverables);

  const now = Date.now();
  const meta: SessionMeta = {
    sessionId: opts.sessionId,
    agentName: opts.agentName,
    createdAt: now,
    updatedAt: now,
    // Not "complete": the point is that a run still has phases left to do.
    status: "running",
    completedPhases: [...pinned],
    currentPhase: null,
    adapterMeta: {},
  };

  await store.initIfMissing();
  await store.saveMeta(meta);
  for (const [phase, payload] of Object.entries(opts.deliverables)) {
    await store.saveDeliverable(phase, payload);
  }

  return pinned;
}
