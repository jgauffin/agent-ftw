/**
 * Reading the user's TypeScript, and following a name to where it was declared.
 *
 * The text a file has is supplied by the caller rather than read here, so the
 * extension can hand over an unsaved editor buffer instead of stale disk text,
 * and the tests can hand over a map of strings. Each loaded file carries the
 * version its text was taken at; that version is what a staleness check
 * compares before any edit is applied.
 *
 * Parser only: no `Program`, no type checker, no tsconfig. This layer never
 * needs types, only syntax, and a `Program` would drag in module resolution the
 * studio does not control.
 */

import * as ts from "typescript";

/** The text of one file, as the caller currently sees it. */
export interface SourceText {
  readonly text: string;
  /** Monotonic per file. The extension uses the document version; disk uses 0. */
  readonly version: number;
}

/** Supplies file text. Returns null when the file does not exist. */
export type SourceReader = (file: string) => Promise<SourceText | null>;

export interface LoadedFile {
  readonly file: string;
  readonly text: string;
  readonly version: number;
  readonly ast: ts.SourceFile;
}

/**
 * The files one resolution pass has read.
 *
 * Cached, because addressing a node in a tree of agents walks the same handful
 * of modules repeatedly, and because every file in one pass must be seen at one
 * version for the staleness check to mean anything.
 */
export class SourceSet {
  private readonly cache = new Map<string, LoadedFile | null>();

  constructor(private readonly reader: SourceReader) {}

  async load(file: string): Promise<LoadedFile | null> {
    const normalized = normalize(file);
    const cached = this.cache.get(normalized);
    if (cached !== undefined) return cached;

    const source = await this.reader(normalized);
    const loaded = source === null ? null : parseFile(normalized, source);
    this.cache.set(normalized, loaded);
    return loaded;
  }

  /** Every file read so far, so a caller can re-check versions before writing. */
  loaded(): readonly LoadedFile[] {
    return [...this.cache.values()].filter((f): f is LoadedFile => f !== null);
  }
}

export function parseFile(file: string, source: SourceText): LoadedFile {
  const ast = ts.createSourceFile(file, source.text, ts.ScriptTarget.ES2022, true, scriptKindOf(file));
  return { file, text: source.text, version: source.version, ast };
}

/** A reader over an in-memory map, which is what the tests use. */
export function mapReader(files: Readonly<Record<string, string>> | ReadonlyMap<string, string>): SourceReader {
  const map = files instanceof Map ? files : new Map(Object.entries(files as Record<string, string>));
  return async (file) => {
    const text = map.get(normalize(file));
    return text === undefined ? null : { text, version: 0 };
  };
}

// ---------------------------------------------------------------------------
// Following a name to its declaration
// ---------------------------------------------------------------------------

/** Where an identifier was declared, and what it was declared as. */
export interface IdentifierTarget {
  readonly file: LoadedFile;
  readonly identifier: string;
  readonly declaration: ts.VariableDeclaration;
  /** The whole `const x = ...` statement, for anchoring an insert before it. */
  readonly statement: ts.VariableStatement;
  readonly initializer: ts.Expression;
  /**
   * How many other declarations in the declaring file mention this name.
   *
   * Above one means the value is shared, and rewriting it through one address
   * would silently change every other declaration using it.
   */
  readonly uses: number;
  /** True when the walk left the file it started in. */
  readonly crossFile: boolean;
}

export type ResolveOutcome =
  | { readonly kind: "found"; readonly target: IdentifierTarget }
  /** The name is bound to a package import, so the walk stops. */
  | { readonly kind: "external"; readonly specifier: string }
  | { readonly kind: "not-found"; readonly reason: string };

/**
 * Resolve a bare identifier to the `const` that declares it.
 *
 * Tier 0 is the same file. Tier 1 follows a relative import, which is how the
 * repo's own examples are written: a sub-agent routinely lives in another
 * module. Following one is read-only; it locates a node, it does not unlock
 * editing it.
 */
export async function resolveIdentifier(
  set: SourceSet,
  from: LoadedFile,
  identifier: string
): Promise<ResolveOutcome> {
  return resolveFrom(set, from, identifier, false, new Set());
}

async function resolveFrom(
  set: SourceSet,
  from: LoadedFile,
  identifier: string,
  crossFile: boolean,
  visited: Set<string>
): Promise<ResolveOutcome> {
  const key = `${from.file}#${identifier}`;
  if (visited.has(key)) return { kind: "not-found", reason: `\`${identifier}\` resolves in a cycle.` };
  visited.add(key);

  const local = findConst(from.ast, identifier);
  if (local) {
    return {
      kind: "found",
      target: {
        file: from,
        identifier,
        declaration: local.declaration,
        statement: local.statement,
        initializer: local.initializer,
        uses: countUses(from.ast, identifier),
        crossFile,
      },
    };
  }

  const hop = findReExportOrImport(from.ast, identifier);
  if (!hop) return { kind: "not-found", reason: `\`${identifier}\` is not declared in ${from.file}.` };
  if (!isRelative(hop.specifier)) return { kind: "external", specifier: hop.specifier };

  const next = await loadRelative(set, from.file, hop.specifier);
  if (!next) {
    return { kind: "not-found", reason: `Could not read the module \`${hop.specifier}\` refers to.` };
  }
  return resolveFrom(set, next, hop.imported, true, visited);
}

interface ConstDeclaration {
  readonly declaration: ts.VariableDeclaration;
  readonly statement: ts.VariableStatement;
  readonly initializer: ts.Expression;
}

/** A top-level `const <identifier> = <expression>`, exported or not. */
export function findConst(file: ts.SourceFile, identifier: string): ConstDeclaration | null {
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== identifier) continue;
      if (!declaration.initializer) continue;
      return { declaration, statement, initializer: declaration.initializer };
    }
  }
  return null;
}

/** What an identifier is bound to elsewhere: an import, or a re-export. */
interface ModuleHop {
  /** The name as the other module exports it, which an alias changes. */
  readonly imported: string;
  readonly specifier: string;
}

function findReExportOrImport(file: ts.SourceFile, identifier: string): ModuleHop | null {
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const hop = hopFromImport(statement, identifier);
      if (hop) return hop;
      continue;
    }
    if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && statement.exportClause) {
      if (!ts.isNamedExports(statement.exportClause)) continue;
      const specifier = literalText(statement.moduleSpecifier);
      if (specifier === null) continue;
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== identifier) continue;
        return { imported: (element.propertyName ?? element.name).text, specifier };
      }
    }
  }
  return null;
}

function hopFromImport(statement: ts.ImportDeclaration, identifier: string): ModuleHop | null {
  const clause = statement.importClause;
  if (!clause) return null;
  const specifier = literalText(statement.moduleSpecifier);
  if (specifier === null) return null;

  if (clause.name && clause.name.text === identifier) return { imported: "default", specifier };
  if (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings)) return null;
  for (const element of clause.namedBindings.elements) {
    if (element.name.text !== identifier) continue;
    // An alias is written at the import site; the other module knows the name
    // it exported, so that is what the walk has to look for.
    return { imported: (element.propertyName ?? element.name).text, specifier };
  }
  return null;
}

/**
 * Count the places a name is referred to, ignoring the declaration itself.
 *
 * A value referred to twice is shared, and the whole point of refusing an edit
 * on a shared value is that changing it through one address would change the
 * other silently.
 */
export function countUses(file: ts.SourceFile, identifier: string): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === identifier && isReference(node)) count++;
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file, visit);
  return count;
}

/** False for the places a name is written rather than read. */
function isReference(node: ts.Identifier): boolean {
  const parent = node.parent as ts.Node | undefined;
  if (!parent) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) return false;
  if (ts.isImportClause(parent) || ts.isNamespaceImport(parent)) return false;
  if (ts.isBindingElement(parent) && parent.name === node) return false;
  if (ts.isParameter(parent) && parent.name === node) return false;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Module specifiers
// ---------------------------------------------------------------------------

export function isRelative(specifier: string): boolean {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

/**
 * Try a relative specifier's candidate files, in order.
 *
 * The `.js` swap comes first among the rewrites because it is this repo's ESM
 * habit: the source says `./tools.js` and the file on disk is `./tools.ts`.
 */
export async function loadRelative(set: SourceSet, from: string, specifier: string): Promise<LoadedFile | null> {
  for (const candidate of candidatePaths(from, specifier)) {
    const loaded = await set.load(candidate);
    if (loaded) return loaded;
  }
  return null;
}

export function candidatePaths(from: string, specifier: string): readonly string[] {
  const base = joinPath(dirName(normalize(from)), specifier);
  const out = [base];
  if (base.endsWith(".js")) out.push(`${base.slice(0, -3)}.ts`);
  out.push(`${base}.ts`, `${base}/index.ts`, `${base}.tsx`);
  return out;
}

// ---------------------------------------------------------------------------
// Paths, kept as forward-slashed strings so a fixture reads the same everywhere
// ---------------------------------------------------------------------------

export function normalize(file: string): string {
  return file.replace(/\\/g, "/");
}

function dirName(file: string): string {
  const cut = file.lastIndexOf("/");
  return cut < 0 ? "." : file.slice(0, cut);
}

function joinPath(dir: string, specifier: string): string {
  const segments = `${dir}/${specifier}`.split("/");
  const out: string[] = [];
  for (const segment of segments) {
    if (segment === "." || segment === "") continue;
    if (segment === ".." && out.length > 0 && out[out.length - 1] !== "..") out.pop();
    else out.push(segment);
  }
  const joined = out.join("/");
  return `${dir}/${specifier}`.startsWith("/") ? `/${joined}` : joined;
}

function scriptKindOf(file: string): ts.ScriptKind {
  return file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function literalText(node: ts.Node): string | null {
  return ts.isStringLiteralLike(node) ? node.text : null;
}
