/**
 * Projects an `AgentDecl` into the plain-data {@link AgentNode} the panel
 * renders.
 *
 * The projection runs against the *compiled* agent rather than the raw
 * declaration, because the tools a designer most needs to see are the ones
 * nobody wrote: `finish_<phase>`, `delegate` on a coordinator, and
 * `propose_side_quest`. Those exist only after `validate`.
 */

import type { AgentNode, Finding, PhaseNode, ToolNode } from "../protocol.js";
import type { AgentLib } from "./lib.js";

/** How the studio addresses a sub-agent that appears under a parent. */
function childPath(parentPath: string, agentName: string): string {
  return `${parentPath}>${agentName}`;
}

export interface ProjectResult {
  readonly tree: AgentNode;
  readonly findings: readonly Finding[];
}

/**
 * Compile, lint, and project one agent declaration.
 *
 * @param lib The library, resolved from the user's own project.
 * @param decl The agent to project.
 * @param maxDepth Depth limit to compile against; matches what the run will use.
 */
export function project(
  lib: AgentLib,
  decl: unknown,
  maxDepth: number,
  inputSchemas: ReadonlyMap<unknown, unknown> = new Map()
): ProjectResult {
  const agentDecl = decl as AgentDeclish;
  const findings = lib.lint(agentDecl as never) as readonly Finding[];
  const tree = projectAgent(lib, agentDecl, agentDecl.name, 0, maxDepth, findings, new Set(), inputSchemas);
  return { tree, findings };
}

/**
 * Map every agent that some `subAgent` wrapper calls to the input schema that
 * wrapper declares.
 *
 * An agent never says what it expects to be given; only a parent calling it
 * does. So the schema for `implementer` lives on the `subAgent({ input })` in
 * whichever agent contracts it, which may be a different export in the same
 * file.
 */
export function collectInputSchemas(decls: Iterable<unknown>): Map<unknown, unknown> {
  const out = new Map<unknown, unknown>();
  const seen = new Set<unknown>();

  const visit = (agent: AgentDeclish): void => {
    if (seen.has(agent)) return;
    seen.add(agent);
    const tools = [...agent.tools, ...agent.phases.flatMap((p) => phaseTools(p) ?? [])];
    for (const t of tools) {
      if (t.kind !== "subAgent" || !t.agent) continue;
      if (!out.has(t.agent) && t.input !== undefined) out.set(t.agent, t.input);
      visit(t.agent);
    }
  };

  for (const d of decls) visit(d as AgentDeclish);
  return out;
}

/** Structural view of the declaration types, so this file needs no library types at compile time. */
interface AgentDeclish {
  readonly name: string;
  readonly role?: "worker" | "coordinator";
  readonly adapter?: unknown;
  readonly tools: readonly ToolDeclish[];
  readonly delegable?: readonly { readonly name: string }[];
  readonly phases: readonly PhaseDeclish[];
  readonly sideQuests?: {
    readonly mode: "off" | "agent";
    readonly catalog: readonly { readonly name: string }[];
    readonly deliverable: unknown;
  };
}

interface PhaseDeclish {
  readonly name: string;
  readonly prompt: string;
  readonly deliverable: unknown;
  readonly turnBudget?: number;
  readonly review?: boolean;
  readonly adapter?: unknown;
  readonly onAssistantText?: unknown;
  readonly checklist?: { readonly prompt: string; readonly schema: unknown; readonly adapter?: unknown };
}

interface ToolDeclish {
  readonly kind: string;
  readonly name: string;
  readonly description?: string;
  readonly input?: unknown;
  readonly output?: unknown;
  readonly mutates?: boolean;
  readonly accept?: unknown;
  readonly maxRejects?: number;
  readonly agent?: AgentDeclish;
  readonly children?: ReadonlyMap<string, unknown>;
  readonly delegable?: ReadonlyMap<string, unknown>;
  readonly spec?: { readonly catalog: readonly { readonly name: string }[] };
}

function projectAgent(
  lib: AgentLib,
  decl: AgentDeclish,
  path: string,
  depth: number,
  maxDepth: number,
  findings: readonly Finding[],
  ancestry: ReadonlySet<string>,
  inputSchemas: ReadonlyMap<unknown, unknown>
): AgentNode {
  // Compiling here is what surfaces the injected tools. A sub-agent sitting at
  // the depth limit legitimately fails to compile, so project it from the raw
  // declaration rather than losing the whole tree to one leaf.
  const compiled = tryCompile(lib, decl, depth, maxDepth);

  const phases: PhaseNode[] = decl.phases.map((p, i) => {
    const cp = compiled?.phases[i];
    const exposed = (cp?.exposedTools ?? [...decl.tools, ...(phaseTools(p) ?? [])]) as readonly ToolDeclish[];
    return {
      name: p.name,
      path: `${path}/${p.name}`,
      prompt: p.prompt,
      deliverable: p.deliverable,
      turnBudget: p.turnBudget ?? lib.DEFAULT_TURN_BUDGET,
      turnBudgetDeclared: p.turnBudget !== undefined,
      review: p.review === true,
      terminator: cp?.hasExternalTerminator ? "external" : "tool",
      phaseEndToolName: cp?.phaseEndToolName ?? `finish_${p.name}`,
      checklist: p.checklist
        ? { prompt: p.checklist.prompt, schema: p.checklist.schema, ownAdapter: p.checklist.adapter !== undefined }
        : null,
      adapterDeclared: p.adapter !== undefined,
      onAssistantTextDeclared: p.onAssistantText !== undefined,
      tools: exposed.map((t) => projectTool(lib, t, path, depth, maxDepth, findings, ancestry, inputSchemas)),
      findings: findingsFor(findings, decl.name, p.name),
    };
  });

  return {
    name: decl.name,
    path,
    role: decl.role ?? "worker",
    adapterDeclared: decl.adapter !== undefined,
    phases,
    tools: decl.tools.map((t) => projectTool(lib, t, path, depth, maxDepth, findings, ancestry, inputSchemas)),
    delegable: (decl.delegable ?? []).map((t) => t.name),
    inputSchema: inputSchemas.get(decl) ?? null,
    sideQuests: decl.sideQuests
      ? {
          mode: decl.sideQuests.mode,
          catalog: decl.sideQuests.catalog.map((t) => t.name),
          deliverable: decl.sideQuests.deliverable,
        }
      : null,
  };
}

function projectTool(
  lib: AgentLib,
  t: ToolDeclish,
  parentPath: string,
  depth: number,
  maxDepth: number,
  findings: readonly Finding[],
  ancestry: ReadonlySet<string>,
  inputSchemas: ReadonlyMap<unknown, unknown>
): ToolNode {
  switch (t.kind) {
    case "subAgent": {
      const child = t.agent as AgentDeclish;
      const path = childPath(parentPath, child.name);
      // A sub-agent reachable twice would otherwise be projected twice, and a
      // declaration cycle (which compile rejects) would not terminate here.
      const nested = ancestry.has(child.name)
        ? leafAgent(child, path)
        : projectAgent(
            lib,
            child,
            path,
            depth + 1,
            maxDepth,
            findings,
            new Set([...ancestry, child.name]),
            inputSchemas
          );
      return {
        kind: "subAgent",
        name: t.name,
        description: t.description ?? "",
        input: t.input,
        hasAccept: t.accept !== undefined,
        maxRejects: t.maxRejects ?? 1,
        agent: nested,
      };
    }
    case "customSubAgent":
      return {
        kind: "customSubAgent",
        name: t.name,
        description: t.description ?? "",
        input: t.input,
        output: t.output,
      };
    case "delegate":
      return {
        kind: "delegate",
        name: t.name,
        children: [...(t.children?.keys() ?? [])],
        delegable: [...(t.delegable?.keys() ?? [])],
      };
    case "sideQuestProposal":
      return {
        kind: "sideQuestProposal",
        name: t.name,
        catalog: (t.spec?.catalog ?? []).map((c) => c.name),
      };
    default:
      return {
        kind: "tool",
        name: t.name,
        description: t.description ?? "",
        input: t.input,
        mutates: t.mutates === true,
      };
  }
}

/** A sub-agent we refuse to walk into, rendered as a stub so the tree still shows it. */
function leafAgent(decl: AgentDeclish, path: string): AgentNode {
  return {
    name: decl.name,
    path,
    role: decl.role ?? "worker",
    adapterDeclared: decl.adapter !== undefined,
    phases: [],
    tools: [],
    delegable: [],
    inputSchema: null,
    sideQuests: null,
  };
}

interface Compiledish {
  readonly phases: readonly {
    readonly exposedTools: readonly unknown[];
    readonly phaseEndToolName: string;
    readonly hasExternalTerminator: boolean;
  }[];
}

function tryCompile(lib: AgentLib, decl: AgentDeclish, depth: number, maxDepth: number): Compiledish | null {
  try {
    return lib.validate(decl as never, { maxDepth, depth }) as unknown as Compiledish;
  } catch {
    // Depth limit or a structural problem. The caller falls back to the raw
    // declaration; `validate` is also run separately so the error is reported
    // once, in the place that can show it.
    return null;
  }
}

function phaseTools(p: PhaseDeclish): readonly ToolDeclish[] | undefined {
  return (p as { tools?: readonly ToolDeclish[] }).tools;
}

/**
 * Lint addresses a construct as `agent/phase/...`, matching how the framework
 * names things everywhere else, so findings attach by name rather than by the
 * studio's own tree path.
 */
function findingsFor(findings: readonly Finding[], agentName: string, phaseName: string): Finding[] {
  const prefix = `${agentName}/${phaseName}/`;
  return findings.filter((f) => f.path.startsWith(prefix));
}
