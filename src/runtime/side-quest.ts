import type { AgentRun } from "./agent-run.js";
import type { CompiledPhase } from "../compile/index.js";
import { validate } from "../compile/index.js";
import {
  agent as agentFactory,
  phase as phaseFactory,
  type SideQuestProposalDecl,
} from "../declare/index.js";

const DEFAULT_SIDE_QUEST_BUDGET = 20;

interface SideQuestInput {
  readonly goal: string;
  readonly rationale: string;
  readonly requestedTools: readonly string[];
}

/**
 * Runs an agent-triggered side quest:
 *   1. Surface the proposal to the host via askUser, presenting the *full
 *      catalog* so the user can widen or narrow the requested toolset.
 *   2. If approved, synthesize a single-phase AgentDecl with the approved
 *      tools + the configured deliverable, and run it as a child AgentRun.
 *   3. Return the side-quest deliverable as the calling tool's result.
 *
 * Depth is enforced declaratively: the synthesized agent has no `sideQuests`
 * config, so it cannot itself spawn side quests (matches `maxDepth: 1`).
 */
export async function runSideQuest(
  decl: SideQuestProposalDecl,
  input: unknown,
  parent: AgentRun,
  phase: CompiledPhase
): Promise<unknown> {
  const proposal = parseProposal(input, decl);

  parent.bus.emit({
    type: "sideQuest.proposed",
    agent: parent.agentName,
    phase: phase.decl.name,
    runId: parent.runId,
    goal: proposal.goal,
    rationale: proposal.rationale,
    requestedTools: proposal.requestedTools,
  });

  const catalogNames = decl.spec.catalog.map((t) => t.name);
  const approved = await askForApproval(parent, phase, proposal, catalogNames);

  if (approved.length === 0) {
    parent.bus.emit({
      type: "sideQuest.declined",
      agent: parent.agentName,
      phase: phase.decl.name,
      runId: parent.runId,
      reason: "no tools approved",
    });
    return { declined: true, reason: "user declined the side quest" };
  }

  parent.bus.emit({
    type: "sideQuest.approved",
    agent: parent.agentName,
    phase: phase.decl.name,
    runId: parent.runId,
    approvedTools: approved,
  });

  const approvedSet = new Set(approved);
  const approvedTools = decl.spec.catalog.filter((t) => approvedSet.has(t.name));

  const sqAgent = agentFactory({
    name: `${parent.agentName}__side_quest`,
    // When the side-quest spec sets no adapter, the synthesized agent leaves it
    // unset and inherits the parent run's effectiveAdapter via the AgentRun chain.
    ...(decl.spec.adapter !== undefined ? { adapter: decl.spec.adapter } : {}),
    phases: [
      phaseFactory({
        name: "explore",
        prompt:
          `Side quest goal: ${proposal.goal}\n` +
          `Rationale: ${proposal.rationale}\n\n` +
          `Use the available tools to explore the goal. When done, return the ` +
          `structured deliverable.`,
        tools: approvedTools,
        deliverable: decl.spec.deliverable,
        turnBudget: decl.spec.turnBudget ?? DEFAULT_SIDE_QUEST_BUDGET,
      }),
    ],
    // Intentionally no sideQuests on the synthesized agent — depth=1.
  });

  const compiled = validate(sqAgent);
  const childRun = parent.spawnRuntimeChild(compiled);
  return await childRun.execute(proposal);
}

function parseProposal(input: unknown, decl: SideQuestProposalDecl): SideQuestInput {
  // Schema validation already ran in dispatch; this is defensive narrowing.
  const o = input as Partial<SideQuestInput> | null;
  if (!o || typeof o.goal !== "string" || typeof o.rationale !== "string" || !Array.isArray(o.requestedTools)) {
    throw new Error(`${decl.name}: malformed input after schema validation`);
  }
  return { goal: o.goal, rationale: o.rationale, requestedTools: [...o.requestedTools] };
}

async function askForApproval(
  parent: AgentRun,
  phase: CompiledPhase,
  proposal: SideQuestInput,
  catalogNames: readonly string[]
): Promise<string[]> {
  const prompt =
    `The agent proposes a side quest:\n` +
    `  Goal: ${proposal.goal}\n` +
    `  Rationale: ${proposal.rationale}\n` +
    `  Requested tools: ${proposal.requestedTools.join(", ")}\n\n` +
    `Select which tools to grant the side quest (defaults to the requested set). ` +
    `Pick none to decline.`;

  // Present the full catalog so the user can widen or narrow the request.
  // Move requested tools to the front so they're the visible default.
  const requested = new Set(proposal.requestedTools);
  const ordered = [
    ...proposal.requestedTools.filter((n) => catalogNames.includes(n)),
    ...catalogNames.filter((n) => !requested.has(n)),
  ];

  const result = await parent.session.askUser(
    { prompt, options: ordered, mode: "multi" },
    { agent: parent.agentName, phase: phase.decl.name, runId: parent.runId }
  );
  // Filter to catalog members; ignore any free-text "other".
  return result.selected.filter((n) => catalogNames.includes(n));
}
