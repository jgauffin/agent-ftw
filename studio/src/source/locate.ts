/**
 * Finding the node an address names, and proving we may rewrite it.
 *
 * An address is the tree path the panel already displays, so the source layer
 * and the panel cannot drift apart about what they are talking about. Every
 * failure resolves to "this is locked, here is why" rather than to a
 * best-effort edit: an edit applied to the wrong node is worse than no edit at
 * all, because the user's next read of the file will not be looking for it.
 */

import * as ts from "typescript";
import {
  type LoadedFile,
  type SourceSet,
  findConst,
  literalText,
  resolveIdentifier,
} from "./parse.js";
import { type Position, type Range, indentAt, positionAt } from "./text.js";

/** The declaration factories this layer knows how to read. */
export type Construct = "agent" | "phase" | "checklist" | "subAgent";

export interface Address {
  /** Tree path exactly as the runner's project.ts builds it: `lead>implementer/implement`. */
  readonly path: string;
  readonly construct: Construct;
  /** Which property. Omitted when addressing the declaration itself. */
  readonly field?: string;
  /** Reaches inside a schema, for a per-property lint fix. */
  readonly pointer?: string;
}

export type Binding =
  /** A literal we can replace. `wrapper` is preserved across the edit. */
  | { readonly kind: "literal"; readonly range: Range; readonly text: string; readonly wrapper: "as-const" | null }
  /** Two or more string literals joined with `+`. Replaceable as one expression. */
  | { readonly kind: "concatenation"; readonly range: Range; readonly parts: readonly string[] }
  /** `deliverable: SCHEMA`, where SCHEMA is a const the walk could follow. */
  | { readonly kind: "reference"; readonly via: string; readonly file: string; readonly target: Binding }
  /** The property is not declared at all. Carries where it would go. */
  | { readonly kind: "absent"; readonly insertInto: Range; readonly indent: string }
  /** Present, but not something we can prove the value of. */
  | { readonly kind: "computed"; readonly expression: string; readonly at: Position }
  /** The address does not resolve to exactly one node. */
  | { readonly kind: "ambiguous"; readonly reason: string };

export interface BindResult {
  readonly binding: Binding;
  /** The file the binding's range is in. Not always the file the walk started in. */
  readonly file: string;
  /**
   * True when reaching the value crossed a module boundary, or went through a
   * value more than one declaration uses. Locating is still fine; rewriting is
   * refused, because a shared value is probably shared on purpose.
   */
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
}

export interface ArrayElement {
  readonly span: Range;
  /** Set when the element is a bare identifier, which is what removal matches on. */
  readonly identifier: string | null;
  readonly text: string;
}

export type ArrayBinding =
  | {
      readonly kind: "array";
      readonly span: Range;
      readonly elements: readonly ArrayElement[];
      /** Where a new element's text goes, and whether a `,` must precede it. */
      readonly insertAt: number;
      readonly needsLeadingComma: boolean;
      readonly itemIndent: string;
      readonly multiline: boolean;
    }
  /** The property is not declared. Carries where the whole `tools: [x],` goes. */
  | { readonly kind: "absent"; readonly insertInto: Range; readonly indent: string }
  | { readonly kind: "computed"; readonly expression: string; readonly at: Position }
  | { readonly kind: "ambiguous"; readonly reason: string };

export interface ArrayBindResult {
  readonly binding: ArrayBinding;
  readonly file: string;
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
}

/** One resolved declaration: the factory call an address names. */
export interface ResolvedNode {
  readonly file: LoadedFile;
  readonly construct: Construct;
  readonly call: ts.CallExpression;
  readonly object: ts.ObjectLiteralExpression;
  /** The `name:` literal, for revealing the declaration. Null when it is inline and unnamed. */
  readonly nameRange: Range | null;
  /** The whole top-level statement, when the node is declared as a const. */
  readonly statement: ts.VariableStatement | null;
  readonly crossFile: boolean;
  readonly shared: boolean;
}

export type Resolution =
  | { readonly kind: "resolved"; readonly node: ResolvedNode }
  | { readonly kind: "ambiguous"; readonly reason: string };

// ---------------------------------------------------------------------------
// Addressing
// ---------------------------------------------------------------------------

interface PathStep {
  /** `>` steps into a sub-agent, `/` into a phase. */
  readonly separator: ">" | "/";
  readonly name: string;
}

export function parsePath(path: string): { readonly root: string; readonly steps: readonly PathStep[] } | null {
  const match = /^([^/>]+)/.exec(path);
  if (!match) return null;
  const root = match[1]!;
  const steps: PathStep[] = [];
  const rest = path.slice(root.length);
  for (const step of rest.matchAll(/([>/])([^/>]+)/g)) {
    steps.push({ separator: step[1] as ">" | "/", name: step[2]! });
  }
  return { root, steps };
}

/**
 * Walk a tree path to the declaration it names.
 *
 * The walk mirrors what the runner's projection does, because the two have to
 * agree on what `lead>implementer/implement` means. In particular a sub-agent
 * step matches the *inner agent's* name, not the `subAgent` wrapper's, which is
 * what `childPath(parentPath, child.name)` uses.
 */
export async function resolveAddress(set: SourceSet, entryFile: string, address: Address): Promise<Resolution> {
  const entry = await set.load(entryFile);
  if (!entry) return { kind: "ambiguous", reason: `Could not read ${entryFile}.` };

  const parsed = parsePath(address.path);
  if (!parsed) return { kind: "ambiguous", reason: `\`${address.path}\` is not a tree path.` };

  let current = findNamedCall(entry, "agent", parsed.root);
  if (current.kind !== "resolved") return current;

  for (const step of parsed.steps) {
    const next: Resolution =
      step.separator === ">"
        ? await stepIntoSubAgent(set, current.node, step.name)
        : await stepIntoPhase(set, current.node, step.name);
    if (next.kind !== "resolved") return next;
    current = next;
  }

  const found = current.node;
  if (found.construct !== address.construct && address.construct !== "checklist") {
    return {
      kind: "ambiguous",
      reason: `\`${address.path}\` names a ${found.construct}, not a ${address.construct}.`,
    };
  }
  if (address.construct === "checklist") return stepIntoChecklist(found);
  return current;
}

/** A top-level `<factory>({ name: "<name>" })` in one file, and only one of them. */
function findNamedCall(file: LoadedFile, construct: Construct, name: string): Resolution {
  const factories = factoryAliases(file.ast, construct);
  const matches: ResolvedNode[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isFactoryCall(node, factories)) {
      const object = callObject(node);
      if (object && nameOf(object) === name) matches.push(nodeFrom(file, construct, node, object, false, false));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(file.ast, visit);

  if (matches.length === 1) return { kind: "resolved", node: matches[0]! };
  if (matches.length === 0) {
    return { kind: "ambiguous", reason: `No ${construct} named "${name}" is declared in ${file.file}.` };
  }
  return {
    kind: "ambiguous",
    reason: `${matches.length} ${construct} declarations in ${file.file} are named "${name}".`,
  };
}

async function stepIntoPhase(set: SourceSet, parent: ResolvedNode, name: string): Promise<Resolution> {
  const phases = arrayElements(parent.object, "phases");
  if (!phases) return { kind: "ambiguous", reason: `Agent "${nameOf(parent.object)}" declares no literal \`phases\` array.` };

  const matches: ResolvedNode[] = [];
  for (const element of phases) {
    const phase = await asFactoryCall(set, parent, element, "phase");
    if (phase && nameOf(phase.object) === name) matches.push(phase);
  }
  return single(matches, `phase "${name}"`, parent);
}

async function stepIntoSubAgent(set: SourceSet, parent: ResolvedNode, agentName: string): Promise<Resolution> {
  const matches: ResolvedNode[] = [];

  for (const wrapper of await subAgentWrappers(set, parent)) {
    const property = propertyOf(wrapper.object, "agent");
    if (!property) continue;
    const child = await asFactoryCall(set, wrapper, property.initializer, "agent");
    if (child && nameOf(child.object) === agentName) matches.push(child);
  }
  return single(matches, `sub-agent "${agentName}"`, parent);
}

/**
 * Every `subAgent({...})` this agent can reach.
 *
 * The runner's projection walks the agent's own tools and each phase's tools,
 * so this walks both. A child reachable through both produces the same node, so
 * duplicates are collapsed rather than reported as ambiguity.
 */
async function subAgentWrappers(set: SourceSet, parent: ResolvedNode): Promise<readonly ResolvedNode[]> {
  const candidates: ts.Expression[] = [...(arrayElements(parent.object, "tools") ?? [])];

  for (const element of arrayElements(parent.object, "phases") ?? []) {
    const phase = await asFactoryCall(set, parent, element, "phase");
    if (!phase) continue;
    candidates.push(...(arrayElements(phase.object, "tools") ?? []));
  }

  const out: ResolvedNode[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const wrapper = await asFactoryCall(set, parent, candidate, "subAgent");
    if (!wrapper) continue;
    const key = `${wrapper.file.file}:${wrapper.call.getStart()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(wrapper);
  }
  return out;
}

function stepIntoChecklist(phase: ResolvedNode): Resolution {
  if (phase.construct !== "phase") {
    return { kind: "ambiguous", reason: `A checklist is declared on a phase, not on a ${phase.construct}.` };
  }
  const property = propertyOf(phase.object, "checklist");
  if (!property) return { kind: "ambiguous", reason: `Phase "${nameOf(phase.object)}" declares no checklist.` };
  const call = unwrap(property.initializer);
  if (!ts.isCallExpression(call)) {
    return { kind: "ambiguous", reason: `The checklist on "${nameOf(phase.object)}" is not a \`checklist({...})\` call.` };
  }
  const object = callObject(call);
  if (!object) return { kind: "ambiguous", reason: "The checklist call takes no object literal." };
  return { kind: "resolved", node: nodeFrom(phase.file, "checklist", call, object, phase.crossFile, phase.shared) };
}

function single(matches: readonly ResolvedNode[], what: string, parent: ResolvedNode): Resolution {
  if (matches.length === 1) return { kind: "resolved", node: matches[0]! };
  if (matches.length === 0) {
    return { kind: "ambiguous", reason: `"${nameOf(parent.object) ?? "?"}" declares no ${what}.` };
  }
  return { kind: "ambiguous", reason: `"${nameOf(parent.object) ?? "?"}" declares ${matches.length} of ${what}.` };
}

/**
 * An array element, or any expression, read as one factory call.
 *
 * Handles both shapes the repo writes: an inline `phase({...})` call, and a
 * bare identifier resolved to a `const`, which may live in another module.
 */
async function asFactoryCall(
  set: SourceSet,
  from: ResolvedNode,
  expression: ts.Expression,
  construct: Construct
): Promise<ResolvedNode | null> {
  const inline = unwrap(expression);

  if (ts.isCallExpression(inline)) {
    if (!isFactoryCall(inline, factoryAliases(from.file.ast, construct))) return null;
    const object = callObject(inline);
    return object ? nodeFrom(from.file, construct, inline, object, from.crossFile, from.shared) : null;
  }

  if (!ts.isIdentifier(inline)) return null;
  const outcome = await resolveIdentifier(set, from.file, inline.text);
  if (outcome.kind !== "found") return null;

  const target = outcome.target;
  const call = unwrap(target.initializer);
  if (!ts.isCallExpression(call)) return null;
  if (!isFactoryCall(call, factoryAliases(target.file.ast, construct))) return null;
  const object = callObject(call);
  if (!object) return null;

  const node = nodeFrom(
    target.file,
    construct,
    call,
    object,
    from.crossFile || target.crossFile,
    from.shared || target.uses > 1
  );
  return { ...node, statement: target.statement };
}

function nodeFrom(
  file: LoadedFile,
  construct: Construct,
  call: ts.CallExpression,
  object: ts.ObjectLiteralExpression,
  crossFile: boolean,
  shared: boolean
): ResolvedNode {
  const property = propertyOf(object, "name");
  const nameLiteral = property && ts.isStringLiteralLike(property.initializer) ? property.initializer : null;
  return {
    file,
    construct,
    call,
    object,
    nameRange: nameLiteral ? rangeOf(nameLiteral) : null,
    statement: null,
    crossFile,
    shared,
  };
}

// ---------------------------------------------------------------------------
// Layer 1: what is this field's value, and may we rewrite it
// ---------------------------------------------------------------------------

export async function bind(set: SourceSet, entryFile: string, address: Address): Promise<BindResult> {
  const resolution = await resolveAddress(set, entryFile, address);
  if (resolution.kind !== "resolved") {
    return locked({ kind: "ambiguous", reason: resolution.reason }, entryFile, resolution.reason);
  }
  const node = resolution.node;

  const field = address.field;
  if (field === undefined) {
    const reason = "The address names the declaration itself, not a value. Use `declarationSite`.";
    return locked({ kind: "ambiguous", reason }, node.file.file, reason);
  }

  const property = propertyOf(node.object, field);
  if (!property) {
    return {
      binding: {
        kind: "absent",
        insertInto: rangeOf(node.object),
        indent: indentAt(node.file.text, node.object.getStart()),
      },
      file: node.file.file,
      ...lockOf(node),
    };
  }

  const binding = await classify(set, node.file, property.initializer);
  const lock = lockOf(node, binding);
  return { binding, file: fileOfBinding(binding, node), ...lock };
}

/** What kind of value this expression is, and whether it is one we may replace. */
async function classify(set: SourceSet, file: LoadedFile, expression: ts.Expression): Promise<Binding> {
  const asConst = asConstAssertion(expression);
  if (asConst) {
    // The range covers the object literal only, so `as const` survives a
    // rewrite. Dropping it would widen the schema to `string` and collapse the
    // deliverable's inferred type — a silent type regression, not a lint.
    const inner = await classify(set, file, asConst);
    if (inner.kind === "literal") return { ...inner, wrapper: "as-const" };
    return inner;
  }

  if (isWritableLiteral(expression)) {
    return { kind: "literal", range: rangeOf(expression), text: expression.getText(), wrapper: null };
  }

  const parts = concatenatedStrings(expression);
  if (parts) return { kind: "concatenation", range: rangeOf(expression), parts };

  if (ts.isIdentifier(expression)) {
    const outcome = await resolveIdentifier(set, file, expression.text);
    if (outcome.kind === "found") {
      const target = await classify(set, outcome.target.file, outcome.target.initializer);
      // The file matters: a reference the walk followed into another module has
      // its range there, not where the property was written.
      return { kind: "reference", via: expression.text, file: outcome.target.file.file, target };
    }
  }

  return {
    kind: "computed",
    expression: ts.SyntaxKind[expression.kind]!,
    at: positionAt(file.text, expression.getStart()),
  };
}

/**
 * The kinds we can prove the value of.
 *
 * Everything else is `computed`, which includes a template with substitutions,
 * a call, a spread inside an object, and a computed property name.
 */
export function isWritableLiteral(expression: ts.Expression): boolean {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return true;
  if (ts.isNumericLiteral(expression)) return true;
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.MinusToken) {
    return ts.isNumericLiteral(expression.operand);
  }
  if (expression.kind === ts.SyntaxKind.TrueKeyword || expression.kind === ts.SyntaxKind.FalseKeyword) return true;
  if (ts.isArrayLiteralExpression(expression)) return expression.elements.every(isWritableLiteral);
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.every(
      (p) => ts.isPropertyAssignment(p) && !ts.isComputedPropertyName(p.name) && isWritableLiteral(p.initializer)
    );
  }
  return false;
}

/** `"a" + "b" + "c"`, which is how this repo's own prompts are written. */
function concatenatedStrings(expression: ts.Expression): readonly string[] | null {
  const parts: string[] = [];
  const walk = (node: ts.Expression): boolean => {
    if (ts.isStringLiteralLike(node)) {
      parts.push(node.text);
      return true;
    }
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.PlusToken) return false;
    return walk(node.left) && walk(node.right);
  };
  if (!ts.isBinaryExpression(expression)) return null;
  return walk(expression) && parts.length > 1 ? parts : null;
}

function asConstAssertion(expression: ts.Expression): ts.Expression | null {
  if (!ts.isAsExpression(expression)) return null;
  const type = expression.type;
  const isConst = ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === "const";
  return isConst ? expression.expression : null;
}

function lockOf(node: ResolvedNode, binding?: Binding): { readOnly: boolean; readOnlyReason: string | null } {
  if (node.crossFile) {
    return { readOnly: true, readOnlyReason: "Declared in another module, which this may only read." };
  }
  if (node.shared) {
    return { readOnly: true, readOnlyReason: "Declared once and used by more than one declaration." };
  }
  if (binding?.kind === "reference") {
    return {
      readOnly: true,
      readOnlyReason: `Refers to \`${binding.via}\`, which other declarations may share.`,
    };
  }
  return { readOnly: false, readOnlyReason: null };
}

/** Which file the binding's range is in, after however many references it took. */
function fileOfBinding(binding: Binding, node: ResolvedNode): string {
  let current = binding;
  let file = node.file.file;
  while (current.kind === "reference") {
    file = current.file;
    current = current.target;
  }
  return file;
}

function locked(binding: Binding, file: string, reason: string): BindResult {
  return { binding, file, readOnly: true, readOnlyReason: reason };
}

// ---------------------------------------------------------------------------
// Layer 1: array properties
// ---------------------------------------------------------------------------

export async function arrayProperty(
  set: SourceSet,
  entryFile: string,
  address: Address,
  property: string
): Promise<ArrayBindResult> {
  const resolution = await resolveAddress(set, entryFile, address);
  if (resolution.kind !== "resolved") {
    return {
      binding: { kind: "ambiguous", reason: resolution.reason },
      file: entryFile,
      readOnly: true,
      readOnlyReason: resolution.reason,
    };
  }

  const node = resolution.node;
  const lock = lockOf(node);
  const declared = propertyOf(node.object, property);

  if (!declared) {
    return {
      binding: {
        kind: "absent",
        insertInto: rangeOf(node.object),
        indent: indentAt(node.file.text, node.object.getStart()),
      },
      file: node.file.file,
      ...lock,
    };
  }

  const array = unwrap(declared.initializer);
  if (!ts.isArrayLiteralExpression(array)) {
    return {
      binding: {
        kind: "computed",
        expression: ts.SyntaxKind[array.kind]!,
        at: positionAt(node.file.text, array.getStart()),
      },
      file: node.file.file,
      ...lock,
    };
  }

  return { binding: describeArray(node.file, array), file: node.file.file, ...lock };
}

function describeArray(file: LoadedFile, array: ts.ArrayLiteralExpression): ArrayBinding {
  const elements = array.elements.map<ArrayElement>((element) => ({
    span: rangeOf(element),
    identifier: ts.isIdentifier(element) ? element.text : null,
    text: element.getText(),
  }));

  const span = rangeOf(array);
  const last = array.elements[array.elements.length - 1];
  const closing = array.getEnd() - 1;
  const trailing = last ? file.text.slice(last.getEnd(), closing) : "";
  const multiline = file.text.slice(span.start, span.end).includes("\n");

  return {
    kind: "array",
    span,
    elements,
    // A trailing comma is a habit worth matching: appending after it keeps the
    // diff to the added line, where inserting before it would touch two.
    insertAt: last ? (trailing.includes(",") ? last.getEnd() + trailing.indexOf(",") + 1 : last.getEnd()) : span.start + 1,
    needsLeadingComma: last !== undefined && !trailing.includes(","),
    itemIndent: last ? indentAt(file.text, array.elements[0]!.getStart()) : `${indentAt(file.text, array.getStart())}  `,
    multiline,
  };
}

// ---------------------------------------------------------------------------
// Schema pointers
// ---------------------------------------------------------------------------

export interface SchemaSite {
  readonly file: LoadedFile;
  /** The schema node the pointer names. */
  readonly object: ts.ObjectLiteralExpression;
  /** The whole deliverable, before the pointer descended into it. */
  readonly root: ts.ObjectLiteralExpression;
  readonly readOnly: boolean;
  readonly readOnlyReason: string | null;
}

export type SchemaLookup = { readonly kind: "found"; readonly site: SchemaSite } | { readonly kind: "locked"; readonly reason: string };

/**
 * The schema object a lint finding points at.
 *
 * A finding's pointer is not a JSON Pointer into the schema document: `lint`
 * descends with the property name at an object and `items` at an array, so
 * `#/ideas/title` means `properties.ideas.items.properties.title` when `ideas`
 * is an array of objects. The step is chosen by the node it is applied to, not
 * by the segment's text, so a property genuinely called `items` still resolves.
 */
export async function schemaSite(set: SourceSet, entryFile: string, address: Address): Promise<SchemaLookup> {
  const result = await bind(set, entryFile, { ...address, pointer: undefined });
  const binding = unwrapReference(result.binding);

  if (binding.kind !== "literal") {
    const reason =
      binding.kind === "ambiguous"
        ? binding.reason
        : binding.kind === "computed"
          ? `The value is a ${binding.expression}, not a literal.`
          : `\`${address.field ?? "the field"}\` is not declared.`;
    return { kind: "locked", reason };
  }

  const file = await set.load(result.file);
  if (!file) return { kind: "locked", reason: `Could not read ${result.file}.` };

  const root = objectAt(file, binding.range);
  if (!root) return { kind: "locked", reason: "The value is not an object literal." };

  const object = navigatePointer(root, address.pointer ?? "");
  if (!object) return { kind: "locked", reason: `Nothing in the schema is at \`${address.pointer}\`.` };

  return {
    kind: "found",
    site: { file, object, root, readOnly: result.readOnly, readOnlyReason: result.readOnlyReason },
  };
}

/** A binding seen through however many references it took to reach it. */
export function unwrapReference(binding: Binding): Binding {
  return binding.kind === "reference" ? unwrapReference(binding.target) : binding;
}

export function navigatePointer(
  root: ts.ObjectLiteralExpression,
  pointer: string
): ts.ObjectLiteralExpression | null {
  const segments = pointer.replace(/^#/, "").split("/").filter((s) => s.length > 0);
  let current: ts.ObjectLiteralExpression | null = root;

  for (const segment of segments) {
    if (!current) return null;
    const type = stringPropertyOf(current, "type");
    const next: ts.ObjectLiteralExpression | null =
      type === "array"
        ? objectPropertyOf(current, "items")
        : objectPropertyOf(objectPropertyOf(current, "properties"), segment);
    current = next;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Reading an object literal
// ---------------------------------------------------------------------------

export function propertyOf(object: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | null {
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    if (propertyName(property) === name) return property;
  }
  return null;
}

function objectPropertyOf(
  object: ts.ObjectLiteralExpression | null,
  name: string
): ts.ObjectLiteralExpression | null {
  if (!object) return null;
  const property = propertyOf(object, name);
  if (!property) return null;
  const value = unwrap(property.initializer);
  return ts.isObjectLiteralExpression(value) ? value : null;
}

function stringPropertyOf(object: ts.ObjectLiteralExpression, name: string): string | null {
  const property = propertyOf(object, name);
  return property ? literalText(property.initializer) : null;
}

export function propertyName(property: ts.PropertyAssignment): string | null {
  const name = property.name;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name)) return name.text;
  return null;
}

/** The declared `name:` literal, or null when it is not a literal. */
export function nameOf(object: ts.ObjectLiteralExpression): string | null {
  const property = propertyOf(object, "name");
  return property ? literalText(property.initializer) : null;
}

export function arrayElements(
  object: ts.ObjectLiteralExpression,
  property: string
): readonly ts.Expression[] | null {
  const declared = propertyOf(object, property);
  if (!declared) return null;
  const value = unwrap(declared.initializer);
  return ts.isArrayLiteralExpression(value) ? value.elements : null;
}

/** Strip `as const`, `satisfies`, and parentheses, which are not the value. */
export function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) return unwrap(expression.expression);
  if (ts.isParenthesizedExpression(expression)) return unwrap(expression.expression);
  return expression;
}

export function callObject(call: ts.CallExpression): ts.ObjectLiteralExpression | null {
  const first = call.arguments[0];
  if (!first) return null;
  const value = unwrap(first);
  return ts.isObjectLiteralExpression(value) ? value : null;
}

export function rangeOf(node: ts.Node): Range {
  return { start: node.getStart(), end: node.getEnd() };
}

/** The object literal that exactly covers a range, for turning a binding back into a node. */
export function objectAt(file: LoadedFile, range: Range): ts.ObjectLiteralExpression | null {
  let found: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node) && node.getStart() === range.start && node.getEnd() === range.end) {
      found = node;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  ts.forEachChild(file.ast, visit);
  return found;
}

// ---------------------------------------------------------------------------
// Factory names, which an import may rename
// ---------------------------------------------------------------------------

/** The local names one factory goes by in this file, aliases included. */
export function factoryAliases(file: ts.SourceFile, construct: string): ReadonlySet<string> {
  const locals = new Set<string>();
  const namespaces = new Set<string>();

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) continue;
    const bindings = statement.importClause.namedBindings;
    if (!bindings) continue;
    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
      continue;
    }
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === construct) locals.add(element.name.text);
    }
  }

  // No import mentioning it: the file either declares its own or was written
  // without one, and the plain name is the only sensible reading.
  if (locals.size === 0) locals.add(construct);
  for (const namespace of namespaces) locals.add(`${namespace}.${construct}`);
  return locals;
}

export function isFactoryCall(call: ts.CallExpression, names: ReadonlySet<string>): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return names.has(callee.text);
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    return names.has(`${callee.expression.text}.${callee.name.text}`);
  }
  return false;
}

/** Where a declaration sits, for revealing it in the editor. */
export async function declarationSite(
  set: SourceSet,
  entryFile: string,
  address: Address
): Promise<{ file: string; range: Range } | null> {
  const resolution = await resolveAddress(set, entryFile, address);
  if (resolution.kind !== "resolved") return null;
  const node = resolution.node;
  return { file: node.file.file, range: node.nameRange ?? rangeOf(node.call) };
}

/** Every tree path this file's agents produce, which must equal what the runner projects. */
export async function projectedPaths(set: SourceSet, entryFile: string, rootAgent: string): Promise<string[]> {
  const paths: string[] = [];
  const entry = await set.load(entryFile);
  if (!entry) return paths;

  const root = findNamedCall(entry, "agent", rootAgent);
  if (root.kind !== "resolved") return paths;

  const walk = async (node: ResolvedNode, path: string, ancestry: ReadonlySet<string>): Promise<void> => {
    paths.push(path);
    for (const element of arrayElements(node.object, "phases") ?? []) {
      const phase = await asFactoryCall(set, node, element, "phase");
      if (phase) paths.push(`${path}/${nameOf(phase.object) ?? "?"}`);
    }
    for (const wrapper of await subAgentWrappers(set, node)) {
      const property = propertyOf(wrapper.object, "agent");
      if (!property) continue;
      const child = await asFactoryCall(set, wrapper, property.initializer, "agent");
      const name = child ? nameOf(child.object) : null;
      if (!child || name === null) continue;
      const childPath = `${path}>${name}`;
      // A declaration cycle would not terminate, and the runner stops at the
      // same place for the same reason.
      if (ancestry.has(name)) {
        paths.push(childPath);
        continue;
      }
      await walk(child, childPath, new Set([...ancestry, name]));
    }
  };

  await walk(root.node, rootAgent, new Set([rootAgent]));
  return [...new Set(paths)];
}
