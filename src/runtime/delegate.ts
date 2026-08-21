import type { AgentRun } from "./agent-run.js";
import type { CompiledPhase } from "../compile/index.js";
import { withContractEnvelope } from "../compile/index.js";
import type {
  AcceptanceVerdict,
  AgentDecl,
  Contract,
  ContractEnvelope,
  DelegateDecl,
  Evidence,
  PhaseDecl,
  SubAgentDecl,
  ToolDecl,
} from "../declare/index.js";
import { tool, READ_ARTIFACT_TOOL_NAME } from "../declare/index.js";
import { validateAgainstSchema } from "../schema/index.js";
import type { JSONSchema } from "../schema/index.js";
import { TurnBudgetExhausted } from "../adapters/types.js";
import type { ArtifactStore } from "./artifact-store.js";

/** One contract that failed the batch check, with the reason the model needs. */
interface ContractProblem {
  readonly index: number;
  readonly childAgent: string;
  readonly reason: string;
}

/** A contract that passed the batch check, resolved against the declarations. */
interface PreparedContract {
  readonly index: number;
  readonly contract: Contract;
  readonly sub: SubAgentDecl;
  /** Child declaration narrowed to the granted tools. */
  readonly childDecl: AgentDecl;
  readonly writeSet: readonly string[] | undefined;
}

/**
 * Run a batch of delegation contracts.
 *
 * The batch is checked as a whole before any of it starts: turns must fit the
 * coordinator's remaining balance, grants must be within what it may hand
 * down, and write-sets decide what may run at the same time. A batch that does
 * not check out starts nothing and comes back with per-contract reasons, so the
 * model can correct rather than discover the problem halfway through.
 */
export async function runDelegate(
  decl: DelegateDecl,
  input: unknown,
  parent: AgentRun,
  phase: CompiledPhase
): Promise<unknown> {
  const contracts = readContracts(input);

  const check = checkBatch(contracts, decl, parent);
  if (!check.ok) {
    parent.bus.emit({
      type: "delegate.rejected",
      agent: parent.agentName,
      phase: phase.decl.name,
      runId: parent.runId,
      problems: check.problems,
    });
    return {
      accepted: false,
      problems: check.problems,
      hint: "Nothing ran. Fix every problem listed and call delegate again with the whole batch.",
    };
  }

  const waves = intoWaves(check.prepared);
  parent.bus.emit({
    type: "delegate.batch",
    agent: parent.agentName,
    phase: phase.decl.name,
    runId: parent.runId,
    contracts: check.prepared.map((p) => ({
      childAgent: p.contract.childAgent,
      objective: p.contract.objective,
      turns: p.contract.turns,
      writeSet: p.writeSet ?? [],
    })),
    waves: waves.length,
  });

  parent.batchesIssued++;
  for (const p of check.prepared) parent.contractHashes.add(contractHash(p.contract));

  const results: unknown[] = [];
  for (const wave of waves) {
    // Contracts in a wave write to disjoint places, so they can run together.
    const settled = await Promise.all(wave.map((p) => runContract(p, parent, phase)));
    results.push(...settled);
  }

  const accepted = results.filter((r) => (r as { status?: string }).status === "ok").length;
  parent.emptyBatchStreak = accepted === 0 ? parent.emptyBatchStreak + 1 : 0;

  return { accepted: true, results };
}

/**
 * Identity of a piece of delegated work. Two contracts that agree on the child,
 * the goal and the input are the same request, however they were phrased in the
 * surrounding call.
 */
function contractHash(c: Contract): string {
  return JSON.stringify([c.childAgent, c.objective, c.input]);
}

/**
 * Run one contract, then decide whether to accept it.
 *
 * Exactly three things can happen, and "it came back, so it worked" is not one
 * of them: accept, reject with a reason and send it back within the same
 * allocation, or abandon and report partial upward.
 */
async function runContract(
  prepared: PreparedContract,
  parent: AgentRun,
  phase: CompiledPhase
): Promise<unknown> {
  const { contract, sub, writeSet } = prepared;
  const maxRejects = sub.maxRejects ?? 1;
  let rejects = 0;
  let feedback: string | null = null;

  while (true) {
    const attempt = await runOneAttempt(prepared, parent, phase, feedback);
    if (attempt.kind === "error") {
      // It failed rather than ran, so it is not part of the loop-detection
      // record. A crash or a dropped connection is not the tree going in
      // circles, and refusing the retry would strand work that would succeed.
      parent.contractHashes.delete(contractHash(contract));
      return { childAgent: contract.childAgent, status: "error", error: attempt.error };
    }

    const envelope = attempt.envelope;
    if (envelope.status === "blocked") {
      // Escalation, not failure. Retrying a child that told us it cannot
      // decide something just spends turns to hear the same thing again.
      emitOutcome(parent, phase, prepared, "contract.blocked", {
        note: envelope.note ?? "",
        runPath: attempt.runPath,
      });
      return {
        childAgent: contract.childAgent,
        status: "blocked",
        note: envelope.note,
        evidence: envelope.evidence ?? [],
      };
    }

    const verdict = await judge(envelope, prepared, rejects);
    if (verdict.ok && envelope.status === "ok") {
      // Stored on acceptance and only on acceptance, so a later sibling can be
      // handed the key instead of having the payload copied through the
      // coordinator's contract input.
      parent.session.artifacts.put({
        key: attempt.runPath,
        childAgent: contract.childAgent,
        objective: contract.objective,
        value: envelope.result,
      });
      emitOutcome(parent, phase, prepared, "contract.accepted", { runPath: attempt.runPath });
      return {
        childAgent: contract.childAgent,
        artifactKey: attempt.runPath,
        status: "ok",
        result: envelope.result,
        evidence: envelope.evidence ?? [],
      };
    }

    const reason = verdict.ok
      ? `the child reported "${envelope.status}"${envelope.note ? `: ${envelope.note}` : ""}`
      : verdict.reason;

    rejects++;
    emitOutcome(parent, phase, prepared, "contract.rejected", {
      reason,
      attempt: rejects,
      runPath: attempt.runPath,
    });

    if (rejects > maxRejects) {
      emitOutcome(parent, phase, prepared, "contract.abandoned", {
        reason,
        runPath: attempt.runPath,
      });
      return {
        childAgent: contract.childAgent,
        status: "partial",
        reason,
        result: envelope.result,
        evidence: envelope.evidence ?? [],
      };
    }

    feedback = reason;
  }

  /** Schema, then write-set, then the host's own check. */
  async function judge(
    envelope: ContractEnvelope,
    p: PreparedContract,
    priorRejects: number
  ): Promise<AcceptanceVerdict> {
    if (envelope.status === "ok") {
      const shape = validateAgainstSchema(declaredDeliverable(p.sub.agent), envelope.result);
      if (!shape.valid) {
        return { ok: false, reason: `result does not match the schema: ${shape.errors.join("; ")}` };
      }
    }

    const evidence = envelope.evidence ?? [];
    const strayed = strayedOutsideWriteSet(evidence, writeSet);
    if (strayed.length > 0) {
      return {
        ok: false,
        reason: `you reported writing ${strayed.map((s) => `"${s}"`).join(", ")}, outside the write-set you were given (${(writeSet ?? []).join(", ")}).`,
      };
    }

    if (!p.sub.accept) return { ok: true };
    return await p.sub.accept(envelope.result, evidence, {
      childAgent: p.contract.childAgent,
      objective: p.contract.objective,
      restatement: envelope.restatement ?? "",
      writeSet,
      rejects: priorRejects,
    });
  }
}

type AttemptOutcome =
  | { readonly kind: "ok"; readonly envelope: ContractEnvelope; readonly runPath: string }
  | { readonly kind: "error"; readonly error: string };

async function runOneAttempt(
  prepared: PreparedContract,
  parent: AgentRun,
  phase: CompiledPhase,
  feedback: string | null
): Promise<AttemptOutcome> {
  const { contract, childDecl, writeSet } = prepared;
  const readable = withArtifactReader(childDecl, contract.reads ?? [], parent.session.artifacts);
  const child = parent.spawnContractChild(withContractEnvelope(readable), {
    objective: contract.objective,
    writeSet,
    maxTurns: contract.maxTurns ?? contract.turns,
  });

  if (!parent.session.ledger.reserve(child.runId, contract.turns)) {
    return { kind: "error", error: `could not reserve ${contract.turns} turns` };
  }
  child.noteReserved(contract.turns);

  parent.bus.emit({
    type: "contract.start",
    agent: parent.agentName,
    phase: phase.decl.name,
    runId: child.runId,
    parentRunId: parent.runId,
    childAgent: contract.childAgent,
    objective: contract.objective,
    turns: contract.turns,
  });

  const input = feedback === null
    ? contract.input
    : { ...(contract.input as object), rejectedBecause: feedback };

  try {
    const output = await child.execute(input);
    return { kind: "ok", envelope: (output ?? {}) as ContractEnvelope, runPath: child.runId };
  } catch (e) {
    // A child that ran out of turns has not failed, it has run out of turns.
    // Turning that into a partial keeps the decision with the coordinator
    // instead of throwing a stack trace at it.
    if (e instanceof TurnBudgetExhausted) {
      return {
        kind: "ok",
        envelope: { status: "partial", evidence: [], note: "ran out of allocated turns" },
        runPath: child.runId,
      };
    }
    return { kind: "error", error: e instanceof Error ? e.message : String(e) };
  } finally {
    parent.session.ledger.release(child.runId);
    parent.bus.emit({
      type: "contract.end",
      agent: parent.agentName,
      phase: phase.decl.name,
      runId: child.runId,
      parentRunId: parent.runId,
      childAgent: contract.childAgent,
    });
  }
}

/**
 * Give a child a reader for exactly the keys its contract named, and nothing
 * else. A child cannot browse what other branches produced, so it cannot drift
 * into someone else's problem.
 */
function withArtifactReader(
  agent: AgentDecl,
  reads: readonly string[],
  store: ArtifactStore
): AgentDecl {
  if (reads.length === 0) return agent;

  const allowed = new Set(reads);
  const available = store
    .index()
    .filter((a) => allowed.has(a.key))
    .map((a) => `${a.key} (${a.childAgent}: ${a.objective})`);

  const reader = tool({
    name: READ_ARTIFACT_TOOL_NAME,
    description:
      `Read a result an earlier agent produced. Available to you: ${available.join("; ")}.`,
    input: {
      type: "object",
      properties: { key: { type: "string", enum: [...allowed], description: "Which result to read." } },
      required: ["key"],
    } as JSONSchema,
    handler: async (input) => {
      const key = (input as { key: string }).key;
      if (!allowed.has(key)) {
        throw new Error(`"${key}" was not granted to this contract`);
      }
      const artifact = store.get(key);
      if (!artifact) throw new Error(`"${key}" no longer exists`);
      return artifact.value;
    },
  });

  return { ...agent, tools: [...agent.tools, reader] };
}

/** The deliverable the child declared, before the envelope wrapped it. */
function declaredDeliverable(agent: AgentDecl): JSONSchema {
  const last = agent.phases[agent.phases.length - 1];
  return last ? last.deliverable : ({ type: "object" } as JSONSchema);
}

/** File evidence pointing somewhere the contract did not allow. */
function strayedOutsideWriteSet(
  evidence: readonly Evidence[],
  writeSet: readonly string[] | undefined
): readonly string[] {
  if (!writeSet) return [];
  return evidence.filter((e) => e.kind === "file" && !writeSet.includes(e.ref)).map((e) => e.ref);
}

function emitOutcome(
  parent: AgentRun,
  phase: CompiledPhase,
  prepared: PreparedContract,
  type: "contract.accepted" | "contract.rejected" | "contract.abandoned" | "contract.blocked",
  extra: { reason?: string; note?: string; attempt?: number; runPath?: string }
): void {
  const reason = extra.reason ?? extra.note ?? "";
  parent.bus.emit({
    type,
    agent: parent.agentName,
    phase: phase.decl.name,
    runId: parent.runId,
    childAgent: prepared.contract.childAgent,
    objective: prepared.contract.objective,
    reason,
    attempt: extra.attempt ?? 0,
  });

  // Sub-agent runs are not otherwise persisted, so a finished tree would leave
  // no record of who was asked to do what. Fire-and-forget: a journal write
  // must never be what fails a run.
  const store = parent.session.store;
  if (!store) return;
  void store
    .appendJournal({
      at: Date.now(),
      runPath: extra.runPath ?? prepared.contract.childAgent,
      parentRunPath: parent.runId,
      childAgent: prepared.contract.childAgent,
      objective: prepared.contract.objective,
      turns: prepared.contract.turns,
      writeSet: prepared.writeSet ?? [],
      outcome: type.slice("contract.".length) as "accepted" | "rejected" | "abandoned" | "blocked",
      ...(reason ? { reason } : {}),
    })
    .catch(() => {});
}

type BatchCheck =
  | { readonly ok: true; readonly prepared: readonly PreparedContract[] }
  | { readonly ok: false; readonly problems: readonly ContractProblem[] };

function checkBatch(
  contracts: readonly Contract[],
  decl: DelegateDecl,
  parent: AgentRun
): BatchCheck {
  const problems: ContractProblem[] = [];
  const prepared: PreparedContract[] = [];

  for (const [index, contract] of contracts.entries()) {
    const one = checkContract(
      contract,
      index,
      decl,
      parent.session.artifacts,
      parent.contractHashes
    );
    if ("reason" in one) problems.push(one);
    else prepared.push(one);
  }

  // A coordinator that keeps re-planning is not making progress, it is
  // circling. Both of these end the circling rather than letting it burn the
  // whole budget.
  if (parent.batchesIssued >= parent.session.maxBatches) {
    problems.push({
      index: -1,
      childAgent: "(batch)",
      reason: `you have already delegated ${parent.batchesIssued} times, the limit. Finish with what you have.`,
    });
  }
  if (parent.emptyBatchStreak >= parent.session.maxEmptyBatches) {
    problems.push({
      index: -1,
      childAgent: "(batch)",
      reason: `your last ${parent.emptyBatchStreak} batches produced nothing usable. Delegating again the same way will not help; finish with what you have.`,
    });
  }

  const requested = contracts.reduce((sum, c) => sum + (Number(c.turns) || 0), 0);
  const available = parent.session.ledger.remaining(parent.runId);
  if (requested > available) {
    problems.push({
      index: -1,
      childAgent: "(batch)",
      reason: `the batch asks for ${requested} turns but only ${available} remain. Reduce the allocations or delegate fewer contracts.`,
    });
  }

  const fanOut = parent.contractsSpawned + contracts.length;
  if (fanOut > parent.session.maxFanOut) {
    problems.push({
      index: -1,
      childAgent: "(batch)",
      reason: `this batch would bring you to ${fanOut} children, past the limit of ${parent.session.maxFanOut}. Delegate fewer, larger pieces of work.`,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, prepared };
}

function checkContract(
  contract: Contract,
  index: number,
  decl: DelegateDecl,
  store: ArtifactStore,
  seen: ReadonlySet<string>
): PreparedContract | ContractProblem {
  const fail = (reason: string): ContractProblem => ({
    index,
    childAgent: String(contract.childAgent ?? "(unnamed)"),
    reason,
  });

  const sub = decl.children.get(contract.childAgent);
  if (!sub) {
    return fail(`"${contract.childAgent}" is not one of your sub-agents (${[...decl.children.keys()].join(", ")}).`);
  }

  // The same contract twice means the tree is going round in circles. Better to
  // say so than to pay for the same work again and get the same answer.
  if (seen.has(contractHash(contract))) {
    return fail(`you have already run this exact contract. Change what you are asking for, or work with the result you got.`);
  }

  if (!Number.isInteger(contract.turns) || contract.turns <= 0) {
    return fail(`turns must be a positive whole number, got ${String(contract.turns)}.`);
  }

  const inputCheck = validateAgainstSchema(sub.input, contract.input);
  if (!inputCheck.valid) {
    return fail(`input does not match what "${contract.childAgent}" accepts: ${inputCheck.errors.join("; ")}`);
  }

  const unreadable = (contract.reads ?? []).filter((k) => !store.has(k));
  if (unreadable.length > 0) {
    return fail(`no result exists under ${unreadable.map((k) => `"${k}"`).join(", ")}. Use a key returned by an earlier delegate call.`);
  }

  const grants = contract.grants;
  if (grants) {
    const ungrantable = grants.filter((g) => !decl.delegable.has(g));
    if (ungrantable.length > 0) {
      return fail(`you cannot hand down ${ungrantable.map((g) => `"${g}"`).join(", ")}; your delegable tools are ${[...decl.delegable.keys()].join(", ") || "(none)"}.`);
    }
  }

  const granted = grantedTools(contract, sub, decl);
  const writeSet = contract.writeSet && contract.writeSet.length > 0 ? contract.writeSet : undefined;
  if (granted.some((t) => t.mutates) && !writeSet) {
    const names = granted.filter((t) => t.mutates).map((t) => `"${t.name}"`).join(", ");
    return fail(`this contract grants ${names}, which changes things, so it must declare a writeSet.`);
  }

  return {
    index,
    contract,
    sub,
    childDecl: grants ? restrictTools(sub.agent, new Set(grants)) : sub.agent,
    writeSet,
  };
}

/**
 * Tools the child will actually be able to call. An omitted `grants` means
 * everything the sub-agent declares, which compile already bounded to the
 * parent's `delegable`.
 */
function grantedTools(
  contract: Contract,
  sub: SubAgentDecl,
  decl: DelegateDecl
): readonly ToolDecl[] {
  if (contract.grants) {
    return contract.grants
      .map((n) => decl.delegable.get(n))
      .filter((t): t is ToolDecl => t !== undefined);
  }
  return ownTools(sub.agent).filter((t): t is ToolDecl => t.kind === "tool");
}

function ownTools(agent: AgentDecl): readonly AgentDecl["tools"][number][] {
  return [...agent.tools, ...agent.phases.flatMap((p) => [...p.tools])];
}

/** Narrow a child declaration to the granted tools, leaving structure alone. */
function restrictTools(agent: AgentDecl, granted: ReadonlySet<string>): AgentDecl {
  const keep = (t: AgentDecl["tools"][number]): boolean =>
    t.kind !== "tool" || granted.has(t.name);
  return {
    ...agent,
    tools: agent.tools.filter(keep),
    phases: agent.phases.map((p): PhaseDecl => ({ ...p, tools: p.tools.filter(keep) })),
  };
}

/**
 * Split contracts into waves that can each run concurrently. A contract joins
 * the first wave where nothing already in it writes somewhere it writes, so two
 * children never have the same path open at once.
 */
function intoWaves(prepared: readonly PreparedContract[]): PreparedContract[][] {
  const waves: PreparedContract[][] = [];
  for (const p of prepared) {
    const wave = waves.find((w) => w.every((other) => !overlaps(p.writeSet, other.writeSet)));
    if (wave) wave.push(p);
    else waves.push([p]);
  }
  return waves;
}

function overlaps(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b) return false;
  return a.some((x) => b.includes(x));
}

function readContracts(input: unknown): readonly Contract[] {
  const list = (input as { contracts?: unknown } | null)?.contracts;
  if (!Array.isArray(list)) {
    throw new Error("delegate: malformed input after schema validation");
  }
  return list as readonly Contract[];
}
