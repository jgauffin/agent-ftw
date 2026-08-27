/**
 * The studio panel: one webview per TypeScript file, wired to one runner
 * subprocess.
 *
 * The panel owns all state. The webview renders what it is given and sends
 * back intentions; the runner executes and reports. Keeping the state here
 * rather than in the webview means a panel that is closed and reopened, or a
 * webview that VS Code discards to save memory, comes back to the same run.
 */

import * as vscode from "vscode";
import * as path from "node:path";
import type {
  CatalogTool,
  Finding,
  FromRunner,
  FromWebview,
  PendingEdit,
  PendingPrompt,
  Pin,
  RunStatus,
  StagedEdit,
  StudioState,
  ToWebview,
  TraceEnvelope,
} from "../protocol.js";
import { RunModel } from "../run-model.js";
import { RunnerClient } from "./runner-client.js";
import { RunStore } from "./run-store.js";
import { publishFindings } from "./lint-diagnostics.js";
import { locatePhase, positionAt } from "./locate.js";
import { LintFixProvider, documentReader, type LintFixHost, type PublishedFinding } from "./lint-fixes.js";
import { SourceSet, normalize } from "../source/parse.js";
import { ordered } from "../source/edit.js";
import { checkInsertedProperty } from "../source/verify.js";
import { buildFix } from "../lint-fix.js";
import {
  checkAssign,
  describe as describeEdit,
  fieldLocks,
  normalizeFieldValue,
  planEdits,
  verifyPlan,
} from "../edit-plan.js";
import { ToolCatalog } from "./tool-catalog.js";
import { openable } from "../agent-choice.js";
import type { TextEdit } from "../source/text.js";

export class StudioPanel implements LintFixHost {
  private static readonly viewType = "agentFtw.studio";
  private static open = new Map<string, StudioPanel>();

  private readonly panel: vscode.WebviewPanel;
  private readonly runner: RunnerClient;
  private readonly store: RunStore;
  private readonly output: vscode.OutputChannel;
  private readonly diagnostics: vscode.DiagnosticCollection;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly model = new RunModel();
  private readonly catalog: ToolCatalog;
  /** False until the panel script reports in; see the `ready` message. */
  private webviewReady = false;
  /** The findings as they were last placed, so a quick-fix can be matched back to one. */
  private publishedFindings: readonly PublishedFinding[] = [];

  private state: StudioState = {
    file: null,
    agents: [],
    selectedExport: null,
    tree: null,
    findings: [],
    selectedPath: null,
    status: "idle",
    error: null,
    pending: null,
    output: undefined,
    pins: [],
    locks: {},
    edits: [],
    editError: null,
    catalog: [],
    // The drawing is always on the left, so the inspector opens on what the
    // root agent is rather than on any one phase of it.
    tab: "settings",
  };

  static show(context: vscode.ExtensionContext, file: string): void {
    const existing = StudioPanel.open.get(file);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    StudioPanel.open.set(file, new StudioPanel(context, file));
  }

  /** The panel that owns a file, which is the only place a fix for it can be applied. */
  static forFile(file: string): StudioPanel | undefined {
    return StudioPanel.open.get(file);
  }

  published(): readonly PublishedFinding[] {
    return this.publishedFindings;
  }

  private constructor(
    private readonly context: vscode.ExtensionContext,
    readonly file: string
  ) {
    const workspace = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file));
    const root = workspace?.uri.fsPath ?? path.dirname(file);

    this.output = vscode.window.createOutputChannel(`Agent FTW: ${path.basename(file)}`);
    this.diagnostics = vscode.languages.createDiagnosticCollection("agent-ftw");
    this.store = new RunStore(path.join(root, ".agent-ftw", "studio"));

    this.panel = vscode.window.createWebviewPanel(
      StudioPanel.viewType,
      `Studio: ${path.basename(file)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out")],
      }
    );
    this.panel.webview.html = this.html();

    this.runner = new RunnerClient(
      path.join(context.extensionUri.fsPath, "out", "runner.mjs"),
      root,
      {
        onMessage: (m) => this.onRunnerMessage(m),
        onLog: (stream, text) => this.output.append(stream === "stderr" ? text : text),
        onExit: (code) => this.onRunnerExit(code),
      }
    );

    this.catalog = new ToolCatalog((tools) => this.update({ catalog: tools }));

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m: FromWebview) => this.onWebviewMessage(m)),
      this.panel.onDidDispose(() => this.dispose()),
      // Scoped to this panel's file: the findings only exist while it is open,
      // so the actions should not outlive it either.
      vscode.languages.registerCodeActionsProvider({ scheme: "file", pattern: file }, new LintFixProvider(this), {
        providedCodeActionKinds: LintFixProvider.providedCodeActionKinds,
      })
    );

    this.update({ file, status: "inspecting" });
    this.runner.send({ t: "discover", file });
    // Not awaited: the tree is what the user is waiting for, and an assignment
    // picker is useful a moment later.
    void this.catalog.refresh();
  }

  // -------------------------------------------------------------------------
  // Runner
  // -------------------------------------------------------------------------

  private onRunnerMessage(msg: FromRunner): void {
    switch (msg.t) {
      case "ready":
        return;

      case "discovered": {
        // Auto-select when there is no ambiguity. Several exports usually mean
        // one tree seen from several places, because a file exports its
        // sub-agents so they can be run alone, so the one nothing else
        // contracts is the whole thing rather than a guess between siblings.
        // Two unrelated trees in one file is a real question, and that waits.
        const only = openable(msg.agents);
        this.update({ agents: msg.agents, status: only ? "inspecting" : "idle" });
        if (only) this.selectAgent(only.exportName);
        else if (msg.agents.length === 0) {
          this.update({
            status: "failed",
            error:
              `No exported agent found in ${path.basename(this.file)}. ` +
              `The studio reads exports, so the agent needs to be \`export const\`.`,
          });
        }
        return;
      }

      case "tree":
        // A tree arriving is the end of an inspect, so the panel is idle again
        // unless a run is what asked for it.
        this.update({
          tree: msg.tree,
          findings: msg.findings,
          ...(this.state.status === "inspecting" ? { status: "idle" as const } : {}),
        });
        void publishFindings(this.diagnostics, this.file, msg.tree, msg.findings, documentReader()).then(
          (published) => {
            this.publishedFindings = published;
          }
        );
        void this.resolveLocks(msg.tree);
        return;

      case "trace":
        this.onTrace(msg.event);
        return;

      case "ask":
        this.update({
          pending: {
            kind: "ask",
            id: msg.id,
            prompt: msg.prompt,
            options: msg.options,
            mode: msg.mode,
            agent: msg.agent,
            phase: msg.phase,
          },
        });
        return;

      case "review":
        this.update({
          pending: { kind: "review", id: msg.id, deliverable: msg.deliverable, agent: msg.agent, phase: msg.phase },
        });
        return;

      case "reviewRevised":
        // Same prompt, new deliverable: the review conversation continues.
        this.update({
          pending:
            this.state.pending?.kind === "review"
              ? { ...this.state.pending, deliverable: msg.deliverable }
              : this.state.pending,
        });
        return;

      case "budget":
        this.update({ pending: { kind: "budget", id: msg.id, request: msg.request } });
        return;

      case "done":
        void this.store.end();
        this.update({ status: "done", output: msg.output, pending: null });
        return;

      case "failed":
        void this.store.end();
        if (msg.stack) this.output.appendLine(msg.stack);
        this.update({ status: "failed", error: msg.error, pending: null });
        return;
    }
  }

  private onTrace(event: TraceEnvelope): void {
    this.model.apply(event);
    this.store.append(event);
    this.post({ t: "trace", event });
  }

  private onRunnerExit(code: number | null): void {
    void this.store.end();
    if (this.state.status !== "running") return;
    this.update({
      status: "failed",
      error: `The runner exited (code ${code ?? "unknown"}) before the run finished. See the output channel.`,
      pending: null,
    });
  }

  // -------------------------------------------------------------------------
  // Webview
  // -------------------------------------------------------------------------

  private onWebviewMessage(msg: FromWebview): void {
    switch (msg.t) {
      case "ready":
        // Everything posted before the panel script loaded was dropped, so the
        // current state goes out again now that there is something listening.
        this.webviewReady = true;
        this.post({ t: "state", state: this.state });
        return;

      case "selectAgent":
        this.selectAgent(msg.exportName);
        return;

      case "select":
        this.update({ selectedPath: msg.path });
        return;

      case "setTab":
        this.update({ tab: msg.tab });
        return;

      case "stageEdit":
        this.stage(msg.edit);
        return;

      case "unstageEdit":
        this.update({ edits: this.state.edits.filter((_, i) => i !== msg.index), editError: null });
        return;

      case "discardEdits":
        this.update({ edits: [], editError: null });
        return;

      case "saveDefinition":
        void this.saveDefinition();
        return;

      case "refreshCatalog":
        void this.catalog.refresh();
        return;

      case "run":
        void this.startRun(msg.input);
        return;


      case "cancel":
        this.runner.send({ t: "cancel" });
        this.update({ status: "cancelled", pending: null });
        return;

      case "askResult":
        this.runner.send({
          t: "askResult",
          id: msg.id,
          selected: msg.selected,
          ...(msg.other !== undefined ? { other: msg.other } : {}),
        });
        this.update({ pending: null });
        return;

      case "reviewRevise":
        this.runner.send({ t: "reviewRevise", id: msg.id, message: msg.message });
        return;

      case "reviewApprove":
        this.runner.send({ t: "reviewApprove", id: msg.id });
        this.update({ pending: null });
        return;

      case "budgetResult":
        this.runner.send({ t: "budgetResult", id: msg.id, extendBy: msg.extendBy });
        this.update({ pending: null });
        return;

      case "reveal":
        void this.reveal(msg.path);
        return;

      case "copy":
        void vscode.env.clipboard.writeText(msg.text).then(() => {
          void vscode.window.setStatusBarMessage(`Copied ${msg.label}`, 2000);
        });
        return;

      case "pinThrough":
        this.update({ pins: this.pinsThrough(msg.phase) });
        return;

      case "unpinAll":
        this.update({ pins: [] });
        return;

      case "editPin":
        this.update({
          pins: this.state.pins.map((p) =>
            p.phase === msg.phase ? { ...p, json: msg.json, error: jsonError(msg.json) } : p
          ),
        });
        return;
    }
  }

  /**
   * Ask the runner to compile and project one agent.
   *
   * Guarded against re-entry: selecting an agent that is already selected and
   * already projected does nothing. Inspecting is a request the runner answers
   * with a message, so anything that turns that answer back into a fresh
   * selection would spin.
   */
  private selectAgent(exportName: string): void {
    if (this.state.selectedExport === exportName && this.state.tree !== null) return;
    this.update({ selectedExport: exportName, status: "inspecting", tree: null, error: null });
    this.runner.send({ t: "inspect", file: this.file, exportName });
  }

  private async startRun(input: string | Record<string, unknown>): Promise<void> {
    const exportName = this.state.selectedExport;
    if (!exportName) return;

    const broken = this.state.pins.find((p) => p.error !== null);
    if (broken) {
      this.update({ status: "failed", error: `Pinned "${broken.phase}" is not valid JSON: ${broken.error}` });
      return;
    }

    this.model.reset();
    const agentName = this.state.tree?.name ?? exportName;
    const startedAt = Date.now();
    const runFile = await this.store.begin(agentName, startedAt);
    this.output.appendLine(`--- run started, trace at ${runFile}`);

    const pins = Object.fromEntries(this.state.pins.map((p) => [p.phase, JSON.parse(p.json) as unknown]));

    this.update({ status: "running", error: null, output: undefined, pending: null });
    this.runner.send({
      t: "run",
      file: this.file,
      exportName,
      input: parseInput(input),
      sessionDirectory: this.store.sessionDirectory,
      // A fresh id per run: a pinned session is a prepared starting point, not
      // something to accumulate across runs.
      sessionId: `studio_${startedAt.toString(36)}`,
      ...(Object.keys(pins).length > 0 ? { pins } : {}),
    });
  }

  /**
   * Pin the named phase and every phase before it.
   *
   * Holding phase 3 while leaving phase 2 to run would be a hole rather than a
   * starting point: the framework resumes at a boundary, so a pin only means
   * anything if everything ahead of it is pinned too.
   */
  private pinsThrough(phase: string): Pin[] {
    const phases = this.state.tree?.phases ?? [];
    const cutoff = phases.findIndex((p) => p.name === phase);
    if (cutoff < 0) return [];

    const produced = this.deliverablesByPhase();
    const pins: Pin[] = [];
    for (const p of phases.slice(0, cutoff + 1)) {
      if (!produced.has(p.name)) break;
      const existing = this.state.pins.find((x) => x.phase === p.name);
      pins.push(existing ?? { phase: p.name, json: JSON.stringify(produced.get(p.name), null, 2), error: null });
    }
    return pins;
  }

  /** What the last run actually produced, which is what there is to pin. */
  private deliverablesByPhase(): Map<string, unknown> {
    const out = new Map<string, unknown>();
    const root = this.model.root;
    if (!root) return out;
    for (const p of root.phases) {
      if (p.status === "done") out.set(p.phase, p.deliverable);
    }
    return out;
  }

  /**
   * Open the source at the declaration. Both an agent path (`newsroom`) and a
   * phase path (`newsroom/write`) end in the name that appears in the source.
   */
  private async reveal(path: string): Promise<void> {
    const name = path.split(/[/>]/).pop() ?? "";
    const doc = await vscode.workspace.openTextDocument(this.file);
    const range = locatePhase(doc.getText(), name);
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    if (!range) return;
    const start = positionAt(doc.getText(), range.start);
    const position = new vscode.Position(start.line, start.character);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  }

  // -------------------------------------------------------------------------
  // Lint quick-fixes
  // -------------------------------------------------------------------------

  /**
   * Apply one lint fix, then let the rebuilt tree be the evidence.
   *
   * Everything is done here rather than when the action was offered, so the
   * edits are built against the document as it is at this moment and no stale
   * range can be written.
   */
  async applyLintFix(finding: Finding): Promise<void> {
    const tree = this.state.tree;
    const exportName = this.state.selectedExport;
    if (!tree || !exportName) return;

    const reader = documentReader();
    const set = new SourceSet(reader);
    const outcome = await buildFix(set, this.file, tree, finding, normalize(this.file));
    if (outcome.kind !== "fix") {
      void vscode.window.showWarningMessage(`Agent FTW cannot fix this here. ${outcome.reason}`);
      return;
    }

    const plan = outcome.plan;
    const edits = ordered(plan.edits);

    const verdict = await checkInsertedProperty(
      reader,
      this.file,
      edits,
      plan.address,
      plan.verify.property,
      plan.verify.text
    );
    if (verdict.kind !== "ok") {
      void vscode.window.showErrorMessage(`Agent FTW did not apply the fix: ${verdict.reason}`);
      return;
    }

    const stale = await staleFile(set);
    if (stale) {
      void vscode.window.showWarningMessage(`${path.basename(stale)} changed while the fix was being prepared. Nothing was written.`);
      this.runner.send({ t: "inspect", file: this.file, exportName });
      return;
    }

    const workspaceEdit = new vscode.WorkspaceEdit();
    for (const edit of edits) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.file));
      workspaceEdit.replace(doc.uri, new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.newText);
    }
    if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
      void vscode.window.showErrorMessage("Agent FTW could not apply the edit.");
      return;
    }

    // The runner imports the file from disk, so an unsaved edit would be
    // invisible to the very re-inspect meant to prove the fix worked.
    const target = await vscode.workspace.openTextDocument(vscode.Uri.file(this.file));
    await target.save();

    if (plan.selection) await this.putCursorAt(plan.selection.file, plan.selection.range.start);
    this.runner.send({ t: "inspect", file: this.file, exportName });
  }

  // -------------------------------------------------------------------------
  // Staged edits
  // -------------------------------------------------------------------------

  /**
   * Work out which fields are writable, against the source as it is now.
   *
   * Separate from the tree message rather than part of it: the tree comes from
   * the runner, which has no source offsets, and the answer changes when the
   * file is edited by hand as much as when the declaration changes.
   */
  private async resolveLocks(tree: StudioState["tree"]): Promise<void> {
    if (!tree) return;
    try {
      this.update({ locks: await fieldLocks(new SourceSet(documentReader()), this.file, tree) });
    } catch (e) {
      // Not fatal: without locks every control is treated as locked, which is
      // the safe direction, and the panel keeps working as a reader.
      this.output.appendLine(`Could not resolve which fields are editable: ${e instanceof Error ? e.message : e}`);
      this.update({ locks: {} });
    }
  }

  /**
   * Hold a change for the next save.
   *
   * Restaging the same target replaces the earlier change rather than queueing
   * a second one, so typing in a field twice is one edit and the pending list
   * stays a list of intentions rather than of keystrokes.
   */
  private stage(incoming: PendingEdit): void {
    // Every control hands back a string. Turning it into the type the field
    // holds happens here rather than in the webview, so a bad number or a
    // half-typed schema is reported in the same place every other refusal is.
    let edit = incoming;
    if (edit.kind === "field") {
      const normalized = normalizeFieldValue(edit);
      if ("error" in normalized) {
        this.update({ editError: normalized.error });
        return;
      }
      edit = { ...edit, value: normalized.value };
    }

    const staged: StagedEdit[] = [...this.state.edits.filter((e) => targetOf(e.edit) !== targetOf(edit))];

    // Granting a tool to a child needs the parent to hand it down too, and the
    // two have to land together or the file will not compile. Refusals are
    // reported here rather than at save time, while the user is still choosing.
    if (edit.kind === "assignTool" && this.state.tree) {
      const tool = this.state.catalog.find((t) => t.identifier === edit.identifier);
      if (tool) {
        const verdict = checkAssign(this.state.tree, edit.path, edit.list, tool);
        if (verdict.kind === "refused") {
          this.update({ editError: verdict.reason });
          return;
        }
        if (verdict.kind === "also-grant") {
          staged.push(this.staged({
            kind: "assignTool",
            path: verdict.parentPath,
            list: "delegable",
            identifier: edit.identifier,
            fromFile: edit.fromFile,
          }));
        }
      }
    }

    staged.push(this.staged(edit));
    this.update({ edits: staged, editError: null });
  }

  private staged(edit: PendingEdit): StagedEdit {
    return { edit, display: display(edit) };
  }

  /**
   * Write every staged change as one edit, then let the rebuilt tree be the
   * evidence.
   *
   * The same shape as `applyLintFix`: built against the document as it is at
   * this moment, proved before anything is written, applied as one
   * `WorkspaceEdit` so the whole batch is a single undo, then saved because the
   * runner imports the file from disk.
   */
  private async saveDefinition(): Promise<void> {
    const tree = this.state.tree;
    const exportName = this.state.selectedExport;
    if (!tree || !exportName || this.state.edits.length === 0) return;

    const reader = documentReader();
    const set = new SourceSet(reader);
    const outcome = await planEdits(set, this.file, tree, this.state.edits.map((e) => e.edit));

    if (outcome.kind === "refused") {
      this.update({ editError: outcome.reason });
      return;
    }
    if (outcome.kind === "no-change") {
      this.update({ edits: [], editError: null });
      void vscode.window.setStatusBarMessage(`Nothing to write. ${outcome.reason}`, 4000);
      return;
    }

    const verdict = await verifyPlan(reader, this.file, outcome.plan);
    if (verdict.kind !== "ok") {
      this.update({ editError: `Nothing was written: ${verdict.reason}` });
      return;
    }

    const stale = await staleFile(set);
    if (stale) {
      // The staged edits survive: refusing is not a reason to throw away what
      // the user typed, which is the same courtesy a half-finished pin gets.
      this.update({
        editError: `${path.basename(stale)} changed while these were being prepared. Nothing was written; try again.`,
      });
      this.runner.send({ t: "inspect", file: this.file, exportName });
      return;
    }

    if (!(await this.applyAndSave(outcome.plan.edits))) return;

    this.update({ edits: [], editError: null });
    this.runner.send({ t: "inspect", file: this.file, exportName });
  }

  /** One `WorkspaceEdit` so the whole batch is one Ctrl+Z, then a save so the runner sees it. */
  private async applyAndSave(edits: readonly TextEdit[]): Promise<boolean> {
    const workspaceEdit = new vscode.WorkspaceEdit();
    const touched = new Set<string>();

    for (const edit of edits) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(edit.file));
      workspaceEdit.replace(doc.uri, new vscode.Range(doc.positionAt(edit.start), doc.positionAt(edit.end)), edit.newText);
      touched.add(edit.file);
    }

    if (!(await vscode.workspace.applyEdit(workspaceEdit))) {
      this.update({ editError: "The editor refused the change." });
      return false;
    }

    for (const file of touched) {
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
      await doc.save();
    }
    return true;
  }

  /** Leave the caret where the user still has to type. */
  private async putCursorAt(file: string, offset: number): Promise<void> {
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
    const position = doc.positionAt(offset);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
  }

  // -------------------------------------------------------------------------

  private update(patch: Partial<StudioState>): void {
    this.state = { ...this.state, ...patch };
    this.post({ t: "state", state: this.state });
  }

  private post(msg: ToWebview): void {
    if (!this.webviewReady && msg.t !== "state") return;
    void this.panel.webview.postMessage(msg);
  }

  private html(): string {
    const webview = this.panel.webview;
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.js"));
    const styles = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "out", "webview.css"));
    const nonce = randomNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${styles}">
<title>Agent FTW Studio</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    StudioPanel.open.delete(this.file);
    this.catalog.dispose();
    this.runner.stop();
    void this.store.end();
    this.diagnostics.dispose();
    this.output.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

/**
 * What the run receives.
 *
 * Fields arrive already shaped. Typed text is passed through as text unless it
 * plainly is JSON, because an instruction is what a run normally gets and
 * quoting it would be a tax on the common case.
 */
function parseInput(raw: string | Record<string, unknown>): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (!/^[[{"]/.test(trimmed)) return trimmed;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

/**
 * The first file the fix was built from that has since changed, if any.
 *
 * Without this, a rebuild of the tree racing a keystroke could write a value
 * into a range that has moved.
 */
/**
 * What a staged change is about, so restaging replaces rather than queues.
 *
 * Two edits to the same field are one intention; two edits to different fields
 * of the same phase are two.
 */
function targetOf(edit: PendingEdit): string {
  switch (edit.kind) {
    case "field":
      return `field:${edit.path}:${edit.construct}:${edit.field}`;
    case "addPhase":
      return `addPhase:${edit.path}:${edit.name}`;
    case "assignTool":
    case "unassignTool":
      return `${edit.list}:${edit.path}:${edit.identifier}`;
  }
}

/** The one line the pending list shows for a staged change. */
function display(edit: PendingEdit): string {
  if (edit.kind !== "field") return describeEdit(edit);
  const value = typeof edit.value === "object" ? "(schema)" : String(edit.value);
  return `${describeEdit(edit)} → ${value.length > 40 ? `${value.slice(0, 40)}…` : value}`;
}

async function staleFile(set: SourceSet): Promise<string | null> {
  for (const loaded of set.loaded()) {
    const open = vscode.workspace.textDocuments.find((d) => d.uri.fsPath.replace(/\\/g, "/") === loaded.file);
    if (open && open.version !== loaded.version) return loaded.file;
  }
  return null;
}

/** Null when the text parses, otherwise why it does not. */
function jsonError(json: string): string | null {
  try {
    JSON.parse(json);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}
