/**
 * Lint findings, offered as quick-fixes in the editor.
 *
 * The action carries a command rather than a precomputed edit. VS Code
 * re-requests actions on every cursor move, and an edit built when the action
 * was offered can be applied against a document that has since moved. Deferring
 * everything to the moment the user picks it means there is one code path and
 * no stale range is possible, at the cost of the lightbulb's diff preview.
 */

import * as vscode from "vscode";
import type { Finding } from "../protocol.js";
import { FIXABLE } from "../lint-fix.js";
import type { SourceReader } from "../source/parse.js";

export const APPLY_FIX_COMMAND = "agentFtw.applyLintFix";

/** One finding as it was published, so an action can be matched back to it. */
export interface PublishedFinding {
  readonly finding: Finding;
  readonly range: vscode.Range;
}

/** What the provider needs from the panel that owns the file. */
export interface LintFixHost {
  readonly file: string;
  published(): readonly PublishedFinding[];
}

export class LintFixProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  constructor(private readonly host: LintFixHost) {}

  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const published = this.host.published();
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== "agent-ftw") continue;
      const match = published.find((p) => p.finding.code === diagnostic.code && p.range.isEqual(diagnostic.range));
      if (!match || !FIXABLE.has(match.finding.code)) continue;

      const action = new vscode.CodeAction(titleFor(match.finding), vscode.CodeActionKind.QuickFix);
      action.diagnostics = [diagnostic];
      action.command = {
        command: APPLY_FIX_COMMAND,
        title: action.title,
        arguments: [this.host.file, match.finding],
      };
      actions.push(action);
    }
    return actions;
  }
}

/**
 * A title the user can choose between without reading the diagnostic again.
 *
 * The real title comes from the fix itself once it is built, which names the
 * properties it would require; this one only has to be recognisable in a menu.
 */
function titleFor(finding: Finding): string {
  return finding.code === "deliverable.no-required"
    ? "Require the declared properties"
    : "Add a description to write into";
}

/**
 * File text as the editor currently has it.
 *
 * An open document wins over disk, so a fix is built against what the user is
 * looking at rather than against the last save.
 */
export function documentReader(): SourceReader {
  return async (file) => {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.replace(/\\/g, "/") === file);
    if (open) return { text: open.getText(), version: open.version };
    try {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      return { text: doc.getText(), version: doc.version };
    } catch {
      return null;
    }
  };
}
