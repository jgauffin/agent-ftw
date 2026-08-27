/**
 * Projects an agent declaration into plain, serializable data.
 *
 * A declaration carries handlers, adapters and terminator callbacks, so it
 * cannot cross a process boundary or be printed. What a reader (or another
 * program) actually needs is the shape: the phases, their deliverables, and
 * the tools each phase exposes — including the ones nobody wrote, which exist
 * only after compilation.
 *
 * The projection runs against the *compiled* agent for exactly that reason:
 * `finish_<phase>`, a coordinator's `delegate` and the side-quest proposal tool
 * are invisible in the declaration and are usually what a reader is missing.
 */

import { validate, type CompileOptions, type ExposedTool } from "../compile/index.js";
import { DEFAULT_TURN_BUDGET, type AgentDecl } from "../declare/index.js";
import type { JSONSchema } from "../schema/index.js";

/** An agent, its phases, and everything reachable from them, as plain data. */
export interface AgentSummary {
  readonly name: string;
  readonly role: "worker" | "coordinator";
  /** Tool names this agent may hand down to a child. Empty for a worker. */
  readonly delegable: readonly string[];
  readonly sideQuests: "off" | "agent";
  readonly phases: readonly PhaseSummary[];
}

/** Where the model for a construct comes from, once overrides are resolved. */
export type AdapterSource = "phase" | "agent" | "session";

export interface PhaseSummary {
  readonly name: string;
  /** `agent/phase`. The same prefix lint findings use, so the two line up. */
  readonly path: string;
  readonly prompt: string;
  readonly deliverable: JSONSchema;
  /** The budget that applies: the phase's own, or the framework default. */
  readonly turnBudget: number;
  /** False when `turnBudget` above is the inherited default rather than a declared one. */
  readonly turnBudgetDeclared: boolean;
  readonly review: boolean;
  readonly terminator: "tool" | "external";
  /**
   * The tool the model calls to end the phase. With an external terminator it
   * is not exposed to the model, so no model call will ever match it.
   */
  readonly phaseEndToolName: string;
  readonly checklist: ChecklistSummary | null;
  readonly adapter: AdapterSource;
  /** Every tool the model sees in this phase, authored or injected. */
  readonly tools: readonly ToolSummary[];
}

export interface ChecklistSummary {
  readonly prompt: string;
  readonly schema: JSONSchema;
  /** False means the checklist grades with the same model that produced the work. */
  readonly ownAdapter: boolean;
}

/** A tool as the model sees it. `kind` says who wrote it and what calling it does. */
export type ToolSummary =
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly description: string;
      readonly input: JSONSchema;
      /** Declared `mutates`. A dry run refuses to call these unless told to. */
      readonly mutates: boolean;
    }
  | {
      readonly kind: "subAgent";
      readonly name: string;
      readonly description: string;
      readonly input: JSONSchema;
      /** Whether the parent checks contracted results in host TypeScript. */
      readonly hasAccept: boolean;
      readonly maxRejects: number;
      readonly agent: AgentSummary;
    }
  | {
      readonly kind: "customSubAgent";
      readonly name: string;
      readonly description: string;
      readonly input: JSONSchema;
      readonly output: JSONSchema;
    }
  | {
      /** Injected on every phase of a coordinator. Not authored. */
      readonly kind: "delegate";
      readonly name: string;
      readonly children: readonly string[];
      readonly delegable: readonly string[];
    }
  | {
      /** Injected when the agent declares `sideQuests.mode === "agent"`. Not authored. */
      readonly kind: "sideQuestProposal";
      readonly name: string;
      readonly catalog: readonly string[];
    }
  | {
      /** The phase-end tool. Injected, and the only tool that ends the phase. */
      readonly kind: "phaseEnd";
      readonly name: string;
      readonly input: JSONSchema;
    };

/** How many rejections a contracted child gets before the parent gives up on it. */
const DEFAULT_MAX_REJECTS = 1;

/**
 * Compile `decl` and project it, sub-agents included.
 *
 * Throws `CompileError` when the declaration is structurally invalid, because
 * a tree that cannot compile has no shape worth describing.
 */
export function describeAgent(decl: AgentDecl, opts: CompileOptions = {}): AgentSummary {
  validate(decl, opts);
  return project(decl, opts, new Set());
}

function project(decl: AgentDecl, opts: CompileOptions, ancestors: ReadonlySet<AgentDecl>): AgentSummary {
  const compiled = validate(decl, opts);
  const seen = new Set(ancestors).add(decl);

  return {
    name: decl.name,
    role: decl.role ?? "worker",
    delegable: (decl.delegable ?? []).map((t) => t.name),
    sideQuests: decl.sideQuests?.mode ?? "off",
    phases: compiled.phases.map((p) => {
      const phase = p.decl;
      const tools: ToolSummary[] = p.exposedTools
        .filter((t) => t.name !== p.phaseEndToolName)
        .map((t) => projectTool(t, opts, seen));
      if (!p.hasExternalTerminator) {
        tools.push({ kind: "phaseEnd", name: p.phaseEndToolName, input: phase.deliverable });
      }

      return {
        name: phase.name,
        path: `${decl.name}/${phase.name}`,
        prompt: phase.prompt,
        deliverable: phase.deliverable,
        turnBudget: phase.turnBudget ?? DEFAULT_TURN_BUDGET,
        turnBudgetDeclared: phase.turnBudget !== undefined,
        review: phase.review === true,
        terminator: p.hasExternalTerminator ? "external" : "tool",
        phaseEndToolName: p.phaseEndToolName,
        checklist: phase.checklist
          ? {
              prompt: phase.checklist.prompt,
              schema: phase.checklist.schema,
              ownAdapter: phase.checklist.adapter !== undefined,
            }
          : null,
        adapter: phase.adapter ? "phase" : decl.adapter ? "agent" : "session",
        tools,
      };
    }),
  };
}

function projectTool(t: ExposedTool, opts: CompileOptions, ancestors: ReadonlySet<AgentDecl>): ToolSummary {
  switch (t.kind) {
    case "tool":
      return {
        kind: "tool",
        name: t.name,
        description: t.description,
        input: t.input,
        mutates: t.mutates === true,
      };
    case "subAgent":
      return {
        kind: "subAgent",
        name: t.name,
        description: t.description,
        input: t.input,
        hasAccept: t.accept !== undefined,
        maxRejects: t.maxRejects ?? DEFAULT_MAX_REJECTS,
        // Depth is capped at compile time, and a sub-agent reached twice in one
        // branch would have failed there, so recursion terminates. The guard is
        // for a declaration shared by two branches, which is legal.
        agent: ancestors.has(t.agent)
          ? { name: t.agent.name, role: t.agent.role ?? "worker", delegable: [], sideQuests: "off", phases: [] }
          : project(t.agent, { ...opts, depth: (opts.depth ?? 0) + 1 }, ancestors),
      };
    case "customSubAgent":
      return {
        kind: "customSubAgent",
        name: t.name,
        description: t.description,
        input: t.input,
        output: t.output,
      };
    case "delegate":
      return {
        kind: "delegate",
        name: t.name,
        children: [...t.children.keys()],
        delegable: [...t.delegable.keys()],
      };
    case "sideQuestProposal":
      return {
        kind: "sideQuestProposal",
        name: t.name,
        catalog: t.spec.catalog.map((c) => c.name),
      };
  }
}

/** Walk every phase in a summary tree, parents before children. */
export function* eachPhase(summary: AgentSummary): Generator<{ agent: AgentSummary; phase: PhaseSummary }> {
  for (const phase of summary.phases) {
    yield { agent: summary, phase };
    for (const t of phase.tools) {
      if (t.kind === "subAgent") yield* eachPhase(t.agent);
    }
  }
}
