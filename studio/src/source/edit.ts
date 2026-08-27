/**
 * Turning a located node and a value into character splices.
 *
 * Never a reprint. Printing an AST back out would reformat everything it
 * touched and turn a one-word change into an unreviewable diff; splicing
 * characters means comments, blank lines and the author's formatting survive by
 * construction rather than by effort.
 */

import * as ts from "typescript";
import type { LoadedFile } from "./parse.js";
import { isRelative, normalize } from "./parse.js";
import type { ArrayBinding, Binding } from "./locate.js";
import { propertyOf } from "./locate.js";
import type { ImportEntry, Inventory } from "./inventory.js";
import { type TextEdit, indentAt } from "./text.js";

export type EditOutcome =
  | { readonly kind: "edits"; readonly edits: readonly TextEdit[] }
  /** Already the case. Not a failure, and not something to write. */
  | { readonly kind: "no-change"; readonly reason: string }
  | { readonly kind: "refused"; readonly reason: string };

/** Replace a property's value in place. The binding decided this was allowed. */
export function replace(file: string, binding: Binding, newText: string): readonly TextEdit[] {
  if (binding.kind !== "literal" && binding.kind !== "concatenation") {
    throw new Error(`A ${binding.kind} binding is not something to replace.`);
  }
  return [{ file, start: binding.range.start, end: binding.range.end, newText }];
}

/**
 * Add a property that is not declared.
 *
 * Separate from `replace` because it has to choose a position inside the object
 * literal, match the surrounding indentation and get the trailing comma right,
 * none of which a replacement has to think about.
 */
export function insertProperty(
  file: LoadedFile,
  object: ts.ObjectLiteralExpression,
  name: string,
  valueText: string,
  options: { after?: string } = {}
): readonly TextEdit[] {
  const properties = object.properties;
  const multiline = file.text.slice(object.getStart(), object.getEnd()).includes("\n");

  if (properties.length === 0) {
    const inner = multiline ? `\n${indentAt(file.text, object.getStart())}  ${name}: ${valueText},\n` : ` ${name}: ${valueText} `;
    return [{ file: file.file, start: object.getStart() + 1, end: object.getEnd() - 1, newText: inner }];
  }

  const anchor = (options.after ? propertyOf(object, options.after) : null) ?? properties[properties.length - 1]!;
  const isLast = anchor === properties[properties.length - 1];
  const afterAnchor = file.text.slice(anchor.getEnd(), object.getEnd() - 1);
  const hasComma = afterAnchor.trimStart().startsWith(",");
  const at = hasComma ? anchor.getEnd() + afterAnchor.indexOf(",") + 1 : anchor.getEnd();

  // Matching the object's own trailing-comma habit keeps the diff to the added
  // line; adding one where the file has none would touch its neighbour too.
  const trailingComma = isLast ? (hasComma ? "," : "") : ",";
  const newText = multiline
    ? `\n${indentAt(file.text, anchor.getStart())}${name}: ${valueText}${trailingComma}`
    : `${hasComma ? "" : ","} ${name}: ${valueText}${isLast && hasComma ? "," : ""}`;

  return [{ file: file.file, start: at, end: at, newText }];
}

/** Append one element to an array property, creating the property when absent. */
export function appendElement(
  file: LoadedFile,
  object: ts.ObjectLiteralExpression,
  binding: ArrayBinding,
  property: string,
  elementText: string
): EditOutcome {
  if (binding.kind === "absent") {
    return { kind: "edits", edits: insertProperty(file, object, property, `[${elementText}]`) };
  }
  if (binding.kind !== "array") {
    return { kind: "refused", reason: `\`${property}\` is not an array literal.` };
  }
  if (binding.elements.some((e) => e.identifier === elementText)) {
    return { kind: "no-change", reason: `\`${property}\` already lists \`${elementText}\`.` };
  }

  const newText = elementForm(binding, elementText);
  return { kind: "edits", edits: [{ file: file.file, start: binding.insertAt, end: binding.insertAt, newText }] };
}

function elementForm(binding: Extract<ArrayBinding, { kind: "array" }>, elementText: string): string {
  if (binding.elements.length === 0) return elementText;
  if (!binding.multiline) return `${binding.needsLeadingComma ? "," : ""} ${elementText}`;
  return binding.needsLeadingComma
    ? `,\n${binding.itemIndent}${elementText}`
    : `\n${binding.itemIndent}${elementText},`;
}

/**
 * Remove an element from an array property, matched by identifier.
 *
 * The separator goes with the element, which is what keeps the remaining
 * elements' own text untouched.
 */
export function removeElement(file: LoadedFile, binding: ArrayBinding, identifier: string): EditOutcome {
  if (binding.kind !== "array") return { kind: "refused", reason: "Not an array literal." };

  const index = binding.elements.findIndex((e) => e.identifier === identifier);
  if (index < 0) return { kind: "no-change", reason: `Nothing in the array is \`${identifier}\`.` };

  const element = binding.elements[index]!;
  const previous = binding.elements[index - 1];
  const next = binding.elements[index + 1];

  if (previous) return edit(file.file, previous.span.end, element.span.end);
  if (next) return edit(file.file, element.span.start, next.span.start);

  const rest = file.text.slice(element.span.end, binding.span.end - 1);
  const comma = rest.indexOf(",");
  return edit(file.file, element.span.start, comma < 0 ? element.span.end : element.span.end + comma + 1);
}

function edit(file: string, start: number, end: number, newText = ""): EditOutcome {
  return { kind: "edits", edits: [{ file, start, end, newText }] };
}

/**
 * Insert a whole statement, anchored by the caller.
 *
 * The anchor is not cosmetic. Module-scope `const` is in temporal dead zone
 * until its statement runs, and `agent({ tools: [callReviewer] })` evaluates at
 * import time, so a wrapper emitted after its parent is an import-time crash
 * rather than a type error, and no typecheck will report it.
 */
export function insertStatement(
  file: LoadedFile,
  statementText: string,
  anchor: { beforeStatementContaining: number }
): readonly TextEdit[] {
  const target = file.ast.statements.find(
    (s) => s.getStart() <= anchor.beforeStatementContaining && anchor.beforeStatementContaining < s.getEnd()
  );
  const at = target ? target.getStart() : file.text.length;
  return [{ file: file.file, start: at, end: at, newText: `${statementText}\n\n` }];
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

/**
 * Add a binding to a named import that already exists.
 *
 * For a name whose module can only be learned from that import: the file might
 * import `phase` from `agent-ftw` or from `../src/declare/index.js`, and this
 * layer cannot know which. It never invents a specifier.
 *
 * @param siblings Names that identify the right import, e.g. the other factories.
 */
export function extendNamedImport(
  file: LoadedFile,
  inv: Inventory,
  name: string,
  siblings: readonly string[]
): EditOutcome {
  if (bindsLocally(inv, name)) return { kind: "no-change", reason: `\`${name}\` is already in scope.` };

  const target = inv.imports.find(
    (i) => i.kind === "named" && i.extendAt !== null && i.bindings.some((b) => siblings.includes(b.imported))
  );
  if (!target) {
    return {
      kind: "refused",
      reason: `No extendable named import carries ${siblings.map((s) => `\`${s}\``).join(" or ")}, so there is no specifier to add \`${name}\` to.`,
    };
  }
  return { kind: "edits", edits: [bindingEdit(file, target, name)] };
}

/**
 * Make an identifier available in a file, given the module that exports it.
 *
 * An identifier already bound to something else is refused rather than aliased:
 * an alias would have to be threaded through the emitted text and through every
 * consumer's display, and the user can rename in two seconds.
 */
export function ensureImport(file: LoadedFile, inv: Inventory, identifier: string, fromFile: string): EditOutcome {
  const specifier = relativeSpecifier(file, inv, fromFile);

  const existing = inv.imports.find((i) => i.bindings.some((b) => b.local === identifier));
  if (existing) {
    return sameModule(file.file, existing.specifier, fromFile)
      ? { kind: "no-change", reason: `\`${identifier}\` is already imported from \`${existing.specifier}\`.` }
      : {
          kind: "refused",
          reason: `\`${identifier}\` already means something else here — it is imported from \`${existing.specifier}\`. Rename one of them.`,
        };
  }

  const sameSpecifier = inv.imports.find(
    (i) => i.kind === "named" && i.extendAt !== null && i.specifier === specifier
  );
  if (sameSpecifier) return { kind: "edits", edits: [bindingEdit(file, sameSpecifier, identifier)] };

  const at = afterLastImport(file);
  return {
    kind: "edits",
    edits: [
      {
        file: file.file,
        start: at.offset,
        end: at.offset,
        newText: `${at.blankBefore ? "\n" : ""}import { ${identifier} } from ${quote(file, specifier)};\n`,
      },
    ],
  };
}

/**
 * Add one binding just after the last one, keeping the list's own shape.
 *
 * The whitespace between the last binding and the closing brace is rewritten
 * rather than inserted into, so a one-line import stays on one line and a
 * multi-line one keeps its indentation and trailing comma.
 */
function bindingEdit(file: LoadedFile, target: ImportEntry, name: string): TextEdit {
  const closing = target.extendAt!;
  let at = closing;
  while (at > 0 && /\s/.test(file.text[at - 1]!)) at--;

  const trailing = file.text.slice(at, closing);
  const previous = file.text[at - 1];
  const multiline = trailing.includes("\n");

  const newText =
    previous === "{"
      ? ` ${name}${trailing.length > 0 ? trailing : " "}`
      : previous === ","
        ? multiline
          ? `\n${indentAt(file.text, at)}${name},${trailing}`
          : ` ${name},${trailing}`
        : multiline
          ? `,\n${indentAt(file.text, at)}${name}${trailing}`
          : `, ${name}${trailing}`;

  return { file: file.file, start: at, end: closing, newText };
}

function bindsLocally(inv: Inventory, name: string): boolean {
  return (
    inv.imports.some((i) => i.bindings.some((b) => b.local === name)) ||
    inv.declarations.some((d) => d.identifier === name)
  );
}

/** Where a brand new import statement goes: after the last one, or after the leading comment block. */
function afterLastImport(file: LoadedFile): { offset: number; blankBefore: boolean } {
  const imports = file.ast.statements.filter(ts.isImportDeclaration);
  const last = imports[imports.length - 1];
  if (last) return { offset: lineEnd(file.text, last.getEnd()), blankBefore: false };

  const first = file.ast.statements[0];
  const offset = first ? first.getStart() : file.text.length;
  return { offset, blankBefore: false };
}

function lineEnd(text: string, offset: number): number {
  const newline = text.indexOf("\n", offset);
  return newline < 0 ? text.length : newline + 1;
}

/**
 * The specifier this file would write for another file.
 *
 * Extension style is copied from the file's own relative imports: if any ends
 * `.js`, use `.js`; if they are extensionless, stay extensionless.
 */
export function relativeSpecifier(file: LoadedFile, inv: Inventory, fromFile: string): string {
  const target = normalize(fromFile).replace(/\.tsx?$/, "");
  const base = relativePath(dirName(normalize(file.file)), target);
  const relatives = inv.imports.map((i) => i.specifier).filter(isRelative);
  const usesJs = relatives.some((s) => s.endsWith(".js"));
  return usesJs ? `${base}.js` : base;
}

function sameModule(file: string, specifier: string, fromFile: string): boolean {
  if (!isRelative(specifier)) return false;
  const resolved = joinPath(dirName(normalize(file)), specifier).replace(/\.(js|ts|tsx)$/, "");
  return resolved === normalize(fromFile).replace(/\.(js|ts|tsx)$/, "");
}

function quote(file: LoadedFile, value: string): string {
  const single = file.text.includes("from '");
  return single ? `'${value}'` : `"${value}"`;
}

function dirName(file: string): string {
  const cut = file.lastIndexOf("/");
  return cut < 0 ? "." : file.slice(0, cut);
}

function joinPath(dir: string, specifier: string): string {
  const out: string[] = [];
  for (const segment of `${dir}/${specifier}`.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(segment);
  }
  const joined = out.join("/");
  return `${dir}/${specifier}`.startsWith("/") ? `/${joined}` : joined;
}

function relativePath(from: string, to: string): string {
  const fromParts = from.split("/").filter((s) => s.length > 0);
  const toParts = to.split("/").filter((s) => s.length > 0);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) shared++;

  const up = fromParts.length - shared;
  const down = toParts.slice(shared);
  return up === 0 ? `./${down.join("/")}` : `${"../".repeat(up)}${down.join("/")}`;
}

/**
 * Order edits for application and prove they do not collide.
 *
 * Distinct fields always produce distinct spans, so an overlap only ever means
 * a bug in the layer that produced them.
 */
export function ordered(edits: readonly TextEdit[]): readonly TextEdit[] {
  const sorted = [...edits].sort((a, b) => (a.file === b.file ? a.start - b.start : a.file < b.file ? -1 : 1));
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (previous.file === current.file && current.start < previous.end) {
      throw new Error(`Two edits overlap in ${current.file} at ${current.start}. That is a bug, not a conflict.`);
    }
  }
  return sorted;
}

/** Apply edits to text, which is what the verify pass reads back. */
export function applyEdits(text: string, edits: readonly TextEdit[]): string {
  let out = text;
  for (const edit of [...ordered(edits)].reverse()) {
    out = out.slice(0, edit.start) + edit.newText + out.slice(edit.end);
  }
  return out;
}
