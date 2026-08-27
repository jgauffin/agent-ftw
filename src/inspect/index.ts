/**
 * Looking at an agent without running it against a model: projecting its shape
 * into plain data, building values from its schemas, and driving the whole
 * pipeline with those values instead of a model.
 *
 * This is what the `agent-ftw` CLI is built on, and what any other host that
 * wants to check a declaration should use rather than reimplementing.
 */

export { describeAgent, eachPhase } from "./describe.js";
export type {
  AdapterSource,
  AgentSummary,
  ChecklistSummary,
  PhaseSummary,
  ToolSummary,
} from "./describe.js";
export { synthesize } from "./synthesize.js";
export type { Synthesis } from "./synthesize.js";
export { callableTools, dryRunAdapter, stripAdapters } from "./dry-run.js";
export type { DryRunAdapterOptions, SynthesisNote, ToolPolicy } from "./dry-run.js";
