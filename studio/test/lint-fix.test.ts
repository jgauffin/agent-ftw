import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { agent, phase, subAgent } from "../../src/declare/index.js";
import * as lib from "../../src/index.js";
import { SourceSet, mapReader, type SourceReader } from "../src/source/parse.js";
import { applyEdits } from "../src/source/edit.js";
import { syntaxErrors } from "../src/source/verify.js";
import { schemaSite } from "../src/source/locate.js";
import { buildFix, findingToAddress, FIXABLE } from "../src/lint-fix.js";
import { project } from "../src/runner/project.js";
import type { AgentLib } from "../src/runner/lib.js";
import type { Finding } from "../src/protocol.js";

const AGENT_LIB = lib as unknown as AgentLib;
const ENTRY = "/p/agents.ts";

/**
 * The same agent twice: once as source text the fix is applied to, once as a
 * declaration the real `lint` produces findings from. A fix built against
 * invented findings would prove nothing about the rule it claims to fix.
 */
function scenario(source: string, decl: unknown) {
  const reader: SourceReader = mapReader({ [ENTRY]: source });
  const { tree, findings } = project(AGENT_LIB, decl, 3);
  return { reader, set: new SourceSet(reader), tree, findings };
}

function findingWith(findings: readonly Finding[], code: string): Finding {
  const found = findings.find((f) => f.code === code);
  if (!found) throw new Error(`lint produced no ${code}; it found ${findings.map((f) => f.code).join(", ") || "nothing"}`);
  return found;
}

/**
 * Run the real `lint` over the deliverable as the *edited file* now declares
 * it. Asserting against a hand-written copy of the expected result would prove
 * only that the expectation was written correctly.
 */
async function lintDeliverableIn(source: string): Promise<readonly Finding[]> {
  const set = new SourceSet(mapReader({ [ENTRY]: source }));
  const site = await schemaSite(set, ENTRY, {
    path: "planner/draft",
    construct: "phase",
    field: "deliverable",
    pointer: "#",
  });
  if (site.kind !== "found") throw new Error(site.reason);

  const deliverable = valueOf(site.site.object) as never;
  const prompt = /prompt: "([^"]*)"/.exec(source)?.[1] ?? "";
  return lib.lint(agent({ name: "planner", phases: [phase({ name: "draft", prompt, deliverable })] }) as never) as readonly Finding[];
}

/** An all-literal object literal read back as a plain value. */
function valueOf(node: ts.Expression): unknown {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(valueOf);
  if (ts.isAsExpression(node)) return valueOf(node.expression);
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const property of node.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const key = ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : null;
      if (key !== null) out[key] = valueOf(property.initializer);
    }
    return out;
  }
  throw new Error(`Cannot read a ${ts.SyntaxKind[node.kind]} back as a value.`);
}

// ---------------------------------------------------------------------------

const NO_REQUIRED_SOURCE = `import { agent, phase } from "agent-ftw";

export const planner = agent({
  name: "planner",
  phases: [
    phase({
      name: "draft",
      prompt: "Draft a title and a summary.",
      deliverable: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title." },
          summary: { type: "string", description: "The summary." },
        },
      } as const,
    }),
  ],
});
`;

const NO_REQUIRED_DECL = agent({
  name: "planner",
  phases: [
    phase({
      name: "draft",
      prompt: "Draft a title and a summary.",
      deliverable: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title." },
          summary: { type: "string", description: "The summary." },
        },
      } as const,
    }),
  ],
});

describe("an object nothing is required from gets its declared properties required", () => {
  it("lists the properties the source declares, in the order it declares them", async () => {
    const { set, tree, findings, reader } = scenario(NO_REQUIRED_SOURCE, NO_REQUIRED_DECL);
    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.no-required"), ENTRY);

    expect(outcome.kind).toBe("fix");
    if (outcome.kind !== "fix") return;

    const edited = applyEdits(NO_REQUIRED_SOURCE, outcome.plan.edits);
    expect(edited).toContain('required: ["title", "summary"],');
    // Everything else stays exactly as the author wrote it.
    expect(edited.replace('\n        required: ["title", "summary"],', "")).toBe(NO_REQUIRED_SOURCE);
    void reader;
  });

  it("clears the finding it was built for", async () => {
    const { set, tree, findings } = scenario(NO_REQUIRED_SOURCE, NO_REQUIRED_DECL);
    const before = findingWith(findings, "deliverable.no-required");
    const outcome = await buildFix(set, ENTRY, tree, before, ENTRY);
    if (outcome.kind !== "fix") throw new Error(outcome.reason);

    const edited = applyEdits(NO_REQUIRED_SOURCE, outcome.plan.edits);
    const after = await lintDeliverableIn(edited);

    expect(after.map((f) => f.code)).not.toContain("deliverable.no-required");
  });

  it("leaves the edited file parsable", async () => {
    const { set, tree, findings } = scenario(NO_REQUIRED_SOURCE, NO_REQUIRED_DECL);
    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.no-required"), ENTRY);
    if (outcome.kind !== "fix") throw new Error(outcome.reason);

    expect(syntaxErrors(applyEdits(NO_REQUIRED_SOURCE, outcome.plan.edits))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

const UNEXPLAINED_SOURCE = `import { agent, phase } from "agent-ftw";

export const planner = agent({
  name: "planner",
  phases: [
    phase({
      name: "draft",
      prompt: "Produce something.",
      deliverable: {
        type: "object",
        properties: {
          notes: { type: "string" },
        },
        required: ["notes"],
      } as const,
    }),
  ],
});
`;

const UNEXPLAINED_DECL = agent({
  name: "planner",
  phases: [
    phase({
      name: "draft",
      prompt: "Produce something.",
      deliverable: {
        type: "object",
        properties: { notes: { type: "string" } },
        required: ["notes"],
      } as const,
    }),
  ],
});

describe("a free-form string nothing explains gets somewhere to explain it", () => {
  it("inserts an empty description rather than inventing prose to be pasted unchanged", async () => {
    const { set, tree, findings } = scenario(UNEXPLAINED_SOURCE, UNEXPLAINED_DECL);
    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.unexplained-string"), ENTRY);

    expect(outcome.kind).toBe("fix");
    if (outcome.kind !== "fix") return;
    expect(applyEdits(UNEXPLAINED_SOURCE, outcome.plan.edits)).toContain(
      'notes: { type: "string", description: "" },'
    );
  });

  it("leaves the cursor between the quotes, because the user still has to type", async () => {
    const { set, tree, findings } = scenario(UNEXPLAINED_SOURCE, UNEXPLAINED_DECL);
    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.unexplained-string"), ENTRY);
    if (outcome.kind !== "fix") throw new Error(outcome.reason);

    const edited = applyEdits(UNEXPLAINED_SOURCE, outcome.plan.edits);
    expect(outcome.plan.selection).not.toBeNull();
    expect(edited.slice(outcome.plan.selection!.range.start - 1, outcome.plan.selection!.range.start + 1)).toBe('""');
  });

  it("leaves the warning up until real text is written, which an empty description does", async () => {
    const { set, tree, findings } = scenario(UNEXPLAINED_SOURCE, UNEXPLAINED_DECL);
    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.unexplained-string"), ENTRY);
    if (outcome.kind !== "fix") throw new Error(outcome.reason);

    const edited = applyEdits(UNEXPLAINED_SOURCE, outcome.plan.edits);

    expect((await lintDeliverableIn(edited)).map((f) => f.code)).toContain("deliverable.unexplained-string");
    expect((await lintDeliverableIn(edited.replace('description: ""', 'description: "What to note."'))).map((f) => f.code)).not.toContain(
      "deliverable.unexplained-string"
    );
  });
});

// ---------------------------------------------------------------------------

describe("a fix is refused rather than applied to the wrong node", () => {
  const SHARED_SOURCE = `import { agent, phase } from "agent-ftw";

const shared = {
  type: "object",
  properties: { notes: { type: "string" } },
} as const;

export const planner = agent({
  name: "planner",
  phases: [phase({ name: "draft", prompt: "p", deliverable: shared })],
});
`;

  const SHARED_DECL = agent({
    name: "planner",
    phases: [
      phase({
        name: "draft",
        prompt: "p",
        deliverable: { type: "object", properties: { notes: { type: "string" } } } as const,
      }),
    ],
  });

  it("refuses a schema held in a const, which other phases may share", async () => {
    const { set, tree, findings } = scenario(SHARED_SOURCE, SHARED_DECL);
    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.no-required"), ENTRY);

    expect(outcome.kind).toBe("refused");
  });

  it("refuses a schema that lives in another file, where the diagnostic is not", async () => {
    const source = `import { agent, phase } from "agent-ftw";
import { shared } from "./schemas.js";

export const planner = agent({
  name: "planner",
  phases: [phase({ name: "draft", prompt: "p", deliverable: shared })],
});
`;
    const set = new SourceSet(
      mapReader({
        [ENTRY]: source,
        "/p/schemas.ts": `export const shared = { type: "object", properties: { notes: { type: "string" } } } as const;\n`,
      })
    );
    const { tree, findings } = project(AGENT_LIB, SHARED_DECL, 3);

    const outcome = await buildFix(set, ENTRY, tree, findingWith(findings, "deliverable.no-required"), ENTRY);
    expect(outcome.kind).toBe("refused");
  });

  it("offers nothing for a rule whose fix would be a guess", async () => {
    expect(FIXABLE.has("deliverable.unbounded-object")).toBe(false);
    expect(FIXABLE.has("phase.budget-vs-tools")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("a finding is matched to the tree path the source layer addresses by", () => {
  const child = agent({
    name: "implementer",
    phases: [
      phase({
        name: "implement",
        prompt: "Implement it.",
        deliverable: { type: "object", properties: { diff: { type: "string" } } } as const,
      }),
    ],
  });

  const lead = agent({
    name: "lead",
    phases: [
      phase({
        name: "plan",
        prompt: "Plan it.",
        tools: [
          subAgent({
            name: "call_implementer",
            description: "Delegate one step.",
            input: { type: "object", properties: { step: { type: "string" } } } as const,
            agent: child,
          }),
        ],
        deliverable: { type: "object", properties: { steps: { type: "string" } }, required: ["steps"] } as const,
      }),
    ],
  });

  it("prefixes a nested agent's finding with the parent it hangs under", () => {
    const { tree, findings } = project(AGENT_LIB, lead, 3);
    const nested = findings.find((f) => f.path.startsWith("implementer/implement/"))!;

    // lint says `implementer/implement`; the tree says `lead>implementer/implement`.
    expect(findingToAddress(tree, nested)).toMatchObject({ path: "lead>implementer/implement" });
  });

  it("carries the pointer through, so two findings on one deliverable land apart", () => {
    const { tree, findings } = project(AGENT_LIB, lead, 3);
    const nested = findings.find((f) => f.path.includes("#/diff"))!;

    expect(findingToAddress(tree, nested)).toMatchObject({ field: "deliverable", pointer: "#/diff" });
  });
});
