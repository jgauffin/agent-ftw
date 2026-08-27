/**
 * Puts lint findings in the Problems panel.
 *
 * `lint` is advisory and separate from `validate`: it flags deliverables an
 * empty object would satisfy, free-form strings nothing explains, checklists
 * that grade their own work. Those are exactly the problems that surface later
 * as a run that technically succeeded and produced nothing useful, so they
 * belong where a developer already looks for problems rather than behind a
 * button in a panel.
 *
 * A finding lands on the property it is about, not on the phase, so two
 * findings about one deliverable are told apart and a quick-fix on one of them
 * has somewhere unambiguous to attach.
 */

import * as vscode from "vscode";
import type { AgentNode, Finding } from "../protocol.js";
import { locatePhase, positionAt } from "./locate.js";
import { fieldOf } from "../findings.js";
import { findingToAddress } from "../lint-fix.js";
import { SourceSet, type SourceReader } from "../source/parse.js";
import { bind, rangeOf, schemaSite, unwrapReference } from "../source/locate.js";
import type { Range } from "../source/text.js";
import type { PublishedFinding } from "./lint-fixes.js";

export async function publishFindings(
  collection: vscode.DiagnosticCollection,
  file: string,
  tree: AgentNode | null,
  findings: readonly Finding[],
  reader: SourceReader
): Promise<readonly PublishedFinding[]> {
  const uri = vscode.Uri.file(file);
  collection.delete(uri);
  if (findings.length === 0) return [];

  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const set = new SourceSet(reader);

  const published: PublishedFinding[] = [];
  for (const finding of findings) {
    const range = await rangeFor(set, file, text, doc, tree, finding);
    published.push({ finding, range });
  }

  collection.set(
    uri,
    published.map((p) => toDiagnostic(p.range, p.finding))
  );
  return published;
}

function toDiagnostic(range: vscode.Range, finding: Finding): vscode.Diagnostic {
  // The diagnostic names the property it is about, because "add a description"
  // has nowhere to land otherwise.
  const field = fieldOf(finding.path);
  const diagnostic = new vscode.Diagnostic(
    range,
    `${field}: ${finding.message}\n${finding.hint}\n\n${finding.example}`,
    finding.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning
  );
  diagnostic.source = "agent-ftw";
  diagnostic.code = finding.code;
  return diagnostic;
}

/**
 * Where the squiggle goes.
 *
 * The source layer places it on the exact node when the address resolves. When
 * it does not — a schema built by a function, a phase declared in another
 * module — the finding still has to appear somewhere, so it falls back to the
 * phase's name and finally to the first line rather than being dropped.
 */
async function rangeFor(
  set: SourceSet,
  file: string,
  text: string,
  doc: vscode.TextDocument,
  tree: AgentNode | null,
  finding: Finding
): Promise<vscode.Range> {
  const precise = tree ? await preciseRange(set, file, tree, finding) : null;
  if (precise) return toVsRange(text, precise);

  const phaseName = finding.path.split("/")[1];
  const located = phaseName ? locatePhase(text, phaseName) : null;
  if (located) return toVsRange(text, located);

  return new vscode.Range(0, 0, 0, Math.min(1, doc.lineAt(0).text.length));
}

async function preciseRange(
  set: SourceSet,
  file: string,
  tree: AgentNode,
  finding: Finding
): Promise<Range | null> {
  const address = findingToAddress(tree, finding);
  if ("refused" in address) return null;

  if (address.field === "deliverable") {
    const site = await schemaSite(set, file, address);
    return site.kind === "found" && site.site.file.file === normalize(file) ? rangeOf(site.site.object) : null;
  }

  const result = await bind(set, file, address);
  if (result.file !== normalize(file)) return null;
  const binding = unwrapReference(result.binding);
  return binding.kind === "literal" || binding.kind === "concatenation" ? binding.range : null;
}

function normalize(file: string): string {
  return file.replace(/\\/g, "/");
}

function toVsRange(text: string, range: Range): vscode.Range {
  const start = positionAt(text, range.start);
  const end = positionAt(text, range.end);
  return new vscode.Range(start.line, start.character, end.line, end.character);
}
