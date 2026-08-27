import * as vscode from "vscode";
import { StudioPanel } from "./panel.js";
import { APPLY_FIX_COMMAND } from "./lint-fixes.js";
import type { Finding } from "../protocol.js";

/**
 * Set by the launch configuration so a development host lands on a working
 * panel instead of an empty window. Deliberately an environment variable
 * rather than a setting: it is a property of how the extension was started,
 * not something a user of the published extension should ever turn on.
 */
const AUTO_OPEN = "AGENT_FTW_STUDIO_AUTO_OPEN";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("agentFtw.openStudio", () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "typescript") {
        void vscode.window.showErrorMessage(
          "Open the TypeScript file that exports your agent, then run Agent FTW: Open Studio."
        );
        return;
      }
      StudioPanel.show(context, editor.document.uri.fsPath);
    }),
    // Registered once, here, because a command id is global. The panel that
    // owns the file is the one that can apply a fix to it: it holds the tree
    // the finding's address is resolved against, and the runner that re-inspects
    // afterwards.
    vscode.commands.registerCommand(APPLY_FIX_COMMAND, (file: string, finding: Finding) => {
      const panel = StudioPanel.forFile(file);
      if (!panel) {
        void vscode.window.showWarningMessage("Open the Agent FTW studio for this file to apply its lint fixes.");
        return;
      }
      return panel.applyLintFix(finding);
    })
  );

  if (process.env[AUTO_OPEN] === "1") autoOpen(context);
}

/**
 * Open the panel for the first TypeScript file the window shows.
 *
 * The active editor is usually already set by the time this extension
 * activates, but a file passed on the command line can still be opening, so
 * both cases are handled and whichever happens first wins.
 */
function autoOpen(context: vscode.ExtensionContext): void {
  const open = (editor: vscode.TextEditor | undefined): boolean => {
    if (!editor || editor.document.languageId !== "typescript") return false;
    StudioPanel.show(context, editor.document.uri.fsPath);
    return true;
  };

  if (open(vscode.window.activeTextEditor)) return;

  const subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (open(editor)) subscription.dispose();
  });
  context.subscriptions.push(subscription);
}

export function deactivate(): void {
  // Panels dispose their own runner subprocess and file handles.
}
