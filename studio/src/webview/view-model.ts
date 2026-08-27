/**
 * Turns the panel's state into flat rows the template can loop over.
 *
 * The template engine loops over arrays and has no recursion, and an agent
 * tree nests: phases hold sub-agents that hold phases. Flattening to rows with
 * a `depth`, indented in CSS rather than by nesting elements, is both what the
 * engine can render and what reads better anyway, since the whole point is to
 * scan a tree top to bottom.
 *
 * Class names are assembled here rather than in the template. An attribute
 * containing an expression is replaced by that expression's value, so
 * `class="finding {{severity}}"` renders as `warn` and loses `finding`
 * entirely. Every dynamic attribute has to be a single expression, which means
 * the full string is computed on this side.
 */

import type {
  AgentNode,
  BudgetRequest,
  DiscoveredAgent,
  EditConstruct,
  Finding,
  PendingPrompt,
  PhaseNode,
  StudioState,
  TabId,
  ToolNode,
} from "../protocol.js";
import { fieldKey } from "../protocol.js";
import { offerableIn, unreachable } from "../catalog.js";
import type { AgentRun, PhaseRun, RunModel } from "../run-model.js";
import { summarize } from "../run-model.js";
import { allFindingsText, fieldOf, findingText } from "../findings.js";
import { layout, subAgentDeclarations } from "./graph-layout.js";
import { inputForm } from "./input-form.js";

export interface TimelineRow {
  readonly key: string;
  readonly depth: number;
  readonly isRun: boolean;
  readonly label: string;
  readonly detail: string;
  /** Diagnostics worth reading, pre-joined. Empty when the phase went cleanly. */
  readonly problems: string;
  readonly hasProblems: boolean;
  readonly status: string;
  readonly rowClass: string;
  readonly markerClass: string;
  /** Set on a finished phase, which is the only kind there is anything to pin. */
  readonly canPin: boolean;
  readonly phase: string;
  readonly pinLabel: string;
}

/** A finding with its class string ready, since the template cannot build one. */
export interface FindingRow extends Finding {
  readonly rowClass: string;
  /** Which field the finding is about, e.g. `ideas/title`. */
  readonly field: string;
  /** Self-contained text to paste into an agent or an issue. */
  readonly copyText: string;
}

function classes(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * How one export reads in the picker.
 *
 * Saying which agent contracts a sub-agent is what turns a list of three names
 * into one tree and two views into it, which is what a file that exports its
 * children actually is.
 */
function agentLabel(a: DiscoveredAgent): string {
  if (a.compileError) return `${a.agentName} (will not compile)`;
  return a.containedBy ? `${a.agentName} (a sub-agent of ${a.containedBy})` : a.agentName;
}

function phaseName(phasePath: string): string {
  return phasePath.slice(phasePath.lastIndexOf("/") + 1);
}

function phaseBadges(phase: PhaseNode): string {
  const badges: string[] = [];
  if (phase.checklist) badges.push(phase.checklist.ownAdapter ? "checklist" : "checklist (self-graded)");
  if (phase.review) badges.push("review");
  if (phase.adapterDeclared) badges.push("own model");
  if (phase.terminator === "external") badges.push("host-terminated");
  for (const t of phase.tools) {
    if (t.kind === "delegate") badges.push("delegate");
    if (t.kind === "sideQuestProposal") badges.push("may propose side quests");
    if (t.kind === "tool" && t.mutates) badges.push(`writes (${t.name})`);
  }
  return badges.join(" · ");
}

function budgetNote(phase: PhaseNode): string {
  return phase.turnBudgetDeclared ? `${phase.turnBudget} turns` : `${phase.turnBudget} turns (default)`;
}

export function timelineRows(
  model: RunModel,
  pinned: ReadonlySet<string> = new Set(),
  now: number = Date.now()
): TimelineRow[] {
  const rows: TimelineRow[] = [];
  for (const run of model.all) {
    rows.push(runRow(run));
    for (const [i, phase] of run.phases.entries()) {
      // Only the root run's phases can be pinned: persistence covers the
      // top-level run, and sub-agents are rerun on resume.
      rows.push(phaseRow(run, phase, i, run.runId === "root", pinned, now));
    }
  }
  return rows;
}

function runRow(run: AgentRun): TimelineRow {
  const detail = run.objective ? `objective: ${run.objective}` : run.runId;
  return {
    key: `run:${run.runId}`,
    depth: run.depth,
    isRun: true,
    label: run.agent,
    detail,
    problems: run.error ?? "",
    hasProblems: run.error !== null,
    status: run.status,
    rowClass: classes("run", `depth-${run.depth}`, run.status),
    markerClass: classes("marker", run.status),
    canPin: false,
    phase: "",
    pinLabel: "",
  };
}

function phaseRow(
  run: AgentRun,
  phase: PhaseRun,
  index: number,
  pinnable: boolean,
  pinned: ReadonlySet<string>,
  now: number
): TimelineRow {
  const problems = phaseProblems(phase);
  const status = phase.cached ? "cached" : phase.status;
  const isPinned = pinned.has(phase.phase);
  return {
    key: `phase:${run.runId}:${index}:${phase.phase}`,
    depth: run.depth + 1,
    isRun: false,
    label: phase.phase,
    detail: phaseDetail(phase, now),
    problems: problems.join(" · "),
    hasProblems: problems.length > 0,
    status,
    rowClass: classes("phase", `depth-${run.depth + 1}`, status, isPinned && "pinned"),
    markerClass: classes("marker", status),
    canPin: pinnable && phase.status === "done",
    phase: phase.phase,
    // The label says what clicking does, which is hold everything up to here.
    pinLabel: isPinned ? "Pinned" : "Pin through here",
  };
}

/**
 * What a phase row says.
 *
 * The running case matters more than the finished one. A model call emits
 * nothing until it returns, which on a local model is tens of seconds, and a
 * row reading "0 turns" for that long is indistinguishable from a panel that
 * has stopped working. So a live phase says what it is waiting for and shows a
 * clock that moves.
 */
function phaseDetail(phase: PhaseRun, now: number): string {
  if (phase.cached) return "replayed from a stored deliverable";

  const parts: string[] = [];
  if (phase.turns > 0) parts.push(count(phase.turns, "turn"));
  if (phase.toolCalls > 0) parts.push(count(phase.toolCalls, "tool call"));

  if (phase.status === "running") {
    parts.push(phase.pendingTool ? `running ${phase.pendingTool}` : "waiting for the model");
    parts.push(`${elapsed(phase.startedAt, now)}s`);
  } else if (phase.endedAt !== null) {
    parts.push(`${elapsed(phase.startedAt, phase.endedAt)}s`);
  }

  return parts.join(" · ");
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function elapsed(from: number, to: number): string {
  return (Math.max(0, to - from) / 1000).toFixed(1);
}

/**
 * The diagnostics that explain a disappointing run. A phase that finished is
 * not the same as a phase that went well: the retries and nudges that got it
 * there are what a designer needs to see.
 */
function phaseProblems(phase: PhaseRun): string[] {
  const problems: string[] = [];
  if (phase.rejections.length > 0) {
    problems.push(
      `${phase.deliverableAttempts} deliverable attempts (${phase.rejections[0]!.slice(0, 2).join("; ")})`
    );
  }
  if (phase.nudges > 0) problems.push(`${phase.nudges} nudged turns`);
  if (phase.toolErrors > 0) problems.push(`${phase.toolErrors} tool errors`);
  if (phase.checklistFailures > 0) problems.push(`${phase.checklistFailures} checklist failures`);
  if (phase.budgetExhausted) problems.push("budget exhausted");
  if (phase.budgetExtendedBy > 0) problems.push(`budget extended by ${phase.budgetExtendedBy}`);
  return problems;
}

/** The selected phase, looked up across the whole nested tree. */
export function findPhase(tree: AgentNode | null, phasePath: string | null): PhaseNode | null {
  if (!tree || !phasePath) return null;
  for (const phase of tree.phases) {
    if (phase.path === phasePath) return phase;
    const nested = findInTools(phase.tools, phasePath);
    if (nested) return nested;
  }
  return findInTools(tree.tools, phasePath);
}

function findInTools(tools: readonly ToolNode[], phasePath: string): PhaseNode | null {
  for (const t of tools) {
    if (t.kind !== "subAgent") continue;
    const found = findPhase(t.agent, phasePath);
    if (found) return found;
  }
  return null;
}

/** The selected agent, looked up the same way. Agent paths carry no `/`. */
export function findAgent(tree: AgentNode | null, path: string | null): AgentNode | null {
  if (!tree || !path) return null;
  if (tree.path === path) return tree;
  for (const t of [...tree.tools, ...tree.phases.flatMap((p) => p.tools)]) {
    if (t.kind !== "subAgent") continue;
    const found = findAgent(t.agent, path);
    if (found) return found;
  }
  return null;
}

function describeAgentTool(t: ToolNode): string {
  switch (t.kind) {
    case "subAgent":
      return `sub-agent ${t.agent.name}${t.hasAccept ? ", results checked on return" : ""}`;
    case "customSubAgent":
      return "custom handler";
    case "tool":
      return `${t.mutates ? "writes · " : ""}${t.description}`;
    default:
      return t.name;
  }
}

export interface ToolRow {
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  /** Marks a tool the framework injected rather than one the author wrote. */
  readonly injected: boolean;
  readonly noteClass: string;
}

export function toolRows(phase: PhaseNode): ToolRow[] {
  return phase.tools.map((t) => {
    const injected =
      t.kind === "delegate" || t.kind === "sideQuestProposal" || t.name === phase.phaseEndToolName;
    return {
      name: t.name,
      kind: t.kind,
      description: describeTool(t, phase),
      injected,
      noteClass: classes("tool-note", injected && "injected"),
    };
  });
}

function describeTool(t: ToolNode, phase: PhaseNode): string {
  switch (t.kind) {
    case "delegate":
      return `injected. Contracts ${t.children.join(", ") || "no children"}; may grant ${t.delegable.join(", ") || "nothing"}`;
    case "sideQuestProposal":
      return `injected. May request ${t.catalog.join(", ")}`;
    case "subAgent":
      return `sub-agent ${t.agent.name}${t.hasAccept ? ", results checked on return" : ""}`;
    case "customSubAgent":
      return "custom handler";
    default:
      return t.name === phase.phaseEndToolName
        ? "injected. Ends the phase with the deliverable"
        : `${t.mutates ? "writes · " : ""}${t.description}`;
  }
}

export function findingRows(phase: PhaseNode | null, file: string | null): FindingRow[] {
  return (phase?.findings ?? []).map((f) => ({
    ...f,
    rowClass: classes("finding", f.severity),
    field: fieldOf(f.path),
    copyText: findingText(file ?? "(unsaved)", phase?.name ?? "", f),
  }));
}


// ---------------------------------------------------------------------------
// The tree view
// ---------------------------------------------------------------------------

/** An agent box, with everything the SVG needs as one value per attribute. */
export interface GraphAgent {
  readonly path: string;
  readonly label: string;
  readonly role: string;
  readonly transform: string;
  readonly width: number;
  readonly height: number;
  /** Anchor for right-aligned text, so the template needs no arithmetic. */
  readonly rightX: number;
  readonly boxClass: string;
  readonly badge: string;
  readonly hasBadge: boolean;
}

/** A phase row inside an agent box. */
export interface GraphPhase {
  readonly path: string;
  readonly label: string;
  readonly note: string;
  readonly transform: string;
  readonly width: number;
  readonly height: number;
  readonly rightX: number;
  readonly boxClass: string;
}

export interface GraphEdgeRow {
  readonly d: string;
  readonly edgeClass: string;
}

export interface GraphContext {
  readonly agents: GraphAgent[];
  readonly phases: GraphPhase[];
  readonly edges: GraphEdgeRow[];
  readonly width: number;
  readonly height: number;
  readonly viewBox: string;
}

/**
 * The drawn tree.
 *
 * Geometry comes from {@link layout}, which depends only on the declaration.
 * Everything added here (selection, run state, findings) changes on every trace
 * event, which is why the two are computed apart rather than together.
 */
export function graphContext(state: StudioState, model: RunModel): GraphContext {
  const root = state.tree;
  if (!root) return { agents: [], phases: [], edges: [], width: 0, height: 0, viewBox: "0 0 0 0" };

  const geometry = layout(root);
  const agents = indexAgents(root);
  const phases = indexPhases(root);
  const runs = phaseRuns(model);
  const selected = state.selectedPath;

  const agentBoxes: GraphAgent[] = [];
  const phaseBoxes: GraphPhase[] = [];

  for (const box of geometry.boxes) {
    if (box.kind === "agent") {
      const node = agents.get(box.path);
      const problems = node?.phases.reduce((n, p) => n + p.findings.length, 0) ?? 0;
      agentBoxes.push({
        path: box.path,
        label: box.label,
        role: box.role === "coordinator" ? "coordinator" : "",
        transform: `translate(${box.x},${box.y})`,
        width: box.width,
        height: box.height,
        rightX: box.width - 10,
        boxClass: classes(
          "node agent",
          box.role === "coordinator" && "coordinator",
          box.mutates && "mutates",
          problems > 0 && "problems",
          selected === box.path && "selected"
        ),
        badge: problems > 0 ? String(problems) : "",
        hasBadge: problems > 0,
      });
      continue;
    }

    const node = phases.get(box.path);
    const run = node ? runs.get(`${node.agent.name}/${node.phase.name}`) : undefined;
    const status = run ? (run.cached ? "cached" : run.status) : "";
    phaseBoxes.push({
      path: box.path,
      label: box.label,
      note: node ? graphPhaseNote(node.phase, run) : "",
      transform: `translate(${box.x},${box.y})`,
      width: box.width,
      height: box.height,
      rightX: box.width - 8,
      boxClass: classes(
        "node phase",
        status,
        (node?.phase.findings.length ?? 0) > 0 && "problems",
        selected === box.path && "selected"
      ),
    });
  }

  return {
    agents: agentBoxes,
    phases: phaseBoxes,
    // An edge is dimmed unless it touches the selection, which is what makes one
    // branch readable in a tree that has fanned out.
    edges: geometry.edges.map((e) => ({
      d: e.d,
      edgeClass: classes("edge", (selected === e.from || selected === e.to) && "selected"),
    })),
    width: geometry.width,
    height: geometry.height,
    viewBox: geometry.viewBox,
  };
}

/**
 * What a phase box says on its right.
 *
 * Before a run that is the budget it will get. During and after, it is what the
 * phase actually spent against it, because a budget only means something next
 * to the number that tested it.
 */
function graphPhaseNote(phase: PhaseNode, run: PhaseRun | undefined): string {
  if (!run) return `${phase.turnBudget} turns`;
  if (run.cached) return "replayed";
  return `${run.turns}/${phase.turnBudget} turns`;
}

interface PhaseSite {
  readonly phase: PhaseNode;
  readonly agent: AgentNode;
}

/** Every agent in the tree by path, so a drawn box can find what it stands for. */
export function indexAgents(root: AgentNode): Map<string, AgentNode> {
  const out = new Map<string, AgentNode>();
  const visit = (node: AgentNode): void => {
    if (out.has(node.path)) return;
    out.set(node.path, node);
    for (const d of subAgentDeclarations(node)) visit(d.child);
  };
  visit(root);
  return out;
}

/** Every phase by path, with the agent it belongs to, which the run keys need. */
export function indexPhases(root: AgentNode): Map<string, PhaseSite> {
  const out = new Map<string, PhaseSite>();
  for (const agent of indexAgents(root).values()) {
    for (const phase of agent.phases) out.set(phase.path, { phase, agent });
  }
  return out;
}

/** Latest run of each `agent/phase`, which is what the overlays read. */
function phaseRuns(model: RunModel): Map<string, PhaseRun> {
  const out = new Map<string, PhaseRun>();
  for (const run of model.all) {
    for (const p of run.phases) out.set(`${run.agent}/${p.phase}`, p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The definition view
// ---------------------------------------------------------------------------

/**
 * One editable field, with everything the control needs already decided.
 *
 * A locked field still carries its value. Hiding what the panel will not let
 * you change would make it useless in exactly the codebases worth editing, and
 * `reason` is what turns a disabled box into an explanation.
 */
export interface Control {
  /** `path#construct#field`: what the staged edit addresses. */
  readonly key: string;
  readonly path: string;
  readonly construct: EditConstruct;
  readonly field: string;
  readonly inputId: string;
  readonly value: string;
  readonly locked: boolean;
  readonly editable: boolean;
  readonly reason: string;
  readonly rowClass: string;
}

function control(
  state: StudioState,
  path: string,
  construct: EditConstruct,
  field: string,
  value: string
): Control {
  const key = fieldKey(path, construct, field);
  // Absent means the source has not been read back yet, which is a reason to
  // wait rather than to offer a control that will be refused.
  const lock = state.locks[key] ?? { locked: true, reason: "Reading the source…" };
  const pending = state.edits.some(
    (e) => e.edit.kind === "field" && fieldKey(e.edit.path, e.edit.construct, e.edit.field) === key
  );

  return {
    key,
    path,
    construct,
    field,
    inputId: `f-${key.replace(/[^a-zA-Z0-9]+/g, "-")}`,
    value,
    locked: lock.locked,
    editable: !lock.locked,
    reason: lock.reason,
    rowClass: classes("control", lock.locked && "locked", pending && "pending"),
  };
}

export interface SubAgentCard {
  readonly path: string;
  readonly name: string;
  readonly description: string;
  readonly role: string;
  readonly phases: string;
  readonly tools: string;
  readonly delegable: string;
  readonly hasDelegable: boolean;
  readonly acceptance: string;
  readonly declaredBy: string;
  readonly selected: boolean;
  readonly cardClass: string;
  readonly rejectsControl: Control;
}

export interface DefinitionContext {
  readonly path: string;
  readonly name: string;
  readonly role: string;
  readonly isCoordinator: boolean;
  readonly isWorker: boolean;
  readonly roleClass: string;
  readonly adapter: string;
  readonly delegable: string;
  readonly hasDelegable: boolean;
  readonly sideQuests: string;
  readonly hasSideQuests: boolean;
  /** The phases in declared order, which is the order deliverables move through. */
  readonly phaseOrder: string;
  readonly available: ToolRow[];
  readonly delegableTools: ToolRow[];
  readonly subAgents: SubAgentCard[];
  readonly hasSubAgents: boolean;
  readonly roleControl: Control;
  /** Tools declared in the workspace that this agent could be given. */
  readonly assignable: AssignableTool[];
  readonly hasAssignable: boolean;
  /** Declared in the workspace and reachable from nothing in this tree. */
  readonly unwired: string;
  readonly hasUnwired: boolean;
}

export interface AssignableTool {
  readonly identifier: string;
  readonly label: string;
  readonly file: string;
  readonly mutates: boolean;
  readonly optionClass: string;
}

/**
 * The agent the definition view is about.
 *
 * Selecting a phase does not change which agent is being defined, it changes
 * which of its cards is highlighted. So a phase selection resolves to its owner
 * rather than emptying the view.
 */
export function definitionAgent(state: StudioState): AgentNode | null {
  if (!state.tree) return null;
  const direct = findAgent(state.tree, state.selectedPath);
  if (direct) return direct;
  const phase = state.selectedPath ? indexPhases(state.tree).get(state.selectedPath) : undefined;
  return phase?.agent ?? state.tree;
}

export function definitionContext(node: AgentNode, state: StudioState): DefinitionContext {
  const children = subAgentDeclarations(node);
  const selected = state.selectedPath;

  const held = new Set([...node.tools.map((t) => t.name), ...node.delegable]);
  const offerable = state.file ? offerableIn(state.catalog, state.file) : [];
  const reachable = reachableToolNames(state.tree);

  return {
    roleControl: control(state, node.path, "agent", "role", node.role),

    assignable: offerable
      .filter((t) => !held.has(t.name))
      .map((t) => ({
        identifier: t.identifier,
        label: t.mutates ? `${t.name} (writes)` : t.name,
        file: t.file,
        mutates: t.mutates,
        optionClass: classes("assignable", t.mutates && "mutates"),
      })),
    hasAssignable: offerable.some((t) => !held.has(t.name)),

    // Worth its own line: the tree only holds what a phase can reach, so a
    // tool wired to nothing is otherwise invisible in this panel.
    unwired: unreachable(offerable, reachable).map((t) => t.name).join(", "),
    hasUnwired: unreachable(offerable, reachable).length > 0,

    path: node.path,
    name: node.name,
    role: node.role === "coordinator" ? "Coordinator" : "Worker",
    isCoordinator: node.role === "coordinator",
    isWorker: node.role !== "coordinator",
    roleClass: classes("role", node.role),
    adapter: node.adapterDeclared ? "declares its own model" : "inherits the session's model",
    delegable: node.delegable.join(", "),
    hasDelegable: node.delegable.length > 0,
    sideQuests: node.sideQuests ? `${node.sideQuests.mode}: ${node.sideQuests.catalog.join(", ")}` : "",
    hasSideQuests: node.sideQuests?.mode === "agent",

    // The order is the point: each phase is given the deliverables of the ones
    // before it, and nothing else of theirs.
    phaseOrder: node.phases.map((p) => p.name).join(" → "),

    available: node.tools.map(agentToolRow),
    // Named by the agent, so the list is what it may hand down whether or not a
    // child has asked for it yet.
    delegableTools: node.delegable.map((name) => ({
      name,
      kind: "tool",
      description: "",
      injected: false,
      noteClass: "tool-note",
    })),

    subAgents: children.map((child) => ({
      path: child.child.path,
      name: child.tool.name,
      description: child.tool.description,
      role: child.child.role === "coordinator" ? "Coordinator" : "Worker",
      phases: child.child.phases.map((p) => p.name).join(" → "),
      tools: child.child.tools.map((t) => t.name).join(", "),
      delegable: child.child.delegable.join(", "),
      hasDelegable: child.child.delegable.length > 0,
      // A child whose results nobody checks is the drift the acceptance
      // mechanism exists to catch, so its absence is worth naming.
      acceptance: child.tool.hasAccept
        ? `checked on return, up to ${child.tool.maxRejects} reject${child.tool.maxRejects === 1 ? "" : "s"}`
        : "results are not checked",
      declaredBy: child.from === node.path ? "every phase" : phaseName(child.from),
      selected: selected === child.child.path,
      cardClass: classes(
        "sub-agent-card",
        selected === child.child.path && "selected",
        !child.tool.hasAccept && "unchecked"
      ),
      rejectsControl: control(state, child.child.path, "subAgent", "maxRejects", String(child.tool.maxRejects)),
    })),
    hasSubAgents: children.length > 0,
  };
}

/** Every tool name anything in the tree can call, which is what "wired up" means. */
function reachableToolNames(tree: AgentNode | null): ReadonlySet<string> {
  const out = new Set<string>();
  if (!tree) return out;
  for (const agent of indexAgents(tree).values()) {
    for (const t of [...agent.tools, ...agent.phases.flatMap((p) => p.tools)]) out.add(t.name);
    for (const name of agent.delegable) out.add(name);
  }
  return out;
}

function agentToolRow(t: ToolNode): ToolRow {
  return {
    name: t.name,
    kind: t.kind,
    description: describeAgentTool(t),
    injected: t.kind === "delegate" || t.kind === "sideQuestProposal",
    noteClass: classes("tool-note", t.kind === "tool" && t.mutates && "mutates"),
  };
}

// ---------------------------------------------------------------------------
// The inspector
// ---------------------------------------------------------------------------

export interface InspectorTab {
  readonly id: TabId;
  readonly label: string;
  /** A count worth seeing before you open the tab. Empty when there is none. */
  readonly badge: string;
  readonly hasBadge: boolean;
  readonly tabClass: string;
  /** Pushed to the far end of the bar: it is about the run, not the selection. */
  readonly trailing: boolean;
}

/**
 * Which tabs the selection has, in the order they are worked in.
 *
 * Scoped to what is selected rather than fixed, because half the tabs make no
 * sense for the other kind of node: an agent has no prompt, a phase has no
 * sub-agents of its own. A tab that does not apply is absent rather than
 * disabled, so the bar says what this node actually has.
 */
export function inspectorTabs(state: StudioState): InspectorTab[] {
  const tabs: { id: TabId; label: string; badge?: number; trailing?: boolean }[] = [];
  const tree = state.tree;
  if (!tree) return [];

  const site = state.selectedPath ? indexPhases(tree).get(state.selectedPath) : undefined;
  const agent = site ? site.agent : (findAgent(tree, state.selectedPath) ?? tree);

  if (site) {
    tabs.push({ id: "prompt", label: "Prompt" });
    tabs.push({ id: "deliverable", label: "Deliverable" });
    if (site.phase.checklist) tabs.push({ id: "checklist", label: "Checklist" });
    tabs.push({ id: "tools", label: "Tools", badge: site.phase.tools.length });
    if (site.phase.findings.length > 0) tabs.push({ id: "issues", label: "Issues", badge: site.phase.findings.length });
  } else {
    tabs.push({ id: "settings", label: "Settings" });
    tabs.push({ id: "tools", label: "Tools", badge: agent.tools.length });
    const children = subAgentDeclarations(agent).length;
    if (children > 0) tabs.push({ id: "subAgents", label: "Sub-agents", badge: children });
    const problems = agent.phases.reduce((n, p) => n + p.findings.length, 0);
    if (problems > 0) tabs.push({ id: "issues", label: "Issues", badge: problems });
  }

  tabs.push({ id: "run", label: "Run", trailing: true });

  const active = activeTab(state, tabs.map((t) => t.id));
  return tabs.map((t) => ({
    id: t.id,
    label: t.label,
    badge: t.badge ? String(t.badge) : "",
    hasBadge: (t.badge ?? 0) > 0,
    tabClass: classes("tab", t.id === active && "current", t.trailing && "trailing"),
    trailing: t.trailing === true,
  }));
}

/**
 * The tab actually showing.
 *
 * The remembered one wins when the selection still has it, so moving between
 * two phases keeps you on the prompt. Otherwise the first tab of the new
 * selection, because landing on an empty pane after a click reads as a bug.
 */
export function activeTab(state: StudioState, available: readonly TabId[]): TabId {
  const remembered = available.find((id) => id === state.tab);
  return remembered ?? available[0] ?? "settings";
}

// ---------------------------------------------------------------------------
// The schemas panel and the status bar
// ---------------------------------------------------------------------------

export interface SchemaEntry {
  readonly title: string;
  readonly json: string;
  /**
   * The deliverable is the one schema the panel writes back. Everything else
   * here belongs to a tool or a checklist, whose shape is a code change.
   */
  readonly control: Control | null;
  readonly editable: boolean;
}

/**
 * The JSON Schemas behind whatever is selected.
 *
 * A schema is the contract a phase is held to, and reading it next to the
 * prompt is the whole point: most of what `lint` complains about is a prompt
 * and a schema that do not describe the same thing.
 */
export function schemaEntries(state: StudioState): SchemaEntry[] {
  const out: SchemaEntry[] = [];
  const tree = state.tree;
  if (!tree) return out;

  const readOnly = (title: string, value: unknown): SchemaEntry => ({
    title,
    json: pretty(value),
    control: null,
    editable: false,
  });

  const site = state.selectedPath ? indexPhases(tree).get(state.selectedPath) : undefined;
  if (site) {
    const deliverable = control(
      state,
      site.phase.path,
      "phase",
      "deliverable",
      pretty(site.phase.deliverable)
    );
    out.push({
      title: "Deliverable",
      json: deliverable.value,
      control: deliverable,
      editable: deliverable.editable,
    });
    if (site.phase.checklist) out.push(readOnly("Checklist", site.phase.checklist.schema));
    for (const t of site.phase.tools) {
      if (t.kind === "delegate" || t.kind === "sideQuestProposal") continue;
      if (t.name === site.phase.phaseEndToolName) continue;
      out.push(readOnly(`Tool input: ${t.name}`, t.input));
    }
    return out;
  }

  const agent = findAgent(tree, state.selectedPath) ?? tree;
  if (agent.inputSchema !== null) out.push(readOnly("Agent input", agent.inputSchema));
  if (agent.sideQuests) out.push(readOnly("Side quest deliverable", agent.sideQuests.deliverable));
  for (const t of agent.tools) {
    if (t.kind === "delegate" || t.kind === "sideQuestProposal") continue;
    out.push(readOnly(`Tool input: ${t.name}`, t.input));
  }
  return out;
}

export interface StatusBar {
  readonly message: string;
  readonly statusClass: string;
  readonly valid: boolean;
}

/**
 * Whether this agent would run at all, said once, where the buttons are.
 *
 * A compile error is fatal and comes from `validate`; lint findings are advice
 * and never stop a run. Reporting them as one number would tell the reader the
 * wrong thing about both.
 */
export function statusBar(state: StudioState): StatusBar {
  const compileError = state.agents.find((a) => a.exportName === state.selectedExport)?.compileError;
  if (compileError) {
    return { message: `Will not compile: ${compileError}`, statusClass: "validity failed", valid: false };
  }
  if (!state.tree) return { message: "No agent selected", statusClass: "validity", valid: false };

  const errors = state.findings.filter((f) => f.severity === "error").length;
  const warnings = state.findings.length - errors;
  if (errors > 0) {
    return {
      message: `${count(errors, "lint error")}${warnings > 0 ? `, ${count(warnings, "warning")}` : ""}`,
      statusClass: "validity failed",
      valid: false,
    };
  }
  if (warnings > 0) {
    return { message: `Valid · ${count(warnings, "lint warning")}`, statusClass: "validity warn", valid: true };
  }
  return { message: "Agent is valid", statusClass: "validity good", valid: true };
}

export function pretty(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Everything the template reads, in one object.
 *
 * The engine only re-renders when handed a context that is a different object
 * from last time, so this is built fresh rather than mutated. It lives here
 * rather than next to the render call so tests can assert what the panel shows
 * without a DOM or a VS Code API to acquire.
 */
export function buildContext(
  state: StudioState,
  model: RunModel,
  pending: PendingPrompt | null,
  inputMode: InputMode = "text",
  now: number = Date.now()
): Record<string, unknown> {
  const phase = findPhase(state.tree, state.selectedPath);
  const rollup = summarize(model);
  const defined = definitionAgent(state);
  const status = statusBar(state);
  const schemas = schemaEntries(state);
  const tabs = inspectorTabs(state);
  const tab = activeTab(state, tabs.map((t) => t.id));
  const definition = defined ? definitionContext(defined, state) : null;

  return {
    // The drawing is the navigator now, so it is always there and always the
    // thing that moves the selection.
    graph: graphContext(state, model),
    hasGraph: state.tree !== null,

    // One thing at a time in the inspector. Four editors sharing a pane that is
    // often half a screen is what made every one of them cramped.
    tabs,
    hasTabs: tabs.length > 0,
    inspectorTitle: phase ? `${phase.name}` : (definition?.name ?? ""),
    inspectorSubtitle: phase ? budgetNote(phase) : (definition?.role ?? ""),
    showSettings: tab === "settings",
    showPrompt: tab === "prompt",
    showDeliverable: tab === "deliverable",
    showChecklist: tab === "checklist",
    showTools: tab === "tools",
    showSubAgents: tab === "subAgents",
    showIssues: tab === "issues",
    showRun: tab === "run",

    // The phase whose prompt and checklist the inspector edits, when one is
    // selected. Null on an agent, where those tabs are not offered.
    phase: phase
      ? {
          ...phase,
          promptControl: control(state, phase.path, "phase", "prompt", phase.prompt),
          budgetControl: control(state, phase.path, "phase", "turnBudget", String(phase.turnBudget)),
          checklistControl: phase.checklist
            ? control(state, phase.path, "checklist", "prompt", phase.checklist.prompt)
            : null,
          badges: phaseBadges(phase),
          hasBadges: phaseBadges(phase).length > 0,
          tools: toolRows(phase),
        }
      : null,
    hasPhase: phase !== null,

    definition,
    hasDefinition: definition !== null,

    schemas,
    hasSchemas: schemas.length > 0,

    validity: status.message,
    validityClass: status.statusClass,
    valid: status.valid,

    // Staged, not written. The list is of intentions rather than keystrokes:
    // restaging the same field replaces its earlier entry.
    pendingEdits: state.edits.map((e, index) => ({ ...e, index })),
    hasPendingEdits: state.edits.length > 0,
    pendingCount: state.edits.length,
    editError: state.editError ?? "",
    hasEditError: state.editError !== null,

    agents: state.agents.map((a) => ({
      ...a,
      selected: a.exportName === state.selectedExport,
      label: agentLabel(a),
    })),
    hasAgents: state.agents.length > 0,
    manyAgents: state.agents.length > 1,
    // The file has agents but none is being shown, which is a different thing
    // from a file that has none and needs saying differently.
    needsAgentChoice: state.agents.length > 0 && state.tree === null,
    status: state.status,
    statusClass: `status ${state.status}`,
    running: state.status === "running",
    idle: state.status !== "running",
    error: state.error ?? "",
    hasError: state.error !== null,

    timeline: timelineRows(model, new Set(state.pins.map((p) => p.phase)), now),
    hasTimeline: model.all.length > 0,

    pins: state.pins.map((p) => ({
      ...p,
      hasError: p.error !== null,
      error: p.error ?? "",
      // Composed here: an attribute holding an expression loses any literal beside it.
      inputId: `pin-${p.phase}`,
    })),
    hasPins: state.pins.length > 0,
    // Naming the phase the run will actually begin at is clearer than listing
    // what is held, which is what the reader has to work out otherwise.
    resumeAt: firstUnpinned(state),

    findings: findingRows(phase, state.file),
    hasFindings: (phase?.findings.length ?? 0) > 0,
    // One paste for the whole phase, which is what actually gets handed to an
    // agent: fixing findings one at a time is not how anyone works.
    allFindingsText: phase ? allFindingsText(state.file ?? "(unsaved)", phase.name, phase.findings) : "",

    ...inputContext(state, inputMode),

    rollup,
    hasRollup: rollup.phases > 0,
    // Worth saying out loud: a run with no retries, nudges or refusals means
    // the tree behaved the way it reads, which is the goal.
    clean:
      rollup.phases > 0 &&
      rollup.rejectedDeliverables === 0 &&
      rollup.nudges === 0 &&
      rollup.toolErrors === 0 &&
      rollup.checklistFailures === 0 &&
      rollup.budgetExhaustions === 0,

    output: pretty(state.output),
    hasOutput: state.output !== undefined,

    ...promptContext(pending),
  };
}

/**
 * How the run input is entered.
 *
 * Free text is the default because it is what a run normally receives: an
 * instruction, in the same words a person would use. Every example in the repo
 * calls `session.run` with a sentence. The fields view exists for the minority
 * of agents some parent calls with a declared object, and it is never the only
 * option, since `Session.run` accepts anything either way.
 */
export type InputMode = "text" | "fields";

/** The phase a pinned run starts at, or empty when nothing is pinned. */
function firstUnpinned(state: StudioState): string {
  if (state.pins.length === 0) return "";
  const pinned = new Set(state.pins.map((p) => p.phase));
  const next = (state.tree?.phases ?? []).find((p) => !pinned.has(p.name));
  return next?.name ?? "(nothing left to run)";
}

function inputContext(state: StudioState, mode: InputMode): Record<string, unknown> {
  const form = inputForm(state.tree?.inputSchema ?? null);
  const fieldsMode = mode === "fields" && form.usable;
  return {
    inputFields: form.fields,
    // The toggle only appears when there is something to toggle to.
    canUseFields: form.usable,
    fieldsMode,
    textMode: !fieldsMode,
    inputReason: form.reason,
    inputPlaceholder: form.usable
      ? "Instruction, or JSON matching the declared input"
      : "What the agent should do, in a sentence",
  };
}

/** Flattened so the template can branch without an equality operator. */
function promptContext(pending: PendingPrompt | null): Record<string, unknown> {
  return {
    hasPrompt: pending !== null,
    isAsk: pending?.kind === "ask",
    isReview: pending?.kind === "review",
    isBudget: pending?.kind === "budget",
    ask: pending?.kind === "ask" ? pending : null,
    review: pending?.kind === "review" ? { ...pending, json: pretty(pending.deliverable) } : null,
    budget: pending?.kind === "budget" ? budgetContext(pending.request) : null,
  };
}

function budgetContext(request: BudgetRequest): Record<string, unknown> {
  return {
    ...request,
    // What it was doing is the whole basis for deciding whether more turns help.
    lastText: request.lastAssistantText ?? "(no text turn)",
    recent: request.recentToolCalls.map((c) => `${c.name}(${c.inputSummary})`).join(", ") || "(no tool calls)",
    runWide: request.limit === "run",
  };
}
