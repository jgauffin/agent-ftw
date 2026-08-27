/**
 * Finds where a phase is declared in the source, so a lint finding lands on a
 * line and clicking a phase in the tree opens the right place.
 *
 * This matches text, not syntax. It is the fallback for the cases the source
 * layer cannot address — a phase built by a factory, a declaration in a module
 * the walk could not follow — where a finding still has to appear somewhere.
 * It refuses rather than guesses when the name is ambiguous, because a
 * diagnostic on an unrelated line reads as a bug in the linter.
 */

export interface SourceRange {
  /** Character offset of the start of the matched name literal. */
  readonly start: number;
  readonly end: number;
}

/**
 * Locate `name: "<phaseName>"` inside a `phase({...})` call.
 *
 * Returns null when the name appears more than once, because pointing at the
 * wrong one is worse than pointing at nothing: a diagnostic on an unrelated
 * line reads as a bug in the linter.
 */
export function locatePhase(source: string, phaseName: string): SourceRange | null {
  const matches = [...source.matchAll(namePattern(phaseName))];
  if (matches.length !== 1) return null;
  const m = matches[0]!;
  // Point at the name literal itself rather than the whole `name:` property, so
  // the squiggle sits under the phase's identity.
  const literalOffset = m[0].length - (phaseName.length + 2);
  const start = m.index + literalOffset;
  return { start, end: start + phaseName.length + 2 };
}

function namePattern(phaseName: string): RegExp {
  const escaped = phaseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`name\\s*:\\s*["']${escaped}["']`, "g");
}

// Offset → line/character lives with the rest of the offset arithmetic, and is
// re-exported here because everything that needs an editor range already
// imports from this module.
export { positionAt } from "../source/text.js";
