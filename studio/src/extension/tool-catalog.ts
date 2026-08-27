/**
 * Finding every tool the workspace declares, and keeping the list current.
 *
 * Glue over {@link ../catalog.ts}: this one knows how to enumerate files and
 * when to look again, and nothing about what a tool declaration is.
 */

import * as vscode from "vscode";
import type { CatalogTool } from "../protocol.js";
import { SCAN_EXCLUDE, mightDeclareATool, scanFile } from "../catalog-scan.js";
import { normalize } from "../source/parse.js";

/** Enough for any real workspace, and a backstop against scanning a whole disk. */
const MAX_FILES = 5000;
/** A save fires several events; one scan per burst is plenty. */
const SETTLE_MS = 250;

export class ToolCatalog {
  private readonly byFile = new Map<string, readonly CatalogTool[]>();
  private readonly watcher: vscode.FileSystemWatcher;
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onChange: (tools: readonly CatalogTool[]) => void) {
    this.watcher = vscode.workspace.createFileSystemWatcher("**/*.ts");
    this.watcher.onDidChange((uri) => this.queue(uri));
    this.watcher.onDidCreate((uri) => this.queue(uri));
    this.watcher.onDidDelete((uri) => {
      this.byFile.delete(normalize(uri.fsPath));
      this.publish();
    });
  }

  /** Everything found so far, newest scan wins. */
  current(): readonly CatalogTool[] {
    return [...this.byFile.values()].flat();
  }

  /**
   * Walk the workspace once.
   *
   * Deliberately not awaited by whoever opens the panel: the tree is what the
   * user is waiting for, and an assignment picker is useful a moment later.
   */
  async refresh(): Promise<void> {
    const files = await vscode.workspace.findFiles("**/*.ts", SCAN_EXCLUDE, MAX_FILES);
    this.byFile.clear();
    for (const uri of files) await this.read(uri);
    this.publish();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher.dispose();
  }

  private queue(uri: vscode.Uri): void {
    this.pending.add(uri.fsPath);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      const files = [...this.pending];
      this.pending.clear();
      this.timer = null;
      void (async () => {
        for (const file of files) await this.read(vscode.Uri.file(file));
        this.publish();
      })();
    }, SETTLE_MS);
  }

  /**
   * One file's declarations.
   *
   * An open document wins over disk so the picker matches what the user is
   * looking at. Everything else is read as bytes rather than through
   * `openTextDocument`, which would create a document per file in the workspace.
   */
  private async read(uri: vscode.Uri): Promise<void> {
    const file = normalize(uri.fsPath);
    const open = vscode.workspace.textDocuments.find((d) => normalize(d.uri.fsPath) === file);

    let text: string;
    if (open) {
      text = open.getText();
    } else {
      try {
        text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        this.byFile.delete(file);
        return;
      }
    }

    if (!mightDeclareATool(text)) {
      this.byFile.delete(file);
      return;
    }
    this.byFile.set(file, scanFile(file, text));
  }

  private publish(): void {
    this.onChange(this.current());
  }
}
