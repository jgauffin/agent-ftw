import type { CompiledPhase } from "../compile/index.js";
import type { AgentRun } from "./agent-run.js";
import type { Adapter, RunContext, Turn, ToolSpec, PersistenceCtx } from "../adapters/types.js";
import { TurnBudgetExhausted } from "../adapters/types.js";
import { dispatchTool } from "./dispatch.js";
import { validateAgainstSchema as validateSchema } from "../schema/index.js";
import type { PhaseTerminator } from "../declare/index.js";
import { DEFAULT_TURN_BUDGET } from "../declare/index.js";
import type { BudgetExtensionRecentActivity } from "../hooks/index.js";
import type { SessionStore } from "./session-store.js";

const MAX_DELIVERABLE_ATTEMPTS = 3;
const RECENT_TOOL_CALLS_MAX = 5;
const TOOL_INPUT_SUMMARY_MAX = 200;

export class PhaseRun {
  private remaining: number;
  private readonly originalBudget: number;
  private extensionsGranted = 0;
  /** Which ceiling raised the most recent exhaustion, so a grant lands on it. */
  private exhaustedBy: "phase" | "run" = "phase";
  private conversation: Turn[] = [];
  private systemPrompt: string;
  private toolSpecs: ToolSpec[];
  /** Adapter driving this phase's model loop: the phase's own override, else the agent's. */
  private readonly adapter: Adapter;

  constructor(
    private readonly agentRun: AgentRun,
    private readonly phase: CompiledPhase,
    private readonly prevDeliverables: ReadonlyMap<string, unknown>,
    private readonly store: SessionStore | undefined = undefined
  ) {
    this.adapter = phase.decl.adapter ?? agentRun.effectiveAdapter;
    this.originalBudget = phase.decl.turnBudget ?? DEFAULT_TURN_BUDGET;
    this.remaining = this.originalBudget;
    this.systemPrompt = this.buildSystemPrompt();
    this.toolSpecs = phase.exposedTools.map((t) => ({
      name: t.name,
      description: t.kind === "subAgent" ? `${t.description} [sub-agent]` : t.description,
      input: t.input,
    }));
  }

  async execute(initialInput: string): Promise<unknown> {
    try {
      return await this.executeInner(initialInput);
    } finally {
      // Persist any in-flight transcript writes before the phase truly exits,
      // whether successful or throwing. Without this the test harness (and a
      // process that's crashing for real) can lose the last turn.
      await this.flushSaves();
    }
  }

  private async executeInner(initialInput: string): Promise<unknown> {
    const { phase, agentRun } = this;
    agentRun.bus.emit({
      type: "phase.start",
      agent: agentRun.agentName,
      phase: phase.decl.name,
      runId: agentRun.runId,
    });

    // If persisted conversation exists for this phase, resume from it. The
    // caller-provided initialInput is suppressed because we already have the
    // prior turns in flight — feeding it again would duplicate the user message.
    let resumeInput = initialInput;
    if (this.store) {
      const meta = await this.store.loadMeta();
      this.adapterMetaCache = meta?.adapterMeta;
      const stored = await this.store.loadPhaseConversation(phase.decl.name);
      if (stored && stored.length > 0) {
        this.conversation = sanitizeForResume([...stored]);
        if (this.conversation.length !== stored.length) {
          // Persist the sanitized form so the adapter sees a valid prefix.
          await this.store.savePhaseConversation(phase.decl.name, this.conversation);
        }
        resumeInput = "";
      }
    }

    let payload = await this.runLoop(resumeInput);
    payload = await this.ensureValidDeliverable(payload);

    if (phase.decl.checklist) {
      payload = await this.runChecklist(payload);
    }

    if (phase.decl.review && agentRun.isTopLevel) {
      payload = await this.runReview(payload);
    }

    agentRun.bus.emit({
      type: "phase.end",
      agent: agentRun.agentName,
      phase: phase.decl.name,
      runId: agentRun.runId,
      deliverable: payload,
    });
    return payload;
  }

  private buildSystemPrompt(): string {
    const { phase, agentRun, prevDeliverables } = this;
    const parts: string[] = [
      `Agent: ${agentRun.agentName}`,
      `Phase: ${phase.decl.name}`,
      "",
      phase.decl.prompt,
    ];
    if (prevDeliverables.size > 0) {
      parts.push("", "Prior phase deliverables:");
      for (const [name, value] of prevDeliverables) {
        parts.push(`  ${name}: ${JSON.stringify(value)}`);
      }
    }
    if (!phase.hasExternalTerminator) {
      parts.push(
        "",
        `When the deliverable is ready, call ${phase.phaseEndToolName} with the structured payload.`
      );
    }
    return parts.join("\n");
  }

  private async runLoop(newUserText: string): Promise<unknown> {
    const terminator: PhaseTerminator = this.phase.decl.terminator ?? { kind: "tool" };

    while (true) {
      try {
        if (terminator.kind === "external") {
          return await this.runExternal(newUserText, terminator);
        }
        const ctx = this.buildRunContext(newUserText, this.agentRun.signal);
        const result = await this.adapter.runUntilPhaseEnd(ctx);
        this.conversation = [...result.conversation];
        return result.payload;
      } catch (e) {
        if (e instanceof TurnBudgetExhausted && (await this.askExtendBudget())) continue;
        throw e;
      }
    }
  }

  private buildRunContext(newUserText: string, signal: AbortSignal): RunContext {
    // Mutable holder so we can mirror conversation state into persistence after
    // every turn. The adapter pushes onto its own array; we observe via onTurn
    // and snapshot ours from this.conversation when the adapter has appended.
    const persistence = this.buildPersistenceCtx();
    const ctx: RunContext = {
      systemPrompt: this.systemPrompt,
      conversation: this.conversation,
      newUserText,
      tools: this.toolSpecs,
      phaseEndToolName: this.phase.phaseEndToolName,
      signal,
      dispatchTool: (name, input, callId) =>
        dispatchTool({ agentRun: this.agentRun, phase: this.phase, name, input, callId }),
      onTurn: (turn) => {
        this.recordTurn(turn);
        this.agentRun.bus.emit({
          type: "model.turn",
          agent: this.agentRun.agentName,
          phase: this.phase.decl.name,
          runId: this.agentRun.runId,
          turn,
        });
      },
      consumeTurn: () => this.consumeTurn(),
      // Always supplied so the framework — not each adapter — owns what happens
      // when the model talks instead of calling a tool, and so the nudge is
      // visible on the trace bus either way.
      onAssistantText: (text) => this.handleAssistantText(text, signal),
      ...(persistence ? { persistence } : {}),
    };
    return ctx;
  }

  /**
   * The model emitted text with no tool calls. Hand it to the host's callback if
   * there is one, otherwise nudge it back into tool-calling. Either way the
   * event is traced: a phase that keeps talking instead of finishing is a signal
   * that its instructions never gave it a path to completion.
   */
  private async handleAssistantText(text: string, signal: AbortSignal): Promise<string> {
    const ctxArgs = {
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      signal,
    };
    const cb = this.phase.decl.onAssistantText;
    if (cb) {
      this.agentRun.bus.emit({
        type: "phase.assistantText",
        agent: ctxArgs.agent,
        phase: ctxArgs.phase,
        runId: ctxArgs.runId,
        text,
      });
      return await cb(text, ctxArgs);
    }

    this.agentRun.bus.emit({
      type: "phase.nudged",
      agent: ctxArgs.agent,
      phase: ctxArgs.phase,
      runId: ctxArgs.runId,
      text,
    });
    // With an external terminator the phase-end tool is not exposed, so naming
    // it would point the model at a tool it cannot call.
    return this.phase.hasExternalTerminator
      ? "You must call one of the available tools to make progress."
      : `You must call ${this.phase.phaseEndToolName} or another tool to make progress.`;
  }

  /**
   * External terminator: race the adapter loop against the host-supplied promise.
   * Whichever resolves first wins; the adapter is signalled to abort if the host
   * wins, but we don't block on it — adapters that don't honor the signal would
   * leak the run otherwise. The conversation built up by the adapter is
   * discarded; the deliverable comes from the host.
   */
  private async runExternal(
    newUserText: string,
    terminator: Extract<PhaseTerminator, { kind: "external" }>
  ): Promise<unknown> {
    const inner = new AbortController();
    const linked = linkSignals(this.agentRun.signal, inner.signal);
    const ctx = this.buildRunContext(newUserText, linked);

    type AdapterOutcome = { ok: true; payload: unknown } | { ok: false; error: unknown };
    const adapterBox: { value: AdapterOutcome | null } = { value: null };
    const adapterSettled = this.adapter.runUntilPhaseEnd(ctx).then(
      (r) => {
        adapterBox.value = { ok: true, payload: r.payload };
      },
      (e) => {
        adapterBox.value = { ok: false, error: e };
      }
    );

    let externalDone = false;
    let externalPayload: unknown;
    const externalSettled = terminator
      .await({
        agent: this.agentRun.agentName,
        phase: this.phase.decl.name,
        runId: this.agentRun.runId,
        signal: this.agentRun.signal,
      })
      .then((p) => {
        externalPayload = p;
        externalDone = true;
      });

    // Whichever settles first decides the outcome. `externalSettled` may reject
    // — let that propagate to the caller.
    await Promise.race([externalSettled, adapterSettled]);

    if (externalDone) {
      inner.abort();
      this.agentRun.bus.emit({
        type: "phase.externalTerminated",
        agent: this.agentRun.agentName,
        phase: this.phase.decl.name,
        runId: this.agentRun.runId,
      });
      return externalPayload;
    }

    // Adapter settled first. Surface its outcome.
    const outcome = adapterBox.value;
    if (outcome && outcome.ok) return outcome.payload;
    if (outcome) throw outcome.error;
    // Should be unreachable.
    throw new Error("phase external terminator: race resolved without a winner");
  }

  private buildPersistenceCtx(): PersistenceCtx | undefined {
    const store = this.store;
    if (!store) return undefined;
    return {
      sessionId: store.sessionId,
      agentName: store.agentName,
      phaseName: this.phase.decl.name,
      getAdapterMeta: (key) => this.adapterMetaCache?.[key],
      setAdapterMeta: async (key, value) => {
        const meta = await store.loadMeta();
        if (!meta) return;
        meta.adapterMeta[key] = value;
        await store.saveMeta(meta);
        this.adapterMetaCache = meta.adapterMeta;
      },
    };
  }

  private adapterMetaCache: Record<string, unknown> | undefined;

  private saveChain: Promise<void> = Promise.resolve();

  /** Mirror an adapter-emitted turn into our persisted conversation. */
  private recordTurn(turn: Turn): void {
    this.conversation.push(turn);
    if (this.store) {
      // Chain saves so we never write out of order, but don't block onTurn —
      // the adapter loop stays sync. `flushSaves()` at phase exit awaits the
      // tail so durability is guaranteed before we report the run finished
      // (or before the error propagates).
      const snapshot = [...this.conversation];
      const phaseName = this.phase.decl.name;
      const store = this.store;
      this.saveChain = this.saveChain.then(
        () => store.savePhaseConversation(phaseName, snapshot).catch(() => {})
      );
    }
  }

  /** Wait for any pending persistence writes to land. */
  async flushSaves(): Promise<void> {
    await this.saveChain;
  }

  /**
   * Two gates, both hard. The phase's own budget caps this loop; the session
   * ledger caps the entire run tree. A phase with turns left still stops when
   * the tree's pool is dry, which is what stops a nested agent tree from
   * spending without bound.
   */
  private consumeTurn(): void {
    if (this.remaining <= 0) this.raiseExhausted("phase");
    if (!this.agentRun.session.ledger.tryConsume(this.agentRun.runId)) {
      this.raiseExhausted("run");
    }
    this.remaining--;
  }

  private raiseExhausted(limit: "phase" | "run"): never {
    this.exhaustedBy = limit;
    this.agentRun.bus.emit({
      type: "budget.exhausted",
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      limit,
    });
    throw new TurnBudgetExhausted(limit);
  }

  private async askExtendBudget(): Promise<boolean> {
    // A contracted child tops up from its parent first, within the ceiling the
    // contract authorised up front. Only when that is spent does anyone get
    // asked, which keeps an overrun from becoming an open-ended negotiation.
    if (this.exhaustedBy === "run" && this.agentRun.tryTopUpFromParent(this.originalBudget)) {
      this.agentRun.bus.emit({
        type: "budget.extended",
        agent: this.agentRun.agentName,
        phase: this.phase.decl.name,
        runId: this.agentRun.runId,
        by: this.originalBudget,
        limit: "run",
      });
      return true;
    }

    const hook = this.agentRun.session.hooks.requestBudgetExtension;
    if (!hook) return false;

    const turnsUsed = this.originalBudget + this.extensionsGranted * this.originalBudget;
    const response = await hook({
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      depth: this.agentRun.depth,
      limit: this.exhaustedBy,
      originalBudget: this.originalBudget,
      turnsUsed,
      extensionsGranted: this.extensionsGranted,
      suggestedExtension: this.originalBudget,
      recentActivity: this.buildRecentActivity(),
      deliverableSchema: this.phase.decl.deliverable,
    });

    if ("deny" in response) return false;
    // Guard against pathological hook responses that would silently no-op the
    // exhaustion (e.g. extendBy: 0 or negative). Treat as a deny rather than
    // looping forever.
    if (!Number.isFinite(response.extendBy) || response.extendBy <= 0) return false;

    const by = Math.floor(response.extendBy);
    // The grant has to land on whichever ceiling actually bound: topping up the
    // phase when the run pool is dry would just exhaust again on the next turn.
    // Only a host grant adds to the run pool — nothing inside the run can.
    if (this.exhaustedBy === "run") {
      this.agentRun.session.ledger.grant(this.agentRun.runId, by);
    } else {
      this.remaining += by;
    }
    this.extensionsGranted++;
    this.agentRun.bus.emit({
      type: "budget.extended",
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      by,
      limit: this.exhaustedBy,
    });
    return true;
  }

  private buildRecentActivity(): BudgetExtensionRecentActivity {
    let lastAssistantText: string | undefined;
    const recentToolCalls: { name: string; inputSummary: string }[] = [];
    // Walk from the end so we collect the most recent items, then reverse the
    // tool calls so callers see chronological order.
    for (let i = this.conversation.length - 1; i >= 0; i--) {
      const t = this.conversation[i]!;
      if (t.role !== "assistant") continue;
      if (lastAssistantText === undefined && typeof t.text === "string" && t.text.length > 0) {
        lastAssistantText = t.text;
      }
      if (t.toolCalls) {
        // Iterate this turn's calls newest-first so the overall newest-first
        // ordering is preserved before we reverse.
        for (let j = t.toolCalls.length - 1; j >= 0; j--) {
          if (recentToolCalls.length >= RECENT_TOOL_CALLS_MAX) break;
          const c = t.toolCalls[j]!;
          recentToolCalls.push({
            name: c.name,
            inputSummary: summarizeToolInput(c.input),
          });
        }
      }
      if (lastAssistantText !== undefined && recentToolCalls.length >= RECENT_TOOL_CALLS_MAX) break;
    }
    return {
      ...(lastAssistantText !== undefined ? { lastAssistantText } : {}),
      recentToolCalls: recentToolCalls.reverse(),
    };
  }

  /**
   * A phase may not end on a payload that does not match its deliverable schema.
   * Each failure is fed back to the model as a correction request; after
   * MAX_DELIVERABLE_ATTEMPTS the phase fails loudly rather than passing a
   * malformed payload into the next phase's context, where the real cause would
   * be invisible.
   */
  private async ensureValidDeliverable(payload: unknown): Promise<unknown> {
    let current = payload;
    for (let attempt = 1; ; attempt++) {
      const v = validateSchema(this.phase.decl.deliverable, current);
      if (v.valid) return current;

      if (this.phase.hasExternalTerminator) {
        throw new Error(
          `phase "${this.phase.decl.name}" external terminator returned invalid deliverable: ${v.errors.join("; ")}`
        );
      }

      this.agentRun.bus.emit({
        type: "deliverable.rejected",
        agent: this.agentRun.agentName,
        phase: this.phase.decl.name,
        runId: this.agentRun.runId,
        attempt,
        errors: v.errors,
      });

      if (attempt >= MAX_DELIVERABLE_ATTEMPTS) {
        throw new Error(
          `phase "${this.phase.decl.name}" did not produce a valid deliverable after ` +
            `${MAX_DELIVERABLE_ATTEMPTS} attempts. Last errors: ${v.errors.join("; ")}`
        );
      }

      const feedback =
        `Your deliverable did not match the required schema. Errors:\n${v.errors.join("\n")}\n` +
        `Call ${this.phase.phaseEndToolName} again with a corrected payload.`;
      current = await this.runLoop(feedback);
    }
  }

  private async runChecklist(payload: unknown): Promise<unknown> {
    const cl = this.phase.decl.checklist!;
    // Checklist verification runs on its own adapter override if set, else the
    // phase's adapter.
    const checklistAdapter = cl.adapter ?? this.adapter;

    const userText = `${cl.prompt}\n\nDeliverable to check:\n${JSON.stringify(payload, null, 2)}`;
    const result = await checklistAdapter.runStructured({
      systemPrompt: "You are a checklist verifier. Reply with structured output only.",
      userText,
      schema: cl.schema,
      signal: this.agentRun.signal,
    });

    this.agentRun.bus.emit({
      type: "checklist.run",
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      result,
    });

    const failures = extractFailures(result);
    if (failures.length === 0) return payload;

    this.agentRun.bus.emit({
      type: "checklist.failed",
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      failures,
    });

    const feedback =
      `The deliverable failed verification. Failed checks:\n` +
      failures.map((f) => `- ${f.name}${f.evidence ? `: ${f.evidence}` : ""}`).join("\n") +
      `\nRevise the deliverable and call ${this.phase.phaseEndToolName} again.`;
    // One revision round, no re-check.
    let revised = await this.runLoop(feedback);
    revised = await this.ensureValidDeliverable(revised);
    return revised;
  }

  private async runReview(initial: unknown): Promise<unknown> {
    const hooks = this.agentRun.session.hooks;
    if (!hooks.review) return initial;

    let current = initial;
    this.agentRun.bus.emit({
      type: "review.start",
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
      deliverable: current,
    });

    await hooks.review(current, {
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      requestRevision: async (userMessage: string): Promise<unknown> => {
        this.agentRun.bus.emit({
          type: "review.message",
          agent: this.agentRun.agentName,
          phase: this.phase.decl.name,
          runId: this.agentRun.runId,
          from: "user",
          text: userMessage,
        });
        let revised = await this.runLoop(userMessage);
        revised = await this.ensureValidDeliverable(revised);
        current = revised;
        this.agentRun.bus.emit({
          type: "review.message",
          agent: this.agentRun.agentName,
          phase: this.phase.decl.name,
          runId: this.agentRun.runId,
          from: "agent",
          text: JSON.stringify(revised),
        });
        return revised;
      },
    });

    this.agentRun.bus.emit({
      type: "review.approved",
      agent: this.agentRun.agentName,
      phase: this.phase.decl.name,
      runId: this.agentRun.runId,
    });
    return current;
  }
}

interface CheckResult {
  name: string;
  passed: boolean;
  evidence?: string;
}

function extractFailures(result: unknown): CheckResult[] {
  const checks = (result as { checks?: unknown } | null)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks
    .map(parseFailedCheck)
    .filter((c): c is CheckResult => c !== null);
}

function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const ac = new AbortController();
  const onAbort = (): void => ac.abort();
  if (a.aborted) ac.abort();
  else a.addEventListener("abort", onAbort, { once: true });
  if (b.aborted) ac.abort();
  else b.addEventListener("abort", onAbort, { once: true });
  return ac.signal;
}

/**
 * Trim a loaded conversation so the next adapter call sees a coherent prefix.
 * After a crash mid-dispatch we may have an assistant turn whose tool_calls
 * don't all have matching tool results. Most tool-calling APIs reject that.
 * Drop the offending assistant turn (and any partial results after it) — the
 * model will continue cleanly from the prior boundary.
 */
function sanitizeForResume(conv: Turn[]): Turn[] {
  if (conv.length === 0) return conv;
  let assistantIdx = -1;
  for (let i = conv.length - 1; i >= 0; i--) {
    const t = conv[i]!;
    if (t.role === "assistant" && t.toolCalls && t.toolCalls.length > 0) {
      assistantIdx = i;
      break;
    }
    if (t.role === "user" || t.role === "assistant") return conv; // stable tail
  }
  if (assistantIdx < 0) return conv;
  const assistant = conv[assistantIdx] as Extract<Turn, { role: "assistant" }>;
  const wantedIds = new Set((assistant.toolCalls ?? []).map((c) => c.id));
  const seen = new Set<string>();
  for (let i = assistantIdx + 1; i < conv.length; i++) {
    const t = conv[i]!;
    if (t.role === "tool") seen.add(t.toolCallId);
  }
  for (const id of wantedIds) {
    if (!seen.has(id)) return conv.slice(0, assistantIdx);
  }
  return conv;
}

function summarizeToolInput(input: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(input);
  } catch {
    s = String(input);
  }
  if (s === undefined) s = String(input);
  if (s.length <= TOOL_INPUT_SUMMARY_MAX) return s;
  return s.slice(0, TOOL_INPUT_SUMMARY_MAX - 1) + "…";
}

function parseFailedCheck(c: unknown): CheckResult | null {
  if (!c || typeof c !== "object") return null;
  const o = c as { name?: unknown; passed?: unknown; evidence?: unknown };
  if (typeof o.name !== "string" || o.passed !== false) return null;
  return {
    name: o.name,
    passed: false,
    ...(typeof o.evidence === "string" ? { evidence: o.evidence } : {}),
  };
}
