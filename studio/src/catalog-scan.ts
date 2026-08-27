/**
 * Every tool declared in a file, whether or not anything calls it.
 *
 * The projected tree only holds what is reachable from a phase, so a
 * `const search = tool({...})` wired to nothing is invisible in the panel
 * today. That set is exactly what an assignment picker has to offer, and it is
 * also how a declared name resolves to the identifier that actually compiles:
 * `delegable: ["search"]` does not, `delegable: [search]` does.
 *
 * Kept free of `vscode`, like the rest of this layer. Enumerating the workspace
 * needs the editor's API and lives in `extension/tool-catalog.ts`; deciding
 * what counts as a tool does not.
 */

import type { CatalogTool } from "./protocol.js";
import { inventory, type DeclKind } from "./source/inventory.js";
import { parseFile } from "./source/parse.js";

/** Directories a scan must never walk. `node_modules` is where it would spend all its time. */
export const SCAN_EXCLUDE = "**/{node_modules,out,dist,.git,.agent-ftw,coverage}/**";

/**
 * A text test cheap enough to run on every file before parsing any of them.
 *
 * The overwhelming majority of a workspace's TypeScript declares no tools at
 * all, and the parser is the expensive part.
 */
const DECLARES_SOMETHING = /\b(tool|subAgent|customSubAgent)\s*\(/;

const OFFERABLE: readonly DeclKind[] = ["tool", "subAgent", "customSubAgent"];

export function mightDeclareATool(text: string): boolean {
  return DECLARES_SOMETHING.test(text);
}

/** The tools one file declares, or nothing when it declares none. */
export function scanFile(file: string, text: string): readonly CatalogTool[] {
  if (!mightDeclareATool(text)) return [];

  const inv = inventory(parseFile(file, { text, version: 0 }));
  return inv.declarations
    .filter((d): d is typeof d & { kind: "tool" | "subAgent" | "customSubAgent" } =>
      (OFFERABLE as readonly string[]).includes(d.kind)
    )
    .map((d) => ({
      kind: d.kind,
      identifier: d.identifier,
      name: d.name,
      description: d.description,
      mutates: d.mutates,
      file,
      line: d.line,
      exported: d.exported,
    }));
}
