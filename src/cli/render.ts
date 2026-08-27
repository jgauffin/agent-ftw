/**
 * Text output for the CLI.
 *
 * Written to be read by a person scanning a terminal and by a coding agent
 * reading the same bytes back: one fact per line, the identifier that addresses
 * the problem always first, and no box drawing to parse around.
 */

import type { AgentSummary, PhaseSummary, ToolSummary } from "../inspect/describe.js";
import type { LintFinding } from "../lint/index.js";
import type { AgentCheck, CheckReport } from "./check.js";
import type { DryRunReport } from "./dry-run.js";

export function renderCheck(report: CheckReport): string {
  const out: string[] = [report.file, ""];
  if (report.problem) {
    out.push(report.problem);
    return out.join("\n");
  }

  for (const a of report.agents) {
    out.push(...renderAgentCheck(a));
    out.push("");
  }

  const findings = report.agents.flatMap((a) => a.findings);
  const errors = findings.filter((f) => f.severity === "error").length;
  out.push(summaryLine(findings.length, errors, report.agents.some((a) => a.compileError)));
  return out.join("\n");
}

function renderAgentCheck(a: AgentCheck): string[] {
  const out: string[] = [];
  const role = a.summary ? a.summary.role : "?";
  out.push(`${a.agent}  (export ${a.exportName}, ${role})`);

  if (a.compileError) {
    out.push(`  does not compile: ${a.compileError}`);
  } else if (a.summary) {
    out.push(...renderTree(a.summary, "  "));
  }

  if (a.findings.length > 0) {
    out.push("");
    for (const f of a.findings) out.push(...renderFinding(f));
  }
  return out;
}

function renderTree(summary: AgentSummary, indent: string): string[] {
  const out: string[] = [];
  for (const p of summary.phases) {
    out.push(`${indent}${renderPhaseLine(p)}`);
    for (const t of p.tools) {
      if (t.kind === "subAgent") {
        out.push(`${indent}  ${t.name} -> ${t.agent.name}${t.hasAccept ? " (accept)" : ""}`);
        out.push(...renderTree(t.agent, `${indent}    `));
      }
    }
  }
  return out;
}

function renderPhaseLine(p: PhaseSummary): string {
  const budget = `${p.turnBudget}${p.turnBudgetDeclared ? "" : "*"} turns`;
  const parts = [
    p.name.padEnd(16),
    budget.padEnd(11),
    p.terminator === "external" ? "external terminator" : p.phaseEndToolName,
  ];
  const extras = [
    ...p.tools.filter((t) => t.kind !== "phaseEnd").map(toolLabel),
    ...(p.checklist ? [p.checklist.ownAdapter ? "checklist" : "checklist(self-judged)"] : []),
    ...(p.review ? ["review"] : []),
    ...(p.adapter !== "session" ? [`adapter:${p.adapter}`] : []),
  ];
  return `${parts.join(" ")}${extras.length > 0 ? `   ${extras.join(", ")}` : ""}`;
}

function toolLabel(t: ToolSummary): string {
  switch (t.kind) {
    case "tool":
      return t.mutates ? `${t.name}!` : t.name;
    case "subAgent":
      return `${t.name}()`;
    case "customSubAgent":
      return `${t.name}()`;
    case "delegate":
      return `delegate[${t.children.join(" ")}]`;
    case "sideQuestProposal":
      return `${t.name}[${t.catalog.join(" ")}]`;
    case "phaseEnd":
      return t.name;
  }
}

function renderFinding(f: LintFinding): string[] {
  const out = [`${f.severity.padEnd(5)} ${f.code}  ${f.path}`];
  for (const line of f.message.split("\n")) out.push(`      ${line.trim()}`);
  for (const line of f.hint.split("\n")) out.push(`      ${line.trim()}`);
  for (const line of f.example.split("\n")) out.push(`      | ${line}`);
  return out;
}

function summaryLine(total: number, errors: number, compileFailed: boolean): string {
  if (compileFailed) return `${total} finding(s); one or more agents do not compile.`;
  if (total === 0) return "No findings.";
  return `${total} finding(s), ${errors} error(s).`;
}

export function renderDryRun(report: DryRunReport): string {
  const out: string[] = [
    `${report.file}  ${report.exportName} (${report.agent})   tools: ${report.tools}`,
    "",
  ];

  if (report.calledUnderPolicy.length > 0) {
    out.push(`callable: ${report.calledUnderPolicy.join(", ")}`);
    out.push("");
  }

  for (const p of report.phases) {
    const calls = report.toolCalls.filter((t) => t.agent === p.agent && t.phase === p.phase);
    const suffix = calls.length > 0 ? `   called ${calls.map((c) => c.tool).join(", ")}` : "";
    out.push(`  ok   ${p.agent}/${p.phase}${suffix}`);
  }
  if (report.phases.length === 0) out.push("  no phase completed");

  const failedCalls = report.toolCalls.filter((t) => t.error !== null);
  if (failedCalls.length > 0) {
    out.push("", "tool errors");
    for (const t of failedCalls) out.push(`  ${t.agent}/${t.phase} ${t.tool}: ${t.error}`);
  }

  if (report.rejections.length > 0) {
    out.push("", "deliverables the schema refused");
    for (const r of report.rejections) {
      out.push(`  ${r.agent}/${r.phase} attempt ${r.attempt}`);
      for (const e of r.errors) out.push(`    ${e}`);
    }
  }

  if (report.gaps.length > 0) {
    out.push("", "schemas that did not say enough to build a value from");
    for (const g of report.gaps) {
      out.push(`  ${g.kind} ${g.target}`);
      for (const gap of g.gaps) out.push(`    ${gap}`);
    }
  }

  out.push("");
  if (report.ok) {
    out.push(`Ran ${report.phases.length} phase(s). Final deliverable:`);
    out.push(indentJson(report.output));
  } else {
    out.push(`Failed: ${report.error}`);
  }
  return out.join("\n");
}

function indentJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
}
