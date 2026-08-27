/**
 * Which of the workspace's tools a given agent can be offered.
 *
 * Deliberately imports nothing but the wire types. The webview reads these to
 * build its picker, and anything that reached the TypeScript compiler from here
 * would be bundled into the panel script along with it.
 *
 * Finding the tools in the first place is {@link ./catalog-scan.ts}.
 */

import type { CatalogTool } from "./protocol.js";

/**
 * The tools that can be assigned from a given file.
 *
 * A `const` its own module keeps to itself is reachable only from that module,
 * so offering it anywhere else would produce an import of something that is not
 * exported. Within its own file it needs no import at all and is fair game.
 */
export function offerableIn(catalog: readonly CatalogTool[], file: string): readonly CatalogTool[] {
  return catalog.filter((t) => t.exported || t.file === file);
}

/**
 * Tools declared in the workspace that nothing in the projected tree can reach.
 *
 * Worth surfacing on its own: the tree only holds what is reachable from a
 * phase, so a tool wired to nothing is invisible in the panel, and "defined
 * here, nothing can call it" is usually a wiring mistake rather than a spare
 * part.
 */
export function unreachable(catalog: readonly CatalogTool[], reachable: ReadonlySet<string>): readonly CatalogTool[] {
  return catalog.filter((t) => !reachable.has(t.name));
}
