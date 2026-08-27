/**
 * Reading a lint finding's path.
 *
 * Shared by the panel and the Problems-panel diagnostics, because both have to
 * answer the same question: which field is this about?
 */

/**
 * The field a finding is about, pulled out of its path.
 *
 * A path reads `agent/phase/construct#/pointer`, e.g.
 * `planner/brainstorm/deliverable#/ideas/title`. Without the pointer half, two
 * findings about two different properties of one deliverable are
 * indistinguishable, and advice to "add a description" has nowhere to land.
 */
/** The shape both the panel and the clipboard text need. */
interface FindingLike {
  readonly code: string;
  readonly severity: string;
  readonly path: string;
  readonly message: string;
  readonly hint: string;
  readonly example: string;
}

/**
 * One finding written out for the clipboard.
 *
 * VS Code has no API for handing work to whatever agent is installed, so the
 * fallback is the oldest one there is: put it somewhere the person can paste
 * it. Which means it has to carry its own context, since the chat window on the
 * other end knows nothing about the panel it came from.
 */
export function findingText(file: string, phase: string, f: FindingLike): string {
  return [
    `agent-ftw lint (${f.severity}): ${f.code}`,
    `File: ${file}`,
    `Phase: ${phase}`,
    `Field: ${fieldOf(f.path)}`,
    "",
    f.message,
    "",
    `Fix: ${f.hint}`,
    "",
    f.example,
  ].join("\n");
}

/** Every finding for one phase, as one paste. */
export function allFindingsText(file: string, phase: string, findings: readonly FindingLike[]): string {
  const header = `agent-ftw lint found ${findings.length} ${findings.length === 1 ? "issue" : "issues"} in phase "${phase}".`;
  return [header, "", ...findings.map((f) => findingText(file, phase, f))].join("\n\n---\n\n");
}

export function fieldOf(path: string): string {
  const pointer = path.split("#")[1];
  if (pointer === undefined) return path.split("/").pop() ?? path;
  const trimmed = pointer.replace(/^\//, "");
  // An empty pointer means the finding is about the deliverable as a whole.
  return trimmed.length > 0 ? trimmed : "(whole deliverable)";
}
