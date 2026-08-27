/**
 * Staged panel changes, turned into source.
 *
 * Fixture text in, exact text out. The interesting cases are all shapes of
 * source rather than shapes of data, and the two invariants that matter are
 * asserted directly: a change touches only what it claimed, and the file still
 * parses afterwards.
 */

import { describe, expect, it } from "vitest";
import { agent, phase, subAgent, tool } from "../../src/declare/index.js";
import * as lib from "../../src/index.js";
import type { AgentLib } from "../src/runner/lib.js";
import { project } from "../src/runner/project.js";
import type { AgentNode, CatalogTool, PendingEdit } from "../src/protocol.js";
import { SourceSet, mapReader, type SourceReader } from "../src/source/parse.js";
import { applyEdits } from "../src/source/edit.js";
import { syntaxErrors } from "../src/source/verify.js";
import { checkAssign, planEdits, verifyPlan, type PlanOutcome } from "../src/edit-plan.js";

const AGENT_LIB = lib as unknown as AgentLib;
const ENTRY = "/p/agents.ts";
const TOOLS = "/p/tools.ts";

const TOOLS_SOURCE = `import { tool } from "agent-ftw";

export const readSource = tool({
  name: "readSource",
  description: "Read a file.",
  input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as const,
  handler: async () => "",
});

export const writeSource = tool({
  name: "writeSource",
  description: "Write a file.",
  input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as const,
  mutates: true,
  handler: async () => "",
});
`;

const AGENTS_SOURCE = `import { agent, phase, subAgent } from "agent-ftw";
import { readSource } from "./tools.js";

export const implementer = agent({
  name: "implementer",
  phases: [
    phase({
      name: "implement",
      prompt: "Make the change.",
      tools: [readSource],
      turnBudget: 8,
      deliverable: {
        type: "object",
        properties: { summary: { type: "string", description: "What changed." } },
        required: ["summary"],
      } as const,
    }),
  ],
});

export const lead = agent({
  name: "lead",
  role: "coordinator",
  tools: [readSource],
  delegable: [readSource],
  phases: [
    phase({
      name: "deliver",
      prompt: "Hand it out.",
      tools: [
        subAgent({
          name: "call_implementer",
          description: "Make a change.",
          input: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } as const,
          agent: implementer,
        }),
      ],
      deliverable: {
        type: "object",
        properties: { outcome: { type: "string", description: "What was delivered." } },
        required: ["outcome"],
      } as const,
    }),
  ],
});
`;

/** The same tree the source declares, so the plan and the text cannot disagree. */
function declaredTree(): AgentNode {
  const readSource = tool({
    name: "readSource",
    description: "Read a file.",
    input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as const,
    handler: async () => "",
  });

  const implementer = agent({
    name: "implementer",
    phases: [
      phase({
        name: "implement",
        prompt: "Make the change.",
        tools: [readSource],
        turnBudget: 8,
        deliverable: {
          type: "object",
          properties: { summary: { type: "string", description: "What changed." } },
          required: ["summary"],
        } as const,
      }),
    ],
  });

  const lead = agent({
    name: "lead",
    role: "coordinator",
    tools: [readSource],
    delegable: [readSource],
    phases: [
      phase({
        name: "deliver",
        prompt: "Hand it out.",
        tools: [
          subAgent({
            name: "call_implementer",
            description: "Make a change.",
            input: { type: "object", properties: { task: { type: "string" } }, required: ["task"] } as const,
            agent: implementer,
          }),
        ],
        deliverable: {
          type: "object",
          properties: { outcome: { type: "string", description: "What was delivered." } },
          required: ["outcome"],
        } as const,
      }),
    ],
  });

  return project(AGENT_LIB, lead, 3).tree;
}

const TREE = declaredTree();

function scenario(agents = AGENTS_SOURCE, tools = TOOLS_SOURCE) {
  const reader: SourceReader = mapReader({ [ENTRY]: agents, [TOOLS]: tools });
  return { reader, set: new SourceSet(reader) };
}

async function plan(staged: readonly PendingEdit[], agents = AGENTS_SOURCE): Promise<PlanOutcome> {
  const { set } = scenario(agents);
  return planEdits(set, ENTRY, TREE, staged);
}

/** The edited text of one file, with the plan proved before it is applied. */
async function write(staged: readonly PendingEdit[], file = ENTRY, agents = AGENTS_SOURCE): Promise<string> {
  const { reader, set } = scenario(agents);
  const outcome = await planEdits(set, ENTRY, TREE, staged);
  if (outcome.kind !== "plan") throw new Error(`expected a plan, got ${outcome.kind}: ${outcome.reason}`);

  const verdict = await verifyPlan(reader, ENTRY, outcome.plan);
  expect(verdict).toEqual({ kind: "ok" });

  const original = await reader(file);
  return applyEdits(original!.text, outcome.plan.edits.filter((e) => e.file === file));
}

function refusal(outcome: PlanOutcome): string {
  if (outcome.kind !== "refused") throw new Error(`expected a refusal, got ${outcome.kind}`);
  return outcome.reason;
}

describe("changing a value writes only that value", () => {
  it("replaces a prompt and leaves the rest of the file byte-identical", async () => {
    const edited = await write([
      { kind: "field", path: "lead/deliver", construct: "phase", field: "prompt", value: "Break it into contracts." },
    ]);

    expect(edited).toContain('prompt: "Break it into contracts.",');
    expect(edited).toBe(AGENTS_SOURCE.replace('"Hand it out."', '"Break it into contracts."'));
  });

  it("replaces a number where one is already declared", async () => {
    const edited = await write([
      { kind: "field", path: "lead>implementer/implement", construct: "phase", field: "turnBudget", value: 20 },
    ]);
    expect(edited).toBe(AGENTS_SOURCE.replace("turnBudget: 8", "turnBudget: 20"));
  });

  it("inserts a budget where the phase declares none, rather than refusing", async () => {
    // A phase running on the framework default is ordinary, so this is the
    // common path and not an edge case.
    const edited = await write([
      { kind: "field", path: "lead/deliver", construct: "phase", field: "turnBudget", value: 12 },
    ]);

    expect(edited).toContain("turnBudget: 12,");
    expect(syntaxErrors(edited)).toEqual([]);
  });

  it("keeps `as const` when it rewrites a deliverable", async () => {
    // Losing it would widen the schema to `string` and collapse the
    // deliverable's inferred type, silently.
    const edited = await write([
      {
        kind: "field",
        path: "lead/deliver",
        construct: "phase",
        field: "deliverable",
        value: {
          type: "object",
          properties: { outcome: { type: "string", description: "What was delivered, in one sentence." } },
          required: ["outcome"],
        },
      },
    ]);

    expect(edited).toContain("in one sentence.");
    // Once, not twice. `{...} as const as const` is valid TypeScript, so a
    // doubled wrapper parses cleanly and only a read-back would ever see it.
    expect(edited.match(/as const/g)).toHaveLength(AGENTS_SOURCE.match(/as const/g)!.length);
    expect(syntaxErrors(edited)).toEqual([]);
  });

  it("changes a coordinator back to a worker", async () => {
    const edited = await write([
      { kind: "field", path: "lead", construct: "agent", field: "role", value: "worker" },
    ]);
    expect(edited).toBe(AGENTS_SOURCE.replace('role: "coordinator"', 'role: "worker"'));
  });

  it("writes nothing when the value is already what was asked for", async () => {
    const outcome = await plan([
      { kind: "field", path: "lead/deliver", construct: "phase", field: "prompt", value: "Hand it out." },
    ]);
    expect(outcome.kind).toBe("no-change");
  });
});

describe("a value the panel cannot prove is refused, with the reason", () => {
  it("refuses a prompt built by a function call", async () => {
    const source = AGENTS_SOURCE.replace('prompt: "Hand it out.",', "prompt: buildPrompt(),");
    const outcome = await plan(
      [{ kind: "field", path: "lead/deliver", construct: "phase", field: "prompt", value: "x" }],
      source
    );
    expect(refusal(outcome)).toContain("a function call");
  });

  it("refuses a field the panel is not allowed to write at all", async () => {
    // `name` is the address every trace, pin and lint finding uses. Renaming it
    // is a refactor, not a tweak.
    const outcome = await plan([
      { kind: "field", path: "lead/deliver", construct: "phase", field: "name", value: "shipped" },
    ]);
    expect(refusal(outcome)).toContain("not a field the panel writes");
  });

  it("refuses a value of the wrong type rather than writing it", async () => {
    const outcome = await plan([
      { kind: "field", path: "lead>implementer/implement", construct: "phase", field: "turnBudget", value: "lots" },
    ]);
    expect(refusal(outcome)).toContain("not a number");
  });
});

describe("a batch lands whole or not at all", () => {
  it("writes several changes at once", async () => {
    const edited = await write([
      { kind: "field", path: "lead/deliver", construct: "phase", field: "prompt", value: "Contract it out." },
      { kind: "field", path: "lead>implementer/implement", construct: "phase", field: "turnBudget", value: 16 },
    ]);

    expect(edited).toContain('prompt: "Contract it out.",');
    expect(edited).toContain("turnBudget: 16");
  });

  it("refuses the whole batch when one change cannot be made, and names it", async () => {
    // Half a batch is the outcome worth ruling out: a granted tool without the
    // matching `delegable` entry leaves a file that will not compile.
    const outcome = await plan([
      { kind: "field", path: "lead/deliver", construct: "phase", field: "prompt", value: "Fine." },
      { kind: "field", path: "lead/deliver", construct: "phase", field: "name", value: "shipped" },
    ]);

    expect(refusal(outcome)).toContain("lead/deliver · name");
  });
});

describe("a phase can be added to an agent that already has one", () => {
  it("appends a phase that parses and does not collide with an existing name", async () => {
    const edited = await write([{ kind: "addPhase", path: "lead>implementer", name: "review" }]);

    expect(edited).toContain('name: "review",');
    expect(syntaxErrors(edited)).toEqual([]);
    // The original phase is untouched.
    expect(edited).toContain('name: "implement",');
  });

  it("gives the new phase a different name when the one asked for is taken", async () => {
    // `validate` throws on a duplicate phase name, so this is a compile error
    // the panel can simply not cause.
    const edited = await write([{ kind: "addPhase", path: "lead>implementer", name: "implement" }]);

    expect(edited).toContain('name: "implement_2",');
    expect(syntaxErrors(edited)).toEqual([]);
  });

  it("scaffolds a phase the framework's own linter is happy with", async () => {
    const edited = await write([{ kind: "addPhase", path: "lead>implementer", name: "review" }]);

    // `deliverable.no-required` is an error, so a scaffold without it would put
    // the studio's own output in the Problems panel.
    expect(edited).toContain('required: ["summary"],');
    expect(edited).toContain("description:");
  });
});

describe("assigning a tool writes the reference and the import together", () => {
  it("adds the identifier and extends the import it comes from", async () => {
    const edited = await write([
      {
        kind: "assignTool",
        path: "lead>implementer",
        list: "tools",
        identifier: "writeSource",
        fromFile: TOOLS,
      },
    ]);

    // A name is not a reference: only the identifier compiles.
    expect(edited).toContain("writeSource");
    expect(edited).toContain('import { readSource, writeSource } from "./tools.js";');
    expect(syntaxErrors(edited)).toEqual([]);
  });

  it("creates the list when the agent declares none", async () => {
    const edited = await write([
      { kind: "assignTool", path: "lead>implementer", list: "tools", identifier: "writeSource", fromFile: TOOLS },
    ]);
    expect(edited).toMatch(/tools: \[writeSource\]/);
  });

  it("does nothing when the agent already lists it", async () => {
    const outcome = await plan([
      { kind: "assignTool", path: "lead", list: "delegable", identifier: "readSource", fromFile: TOOLS },
    ]);
    expect(outcome.kind).toBe("no-change");
  });

  it("removes an assignment without removing the import", async () => {
    // An unused import is inert; removing one another declaration still uses is
    // a real bug, and Organize Imports already exists in the editor.
    const edited = await write([
      { kind: "unassignTool", path: "lead", list: "delegable", identifier: "readSource" },
    ]);

    expect(edited).toContain("delegable: []");
    expect(edited).toContain('import { readSource } from "./tools.js";');
    expect(syntaxErrors(edited)).toEqual([]);
  });
});

describe("an assignment that would not compile is caught before it is offered", () => {
  const writeSourceTool: CatalogTool = {
    kind: "tool",
    identifier: "writeSource",
    name: "writeSource",
    description: "Write a file.",
    mutates: true,
    file: TOOLS,
    line: 9,
    exported: true,
  };
  const readSourceTool: CatalogTool = { ...writeSourceTool, identifier: "readSource", name: "readSource", mutates: false };

  it("refuses to give a coordinator a tool that writes", () => {
    // What keeps a coordinator from quietly doing the work itself is that it
    // physically cannot, and that is checked at compile.
    const result = checkAssign(TREE, "lead", "tools", writeSourceTool);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" && result.reason).toContain("hand down");
  });

  it("lets a coordinator hand down what it may not hold", () => {
    expect(checkAssign(TREE, "lead", "delegable", writeSourceTool).kind).toBe("ok");
  });

  it("offers to grant the tool on the parent when a child is given one", () => {
    // A sub-agent may only declare tools its parent lists in `delegable`, so
    // the two edits belong to one act.
    const result = checkAssign(TREE, "lead>implementer", "tools", writeSourceTool);
    expect(result.kind).toBe("also-grant");
    expect(result.kind === "also-grant" && result.parentPath).toBe("lead");
  });

  it("refuses a tool whose name the agent already exposes", () => {
    const result = checkAssign(TREE, "lead>implementer", "tools", readSourceTool);
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" && result.reason).toContain("already exposes");
  });
});
