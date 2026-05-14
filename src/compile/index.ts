import type {
  AgentDecl,
  PhaseDecl,
  ToolDecl,
  SubAgentDecl,
  CustomSubAgentDecl,
  SideQuestProposalDecl,
  SideQuestsDecl,
} from "../declare/index.js";
import { SIDE_QUEST_TOOL_NAME } from "../declare/index.js";
import type { JSONSchema } from "../schema/index.js";

/**
 * Anything the model can call as a tool in a compiled phase: plain tools,
 * sub-agents, custom-handler sub-agents, and the synthetic side-quest proposal.
 */
export type ExposedTool = ToolDecl | SubAgentDecl | CustomSubAgentDecl | SideQuestProposalDecl;

/**
 * The output of {@link validate} — an {@link AgentDecl} that has been
 * structurally checked, with every phase's exposed tools resolved. Pass this
 * to `new Session({ agent, ... })` to skip re-validation.
 */
export interface CompiledAgent {
  /** The original (unchanged) declaration. */
  readonly decl: AgentDecl;
  readonly phases: readonly CompiledPhase[];
  /** All tools the agent and its phases expose, indexed by name. */
  readonly toolsByName: ReadonlyMap<string, ExposedTool>;
}

/**
 * A phase after compilation. Carries the synthesized phase-end tool and the
 * full set of tools exposed to the model during this phase.
 */
export interface CompiledPhase {
  readonly decl: PhaseDecl;
  /** Synthesized phase-end tool. Always generated, but only exposed to the model when terminator is `tool` (the default). */
  readonly phaseEndTool: ToolDecl;
  readonly exposedTools: readonly ExposedTool[];
  /**
   * Name of the synthesized phase-end tool. With external terminators the tool
   * is NOT in `exposedTools`, so this name will never match a model tool call —
   * adapters can still reference it harmlessly.
   */
  readonly phaseEndToolName: string;
  /** True when the phase uses an external (host-driven) terminator. */
  readonly hasExternalTerminator: boolean;
}

/**
 * Thrown by {@link validate} when an agent declaration is structurally invalid:
 * cycles in the sub-agent graph, duplicate phase/tool names, empty phases, etc.
 */
export class CompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompileError";
  }
}

type ToolMap = Map<string, ExposedTool>;

/**
 * Validate and compile an {@link AgentDecl}. Throws {@link CompileError} on
 * structural problems (cycles, duplicates, illegal terminator/review combos).
 *
 * Passing the returned {@link CompiledAgent} to `Session` skips re-validation.
 * Passing the raw `AgentDecl` is fine too — `Session` calls `validate` itself.
 */
export function validate(agent: AgentDecl): CompiledAgent {
  return compileAgent(agent, new Set(), true);
}

function compileAgent(
  agent: AgentDecl,
  ancestors: ReadonlySet<string>,
  isTopLevel: boolean
): CompiledAgent {
  validateAgentShape(agent, ancestors);

  const toolsByName: ToolMap = new Map();
  for (const t of agent.tools) addTool(toolsByName, agent.name, t);

  const sideQuestProposal = buildSideQuestProposal(agent);
  if (sideQuestProposal) addTool(toolsByName, agent.name, sideQuestProposal);

  const childAncestors = new Set(ancestors);
  childAncestors.add(agent.name);

  const compiledPhases = agent.phases.map((phase) =>
    compilePhase(agent, phase, isTopLevel, toolsByName, childAncestors, sideQuestProposal)
  );

  return { decl: agent, phases: compiledPhases, toolsByName };
}

function buildSideQuestProposal(agent: AgentDecl): SideQuestProposalDecl | null {
  const sq = agent.sideQuests;
  if (!sq || sq.mode !== "agent") return null;

  if (sq.catalog.length === 0) {
    throw new CompileError(
      `agent "${agent.name}" has sideQuests.mode "agent" but an empty catalog`
    );
  }
  const catalogNames = new Set<string>();
  for (const t of sq.catalog) {
    if (t.kind !== "tool") {
      throw new CompileError(
        `agent "${agent.name}" sideQuests.catalog must contain plain tools (no sub-agents)`
      );
    }
    if (catalogNames.has(t.name)) {
      throw new CompileError(
        `agent "${agent.name}" sideQuests.catalog has duplicate tool "${t.name}"`
      );
    }
    catalogNames.add(t.name);
  }

  const inputSchema: JSONSchema = {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "What you want to explore in the side quest, and why.",
      },
      rationale: {
        type: "string",
        description: "Why this diverges from the current task and is worth pursuing.",
      },
      requestedTools: {
        type: "array",
        items: { type: "string", enum: [...catalogNames] },
        description: "Names of tools you want available in the side quest.",
        minItems: 1,
      },
    },
    required: ["goal", "rationale", "requestedTools"],
  };

  return {
    kind: "sideQuestProposal",
    name: SIDE_QUEST_TOOL_NAME,
    description:
      "Propose a side quest: a bounded exploration with a fresh tool subset. " +
      "The host approves (and may narrow) the requested tools before the side " +
      "quest runs. Returns the side quest's structured deliverable.",
    input: inputSchema,
    spec: agent.sideQuests as SideQuestsDecl,
  };
}

function validateAgentShape(agent: AgentDecl, ancestors: ReadonlySet<string>): void {
  if (ancestors.has(agent.name)) {
    throw new CompileError(`cycle in agent graph: ${[...ancestors, agent.name].join(" -> ")}`);
  }
  if (agent.phases.length === 0) {
    throw new CompileError(`agent "${agent.name}" must have at least one phase`);
  }
  const phaseNames = new Set<string>();
  for (const p of agent.phases) {
    if (phaseNames.has(p.name)) {
      throw new CompileError(`agent "${agent.name}" has duplicate phase "${p.name}"`);
    }
    phaseNames.add(p.name);
  }
}

function addTool(map: ToolMap, agentName: string, t: ExposedTool): void {
  const existing = map.get(t.name);
  if (existing && existing !== t) {
    throw new CompileError(`agent "${agentName}" has duplicate tool name "${t.name}"`);
  }
  map.set(t.name, t);
}

function compilePhase(
  agent: AgentDecl,
  phase: PhaseDecl,
  isTopLevel: boolean,
  toolsByName: ToolMap,
  ancestors: ReadonlySet<string>,
  sideQuestProposal: SideQuestProposalDecl | null
): CompiledPhase {
  if (!isTopLevel && phase.review) {
    throw new CompileError(
      `phase "${phase.name}" in sub-agent "${agent.name}" cannot have review (review is top-level only)`
    );
  }

  for (const t of phase.tools) addTool(toolsByName, agent.name, t);

  const phaseEndToolName = phase.phaseEndToolName ?? `finish_${phase.name}`;
  const terminator = phase.terminator ?? { kind: "tool" };
  const hasExternalTerminator = terminator.kind === "external";

  if (!hasExternalTerminator && toolsByName.has(phaseEndToolName)) {
    throw new CompileError(
      `agent "${agent.name}" has tool "${phaseEndToolName}" colliding with auto-generated phase-end tool`
    );
  }

  const phaseEndTool = makePhaseEndTool(phaseEndToolName, phase.deliverable);
  const exposed: ExposedTool[] = [...agent.tools, ...phase.tools];
  if (!hasExternalTerminator) exposed.push(phaseEndTool);
  if (sideQuestProposal) exposed.push(sideQuestProposal);

  for (const t of exposed) {
    if (t.kind === "subAgent") compileAgent(t.agent, ancestors, false);
  }

  return { decl: phase, phaseEndTool, exposedTools: exposed, phaseEndToolName, hasExternalTerminator };
}

function makePhaseEndTool(name: string, deliverable: JSONSchema): ToolDecl {
  return {
    kind: "tool",
    name,
    description: `Finalize the phase with the structured deliverable. Call this exactly once when ready.`,
    input: deliverable,
    handler: async () => {
      throw new Error("phase-end handler should never be invoked");
    },
  };
}
