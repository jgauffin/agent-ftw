# Source editing

Status: the layer is built, in `studio/src/source/`, along with the first
consumer (lint quick-fixes, in `studio/src/lint-fix.ts` and
`studio/src/extension/lint-fixes.ts`). Tiers 0 and 1 are in; tier 2 is not. The
other consumers listed at the bottom are not built, which is why this file is
still here: what it refuses to do, and why, is what they have to be built
against.

How the studio finds a declared value in the user's TypeScript and changes it, as
an ordinary editor change.

This is written before the code because everything downstream depends on it: lint
quick-fixes, panel editing, adding a sub-agent from the panel, assigning a tool,
and any future codemod all want the same ability. Getting the address model and
the refusal rules wrong here would be expensive to unpick later.

It is also written because more than one piece of work needs it at once. Three
independently written AST readers would disagree about what "the phase named
`draft`" addresses, and an edit applied to the wrong node is the failure mode this
whole design exists to prevent. The library is built once, on its own, with no
consumer. Then the consumers proceed.

## The problem

An agent is TypeScript. The studio holds a projection of the *runtime*
declaration, built by importing the module. Nothing connects a value in that
projection back to the characters that produced it.

```ts
const brainstorm = phase({
  name: "brainstorm",
  prompt: "Produce 3 distinct project ideas.",   // <- change this
  turnBudget: 12,
});
```

To edit `prompt`, we have to find *that* `phase({...})` call, find *that*
property, prove its value is something we may rewrite, and replace exactly its
characters. Three of those four steps can fail, and the failure has to be visible
rather than silent: an edit applied to the wrong node is worse than no edit at
all, because the user's next read of the file will not be looking for it.

## Guiding decisions

**Never reprint the file.** Edits are character-range splices. Printing an AST
back out would reformat everything it touched and turn a one-word change into an
unreviewable diff. This also means comments, blank lines, and the author's
formatting survive by construction rather than by effort.

**Refuse rather than guess.** Every failure mode resolves to "this field is
locked, here is why", never to a best-effort edit. A locked field still renders
its live value, so the panel stays useful and the user edits by hand.

**Address by name, and prove the name is unique.** Names are how the framework
addresses everything already: traces, persistence paths, lint findings. Source
editing uses the same address, and refuses when it does not resolve to exactly one
node.

**No `vscode` import, and no framework import, below the extension layer.** The
locator, the emitter and the editor are pure functions over text. They return
character ranges; the extension turns those into a `WorkspaceEdit`. This is what
makes the whole thing testable without an editor, and what would let it be
extracted later. The tests are the one exception: they import the real `lint()`,
for a reason given under Testing.

## Who this serves

Two consumers are waiting on it, and they need different halves.

**Adding a sub-agent from the panel** needs structure only. It emits a child
`agent({...})`, a `subAgent({...})` wrapper, an entry in a phase's `tools`, and
entries in the parent's `delegable`. It replaces no values at all. Same-file is
enough for its first cut.

**The definition panel** needs values (prompt, budget, deliverable schema) plus
the ability to append a phase and to assign a tool found elsewhere in the
workspace. It also has to address nodes that live in another module, because a
sub-agent routinely does.

A third want, not yet claimed by anyone, is **lint quick-fixes**. Those are
property inserts into a schema object, addressed by JSON pointer. They are the
cheapest real use of this layer and the one most likely to pay off, for reasons
under "What this does not solve".

## Scope: what may be changed

The old draft of this document said `tools` was "deliberately not editable", which
read as forbidding both consumers. The line it was reaching for is not
value-versus-structure-property; it is **live values versus structure**.

**Never touched, under any operation.** `handler`, `adapter`, `terminator`,
`accept`. These hold functions and adapter instances. Changing them is a code
change and the panel has no business pretending otherwise.

**Never editable: `name`, on anything.** It is the address. Renaming it
invalidates traces, persisted sessions, pins and lint paths in the same edit. A
rename is a refactor, not a tweak, and belongs to the editor's own rename.

**Replaceable, when the value is a literal.**

| Construct | Field | Type |
|---|---|---|
| `agent` | `role` | enum |
| `phase` | `prompt` | string |
| `phase` | `turnBudget` | number |
| `phase` | `review` | boolean |
| `phase` | `phaseEndToolName` | string |
| `phase` | `deliverable` | JSON Schema object |
| `checklist` | `prompt` | string |
| `subAgent` | `description` | string |
| `subAgent` | `maxRejects` | number |

**Append and remove-by-identifier only: `tools`, `delegable`, `phases`.** Never
rewritten wholesale, never reordered, and an individual element is never rewritten
in place. That permits a scaffolded insert and a tool assignment, and still
forbids the panel restructuring a list it does not understand.

## Addressing

An address names a node in the tree the panel already displays, so the source
layer and the panel cannot drift apart about what they are talking about.

```ts
interface Address {
  /** Tree path exactly as the runner's project.ts builds it. */
  readonly path: string;
  readonly construct: "agent" | "phase" | "checklist" | "subAgent";
  /** Which property. Omitted when addressing the declaration itself. */
  readonly field?: string;
  /** Reaches inside a schema, for a per-property lint fix. */
  readonly pointer?: string;
}
```

Paths are what `studio/src/runner/project.ts` already produces from runtime `name`
literals: `lead` for the root agent, `lead/deliver` for one of its phases,
`lead>implementer` for a sub-agent, `lead>implementer/implement` for that
sub-agent's phase.

Two things this fixes over addressing by bare name. An agent literal is
addressable at all, which it was not, and `tools` / `delegable` / `phases` all
live there. And a phase carries its owning agent, so two agents in one file that
both declare a `review` phase are told apart. Bare names were ambiguous in exactly
the files worth editing.

`field` says *which property*. It does not imply replacement. The operation is
chosen by which function is called: `bind` to replace a value, `arrayProperty` to
append or remove an element.

One consequence is worth stating as a requirement rather than leaving implicit.
**The paths this layer resolves must equal the paths the runner projects.** Build
one fixture agent both ways, run `project()` over the imported module and the
locator over the same file's text, and assert the two path sets are identical.
Everything else in the design rests on that, and it is the single most valuable
test in the suite.

Note that lint findings use a *different* key: `agentName/phaseName`, not the tree
path, so a nested agent's finding reads `implementer/implement` where its tree path
reads `lead>implementer/implement`. Both lookups are needed.

## Reading across files

The old draft refused to follow a reference into another module. That judgement is
right for *editing a value* and wrong for *finding a node*, and the two were
conflated. They separate into three tiers, which also happen to be the order they
should be built in.

**Tier 0, same file.** Resolve an identifier to its declaration in the same
module, and inventory what that module declares. Enough for adding a sub-agent.
Note that writing `tools: [search]` only requires the identifier to be *in scope*,
which an existing `import { search } from "./tools.js"` already satisfies with no
cross-file work at all.

**Tier 1, follow a relative import to address a node.** Required to reach
`lead>implementer` when `implementer` is declared elsewhere, which is how the
examples are written. Read-only: it locates, it does not unlock editing.

**Tier 2, scan the workspace.** Required only to offer something that exists in
the repo but is not yet imported into this file, because then the exporting module
has to be known in order to emit the import.

**Editing a value through a cross-file reference stays refused.** Not because it
is hard, but because a shared schema is probably shared: editing it through one
phase's panel would silently change every other phase using it. If that is ever
wanted it should be an explicit, and clearly labelled, action.

A reference used more than once *within* a file has the same problem, so the
locator counts uses and refuses above one.

Only relative specifiers are followed. Candidates are tried in order: the
specifier as written, `.js` swapped for `.ts` (this repo's ESM habit), the
specifier with `.ts` appended, then `/index.ts`, then `.tsx`. A package specifier
ends the walk. Aliased imports map back to the exported name.

The loader is asynchronous, so the extension can supply an unsaved editor buffer
rather than stale disk text, and each loaded file carries the document version it
was read at. That version is what the staleness check under Applying compares.

## Layer 1: locate and classify

### Binding

Given source text and an address, return what the field's value is and whether we
may rewrite it.

```ts
type Binding =
  /** A literal we can replace. `wrapper` is preserved across the edit. */
  | { kind: "literal"; range: Range; text: string; wrapper: "as-const" | null }
  /** Two or more string literals joined with `+`. Replaceable as one expression. */
  | { kind: "concatenation"; range: Range; parts: readonly string[] }
  /** `deliverable: SCHEMA`, where SCHEMA is a const in the same file. */
  | { kind: "reference"; via: string; target: Binding }
  /** The property is not declared at all. Carries where it would go. */
  | { kind: "absent"; insertInto: Range; indent: string }
  /** Present, but not something we can prove the value of. */
  | { kind: "computed"; expression: string; at: Position }
  /** The address does not resolve to exactly one node. */
  | { kind: "ambiguous"; reason: string };
```

`computed` and `ambiguous` both mean locked; they are separate so the panel can
say which, because the two suggest different fixes to the reader. `expression` is
the TypeScript syntax kind, which is what the studio's existing `FieldLock` type
already promises to carry. Turning a syntax kind into prose ("built by a function
call", "an imported constant") is the view model's job, not this layer's.

`wrapper: "as-const"` means `range` covers the object literal only, so `as const`
survives a rewrite by construction. Dropping it would be a silent type regression:
the schema would widen to `string` and the deliverable's inferred type would
collapse. There is a test that says so.

`absent` is not an edge case. `tools` and `delegable` are both optional at the
factory call site, and a phase that declares no `turnBudget` is ordinary, so most
real files reach this branch.

**Writable literal kinds.** String and template-without-substitution, numeric
(including a leading minus), `true` and `false`, and an object literal whose every
leaf is a literal, bare or inside an `as const`. Everything else is `computed`,
which includes concatenation the locator did not recognise as such, a template
with substitutions, a call, a bare identifier, a spread inside an object, and a
computed property name. Note that a prompt built with `+` is the *common* case in
this repo's own examples, so `concatenation` earns its place in the union.

### Array properties

```ts
type ArrayBinding =
  | { kind: "array"; span: Range; elements: readonly ArrayElement[];
      /** Where a new element's text goes, and whether a `,` must precede it. */
      insertAt: number; needsLeadingComma: boolean;
      itemIndent: string; multiline: boolean }
  /** The property is not declared. Carries where the whole `tools: [x],` goes. */
  | { kind: "absent"; insertInto: Range; indent: string }
  | { kind: "computed"; expression: string; at: Position };

interface ArrayElement {
  readonly span: Range;
  /** Set when the element is a bare identifier, which is what removal matches on. */
  readonly identifier: string | null;
  readonly text: string;
}
```

Both element shapes have to work: an inline `phase({...})` or `subAgent({...})`
call, and a bare identifier resolved to a `const`. Removal takes the element's
comma and the whitespace ahead of it. Insertion matches the array's existing
indentation and its trailing-comma habit, because a diff that reformats its
neighbours is a diff nobody reads.

### Inventory

One scan of a file, returning every top-level declaration and every import.

```ts
interface Inventory {
  readonly file: string;
  readonly declarations: readonly DeclEntry[];
  readonly imports: readonly ImportEntry[];
}

interface DeclEntry {
  readonly kind: "tool" | "subAgent" | "customSubAgent" | "phase" | "agent" | "checklist";
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
  readonly line: number;
}

interface ImportEntry {
  readonly specifier: string;
  readonly kind: "named" | "namespace" | "default" | "typeOnly";
  readonly bindings: readonly { local: string; imported: string }[];
  readonly range: Range;
  /** Offset to insert a new binding before `}`. Null when not extendable. */
  readonly extendAt: number | null;
}
```

This is one parse serving four needs, which is why it is one function rather than
four.

It resolves a declared name to a source identifier. `const search = tool({ name:
"search" })` has to become `delegable: [search]`, not `delegable: ["search"]`; the
two differ and only the identifier compiles.

It gives an insert its anchor, via `statement`.

It tells the import layer what it can extend.

And it surfaces what the projected tree cannot. The tree shows only what is
*reachable from a phase*, so a tool declared in the file and wired to nothing is
invisible in the panel today. That set is exactly what a "grant this to the child"
picker must offer, and "defined here, nothing can call it" is worth saying out
loud on its own.

Non-literal values are left blank rather than guessed. The identifier is what gets
written, and it is always known.

### Ambiguity

Refuse, with a reason, when:

- two calls in the file declare the same `name` at the same address depth
- the address resolves to no call at all (built by a factory, or in a loop)
- `name` is not a string literal (`name: makeName("draft")`)
- a followed reference is used by more than one declaration

## Layer 2: emit

A value from the panel becomes TypeScript source text.

**Strings.** Match the quote style already in the file. A string that fits the
line budget becomes one literal; a longer one becomes a `+`-joined concatenation
wrapped at the file's apparent width, which is the idiom the repo already uses for
prompts. Newlines in the value become `\n` escapes rather than a template literal,
because a template literal changes what the surrounding code means if it is later
edited by hand. There is one emitter and one style, so that two consumers cannot
produce two dialects in the same file.

**Numbers and booleans.** Direct.

**JSON Schema objects.** Printed as an idiomatic TS object literal, not as JSON:
unquoted keys where the key is a valid identifier, two-space indentation relative
to the property's own indentation, and `as const` restored when the original had
it. `JSON.stringify` output would be valid TypeScript and would read as though a
machine had been through the file, which is exactly the impression to avoid when
the whole promise is "this is an ordinary editor change".

**Declarations.** A `phase({...})` element, a `subAgent({...})` wrapper, a whole
`agent({...})`, an import statement.

Two constraints every declaration emitter has to satisfy, both enforced by code
that already exists.

*At least one phase* on an emitted agent, or `validate` throws.

*Lint-clean out of the box.* `lint()` treats `deliverable.no-required` as an error
and warns on a free-form string with neither a description nor a mention in the
prompt. A scaffold that lights up the studio's own Problems panel the moment it is
written is a bug, not a starting point. This is why the tests import the real
`lint()` even though the library does not.

## Layer 3: edit

A binding plus a value gives a list of `{ file, start, end, newText }`.

**Replace** an existing property's value. This is panel editing.

**Insert a property** that is not declared. This is what a lint quick-fix needs:
`deliverable.no-required` wants `required: ["title","summary"]` added to an object
literal that has no `required` at all, and `deliverable.unexplained-string` wants a
`description` added to a property. Insert has to choose a position inside the
object literal, match the surrounding indentation, and get the trailing comma
right, none of which replace has to think about, so they are separate functions.

**Append an element** to an array property, creating the property when it is
absent.

**Remove an element** from an array property, matched by identifier.

**Insert a statement**, anchored by the caller:

```ts
insertStatement(source, statementText, { beforeStatementContaining: offset }): TextEdit
```

The anchor is not cosmetic and the caller supplies it deliberately. Module-scope
`const` is in temporal dead zone until its statement runs, and
`agent({ tools: [callReviewer] })` evaluates at import time. A wrapper emitted
*after* the parent is an import-time crash, not a type error, and it will not show
up in a typecheck. The offset function carries a "why" comment saying so, because
the failure lands far from the edit.

**Imports** are two operations, not one, because the two consumers need different
things.

`extendNamedImport(source, name)` adds a binding to an import that already exists,
for a name whose module can only be learned from that import. `phase` and
`subAgent` are this case: the file might import from `agent-ftw` or from
`../src/declare/index.js` and the layer cannot know which. It refuses when there is
no extendable named import, for instance a namespace import. It never invents a
specifier.

`ensureImport(target, identifier, fromFile)` handles a name whose source file is
known, which is the tier-2 workspace case. Three outcomes: already in scope and
resolving to that file, so no edit; an existing import with the same computed
specifier, so a binding is appended; otherwise a new statement after the last
import, or after the file's leading comment block when there are none. A type-only
import falls through to the third case.

An identifier already bound to something else is **refused, not aliased**. An
alias would have to be threaded through the emitted array text and through every
consumer's display, and the user can rename in two seconds.

Specifier style is copied from the target file's own relative imports: if any ends
`.js`, use `.js`; if they are extensionless, stay extensionless.

**Removing an element never removes an import.** An unused import is inert.
Removing one that another declaration still uses is a real bug, and Organize
Imports already exists in the editor.

## Layer 4: verify

Applying an edit is not the same as having made the change. After every write:

1. Re-parse the edited text.
2. Re-locate the same address.
3. Read the value back and compare it to what was asked for.

A mismatch is a bug in the emitter or the locator, and it is caught at the moment
it happens rather than by a user noticing their prompt is subtly wrong a week
later. The check is cheap because it is the locator we already have.

Every emitted declaration additionally has to re-parse with no syntactic
diagnostics. That one is worth asserting even where nothing is read back.

## Applying: the extension's half

The library returns edits. The extension applies them, and how it does so is part
of the contract because both consumers have to do it the same way.

All edits in one `WorkspaceEdit`, so the whole change is a single undo step. Sort
by offset and assert that no two edits in one file overlap; distinct fields always
produce distinct spans, so this only ever fires on a bug.

**Then save.** An earlier draft of this document described the edit landing as an
unsaved editor modification, and one of the consumer plans called `doc.save()`.
Save wins: the runner imports the user's file from disk, so an unsaved edit is
invisible to the very re-inspect that is meant to prove the edit worked.

Then re-inspect, and let the rebuilt tree be the evidence.

**Staleness.** Edits are never applied to a file the projection did not come from.
Each loaded file recorded its document version; before building edits, re-check
it. If anything changed, refuse, say which file, re-inspect, and **keep the staged
edits** so nothing the user typed is thrown away. Without this, a rebuild of the
tree racing a keystroke could write a value into a range that has moved.

Consumers that stage several changes before writing should stage on change rather
than on every keystroke, which is what the panel's existing pin editor already
does.

## API sketch

```
studio/src/source/
  parse.ts      Loader, LoadedFile (text + version), file cache,
                identifier resolution (tier 0 and tier 1)
  locate.ts     bind(text, address): Binding
                arrayProperty(text, address, prop): ArrayBinding
                declarationSite(address): DeclEntry
  inventory.ts  inventory(file, text): Inventory
  emit.ts       emitString / emitNumber / emitBoolean / emitSchema
                emitPhase / emitSubAgent / emitAgent / emitImport
  edit.ts       replace, insertProperty,
                appendElement, removeElement,
                insertStatement,
                extendNamedImport, ensureImport      -> TextEdit[]
  verify.ts     check(text, edits, address, expected)
```

Nothing here imports `vscode`. Nothing here imports the framework.

The library ships with its tests and no consumer. It is verifiable on its own as
pure functions over fixture text, and that is the point: the riskiest part of the
design is addressing, and addressing can be proved right before a single byte is
written back to anyone's file.

`studio/src/extension/locate.ts`, the regex that currently points the reveal
command and the lint diagnostics at a phase, is left alone by this work. It is
retired by whichever consumer first needs field-accurate diagnostics, and that is
a follow-up rather than something to smuggle in here.

## Testing

Table-driven over fixture sources, because the interesting cases are all shapes of
source rather than shapes of data:

- a literal prompt, a concatenated prompt, a prompt from a function call
- a schema inline with `as const`, a schema referenced by a same-file const, a
  schema imported from another module
- two phases sharing a name; two agents in one file each with a `review` phase; a
  phase built in a loop; a computed `name`
- a property present, and the same property absent
- `tools` present and non-empty, present and empty, and absent entirely
- `delegable` absent, and already containing the needed name, so no duplicate is
  emitted
- an import already carrying the binding, an extendable named import, a namespace
  import that has to be refused, and a file needing a brand new import statement

Four assertions cut across all of it and are worth stating as properties rather
than cases.

**Round trip.** Reading a value and writing the same value back leaves the file
byte-identical. This catches an emitter that quietly reformats.

**Locality.** Every edit changes only the range it claimed. Assert the text
outside the edited range is unchanged, so a regression that reprints a whole node
fails loudly.

**Path equality.** The paths the locator resolves equal the paths the runner
projects, proved on one fixture built both ways.

**Scaffolds are clean.** Every emitted declaration parses with no syntactic
diagnostics and produces no findings from the framework's real `lint()`.

## The TypeScript dependency

The locator needs a real TypeScript parser. `typescript` is currently a
devDependency of the studio and is large on disk.

**Decision: move it to `dependencies` and mark it external to the bundle.**

VS Code ships TypeScript but does not expose it to extensions, so it has to be
carried. Bundling it into `extension.js` with esbuild is possible but produces a
single very large file and buys nothing, since it is loaded either way. Marking it
external keeps the bundle readable and lets Node load it normally. The studio
already resolves `tsx` this way at runtime, so the arrangement is not new.

Parser only: no `Program`, no type checker, no tsconfig. The layer never needs
types, only syntax, and a `Program` would drag in module resolution the studio
does not control.

A lighter parser was considered and rejected. `acorn` and friends do not parse
TypeScript syntax at all, and anything that disagrees with `tsc` about what the
file means is a source of edits applied to the wrong node. The whole design rests
on the parser agreeing with the editor, so it uses the same parser the editor
does.

The cost is the packaged extension's size. That is the right thing to trade for
correctness here, and it is worth revisiting only if a parser appears that is both
TypeScript-accurate and small.

## What this does not solve

The share of a real agent that is literal is still unknown. In `examples/` it is
essentially everything; in a codebase that factors prompts into a `prompts.ts`,
following same-file references will not help and most fields will render locked.
That is a real limit on how useful panel *value* editing is.

It is also the reason to build the lint quick-fixes early. Those act on schema
properties, which are far more often inline than prompts are, and they are
deterministic inserts needing no model at all.

Structural editing does not have this problem. Appending to an array and inserting
a declaration work regardless of how the values around them were written, which is
why the sub-agent consumer can be built against tier 0 alone.

## What builds on this

- **Adding a sub-agent from the panel.** Tier 0, structure only.
- **The definition panel.** Value editing, plus appending a phase and assigning a
  tool. Tiers 1 and 2.
- **Lint quick-fixes.** Built. `deliverable.no-required` and
  `deliverable.unexplained-string` are offered; the rest are not, because their
  fix is a design decision rather than a deterministic insert.
  `phase.budget-vs-tools` is deterministic but its required floor exists only in
  the finding's prose, so making it fixable wants a structured field on the
  framework's `LintFinding`.
- **Codemods.** The same locate-and-splice layer over a whole directory, if bulk
  edits are ever wanted.
