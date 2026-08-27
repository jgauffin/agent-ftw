/**
 * Geometry for the tree view.
 *
 * The panel's other surfaces flatten the tree into indented rows, which says
 * what is there without saying what its shape is. This lays the same tree out
 * as boxes and edges so the shape is the thing you see: an agent is a box, its
 * phases are the rows inside it in declared order, and an edge leaves the phase
 * that declares a sub-agent and arrives at that sub-agent's box.
 *
 * Depth runs left to right rather than top to bottom. A phase row has its own
 * vertical position inside the box, so an edge leaving sideways can say *which*
 * phase declared the child; an edge leaving the bottom could not.
 *
 * Pure geometry, no colours and no run state. Those change on every trace event
 * while this changes only when the declaration does, so the panel computes them
 * separately and this one stays cheap to leave alone.
 */

import type { AgentNode, ToolNode } from "../protocol.js";

const BOX_WIDTH = 200;
/** Room for the agent's own name above its phase rows. */
const HEADER_HEIGHT = 28;
const ROW_HEIGHT = 22;
/** Inset of a phase row inside its agent's box. */
const ROW_INSET = 6;
const BOX_FOOT = 6;
/** Horizontal room between one depth and the next, which the edges cross. */
const COLUMN_GAP = 72;
const SIBLING_GAP = 20;
const CANVAS_PAD = 12;

export interface LayoutBox {
  /** The same address the navigator selects by: `lead`, `lead/deliver`, `lead>implementer`. */
  readonly path: string;
  readonly kind: "agent" | "phase";
  readonly label: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** The agent box a phase row sits in. Empty on an agent. */
  readonly parent: string;
  /** Agent only. Empty on a phase row. */
  readonly role: "worker" | "coordinator" | "";
  /** Whether anything reachable here can change the world outside the run. */
  readonly mutates: boolean;
}

export interface LayoutEdge {
  /** Phase path, or the agent's own path when the sub-agent is declared agent-wide. */
  readonly from: string;
  readonly to: string;
  readonly d: string;
}

export interface GraphLayout {
  readonly boxes: readonly LayoutBox[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
}

/** One agent and everything below it, measured but not yet placed. */
interface Branch {
  readonly node: AgentNode;
  readonly ownHeight: number;
  /** Vertical room this agent and its whole subtree need. */
  readonly band: number;
  readonly links: readonly Link[];
}

interface Link {
  /** Where the declaration lives: a phase path, or the agent path when agent-wide. */
  readonly from: string;
  readonly child: Branch;
}

export function layout(root: AgentNode): GraphLayout {
  const branch = measure(root, new Set());
  const boxes: LayoutBox[] = [];
  const edges: LayoutEdge[] = [];
  place(branch, 0, CANVAS_PAD, CANVAS_PAD, boxes, edges);

  const depth = deepest(branch, 0);
  return {
    boxes,
    edges,
    width: CANVAS_PAD * 2 + BOX_WIDTH + depth * (BOX_WIDTH + COLUMN_GAP),
    height: CANVAS_PAD * 2 + branch.band,
    viewBox: `0 0 ${CANVAS_PAD * 2 + BOX_WIDTH + depth * (BOX_WIDTH + COLUMN_GAP)} ${CANVAS_PAD * 2 + branch.band}`,
  };
}

function measure(node: AgentNode, ancestry: ReadonlySet<string>): Branch {
  const ownHeight = HEADER_HEIGHT + node.phases.length * ROW_HEIGHT + BOX_FOOT;
  const seen = new Set(ancestry).add(node.path);
  const links: Link[] = [];

  for (const declaration of subAgentDeclarations(node)) {
    // The projection already refuses a cycle, so this only fires on a tree that
    // reached here some other way. Dropping the repeat beats recursing forever.
    if (seen.has(declaration.child.path)) continue;
    links.push({ from: declaration.from, child: measure(declaration.child, seen) });
  }

  const childrenBand = links.reduce((sum, l) => sum + l.child.band, 0) + Math.max(0, links.length - 1) * SIBLING_GAP;
  return { node, ownHeight, band: Math.max(ownHeight, childrenBand), links };
}

/** A sub-agent, and the declaration it was reached through. */
export interface SubAgentDeclaration {
  /** The agent's own path when it is declared agent-wide, otherwise a phase path. */
  readonly from: string;
  readonly child: AgentNode;
  /** The `subAgent` wrapper itself, which is where the description and acceptance live. */
  readonly tool: SubAgentTool;
}

/** The `subAgent` variant of `ToolNode`, narrowed so callers need no cast. */
export type SubAgentTool = Extract<ToolNode, { kind: "subAgent" }>;

/**
 * Every sub-agent this agent declares, once each, with where it was declared.
 *
 * An agent-level tool is exposed on every phase by the compiler, so reading the
 * phases alone would report one declaration as several. The agent's own list is
 * checked first for that reason: a child that appears there was written once,
 * for the whole agent, and everything that renders it should say so.
 *
 * Exported because the navigator has the same problem and must not answer it
 * differently: two panes disagreeing about how many children an agent has is
 * worse than either answer on its own.
 */
export function subAgentDeclarations(node: AgentNode): SubAgentDeclaration[] {
  const out: SubAgentDeclaration[] = [];
  const claimed = new Set<string>();

  for (const t of node.tools) {
    if (t.kind !== "subAgent" || claimed.has(t.agent.path)) continue;
    claimed.add(t.agent.path);
    out.push({ from: node.path, child: t.agent, tool: t });
  }

  for (const phase of node.phases) {
    for (const t of phase.tools) {
      if (t.kind !== "subAgent" || claimed.has(t.agent.path)) continue;
      claimed.add(t.agent.path);
      out.push({ from: phase.path, child: t.agent, tool: t });
    }
  }

  return out;
}

function place(
  branch: Branch,
  depth: number,
  bandTop: number,
  left: number,
  boxes: LayoutBox[],
  edges: LayoutEdge[]
): void {
  const x = left + depth * (BOX_WIDTH + COLUMN_GAP);
  const y = bandTop + (branch.band - branch.ownHeight) / 2;
  const node = branch.node;

  boxes.push({
    path: node.path,
    kind: "agent",
    label: node.name,
    x: round(x),
    y: round(y),
    width: BOX_WIDTH,
    height: branch.ownHeight,
    parent: "",
    role: node.role,
    mutates: holdsMutatingTool(node),
  });

  const rowY = new Map<string, number>();
  for (const [i, phase] of node.phases.entries()) {
    const top = y + HEADER_HEIGHT + i * ROW_HEIGHT;
    rowY.set(phase.path, top + ROW_HEIGHT / 2);
    boxes.push({
      path: phase.path,
      kind: "phase",
      label: phase.name,
      x: round(x + ROW_INSET),
      y: round(top),
      width: BOX_WIDTH - ROW_INSET * 2,
      height: ROW_HEIGHT,
      parent: node.path,
      role: "",
      mutates: false,
    });
  }

  const childrenBand =
    branch.links.reduce((sum, l) => sum + l.child.band, 0) + Math.max(0, branch.links.length - 1) * SIBLING_GAP;
  let cursor = bandTop + (branch.band - childrenBand) / 2;

  for (const link of branch.links) {
    place(link.child, depth + 1, cursor, left, boxes, edges);
    const target = boxes.find((b) => b.path === link.child.node.path)!;
    edges.push({
      from: link.from,
      to: link.child.node.path,
      // An agent-wide declaration leaves the header, since it belongs to no one phase.
      d: curve(x + BOX_WIDTH, rowY.get(link.from) ?? y + HEADER_HEIGHT / 2, target.x, target.y + HEADER_HEIGHT / 2),
    });
    cursor += link.child.band + SIBLING_GAP;
  }
}

function curve(sx: number, sy: number, tx: number, ty: number): string {
  const reach = COLUMN_GAP * 0.6;
  return `M${round(sx)} ${round(sy)} C${round(sx + reach)} ${round(sy)}, ${round(tx - reach)} ${round(ty)}, ${round(tx)} ${round(ty)}`;
}

function holdsMutatingTool(node: AgentNode): boolean {
  const tools = [...node.tools, ...node.phases.flatMap((p) => p.tools)];
  return tools.some((t) => t.kind === "tool" && t.mutates);
}

function deepest(branch: Branch, depth: number): number {
  return branch.links.reduce((max, l) => Math.max(max, deepest(l.child, depth + 1)), depth);
}

/** Whole pixels, so two renders of one tree produce byte-identical attributes. */
function round(n: number): number {
  return Math.round(n);
}
