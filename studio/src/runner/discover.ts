/**
 * Finds the agents a module exports.
 *
 * Importing the user's module runs everything at its top level. That is the
 * price of getting the live declaration, handlers and adapters and all, rather
 * than a parsed approximation of it. It is worth stating plainly in the docs
 * rather than working around.
 */

import { pathToFileURL } from "node:url";
import type { DiscoveredAgent } from "../protocol.js";
import type { AgentLib } from "./lib.js";

export interface Discovery {
  readonly agents: readonly DiscoveredAgent[];
  /** Live declarations by export name, for a subsequent inspect or run. */
  readonly declsByExport: ReadonlyMap<string, unknown>;
  /**
   * An `Adapter` the module exports, if it has one.
   *
   * `defaultAdapter` is a Session option, not an agent property, so an agent
   * that routes every phase through one model has nowhere to declare it and
   * the studio has nothing to run it with. An exported `adapter` is the
   * lightest place to say which model this file's agents belong to, and it
   * keeps the choice in the user's code rather than in the studio's settings.
   */
  readonly adapter: unknown | null;
}

export async function discover(lib: AgentLib, file: string, maxDepth: number): Promise<Discovery> {
  // Cache-busting so a re-run after an edit picks up the change. ESM has no
  // module-cache eviction; a fresh query string is the supported way.
  const url = `${pathToFileURL(file).href}?studio=${Date.now()}`;
  const mod = (await import(url)) as Record<string, unknown>;

  const declsByExport = new Map<string, AgentShape>();
  for (const [exportName, value] of Object.entries(mod)) {
    if (isAgentDecl(value)) declsByExport.set(exportName, value);
  }

  const parents = containment(declsByExport);
  const agents: DiscoveredAgent[] = [...declsByExport].map(([exportName, decl]) => {
    const parent = parents.get(exportName);
    return {
      ...describe(lib, exportName, decl, maxDepth),
      ...(parent !== undefined ? { containedBy: parent } : {}),
    };
  });

  return { agents, declsByExport, adapter: findAdapter(mod) };
}

/**
 * Which exported agents another exported agent contracts.
 *
 * A file that declares a coordinator normally exports its children too, because
 * the studio reads exports and a child nobody exported cannot be run on its
 * own. So three exports usually mean one tree seen from three places, and only
 * one of them is the whole thing.
 */
function containment(decls: ReadonlyMap<string, AgentShape>): Map<string, string> {
  const parents = new Map<string, string>();

  for (const [name, decl] of decls) {
    for (const [otherName, other] of decls) {
      if (otherName === name) continue;
      if (reaches(other, decl, new Set())) {
        parents.set(name, otherName);
        break;
      }
    }
  }
  return parents;
}

/** Whether `from` can contract `target`, directly or through another sub-agent. */
function reaches(from: AgentShape, target: AgentShape, seen: Set<unknown>): boolean {
  if (seen.has(from)) return false;
  seen.add(from);

  for (const tool of subAgentsOf(from)) {
    if (tool === target) return true;
    if (reaches(tool, target, seen)) return true;
  }
  return false;
}

function subAgentsOf(decl: AgentShape): AgentShape[] {
  const tools = [...(decl.tools ?? []), ...decl.phases.flatMap((p) => (p as PhaseShape).tools ?? [])];
  return tools
    .map((t) => (t as { kind?: unknown; agent?: unknown }))
    .filter((t) => t.kind === "subAgent" && isAgentDecl(t.agent))
    .map((t) => t.agent as AgentShape);
}

const ADAPTER_EXPORTS = ["adapter", "studioAdapter", "defaultAdapter"] as const;

function findAdapter(mod: Record<string, unknown>): unknown | null {
  for (const name of ADAPTER_EXPORTS) {
    const value = mod[name];
    if (isAdapter(value)) return value;
  }
  return null;
}

function isAdapter(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { runUntilPhaseEnd?: unknown; runStructured?: unknown };
  return typeof v.runUntilPhaseEnd === "function" && typeof v.runStructured === "function";
}

function describe(lib: AgentLib, exportName: string, decl: AgentShape, maxDepth: number): DiscoveredAgent {
  const base = { exportName, agentName: decl.name, phaseCount: decl.phases.length };
  try {
    lib.validate(decl, { maxDepth });
    return base;
  } catch (e) {
    // A declaration that fails to compile is still listed. Hiding it would
    // leave the panel showing nothing at all for a file that plainly has an
    // agent in it, which reads as "the studio is broken".
    return { ...base, compileError: e instanceof Error ? e.message : String(e) };
  }
}

interface AgentShape {
  readonly kind: "agent";
  readonly name: string;
  readonly phases: readonly unknown[];
  readonly tools?: readonly unknown[];
}

interface PhaseShape {
  readonly tools?: readonly unknown[];
}

function isAgentDecl(value: unknown): value is AgentShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; name?: unknown; phases?: unknown };
  return v.kind === "agent" && typeof v.name === "string" && Array.isArray(v.phases);
}
