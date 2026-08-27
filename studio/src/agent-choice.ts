/**
 * Which agent a file opens on.
 *
 * A file that declares a coordinator normally exports its children too, because
 * the studio reads exports and a child nobody exported cannot be run on its
 * own. So several exports usually mean one tree seen from several places rather
 * than several trees, and refusing to choose between them shows an empty panel
 * for a file that plainly has a tree in it.
 *
 * Kept free of `vscode` so the rule is testable, like everything else in this
 * layer.
 */

import type { DiscoveredAgent } from "./protocol.js";

/**
 * The one agent that can be opened without guessing, or null when the choice is
 * a real question.
 *
 * `examples/08-coordinator.ts` exports `implementer`, `reviewer` and `lead`;
 * only `lead` contracts the other two, so it is the whole thing. Two agents
 * that contain neither each other nor anything in common are two trees, and
 * picking one of those would show the wrong one half the time.
 */
export function openable(agents: readonly DiscoveredAgent[]): DiscoveredAgent | null {
  if (agents.length === 1) return agents[0]!;
  const roots = agents.filter((a) => a.containedBy === undefined);
  return roots.length === 1 ? roots[0]! : null;
}
