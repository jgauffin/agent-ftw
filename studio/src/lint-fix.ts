/**
 * Turning a lint finding into an edit.
 *
 * Only the findings whose fix is deterministic get one. A rule that offers two
 * genuinely different ways out is a design decision, not a fix, and offering to
 * pick one for the user would be guessing on their behalf.
 *
 * Kept free of `vscode` so the whole decision — which findings are fixable,
 * what the edit is, and when to refuse — is testable without an editor. The
 * extension module above this one is glue.
 */

import * as ts from "typescript";
import type { AgentNode, Finding } from "./protocol.js";
import type { SourceSet } from "./source/parse.js";
import { type Address, propertyName, propertyOf, schemaSite } from "./source/locate.js";
import { emitSchema, styleOf } from "./source/emit.js";
import { insertProperty } from "./source/edit.js";
import type { Range, TextEdit } from "./source/text.js";

/** The lint codes a quick-fix exists for. */
export const FIXABLE = new Set(["deliverable.no-required", "deliverable.unexplained-string"]);

export interface FixPlan {
  readonly title: string;
  readonly edits: readonly TextEdit[];
  /**
   * Where to leave the cursor once the edit lands, for a fix that inserts a
   * placeholder the user still has to fill in.
   */
  readonly selection: { readonly file: string; readonly range: Range } | null;
  /** The schema node the fix acts on, for the verify pass to re-find. */
  readonly address: Address;
  /** What that node must read back as once the edit lands. */
  readonly verify: { readonly property: string; readonly text: string };
}

export type FixOutcome =
  | { readonly kind: "fix"; readonly plan: FixPlan }
  | { readonly kind: "refused"; readonly reason: string };

/**
 * The tree path a lint finding is about.
 *
 * Lint keys by `agentName/phaseName`, so a nested agent's finding reads
 * `implementer/implement` where its tree path reads `lead>implementer/implement`.
 * The projected tree is what closes that gap, and two agents sharing a name are
 * refused rather than guessed between.
 */
export function findingToAddress(tree: AgentNode, finding: Finding): Address | { readonly refused: string } {
  const [head, pointer] = splitPointer(finding.path);
  const [agentName, phaseName, construct] = head.split("/");
  if (!agentName || !phaseName || !construct) {
    return { refused: `\`${finding.path}\` does not name a phase property.` };
  }

  const paths = agentPaths(tree).filter((a) => a.name === agentName).map((a) => a.path);
  if (paths.length === 0) return { refused: `No agent named "${agentName}" is in the tree.` };
  if (paths.length > 1) return { refused: `${paths.length} agents in the tree are named "${agentName}".` };

  return {
    path: `${paths[0]!}/${phaseName}`,
    construct: "phase",
    field: construct,
    ...(pointer !== null ? { pointer } : {}),
  };
}

/**
 * Build the edit one finding asks for.
 *
 * @param inFile The file the diagnostic is attached to. A schema that resolves
 * outside it is refused: a shared schema is probably shared, and changing it
 * through one phase's finding would silently change every other phase using it.
 */
export async function buildFix(
  set: SourceSet,
  entryFile: string,
  tree: AgentNode,
  finding: Finding,
  inFile: string
): Promise<FixOutcome> {
  if (!FIXABLE.has(finding.code)) return { kind: "refused", reason: `\`${finding.code}\` has no deterministic fix.` };

  const address = findingToAddress(tree, finding);
  if ("refused" in address) return { kind: "refused", reason: address.refused };

  const site = await schemaSite(set, entryFile, address);
  if (site.kind !== "found") return { kind: "refused", reason: site.reason };
  if (site.site.readOnly) {
    return { kind: "refused", reason: site.site.readOnlyReason ?? "The schema is not one this may rewrite." };
  }
  if (site.site.file.file !== inFile) {
    return { kind: "refused", reason: `The schema is declared in ${site.site.file.file}, not in this file.` };
  }

  return finding.code === "deliverable.no-required"
    ? requireDeclaredProperties(site.site.file, site.site.object, address)
    : describeTheString(site.site.file, site.site.object, address);
}

/**
 * `deliverable.no-required`: list the properties the object already declares.
 *
 * The names come from the source rather than from the finding, so the inserted
 * array matches what is actually written even if the projection and the file
 * have drifted apart.
 */
function requireDeclaredProperties(
  file: Parameters<typeof insertProperty>[0],
  object: ts.ObjectLiteralExpression,
  address: Address
): FixOutcome {
  const properties = propertyOf(object, "properties");
  const value = properties ? properties.initializer : null;
  if (!value || !ts.isObjectLiteralExpression(value)) {
    return { kind: "refused", reason: "The object's `properties` is not a literal, so there is nothing to list." };
  }

  const names = value.properties
    .filter(ts.isPropertyAssignment)
    .map(propertyName)
    .filter((n): n is string => n !== null);
  if (names.length === 0) return { kind: "refused", reason: "The object declares no properties to require." };

  const style = styleOf(file);
  const required = emitSchema(names, style);
  return {
    kind: "fix",
    plan: {
      title: `Require ${names.map((n) => `\`${n}\``).join(", ")}`,
      edits: insertProperty(file, object, "required", required, { after: "properties" }),
      selection: null,
      address,
      verify: { property: "required", text: required },
    },
  };
}

/**
 * `deliverable.unexplained-string`: add an empty `description` to type into.
 *
 * Empty on purpose. `lint` only clears the finding once there is real text, so
 * a blank keeps the warning up until someone writes something, and generated
 * prose that reads like advice is worse than a blank because it invites being
 * pasted unchanged.
 */
function describeTheString(
  file: Parameters<typeof insertProperty>[0],
  object: ts.ObjectLiteralExpression,
  address: Address
): FixOutcome {
  if (propertyOf(object, "description")) {
    return { kind: "refused", reason: "The property already has a description." };
  }

  const style = styleOf(file);
  const empty = `${style.quote}${style.quote}`;
  const edits = insertProperty(file, object, "description", empty, { after: "type" });
  const edit = edits[0]!;
  const cursor = edit.start + edit.newText.indexOf(empty) + 1;

  return {
    kind: "fix",
    plan: {
      title: "Add a description to write into",
      edits,
      selection: { file: file.file, range: { start: cursor, end: cursor } },
      address,
      verify: { property: "description", text: empty },
    },
  };
}

// ---------------------------------------------------------------------------

function splitPointer(path: string): [string, string | null] {
  const hash = path.indexOf("#");
  return hash < 0 ? [path, null] : [path.slice(0, hash), path.slice(hash)];
}

/** Every agent in the tree with the path the source layer addresses it by. */
function agentPaths(tree: AgentNode): readonly { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [{ name: tree.name, path: tree.path }];
  const walkTools = (tools: readonly AgentNode["tools"][number][]): void => {
    for (const tool of tools) {
      if (tool.kind !== "subAgent") continue;
      out.push(...agentPaths(tool.agent));
    }
  };
  walkTools(tree.tools);
  for (const phase of tree.phases) walkTools(phase.tools);

  const seen = new Set<string>();
  return out.filter((entry) => (seen.has(entry.path) ? false : (seen.add(entry.path), true)));
}
