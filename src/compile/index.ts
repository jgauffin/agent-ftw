import type {
  AgentDecl,
  PhaseDecl,
  ToolDecl,
  SubAgentDecl,
  CustomSubAgentDecl,
  SideQuestProposalDecl,
  SideQuestsDecl,
} from "../declare/index.js";
import type { DelegateDecl } from "../declare/index.js";
import { SIDE_QUEST_TOOL_NAME, DELEGATE_TOOL_NAME } from "../declare/index.js";
import type { JSONSchema } from "../schema/index.js";

/**
 * Anything the model can call as a tool in a compiled phase: plain tools,
 * sub-agents, custom-handler sub-agents, and the synthetic side-quest proposal.
 */
export type ExposedTool =
  | ToolDecl
  | SubAgentDecl
  | CustomSubAgentDecl
  | SideQuestProposalDecl
  | DelegateDecl;

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
export function validate(agent: AgentDecl, opts: CompileOptions = {}): CompiledAgent {
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const depth = opts.depth ?? 0;
  return compileAgent(agent, new Set(), depth === 0, { maxDepth, depth });
}

/**
 * Limits applied while compiling. Depth is what stops a coordinator tree from
 * recursing without bound, and it is enforced here rather than in a prompt.
 */
export interface CompileOptions {
  /**
   * How deep the run tree may go. The root agent is depth 0, so the default
   * allows the root plus two levels of sub-agents.
   */
  readonly maxDepth?: number;
  /**
   * Depth this agent sits at. Set when re-compiling a sub-agent at runtime so
   * the limit still means the same thing.
   * @internal
   */
  readonly depth?: number;
}

/** Root plus two levels of sub-agents. */
export const DEFAULT_MAX_DEPTH = 3;

/** Children one coordinator run may contract, across all its batches. */
export const DEFAULT_MAX_FAN_OUT = 8;

/** Delegate batches one coordinator run may issue. */
export const DEFAULT_MAX_BATCHES = 4;

/** Consecutive fruitless batches tolerated before delegation is refused. */
export const DEFAULT_MAX_EMPTY_BATCHES = 2;

interface Limits {
  readonly maxDepth: number;
  readonly depth: number;
}

function compileAgent(
  agent: AgentDecl,
  ancestors: ReadonlySet<string>,
  isTopLevel: boolean,
  limits: Limits
): CompiledAgent {
  validateAgentShape(agent, ancestors);
  validateDepth(agent, limits);
  validateCoordinatorHoldsNothingMutating(agent);

  const toolsByName: ToolMap = new Map();
  for (const t of agent.tools) addTool(toolsByName, agent.name, t);

  const sideQuestProposal = buildSideQuestProposal(agent);
  if (sideQuestProposal) addTool(toolsByName, agent.name, sideQuestProposal);

  const childAncestors = new Set(ancestors);
  childAncestors.add(agent.name);

  const compiledPhases = agent.phases.map((phase) =>
    compilePhase(agent, phase, isTopLevel, toolsByName, childAncestors, sideQuestProposal, limits)
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

function validateDepth(agent: AgentDecl, limits: Limits): void {
  if (limits.depth < limits.maxDepth) return;
  throw new CompileError(
    `agent "${agent.name}" sits at depth ${limits.depth}, past the limit of ${limits.maxDepth} ` +
      `(the root is depth 0). Flatten the tree or raise maxDepth on the Session.`
  );
}

/**
 * A coordinator decides who does the work; it does not do it. Withholding the
 * capability is what enforces that — an agent cannot abandon its own plan to
 * start editing things if it holds nothing that edits.
 */
function validateCoordinatorHoldsNothingMutating(agent: AgentDecl): void {
  if ((agent.role ?? "worker") !== "coordinator") return;
  for (const t of ownTools(agent)) {
    if (t.kind === "tool" && t.mutates) {
      throw new CompileError(
        `coordinator "${agent.name}" holds mutating tool "${t.name}". A coordinator delegates ` +
          `that authority instead of holding it: move the tool to \`delegable\` and give it to a sub-agent.`
      );
    }
  }
}

/**
 * Authority narrows going down: a sub-agent may only hold tools its parent
 * listed in `delegable`. `customSubAgent` handlers are host TypeScript rather
 * than a granted capability, so they are outside this check — where you place
 * one is the grant.
 */
function validateGrantsWithinDelegable(parent: AgentDecl, child: AgentDecl): void {
  const delegable = new Set((parent.delegable ?? []).map((t) => t.name));
  for (const t of ownTools(child)) {
    if (t.kind !== "tool") continue;
    if (delegable.has(t.name)) continue;
    throw new CompileError(
      `sub-agent "${child.name}" declares tool "${t.name}", which its parent "${parent.name}" ` +
        `does not list in \`delegable\`. Add it there to hand that authority down.`
    );
  }
}

/** Every tool this agent declares, globally or on a phase. */
function ownTools(agent: AgentDecl): readonly (ToolDecl | SubAgentDecl | CustomSubAgentDecl)[] {
  return [...agent.tools, ...agent.phases.flatMap((p) => [...p.tools])];
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
  sideQuestProposal: SideQuestProposalDecl | null,
  limits: Limits
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

  const delegateTool = buildDelegate(agent, phase);
  if (delegateTool) {
    if (toolsByName.has(DELEGATE_TOOL_NAME)) {
      throw new CompileError(
        `coordinator "${agent.name}" has tool "${DELEGATE_TOOL_NAME}" colliding with the auto-generated delegation tool`
      );
    }
    exposed.push(delegateTool);
  }

  for (const t of exposed) {
    if (t.kind !== "subAgent") continue;
    validateGrantsWithinDelegable(agent, t.agent);
    compileAgent(t.agent, ancestors, false, { ...limits, depth: limits.depth + 1 });
  }

  return { decl: phase, phaseEndTool, exposedTools: exposed, phaseEndToolName, hasExternalTerminator };
}

/**
 * Build the delegation tool for a coordinator phase, or return null for a
 * worker.
 *
 * Depth is not checked here. A coordinator needs sub-agents to delegate to, and
 * those are compiled one level down, so a coordinator with no room beneath it
 * fails on its children's depth rather than quietly losing the tool. Failing to
 * compile beats running an agent whose whole purpose has been withheld.
 */
function buildDelegate(agent: AgentDecl, phase: PhaseDecl): DelegateDecl | null {
  if ((agent.role ?? "worker") !== "coordinator") return null;

  const children = new Map<string, SubAgentDecl>();
  for (const t of [...agent.tools, ...phase.tools]) {
    if (t.kind === "subAgent") children.set(t.name, t);
  }
  if (children.size === 0) {
    throw new CompileError(
      `coordinator "${agent.name}" phase "${phase.name}" has no sub-agents to delegate to. ` +
        `Declare at least one subAgent, or make the agent a worker.`
    );
  }

  const delegable = new Map<string, ToolDecl>();
  for (const t of agent.delegable ?? []) delegable.set(t.name, t);

  return {
    kind: "delegate",
    name: DELEGATE_TOOL_NAME,
    description:
      "Delegate work to your sub-agents. Pass every contract you want run in ONE call: " +
      "the batch is checked as a whole and either all of it starts or none of it does. " +
      "Contracts that write to different places run at the same time.",
    input: delegateInputSchema(children, delegable),
    children,
    delegable,
  };
}

function delegateInputSchema(
  children: ReadonlyMap<string, SubAgentDecl>,
  delegable: ReadonlyMap<string, ToolDecl>
): JSONSchema {
  const contract: Record<string, unknown> = {
    type: "object",
    properties: {
      childAgent: {
        type: "string",
        enum: [...children.keys()],
        description: "Which sub-agent does this piece of work.",
      },
      objective: {
        type: "string",
        description:
          "What this child must achieve, stated narrowly enough that it can be judged done or not done.",
      },
      input: {
        description: "Input for the sub-agent, matching the schema it declares.",
      },
      writeSet: {
        type: "array",
        items: { type: "string" },
        description:
          "Paths this child may write to. Required when any granted tool changes things. " +
          "Two contracts that name the same path cannot run at the same time.",
      },
      turns: {
        type: "number",
        description:
          "Model turns to allocate. Taken from your own remaining balance, so the total across the batch cannot exceed it.",
      },
      maxTurns: {
        type: "number",
        description:
          "Ceiling this child may be topped up to if it runs out, drawn from your balance without asking you again. Defaults to turns.",
      },
      reads: {
        type: "array",
        items: { type: "string" },
        description:
          "Keys of earlier children's results this child may read, as returned by previous delegate calls. " +
          "Use these instead of copying an earlier result into this contract's input.",
      },
    },
    required: ["childAgent", "objective", "input", "turns"],
  };

  // A coordinator with nothing to hand down gets no grants field at all rather
  // than an empty enum the model cannot satisfy.
  if (delegable.size > 0) {
    (contract["properties"] as Record<string, unknown>)["grants"] = {
      type: "array",
      items: { type: "string", enum: [...delegable.keys()] },
      description:
        "Tools this child may use. Omit to allow everything the sub-agent declares. Narrowing is always allowed; widening is not.",
    };
  }

  return {
    type: "object",
    properties: {
      contracts: { type: "array", minItems: 1, items: contract as JSONSchema },
    },
    required: ["contracts"],
  } as JSONSchema;
}

/**
 * Rewrite a contracted child so its last phase returns a status envelope rather
 * than a bare deliverable.
 *
 * The child has to be able to say "I could not do this" in a way the parent can
 * act on. Without somewhere to put that, a child with an unresolvable ambiguity
 * has no option except to invent an answer that fits the schema.
 *
 * `result` is not required by the schema, because a `blocked` child has none.
 * Whether a result was actually needed is decided by the parent when it accepts.
 */
export function withContractEnvelope(agent: AgentDecl): AgentDecl {
  const last = agent.phases[agent.phases.length - 1];
  if (!last) return agent;

  const envelope: JSONSchema = {
    type: "object",
    properties: {
      restatement: {
        type: "string",
        description:
          "The objective you were given, in your own words, before anything else. " +
          "Say what you understood you had to do and what you took to be out of scope.",
      },
      status: {
        type: "string",
        enum: ["ok", "partial", "blocked"],
        description:
          "ok: the objective is met. partial: real progress, but not finished. " +
          "blocked: something ambiguous or missing stops you, and guessing would be worse than saying so.",
      },
      result: {
        ...(last.deliverable as object),
        description: "Your deliverable. Required unless you are blocked.",
      } as JSONSchema,
      evidence: {
        type: "array",
        description:
          "What backs up your result: files you wrote, commands you ran with their outcome, locations you read. " +
          "The parent checks these rather than taking your word for it.",
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["file", "command", "citation", "note"] },
            ref: { type: "string", description: "The path, command line, or location." },
            detail: { type: "string", description: "Outcome or excerpt: an exit code, a matched line, a short quote." },
          },
          required: ["kind", "ref"],
        },
      },
      note: {
        type: "string",
        description: "If blocked or partial, what exactly is missing or undecided.",
      },
    },
    // Restating the objective is required, not optional. Making a model
    // articulate what it thinks it was asked catches a misreading that a
    // plausible-looking result would otherwise hide.
    required: ["restatement", "status", "evidence"],
  };

  const phases = [...agent.phases];
  phases[phases.length - 1] = { ...last, deliverable: envelope };
  return { ...agent, phases };
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
