/**
 * Wire types shared by the three processes the studio spans: the VS Code
 * extension host, the runner subprocess that executes the user's TypeScript,
 * and the webview.
 *
 * Everything here must survive `structuredClone` / `JSON.stringify`. An
 * `AgentDecl` does not: it carries tool handlers, adapter instances, and
 * terminator callbacks. That is why the runner projects it into the
 * {@link AgentNode} tree below before anything leaves that process.
 */

/** Severity of a lint finding. Mirrors the library's `LintSeverity`. */
export type LintSeverity = "error" | "warn";

/** Serializable copy of the library's `LintFinding`. */
export interface Finding {
  readonly code: string;
  readonly severity: LintSeverity;
  /** `agent/phase/construct`, with a JSON-pointer tail, e.g. `triager/plan/deliverable#/files`. */
  readonly path: string;
  readonly message: string;
  readonly hint: string;
  /** The fix written out, using the names from the declaration. Render as code. */
  readonly example: string;
}

/**
 * Whether one field can be written back into the source, and why not when it
 * cannot.
 *
 * The studio only rewrites a value it can prove is a literal in the
 * `phase({...})` call. Anything else is shown but locked, with `reason` saying
 * what got in the way.
 *
 * Computed when the tree is inspected rather than when a save is attempted, so
 * a control that will not work is disabled while the user is looking at it
 * instead of accepting typing it is going to throw away. A locked field still
 * shows its live value: hiding what it will not let you change would make the
 * panel useless in exactly the codebases worth editing.
 */
export interface FieldLock {
  readonly locked: boolean;
  readonly reason: string;
}

/** Keyed `path#construct#field`, which is also what a staged edit addresses. */
export type FieldLocks = Readonly<Record<string, FieldLock>>;

/**
 * The one key a control, a lock and a staged edit all address a field by.
 *
 * Here rather than beside the planner because all three processes have to agree
 * on it, and because the webview must not import anything that reaches the
 * TypeScript compiler.
 */
export function fieldKey(path: string, construct: EditConstruct, field: string): string {
  return `${path}#${construct}#${field}`;
}

/** A tool as the model sees it, projected to plain data. */
export type ToolNode =
  | {
      readonly kind: "tool";
      readonly name: string;
      readonly description: string;
      readonly input: unknown;
      readonly mutates: boolean;
    }
  | {
      readonly kind: "subAgent";
      readonly name: string;
      readonly description: string;
      readonly input: unknown;
      /** Whether the parent checks contracted results in host TypeScript. */
      readonly hasAccept: boolean;
      readonly maxRejects: number;
      readonly agent: AgentNode;
    }
  | {
      readonly kind: "customSubAgent";
      readonly name: string;
      readonly description: string;
      readonly input: unknown;
      readonly output: unknown;
    }
  | {
      /** Auto-injected on every phase of a coordinator. Not authored. */
      readonly kind: "delegate";
      readonly name: string;
      readonly children: readonly string[];
      readonly delegable: readonly string[];
    }
  | {
      /** Auto-injected when the agent declares `sideQuests.mode === "agent"`. Not authored. */
      readonly kind: "sideQuestProposal";
      readonly name: string;
      readonly catalog: readonly string[];
    };

/** A phase projected to plain data, with everything the panel renders. */
export interface PhaseNode {
  readonly name: string;
  /** Addresses this phase across the tree and in lint paths: `triager/plan`. */
  readonly path: string;
  readonly prompt: string;
  /** JSON Schema, already plain data. */
  readonly deliverable: unknown;
  /** Effective budget: the phase's own, or the framework default. */
  readonly turnBudget: number;
  /** False when `turnBudget` above is the inherited framework default. */
  readonly turnBudgetDeclared: boolean;
  readonly review: boolean;
  readonly terminator: "tool" | "external";
  /** Name of the tool the model calls to finish. Absent from the model's tools when the terminator is external. */
  readonly phaseEndToolName: string;
  readonly checklist: {
    readonly prompt: string;
    readonly schema: unknown;
    /** False means the checklist grades with the same adapter that produced the work. */
    readonly ownAdapter: boolean;
  } | null;
  readonly adapterDeclared: boolean;
  readonly onAssistantTextDeclared: boolean;
  /** Everything the model can call in this phase, injected tools included. */
  readonly tools: readonly ToolNode[];
  /** Findings whose path points at this phase. */
  readonly findings: readonly Finding[];
}

/** An agent projected to plain data. Sub-agents nest through `ToolNode`. */
export interface AgentNode {
  readonly name: string;
  /** Unique within the tree: `triager` at the root, `triager>fixer` for a sub-agent. */
  readonly path: string;
  readonly role: "worker" | "coordinator";
  readonly adapterDeclared: boolean;
  readonly phases: readonly PhaseNode[];
  /** Tools shared by every phase of this agent. */
  readonly tools: readonly ToolNode[];
  /** Tool names this agent may hand down to its children. */
  readonly delegable: readonly string[];
  /**
   * JSON Schema for what this agent should be given, when anything declares it.
   *
   * `Session.run` takes `unknown`: a top-level run has no declared input, and
   * the framework simply serializes whatever it is into the first phase's
   * prompt. The one place an agent's input *is* described is the `subAgent`
   * wrapper some parent uses to call it, so that is where this comes from.
   * Null means nobody has said what this agent expects.
   */
  readonly inputSchema: unknown | null;
  readonly sideQuests: {
    readonly mode: "off" | "agent";
    readonly catalog: readonly string[];
    readonly deliverable: unknown;
  } | null;
}

/** One agent found exported from the inspected module. */
export interface DiscoveredAgent {
  /** The export it was found under, e.g. `triager` or `default`. */
  readonly exportName: string;
  readonly agentName: string;
  readonly phaseCount: number;
  /**
   * Set when the agent cannot be compiled. The studio still lists it so the
   * panel can show why rather than silently omitting it.
   */
  readonly compileError?: string;
  /**
   * The export name of another exported agent that contracts this one.
   *
   * A file usually exports its sub-agents too, so "several agents" rarely means
   * several trees. Knowing which of them nothing else contains is what lets the
   * panel open on the whole tree instead of waiting to be told which of three
   * views of the same tree was meant.
   */
  readonly containedBy?: string;
}

/**
 * A completed phase held fixed for the next run.
 *
 * `json` is the text as edited, which is not always valid: the panel keeps what
 * was typed so a half-finished edit is not thrown away on the next render, and
 * reports `error` instead of silently reverting.
 */
export interface Pin {
  readonly phase: string;
  readonly json: string;
  readonly error: string | null;
}

/** The declaration a staged edit is against. Mirrors the source layer's `Construct`. */
export type EditConstruct = "agent" | "phase" | "checklist" | "subAgent";

/**
 * One change made in the panel and not yet written.
 *
 * Staged rather than applied per keystroke for three reasons the existing code
 * already demonstrates: the panel re-renders wholesale on every state change,
 * so a write mid-edit redraws under the cursor; `selectAgent` already guards
 * against inspect-answers-with-a-message loops; and granting a mutating tool to
 * a child needs two edits that must land together or leave the file refusing to
 * compile.
 */
export type PendingEdit =
  | {
      readonly kind: "field";
      readonly path: string;
      readonly construct: EditConstruct;
      readonly field: string;
      /** Already parsed: a schema arrives as an object, a budget as a number. */
      readonly value: unknown;
    }
  | { readonly kind: "addPhase"; readonly path: string; readonly name: string }
  | {
      readonly kind: "assignTool";
      /** The agent whose list gains it. */
      readonly path: string;
      readonly list: ToolList;
      readonly identifier: string;
      /** Where the identifier is declared, so the import can be written. */
      readonly fromFile: string;
    }
  | { readonly kind: "unassignTool"; readonly path: string; readonly list: ToolList; readonly identifier: string };

/** `tools` is what an agent may call; `delegable` is what it may hand down. */
export type ToolList = "tools" | "delegable";

/** A staged edit with the one line the panel shows for it. */
export interface StagedEdit {
  readonly edit: PendingEdit;
  /** e.g. `lead/deliver · turnBudget → 20`. */
  readonly display: string;
}

/**
 * A tool declaration found somewhere in the workspace, offerable for assignment.
 *
 * The projected tree only holds what is reachable from a phase, so a tool
 * declared and wired to nothing is invisible in the panel. This is where those
 * come from, and it is also how a declared name resolves to the identifier that
 * actually compiles.
 */
export interface CatalogTool {
  readonly kind: "tool" | "subAgent" | "customSubAgent";
  /** What gets written into the array. */
  readonly identifier: string;
  /** The declared `name:` literal, which is what the model sees. */
  readonly name: string;
  readonly description: string;
  readonly mutates: boolean;
  readonly file: string;
  readonly line: number;
  readonly exported: boolean;
}

// ---------------------------------------------------------------------------
// Extension → runner
// ---------------------------------------------------------------------------

export type ToRunner =
  /** Import the module and list the agents it exports. Does not run anything. */
  | { readonly t: "discover"; readonly file: string }
  /** Compile + lint one agent and return its projected tree. Does not run anything. */
  | { readonly t: "inspect"; readonly file: string; readonly exportName: string }
  | {
      readonly t: "run";
      readonly file: string;
      readonly exportName: string;
      readonly input: unknown;
      readonly sessionDirectory: string;
      /** Set to resume, or to start from a session seeded with pins. */
      readonly sessionId?: string;
      /**
       * Deliverables to treat as already produced, keyed by phase name. The
       * run starts at the first phase that is not pinned.
       */
      readonly pins?: Readonly<Record<string, unknown>>;
    }
  | { readonly t: "cancel" }
  | { readonly t: "askResult"; readonly id: number; readonly selected: readonly string[]; readonly other?: string }
  | { readonly t: "reviewRevise"; readonly id: number; readonly message: string }
  | { readonly t: "reviewApprove"; readonly id: number }
  | { readonly t: "budgetResult"; readonly id: number; readonly extendBy: number | null };

// ---------------------------------------------------------------------------
// Runner → extension
// ---------------------------------------------------------------------------

export type FromRunner =
  | { readonly t: "ready" }
  | { readonly t: "discovered"; readonly agents: readonly DiscoveredAgent[] }
  | { readonly t: "tree"; readonly tree: AgentNode; readonly findings: readonly Finding[] }
  /** A `TraceEvent`. Left as `unknown` so the studio never has to track the union. */
  | { readonly t: "trace"; readonly event: TraceEnvelope }
  | { readonly t: "ask"; readonly id: number; readonly prompt: string; readonly options: readonly string[]; readonly mode: "single" | "multi"; readonly agent: string; readonly phase: string }
  | { readonly t: "review"; readonly id: number; readonly deliverable: unknown; readonly agent: string; readonly phase: string }
  /** Answer to a `reviewRevise`: the phase re-ran and produced this. */
  | { readonly t: "reviewRevised"; readonly id: number; readonly deliverable: unknown }
  | { readonly t: "budget"; readonly id: number; readonly request: BudgetRequest }
  | { readonly t: "done"; readonly output: unknown; readonly sessionId: string }
  | { readonly t: "failed"; readonly error: string; readonly stack?: string };

/**
 * A trace event with the fields the studio actually reads pulled out, and the
 * whole original kept alongside. The library's union has many variants and
 * grows; the studio groups and renders by these three plus `type`, and treats
 * the rest as a payload to display.
 */
export interface TraceEnvelope {
  readonly type: string;
  readonly ts: number;
  /** Position in the run tree, e.g. `root.2.1`. Absent on session-level events. */
  readonly runId?: string;
  readonly agent?: string;
  readonly phase?: string;
  /** Every other field of the original event. */
  readonly detail: Record<string, unknown>;
}

/** Serializable copy of the library's `BudgetExtensionRequest`. */
export interface BudgetRequest {
  readonly agent: string;
  readonly phase: string;
  readonly runId: string;
  readonly depth: number;
  readonly limit: "phase" | "run";
  readonly originalBudget: number;
  readonly turnsUsed: number;
  readonly extensionsGranted: number;
  readonly suggestedExtension: number;
  readonly lastAssistantText?: string;
  readonly recentToolCalls: ReadonlyArray<{ readonly name: string; readonly inputSummary: string }>;
}

// ---------------------------------------------------------------------------
// Extension ↔ webview
// ---------------------------------------------------------------------------

export type ToWebview =
  | { readonly t: "state"; readonly state: StudioState }
  | { readonly t: "trace"; readonly event: TraceEnvelope };

export type FromWebview =
  /**
   * Sent once the panel script has loaded. A `postMessage` issued before that
   * is dropped, so the extension holds the first state until this arrives.
   */
  | { readonly t: "ready" }
  | { readonly t: "selectAgent"; readonly exportName: string }
  /** Select any node in the tree: an agent path or a phase path. */
  | { readonly t: "select"; readonly path: string | null }
  /**
   * A string when the input was typed as text, an object when it was filled in
   * as fields. `Session.run` takes either, so the panel does not force a shape.
   */
  | { readonly t: "run"; readonly input: string | Record<string, unknown> }
  | { readonly t: "cancel" }
  | { readonly t: "askResult"; readonly id: number; readonly selected: readonly string[]; readonly other?: string }
  | { readonly t: "reviewRevise"; readonly id: number; readonly message: string }
  | { readonly t: "reviewApprove"; readonly id: number }
  | { readonly t: "budgetResult"; readonly id: number; readonly extendBy: number | null }
  /** Jump the editor to where this phase or agent is declared. */
  | { readonly t: "reveal"; readonly path: string }
  /** Show one thing in the inspector, filling the pane. */
  | { readonly t: "setTab"; readonly tab: string }
  /** Hold a change for the next save. Replaces any earlier change to the same target. */
  | { readonly t: "stageEdit"; readonly edit: PendingEdit }
  | { readonly t: "unstageEdit"; readonly index: number }
  | { readonly t: "discardEdits" }
  /** Write every staged change as one undoable edit, then re-inspect. */
  | { readonly t: "saveDefinition" }
  | { readonly t: "refreshCatalog" }
  /** Put text on the system clipboard. The webview's own clipboard access is unreliable. */
  | { readonly t: "copy"; readonly text: string; readonly label: string }
  /** Hold this phase and every phase before it fixed on the next run. */
  | { readonly t: "pinThrough"; readonly phase: string }
  | { readonly t: "unpinAll" }
  | { readonly t: "editPin"; readonly phase: string; readonly json: string };

/** Everything the panel renders, replaced wholesale on each update. */
export interface StudioState {
  readonly file: string | null;
  readonly agents: readonly DiscoveredAgent[];
  readonly selectedExport: string | null;
  readonly tree: AgentNode | null;
  readonly findings: readonly Finding[];
  /** Path of the selected tree node: `newsroom` for an agent, `newsroom/write` for a phase. */
  readonly selectedPath: string | null;
  readonly status: RunStatus;
  readonly error: string | null;
  /** The pending prompt the run is blocked on, if any. */
  readonly pending: PendingPrompt | null;
  readonly output: unknown;
  /** Phases held fixed for the next run, in the order the agent declares them. */
  readonly pins: readonly Pin[];
  /** Which fields can be written, resolved against the source when the tree was built. */
  readonly locks: FieldLocks;
  /** Changes made in the panel and not yet written, in the order they were made. */
  readonly edits: readonly StagedEdit[];
  /** Why the last save was refused. Cleared when anything is staged again. */
  readonly editError: string | null;
  /** Tools found across the workspace, offerable for assignment. */
  readonly catalog: readonly CatalogTool[];
  /**
   * Which inspector tab is showing.
   *
   * Held here rather than in the webview for the same reason everything else
   * is: a panel VS Code discards and restores comes back the way it was left.
   * A tab that does not apply to the current selection falls back to the first
   * that does, so moving from a phase to an agent never lands on nothing.
   */
  readonly tab: string;
}

/**
 * One thing the inspector can show, filling the pane rather than sharing it.
 *
 * Prompts, schemas and tool lists each want the whole width to be workable, and
 * a panel that is often half a screen cannot give that to four of them at once.
 */
export type TabId =
  | "settings"
  | "prompt"
  | "deliverable"
  | "checklist"
  | "tools"
  | "subAgents"
  | "issues"
  | "run";

export type RunStatus = "idle" | "inspecting" | "running" | "done" | "failed" | "cancelled";

export type PendingPrompt =
  | { readonly kind: "ask"; readonly id: number; readonly prompt: string; readonly options: readonly string[]; readonly mode: "single" | "multi"; readonly agent: string; readonly phase: string }
  | { readonly kind: "review"; readonly id: number; readonly deliverable: unknown; readonly agent: string; readonly phase: string }
  | { readonly kind: "budget"; readonly id: number; readonly request: BudgetRequest };
