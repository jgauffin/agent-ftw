/**
 * Running an agent with no model behind it.
 *
 * Everything between the phases is ordinary code: tool handlers, `accept`
 * predicates, deliverable validation, turn budgets, the artifact store. All of
 * it is wrong in ways a schema cannot catch, and today the only way to find out
 * is a paid run that comes back different every time.
 *
 * A dry run substitutes a model that always answers correctly and instantly:
 * each phase ends immediately with a value synthesized from its own deliverable
 * schema. What survives is exactly the machinery around the model, which is the
 * part that is deterministic and therefore worth testing.
 */

import { seedConversation, appendAssistantTurn, dispatchAndAppend } from "../adapters/run-helpers.js";
import type { Adapter, PhaseEndResult, RunContext, ToolCall } from "../adapters/types.js";
import type { AgentDecl, ChecklistDecl, PhaseDecl, SideQuestsDecl } from "../declare/index.js";
import type { JSONSchema } from "../schema/index.js";
import { eachPhase, type AgentSummary } from "./describe.js";
import { synthesize } from "./synthesize.js";

/** What a dry run built for one schema, and where the schema left it guessing. */
export interface SynthesisNote {
  readonly kind: "deliverable" | "toolInput" | "checklist";
  /** The phase-end tool for a deliverable, the tool name for an input. */
  readonly target: string;
  readonly value: unknown;
  readonly gaps: readonly string[];
  /** True when the value came from a caller-supplied fixture rather than the schema. */
  readonly fromFixture: boolean;
}

export interface DryRunAdapterOptions {
  /**
   * Deliverables to use instead of synthesized ones, keyed by **phase-end tool
   * name** (`finish_triage`, or whatever the phase declared).
   *
   * Keyed by the tool rather than the phase because that is the only phase
   * identity an adapter is given, and because it is what a phase's downstream
   * consumers actually see.
   */
  readonly deliverables?: Readonly<Record<string, unknown>>;
  /**
   * Names of tools the run may actually call, once each, with a synthesized
   * input. Empty by default: a tool handler writes files, charges money and
   * sends mail, and a check that quietly did those things would be worse than
   * no check.
   */
  readonly callTools?: readonly string[];
  /** Called for every value synthesized, so a host can report what it had to invent. */
  readonly onSynthesis?: (note: SynthesisNote) => void;
}

/**
 * An {@link Adapter} that answers from schemas instead of a model.
 *
 * Pair it with {@link stripAdapters} — a phase carrying its own `adapter`
 * overrides the session default, so a dry run that skipped that step would
 * quietly call a real model for some phases.
 */
export function dryRunAdapter(opts: DryRunAdapterOptions = {}): Adapter {
  const callable = new Set(opts.callTools ?? []);
  let calls = 0;

  const build = (
    kind: SynthesisNote["kind"],
    target: string,
    schema: JSONSchema,
    fixture?: { value: unknown }
  ): unknown => {
    const built = fixture ? { value: fixture.value, gaps: [] as readonly string[] } : synthesize(schema, target);
    opts.onSynthesis?.({ kind, target, value: built.value, gaps: built.gaps, fromFixture: fixture !== undefined });
    return built.value;
  };

  return {
    async runUntilPhaseEnd(ctx: RunContext): Promise<PhaseEndResult> {
      const conversation = seedConversation(ctx);
      ctx.signal.throwIfAborted();
      ctx.consumeTurn();

      const endTool = ctx.tools.find((t) => t.name === ctx.phaseEndToolName);
      if (!endTool) {
        // An external terminator ends the phase from the host, so there is no
        // tool to call and no deliverable schema in reach. Saying so beats
        // spinning until the budget runs out.
        throw new Error(
          `dry run cannot end a phase with an external terminator (no "${ctx.phaseEndToolName}" tool exposed). ` +
            `Drive it from the host, or dry-run the phases that end with a tool.`
        );
      }

      const toolCalls: ToolCall[] = ctx.tools
        .filter((t) => t.name !== ctx.phaseEndToolName && callable.has(t.name))
        .map((t) => ({ id: `dry_${++calls}`, name: t.name, input: build("toolInput", t.name, t.input) }));

      if (toolCalls.length > 0) {
        appendAssistantTurn(conversation, ctx, null, toolCalls);
        await dispatchAndAppend(toolCalls, conversation, ctx);
        ctx.signal.throwIfAborted();
        ctx.consumeTurn();
      }

      const fixture = opts.deliverables?.[ctx.phaseEndToolName];
      const payload = build(
        "deliverable",
        ctx.phaseEndToolName,
        endTool.input,
        fixture !== undefined ? { value: fixture } : undefined
      );
      appendAssistantTurn(conversation, ctx, null, [
        { id: `dry_${++calls}`, name: ctx.phaseEndToolName, input: payload },
      ]);
      return { payload, conversation };
    },

    async runStructured({ schema }): Promise<unknown> {
      return build("checklist", "checklist", schema);
    },
  };
}

/**
 * How much of the agent's own code a dry run is allowed to execute.
 *
 * `none` exercises the pipeline only. `safe` also calls tools that declare no
 * mutation, which is where most wiring bugs are. `all` calls everything,
 * including handlers that change the world, and is only for a workspace where
 * that is fine.
 */
export type ToolPolicy = "none" | "safe" | "all";

/**
 * Tool names a dry run may call under `policy`.
 *
 * `delegate` and the side-quest proposal are never included: a delegation batch
 * has to name real children, fit the turn balance and declare write-sets, and a
 * value synthesized from the schema satisfies none of that. A side quest waits
 * on a host approval that a dry run has no user to ask.
 */
export function callableTools(summary: AgentSummary, policy: ToolPolicy): readonly string[] {
  if (policy === "none") return [];
  const names = new Set<string>();
  for (const { phase } of eachPhase(summary)) {
    for (const t of phase.tools) {
      if (t.kind === "tool" && (policy === "all" || !t.mutates)) names.add(t.name);
      // A custom sub-agent's handler is arbitrary TypeScript with nothing to
      // declare that it mutates, so `safe` cannot vouch for it.
      if (t.kind === "customSubAgent" && policy === "all") names.add(t.name);
      if (t.kind === "subAgent" && (policy === "all" || !mutatesAnywhere(t.agent))) names.add(t.name);
    }
  }
  return [...names];
}

function mutatesAnywhere(summary: AgentSummary): boolean {
  for (const { phase } of eachPhase(summary)) {
    for (const t of phase.tools) {
      if (t.kind === "tool" && t.mutates) return true;
      if (t.kind === "customSubAgent") return true;
    }
  }
  return false;
}

/**
 * Return `decl` with every declared `adapter` removed, so a session's own
 * adapter reaches every phase, checklist and sub-agent.
 *
 * Sharing is preserved: a sub-agent declaration reached from two places comes
 * back as one object, as it was.
 */
export function stripAdapters(decl: AgentDecl): AgentDecl {
  return stripAgent(decl, new Map());
}

type ToolLike = AgentDecl["tools"][number];

function stripAgent(decl: AgentDecl, seen: Map<AgentDecl, AgentDecl>): AgentDecl {
  const cached = seen.get(decl);
  if (cached) return cached;

  const { adapter: _adapter, ...rest } = decl;
  const out: { -readonly [K in keyof AgentDecl]: AgentDecl[K] } = { ...rest };
  seen.set(decl, out as AgentDecl);

  out.tools = decl.tools.map((t) => stripTool(t, seen));
  out.phases = decl.phases.map((p) => stripPhase(p, seen));
  if (decl.sideQuests) out.sideQuests = stripSideQuests(decl.sideQuests);
  return out as AgentDecl;
}

function stripPhase(phase: PhaseDecl, seen: Map<AgentDecl, AgentDecl>): PhaseDecl {
  const { adapter: _adapter, ...rest } = phase;
  const out: PhaseDecl = {
    ...rest,
    tools: phase.tools.map((t) => stripTool(t, seen)),
    ...(phase.checklist ? { checklist: stripChecklist(phase.checklist) } : {}),
  };
  return out;
}

function stripChecklist(checklist: ChecklistDecl): ChecklistDecl {
  const { adapter: _adapter, ...rest } = checklist;
  return rest;
}

function stripSideQuests(spec: SideQuestsDecl): SideQuestsDecl {
  const { adapter: _adapter, ...rest } = spec;
  return rest;
}

function stripTool(t: ToolLike, seen: Map<AgentDecl, AgentDecl>): ToolLike {
  return t.kind === "subAgent" ? { ...t, agent: stripAgent(t.agent, seen) } : t;
}
