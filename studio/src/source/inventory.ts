/**
 * Everything one file declares and imports, from a single scan.
 *
 * One parse serving four needs, which is why it is one function rather than
 * four. It resolves a declared name to the source identifier that has to be
 * written (`const search = tool({ name: "search" })` becomes `delegable:
 * [search]`, not `delegable: ["search"]`, and only the identifier compiles). It
 * gives an insert its anchor. It tells the import layer what it may extend.
 *
 * And it surfaces what the projected tree cannot: the tree shows only what is
 * reachable from a phase, so a tool declared here and wired to nothing is
 * invisible in the panel. That set is exactly what a "grant this to the child"
 * picker has to offer, and "defined here, nothing can call it" is worth saying
 * out loud on its own.
 */

import * as ts from "typescript";
import type { LoadedFile } from "./parse.js";
import { callObject, factoryAliases, isFactoryCall, propertyOf, rangeOf, unwrap } from "./locate.js";
import { type Range, positionAt } from "./text.js";

export type DeclKind = "tool" | "subAgent" | "customSubAgent" | "phase" | "agent" | "checklist";

const DECL_KINDS: readonly DeclKind[] = ["tool", "subAgent", "customSubAgent", "phase", "agent", "checklist"];

export interface DeclEntry {
  readonly kind: DeclKind;
  readonly identifier: string;
  /** The declared `name:` literal. Empty when it is not a literal. */
  readonly name: string;
  readonly description: string;
  readonly mutates: boolean;
  readonly exported: boolean;
  /** The whole top-level statement, for anchoring an insert. */
  readonly statement: Range;
  /** The factory call's object literal. */
  readonly call: Range;
  /** Zero-based, matching the editor coordinates the extension builds from. */
  readonly line: number;
}

export interface ImportBinding {
  readonly local: string;
  readonly imported: string;
}

export interface ImportEntry {
  readonly specifier: string;
  readonly kind: "named" | "namespace" | "default" | "typeOnly";
  readonly bindings: readonly ImportBinding[];
  readonly range: Range;
  /** Offset to insert a new binding before `}`. Null when not extendable. */
  readonly extendAt: number | null;
}

export interface Inventory {
  readonly file: string;
  readonly declarations: readonly DeclEntry[];
  readonly imports: readonly ImportEntry[];
}

export function inventory(file: LoadedFile): Inventory {
  const aliases = new Map<DeclKind, ReadonlySet<string>>(
    DECL_KINDS.map((kind) => [kind, factoryAliases(file.ast, kind)])
  );

  const declarations: DeclEntry[] = [];
  const imports: ImportEntry[] = [];

  for (const statement of file.ast.statements) {
    if (ts.isImportDeclaration(statement)) {
      const entry = importEntry(statement);
      if (entry) imports.push(entry);
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;

    const exported = hasExportModifier(statement);
    for (const declaration of statement.declarationList.declarations) {
      const entry = declEntry(file, statement, declaration, aliases, exported);
      if (entry) declarations.push(entry);
    }
  }

  return { file: file.file, declarations, imports };
}

function declEntry(
  file: LoadedFile,
  statement: ts.VariableStatement,
  declaration: ts.VariableDeclaration,
  aliases: ReadonlyMap<DeclKind, ReadonlySet<string>>,
  exported: boolean
): DeclEntry | null {
  if (!ts.isIdentifier(declaration.name) || !declaration.initializer) return null;
  const call = unwrap(declaration.initializer);
  if (!ts.isCallExpression(call)) return null;

  const kind = DECL_KINDS.find((k) => isFactoryCall(call, aliases.get(k)!));
  if (!kind) return null;

  const object = callObject(call);
  return {
    kind,
    identifier: declaration.name.text,
    // A non-literal is left blank rather than guessed at. The identifier is
    // what gets written into an edit, and that is always known.
    name: object ? stringOf(object, "name") : "",
    description: object ? stringOf(object, "description") : "",
    mutates: object ? booleanOf(object, "mutates") : false,
    exported,
    statement: rangeOf(statement),
    call: object ? rangeOf(object) : rangeOf(call),
    line: positionAt(file.text, statement.getStart()).line,
  };
}

function importEntry(statement: ts.ImportDeclaration): ImportEntry | null {
  if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return null;
  const specifier = statement.moduleSpecifier.text;
  const range = rangeOf(statement);
  const clause = statement.importClause;

  if (!clause) return { specifier, kind: "named", bindings: [], range, extendAt: null };
  if (clause.isTypeOnly) {
    return { specifier, kind: "typeOnly", bindings: namedBindings(clause), range, extendAt: null };
  }

  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) {
    return {
      specifier,
      kind: "namespace",
      bindings: [{ local: bindings.name.text, imported: "*" }],
      range,
      extendAt: null,
    };
  }
  if (bindings && ts.isNamedImports(bindings)) {
    return {
      specifier,
      kind: "named",
      bindings: namedBindings(clause),
      range,
      // Just inside the closing brace, so a new binding lands beside the others.
      extendAt: bindings.getEnd() - 1,
    };
  }
  return {
    specifier,
    kind: "default",
    bindings: clause.name ? [{ local: clause.name.text, imported: "default" }] : [],
    range,
    extendAt: null,
  };
}

function namedBindings(clause: ts.ImportClause): readonly ImportBinding[] {
  const out: ImportBinding[] = [];
  if (clause.name) out.push({ local: clause.name.text, imported: "default" });
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) {
    for (const element of bindings.elements) {
      out.push({ local: element.name.text, imported: (element.propertyName ?? element.name).text });
    }
  }
  return out;
}

function hasExportModifier(statement: ts.VariableStatement): boolean {
  return (statement.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function stringOf(object: ts.ObjectLiteralExpression, name: string): string {
  const property = propertyOf(object, name);
  if (!property) return "";
  return ts.isStringLiteralLike(property.initializer) ? property.initializer.text : "";
}

function booleanOf(object: ts.ObjectLiteralExpression, name: string): boolean {
  const property = propertyOf(object, name);
  return property !== null && property.initializer.kind === ts.SyntaxKind.TrueKeyword;
}
