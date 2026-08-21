import type { AgentRun } from "./agent-run.js";
import type { CompiledPhase, ExposedTool } from "../compile/index.js";
import { validate } from "../compile/index.js";
import { runDelegate } from "./delegate.js";
import { validateAgainstSchema as validateSchema } from "../schema/index.js";
import type {
  ToolDecl,
  SubAgentDecl,
  CustomSubAgentDecl,
  CustomSubAgentCtx,
  SideQuestProposalDecl,
} from "../declare/index.js";
import { runSideQuest } from "./side-quest.js";

/**
 * Dispatches a tool call within a phase. Sub-agents are invoked via the parent's
 * agent-run tree so context isolation, trace nesting, and cancellation propagation
 * all happen automatically.
 */
export async function dispatchTool(args: {
  agentRun: AgentRun;
  phase: CompiledPhase;
  name: string;
  input: unknown;
  callId: string;
}): Promise<unknown> {
  const { agentRun, phase, name, input, callId } = args;
  agentRun.session.signal.throwIfAborted();

  const tool = phase.exposedTools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(
      `tool "${name}" is not exposed in phase "${phase.decl.name}" of agent "${agentRun.agentName}"`
    );
  }

  const v = validateSchema(tool.input, input);
  if (!v.valid) {
    throw new Error(`tool "${name}" input invalid: ${v.errors.join("; ")}`);
  }

  agentRun.bus.emit({
    type: "tool.call",
    agent: agentRun.agentName,
    phase: phase.decl.name,
    runId: agentRun.runId,
    tool: name,
    input,
    callId,
  });

  try {
    const out = await dispatchByKind(tool, input, agentRun, phase, callId);
    agentRun.bus.emit({
      type: "tool.result",
      agent: agentRun.agentName,
      phase: phase.decl.name,
      runId: agentRun.runId,
      tool: name,
      output: out,
      callId,
    });
    return out;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    agentRun.bus.emit({
      type: "tool.error",
      agent: agentRun.agentName,
      phase: phase.decl.name,
      runId: agentRun.runId,
      tool: name,
      error: msg,
      callId,
    });
    throw e;
  }
}

async function dispatchByKind(
  tool: ExposedTool,
  input: unknown,
  agentRun: AgentRun,
  phase: CompiledPhase,
  callId: string
): Promise<unknown> {
  switch (tool.kind) {
    case "tool":
      return await runTool(tool, input, agentRun, phase, callId);
    case "subAgent":
      return await runSubAgent(tool, input, agentRun);
    case "customSubAgent":
      return await runCustomSubAgent(tool, input, agentRun, phase, callId);
    case "sideQuestProposal":
      return await runSideQuest(tool, input, agentRun, phase);
    case "delegate":
      return await runDelegate(tool, input, agentRun, phase);
  }
}

async function runTool(
  tool: ToolDecl,
  input: unknown,
  agentRun: AgentRun,
  phase: CompiledPhase,
  callId: string
): Promise<unknown> {
  return await tool.handler(input as never, {
    signal: agentRun.signal,
    // The contract that created this run decides where it may write. A mutating
    // tool is the only place a bad path can actually be stopped, so it gets the
    // list rather than being trusted to stay inside it.
    writeSet: agentRun.writeSet,
    askUser: (askInput) =>
      agentRun.session.askUser(askInput, {
        agent: agentRun.agentName,
        phase: phase.decl.name,
        runId: agentRun.runId,
      }),
    emit: (payload) =>
      agentRun.bus.emit({
        type: "tool.event",
        agent: agentRun.agentName,
        phase: phase.decl.name,
        runId: agentRun.runId,
        tool: tool.name,
        callId,
        payload,
      }),
  });
}

async function runSubAgent(
  sub: SubAgentDecl,
  input: unknown,
  parent: AgentRun
): Promise<unknown> {
  // Sub-agent gets its own AgentRun: isolated context, child AbortController, trace nesting.
  const childRun = parent.spawnChild(sub);
  return await childRun.execute(input);
}

async function runCustomSubAgent(
  decl: CustomSubAgentDecl,
  input: unknown,
  parent: AgentRun,
  phase: CompiledPhase,
  callId: string
): Promise<unknown> {
  const ctx: CustomSubAgentCtx = {
    signal: parent.signal,
    emit: (payload) =>
      parent.bus.emit({
        type: "tool.event",
        agent: parent.agentName,
        phase: phase.decl.name,
        runId: parent.runId,
        tool: decl.name,
        callId,
        payload,
      }),
    askUser: (askInput) =>
      parent.session.askUser(askInput, {
        agent: parent.agentName,
        phase: phase.decl.name,
        runId: parent.runId,
      }),
    runChild: async (agentDecl, agentInput) => {
      const compiled = validate(agentDecl);
      const child = parent.spawnRuntimeChild(compiled);
      return await child.execute(agentInput);
    },
  };

  const out = await decl.handler(input, ctx);
  const v = validateSchema(decl.output, out);
  if (!v.valid) {
    throw new Error(
      `customSubAgent "${decl.name}" output invalid: ${v.errors.join("; ")}`
    );
  }
  return out;
}
