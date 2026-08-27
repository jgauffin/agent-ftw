/**
 * Turns the framework's host hooks into request/response messages over IPC.
 *
 * `askUser`, `review` and `requestBudgetExtension` are the three points where
 * the framework stops and waits for a person. Every example in the repo
 * auto-answers them, which means the one thing they exist for has never been
 * exercised by a real UI. Here each becomes a pending promise the panel
 * resolves.
 */

import type { BudgetRequest, FromRunner, ToRunner, TraceEnvelope } from "../protocol.js";

type Send = (msg: FromRunner) => void;

interface PendingAsk {
  readonly kind: "ask";
  resolve(result: { selected: readonly string[]; other?: string }): void;
}

interface PendingReview {
  readonly kind: "review";
  /** Re-runs the phase with a user message and returns the revised deliverable. */
  requestRevision(message: string): Promise<unknown>;
  /** Resolving the review hook is what signals approval. */
  approve(): void;
  reject(error: Error): void;
}

interface PendingBudget {
  readonly kind: "budget";
  resolve(response: { extendBy: number } | { deny: true }): void;
}

type Pending = PendingAsk | PendingReview | PendingBudget;

export class Bridge {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor(private readonly send: Send) {}

  /** Host hooks to hand to `new Session({ hooks })`. */
  hooks(): Record<string, unknown> {
    return {
      askUser: (input: AskInput, ctx: AgentPhase) => this.askUser(input, ctx),
      review: (deliverable: unknown, ctx: ReviewCtxLike) => this.review(deliverable, ctx),
      requestBudgetExtension: (req: BudgetRequestLike) => this.requestBudgetExtension(req),
      trace: (event: Record<string, unknown>) => this.send({ t: "trace", event: envelope(event) }),
    };
  }

  /** Route a reply from the panel. Unknown ids are stale (run cancelled) and ignored. */
  handle(msg: ToRunner): void {
    switch (msg.t) {
      case "askResult": {
        const p = this.take(msg.id, "ask");
        p?.resolve(msg.other !== undefined ? { selected: msg.selected, other: msg.other } : { selected: msg.selected });
        return;
      }
      case "budgetResult": {
        const p = this.take(msg.id, "budget");
        p?.resolve(msg.extendBy === null ? { deny: true } : { extendBy: msg.extendBy });
        return;
      }
      case "reviewApprove": {
        const p = this.take(msg.id, "review");
        p?.approve();
        return;
      }
      case "reviewRevise": {
        // Stays pending: a review is a conversation, not one question.
        const p = this.peek(msg.id, "review");
        if (!p) return;
        void p
          .requestRevision(msg.message)
          .then((deliverable) => this.send({ t: "reviewRevised", id: msg.id, deliverable }))
          .catch((e: unknown) => {
            this.pending.delete(msg.id);
            p.reject(e instanceof Error ? e : new Error(String(e)));
          });
        return;
      }
      default:
        return;
    }
  }

  /** Fail every waiting prompt. Called when the run is cancelled or dies. */
  abandon(reason: string): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (p.kind === "review") p.reject(new Error(reason));
      else if (p.kind === "ask") p.resolve({ selected: [] });
      else p.resolve({ deny: true });
    }
  }

  private askUser(input: AskInput, ctx: AgentPhase): Promise<{ selected: readonly string[]; other?: string }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { kind: "ask", resolve });
      this.send({
        t: "ask",
        id,
        prompt: input.prompt,
        options: input.options ?? [],
        mode: input.mode ?? "single",
        agent: ctx.agent,
        phase: ctx.phase,
      });
    });
  }

  private review(deliverable: unknown, ctx: ReviewCtxLike): Promise<void> {
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, {
        kind: "review",
        requestRevision: (m) => ctx.requestRevision(m),
        approve: resolve,
        reject,
      });
      this.send({ t: "review", id, deliverable, agent: ctx.agent, phase: ctx.phase });
    });
  }

  private requestBudgetExtension(req: BudgetRequestLike): Promise<{ extendBy: number } | { deny: true }> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, { kind: "budget", resolve });
      this.send({ t: "budget", id, request: budgetRequest(req) });
    });
  }

  private take<K extends Pending["kind"]>(id: number, kind: K): Extract<Pending, { kind: K }> | null {
    const p = this.peek(id, kind);
    if (p) this.pending.delete(id);
    return p;
  }

  private peek<K extends Pending["kind"]>(id: number, kind: K): Extract<Pending, { kind: K }> | null {
    const p = this.pending.get(id);
    if (!p || p.kind !== kind) return null;
    return p as Extract<Pending, { kind: K }>;
  }
}

interface AskInput {
  readonly prompt: string;
  readonly options?: readonly string[];
  readonly mode?: "single" | "multi";
}

interface AgentPhase {
  readonly agent: string;
  readonly phase: string;
}

interface ReviewCtxLike extends AgentPhase {
  requestRevision(message: string): Promise<unknown>;
}

interface BudgetRequestLike {
  readonly agent: string;
  readonly phase: string;
  readonly runId: string;
  readonly depth: number;
  readonly limit: "phase" | "run";
  readonly originalBudget: number;
  readonly turnsUsed: number;
  readonly extensionsGranted: number;
  readonly suggestedExtension: number;
  readonly recentActivity: {
    readonly lastAssistantText?: string;
    readonly recentToolCalls: ReadonlyArray<{ readonly name: string; readonly inputSummary: string }>;
  };
}

function budgetRequest(req: BudgetRequestLike): BudgetRequest {
  return {
    agent: req.agent,
    phase: req.phase,
    runId: req.runId,
    depth: req.depth,
    limit: req.limit,
    originalBudget: req.originalBudget,
    turnsUsed: req.turnsUsed,
    extensionsGranted: req.extensionsGranted,
    suggestedExtension: req.suggestedExtension,
    ...(req.recentActivity.lastAssistantText !== undefined
      ? { lastAssistantText: req.recentActivity.lastAssistantText }
      : {}),
    recentToolCalls: req.recentActivity.recentToolCalls,
  };
}

/**
 * Splits a trace event into the fields the studio groups by and everything
 * else. The union has more than thirty variants and gains more with each
 * feature; the panel renders by `type` and nests by `runId`, so binding to the
 * full union would mean editing the studio every time the library grows one.
 */
export function envelope(event: Record<string, unknown>): TraceEnvelope {
  const { type, ts, runId, agent, phase, ...detail } = event;
  return {
    type: String(type),
    ts: typeof ts === "number" ? ts : 0,
    ...(typeof runId === "string" ? { runId } : {}),
    ...(typeof agent === "string" ? { agent } : {}),
    ...(typeof phase === "string" ? { phase } : {}),
    detail,
  };
}
