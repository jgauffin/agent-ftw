import { describe, expect, it } from "vitest";
import { agent, checklist, phase, subAgent, tool } from "../../src/declare/index.js";
import * as lib from "../../src/index.js";
import { collectInputSchemas, project } from "../src/runner/project.js";
import type { AgentLib } from "../src/runner/lib.js";

const AGENT_LIB = lib as unknown as AgentLib;

const deliverable = {
  type: "object",
  properties: { answer: { type: "string", description: "The answer." } },
  required: ["answer"],
} as const;

function readFile(mutates = false) {
  return tool({
    name: mutates ? "write_file" : "read_file",
    description: mutates ? "Write a file." : "Read a file.",
    input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as const,
    ...(mutates ? { mutates: true } : {}),
    handler: async () => "ok",
  });
}

describe("the projection shows tools nobody wrote", () => {
  it("includes the auto-injected phase-end tool a designer never declares", () => {
    const { tree } = project(
      AGENT_LIB,
      agent({ name: "planner", phases: [phase({ name: "draft", prompt: "p", deliverable })] }),
      3
    );

    const draft = tree.phases[0]!;
    expect(draft.phaseEndToolName).toBe("finish_draft");
    expect(draft.tools.map((t) => t.name)).toContain("finish_draft");
  });

  it("includes the delegate tool injected on every phase of a coordinator", () => {
    const worker = agent({
      name: "implementer",
      phases: [phase({ name: "do", prompt: "do it", deliverable, tools: [readFile(true)] })],
    });

    const { tree } = project(
      AGENT_LIB,
      agent({
        name: "lead",
        role: "coordinator",
        delegable: [readFile(true)],
        tools: [
          subAgent({
            name: "implement",
            description: "Implement a change.",
            input: { type: "object", properties: { task: { type: "string" } } } as const,
            agent: worker,
          }),
        ],
        phases: [phase({ name: "plan", prompt: "plan it", deliverable })],
      }),
      3
    );

    expect(tree.role).toBe("coordinator");
    expect(tree.delegable).toEqual(["write_file"]);

    const delegate = tree.phases[0]!.tools.find((t) => t.kind === "delegate");
    expect(delegate).toBeDefined();
    expect(delegate!.kind === "delegate" && delegate!.children).toEqual(["implement"]);
    expect(delegate!.kind === "delegate" && delegate!.delegable).toEqual(["write_file"]);
  });
});

describe("a sub-agent's own phases are reachable from the parent's tree", () => {
  it("nests the child agent under the tool that calls it", () => {
    const child = agent({
      name: "researcher",
      phases: [phase({ name: "look", prompt: "look", deliverable })],
    });

    const { tree } = project(
      AGENT_LIB,
      agent({
        name: "newsroom",
        tools: [
          subAgent({
            name: "research",
            description: "Research.",
            input: { type: "object", properties: {} } as const,
            agent: child,
            maxRejects: 3,
          }),
        ],
        phases: [phase({ name: "write", prompt: "write", deliverable })],
      }),
      3
    );

    const sub = tree.tools.find((t) => t.kind === "subAgent");
    expect(sub).toBeDefined();
    if (sub?.kind !== "subAgent") throw new Error("expected a subAgent");
    expect(sub.maxRejects).toBe(3);
    expect(sub.hasAccept).toBe(false);
    expect(sub.agent.name).toBe("researcher");
    expect(sub.agent.path).toBe("newsroom>researcher");
    expect(sub.agent.phases.map((p) => p.path)).toEqual(["newsroom>researcher/look"]);
  });
});

describe("a phase reports the budget it actually runs under", () => {
  it("distinguishes a declared budget from the inherited framework default", () => {
    const { tree } = project(
      AGENT_LIB,
      agent({
        name: "planner",
        phases: [
          phase({ name: "cheap", prompt: "p", deliverable, turnBudget: 4 }),
          phase({ name: "default", prompt: "p", deliverable }),
        ],
      }),
      3
    );

    expect(tree.phases[0]!.turnBudget).toBe(4);
    expect(tree.phases[0]!.turnBudgetDeclared).toBe(true);
    expect(tree.phases[1]!.turnBudget).toBe(lib.DEFAULT_TURN_BUDGET);
    expect(tree.phases[1]!.turnBudgetDeclared).toBe(false);
  });
});

describe("a checklist that grades with the phase's own model is visible as such", () => {
  it("reports whether the checklist brought its own adapter", () => {
    const { tree } = project(
      AGENT_LIB,
      agent({
        name: "copywriter",
        phases: [
          phase({
            name: "write",
            prompt: "write",
            deliverable,
            checklist: checklist({
              prompt: "Grade it.",
              schema: { type: "object", properties: { ok: { type: "boolean" } } } as const,
            }),
          }),
        ],
      }),
      3
    );

    expect(tree.phases[0]!.checklist).not.toBeNull();
    expect(tree.phases[0]!.checklist!.ownAdapter).toBe(false);
  });
});

describe("lint findings attach to the phase they name", () => {
  it("hangs a finding about a deliverable off that phase", () => {
    const { tree, findings } = project(
      AGENT_LIB,
      agent({
        name: "planner",
        phases: [
          // An object with no required properties is satisfied by `{}`, which
          // means the phase can end having produced nothing.
          phase({ name: "draft", prompt: "p", deliverable: { type: "object", properties: {} } as const }),
        ],
      }),
      3
    );

    expect(findings.length).toBeGreaterThan(0);
    expect(tree.phases[0]!.findings.length).toBeGreaterThan(0);
    expect(tree.phases[0]!.findings.every((f) => f.path.startsWith("planner/draft/"))).toBe(true);
  });
});

describe("an agent's input schema comes from whoever calls it", () => {
  const worker = agent({
    name: "implementer",
    phases: [phase({ name: "do", prompt: "do it", deliverable })],
  });

  const lead = agent({
    name: "lead",
    tools: [
      subAgent({
        name: "implement",
        description: "Implement a change.",
        input: {
          type: "object",
          properties: { task: { type: "string", description: "What to build." } },
          required: ["task"],
        } as const,
        agent: worker,
      }),
    ],
    phases: [phase({ name: "plan", prompt: "plan it", deliverable })],
  });

  it("finds the schema on the wrapper in another export of the same file", () => {
    // An agent never declares what it expects. Selecting `implementer` on its
    // own would show nothing unless the whole file is scanned for the parent
    // that calls it.
    const schemas = collectInputSchemas([lead, worker]);
    const { tree } = project(AGENT_LIB, worker, 3, schemas);

    expect(tree.inputSchema).not.toBeNull();
    expect((tree.inputSchema as { required: string[] }).required).toEqual(["task"]);
  });

  it("leaves it null for an agent nobody calls", () => {
    const { tree } = project(AGENT_LIB, lead, 3, collectInputSchemas([lead, worker]));
    expect(tree.inputSchema).toBeNull();
  });
});

describe("the projection carries no live values", () => {
  it("survives a JSON round-trip, since it has to cross a process boundary", () => {
    const { tree } = project(
      AGENT_LIB,
      agent({
        name: "planner",
        tools: [readFile()],
        phases: [phase({ name: "draft", prompt: "p", deliverable })],
      }),
      3
    );

    expect(JSON.parse(JSON.stringify(tree))).toEqual(tree);
  });
});
