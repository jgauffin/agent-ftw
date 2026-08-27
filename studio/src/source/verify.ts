/**
 * Proving the change that was asked for is the change that landed.
 *
 * Applying an edit is not the same as having made it. A mismatch here is a bug
 * in the emitter or the locator, and it is caught at the moment it happens
 * rather than by a user noticing their prompt is subtly wrong a week later. The
 * check is cheap because it is the locator we already have.
 */

import * as ts from "typescript";
import { SourceSet, type SourceReader, type SourceText } from "./parse.js";
import { type Address, bind, propertyOf, schemaSite, unwrapReference } from "./locate.js";
import { applyEdits } from "./edit.js";
import type { TextEdit } from "./text.js";

export type Verdict =
  | { readonly kind: "ok" }
  | { readonly kind: "mismatch"; readonly reason: string };

/**
 * Re-parse the edited text, re-locate the same address, and compare the value
 * read back against what was asked for.
 *
 * `expected` is the source text of the value, which is what the emitter
 * produced: comparing the characters rather than a parsed value is what catches
 * an emitter that quietly reformats.
 */
export async function check(
  reader: SourceReader,
  entryFile: string,
  edits: readonly TextEdit[],
  address: Address,
  expected: string
): Promise<Verdict> {
  const edited = new SourceSet(await editedReader(reader, edits));

  const syntax = await syntaxErrorsIn(edited, filesTouched(edits));
  if (syntax.length > 0) return { kind: "mismatch", reason: `The edit did not parse: ${syntax.join("; ")}` };

  const result = await bind(edited, entryFile, address);
  const binding = unwrapReference(result.binding);

  if (binding.kind !== "literal" && binding.kind !== "concatenation") {
    return { kind: "mismatch", reason: `After the edit, \`${address.field}\` reads as ${binding.kind}.` };
  }

  const file = await edited.load(result.file);
  const actual = file ? file.text.slice(binding.range.start, binding.range.end) : "";
  if (actual !== expected) {
    return { kind: "mismatch", reason: `Wrote ${expected}, but the file now reads ${actual}.` };
  }
  return { kind: "ok" };
}

/**
 * The same check for an insert: re-locate the schema node and read the property
 * that was supposed to appear in it.
 *
 * Run before the edits are written rather than after. The check costs the same
 * either way, and refusing up front means a bad splice never reaches the file
 * at all instead of having to be undone.
 */
export async function checkInsertedProperty(
  reader: SourceReader,
  entryFile: string,
  edits: readonly TextEdit[],
  address: Address,
  property: string,
  expected: string
): Promise<Verdict> {
  const edited = new SourceSet(await editedReader(reader, edits));

  const syntax = await syntaxErrorsIn(edited, filesTouched(edits));
  if (syntax.length > 0) return { kind: "mismatch", reason: `The edit did not parse: ${syntax.join("; ")}` };

  const site = await schemaSite(edited, entryFile, address);
  if (site.kind !== "found") return { kind: "mismatch", reason: `After the edit, the address no longer resolves: ${site.reason}` };

  const declared = propertyOf(site.site.object, property);
  if (!declared) return { kind: "mismatch", reason: `\`${property}\` is not in the object after the edit.` };

  const actual = declared.initializer.getText();
  return actual === expected
    ? { kind: "ok" }
    : { kind: "mismatch", reason: `Wrote \`${property}: ${expected}\`, but the file now reads \`${actual}\`.` };
}

/** Every emitted declaration has to re-parse, even where nothing is read back. */
export function syntaxErrors(text: string, file = "emitted.ts"): readonly string[] {
  const parsed = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const diagnostics = (parsed as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
}

async function syntaxErrorsIn(set: SourceSet, files: readonly string[]): Promise<readonly string[]> {
  const out: string[] = [];
  for (const file of files) {
    const loaded = await set.load(file);
    if (loaded) out.push(...syntaxErrors(loaded.text, file));
  }
  return out;
}

function filesTouched(edits: readonly TextEdit[]): readonly string[] {
  return [...new Set(edits.map((e) => e.file))];
}

/** A reader that serves the edited text, so nothing is written to disk to check it. */
async function editedReader(reader: SourceReader, edits: readonly TextEdit[]): Promise<SourceReader> {
  const patched = new Map<string, SourceText>();
  for (const file of filesTouched(edits)) {
    const original = await reader(file);
    if (!original) continue;
    patched.set(file, {
      text: applyEdits(original.text, edits.filter((e) => e.file === file)),
      version: original.version,
    });
  }
  return async (file) => patched.get(file) ?? (await reader(file));
}
