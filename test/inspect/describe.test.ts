import { describe, it, expect } from "vitest";
import { agent, checklist, phase, subAgent, tool } from "../../src/declare/index.js";
import { describeAgent, eachPhase } from "../../src/inspect/describe.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";

const anySchema = { type: "object", properties: { x: { type: "string" } }, required: ["x"] } as const;

const readFile = tool({
  name: "read_file",
  description: "Read a file.",
  input: anySchema,
  handler: async () => "contents",
});

const writeFile = tool({
  name: "write_file",
  description: "Write a file.",
  input: anySchema,
  mutates: true,
  handler: async () => "written",
});

describe("describeAgent", () => {
  it("reports_the_phase_end_tool_the_model_gets_but_nobody_wrote", () => {
    const summary = describeAgent(
      agent({ name: "a", phases: [phase({ name: "one", prompt: "go", deliverable: anySchema })] })
    );
    const p = summary.phases[0]!;
    expect(p.phaseEndToolName).toBe("finish_one");
    expect(p.tools.map((t) => t.kind)).toEqual(["phaseEnd"]);
  });

  it("marks_a_budget_that_was_inherited_rather_than_declared", () => {
    const summary = describeAgent(
      agent({
        name: "a",
        phases: [
          phase({ name: "declared", prompt: "go", deliverable: anySchema, turnBudget: 4 }),
          phase({ name: "inherited", prompt: "go", deliverable: anySchema }),
        ],
      })
    );
    expect(summary.phases[0]!.turnBudgetDeclared).toBe(true);
    expect(summary.phases[0]!.turnBudget).toBe(4);
    expect(summary.phases[1]!.turnBudgetDeclared).toBe(false);
  });

  it("says_where_each_phases_model_comes_from", () => {
    const summary = describeAgent(
      agent({
        name: "a",
        adapter: fakeAdapter(),
        phases: [
          phase({ name: "own", prompt: "go", deliverable: anySchema, adapter: fakeAdapter() }),
          phase({ name: "agents", prompt: "go", deliverable: anySchema }),
        ],
      })
    );
    expect(summary.phases.map((p) => p.adapter)).toEqual(["phase", "agent"]);
  });

  it("flags_a_checklist_that_grades_with_the_model_that_did_the_work", () => {
    const summary = describeAgent(
      agent({
        name: "a",
        phases: [
          phase({
            name: "one",
            prompt: "go",
            deliverable: anySchema,
            checklist: checklist({ prompt: "check", schema: anySchema }),
          }),
        ],
      })
    );
    expect(summary.phases[0]!.checklist?.ownAdapter).toBe(false);
  });

  it("reports_the_delegate_tool_injected_into_a_coordinator", () => {
    const worker = agent({
      name: "worker",
      phases: [phase({ name: "work", prompt: "go", deliverable: anySchema })],
    });
    const lead = agent({
      name: "lead",
      role: "coordinator",
      tools: [subAgent({ name: "hand_off", description: "d", input: anySchema, agent: worker })],
      delegable: [readFile, writeFile],
      phases: [phase({ name: "plan", prompt: "go", deliverable: anySchema })],
    });

    const summary = describeAgent(lead);
    const delegate = summary.phases[0]!.tools.find((t) => t.kind === "delegate");
    expect(delegate).toMatchObject({ children: ["hand_off"], delegable: ["read_file", "write_file"] });
    expect(summary.delegable).toEqual(["read_file", "write_file"]);
  });

  it("nests_a_sub_agents_own_phases_so_the_whole_tree_is_visible", () => {
    const child = agent({
      name: "child",
      tools: [readFile],
      phases: [phase({ name: "do", prompt: "go", deliverable: anySchema })],
    });
    const parent = agent({
      name: "parent",
      delegable: [readFile],
      tools: [subAgent({ name: "call_child", description: "d", input: anySchema, agent: child })],
      phases: [phase({ name: "one", prompt: "go", deliverable: anySchema })],
    });

    const paths = [...eachPhase(describeAgent(parent))].map((p) => p.phase.path);
    expect(paths).toEqual(["parent/one", "child/do"]);
  });

  it("carries_the_declared_mutates_flag_through_to_the_summary", () => {
    const summary = describeAgent(
      agent({
        name: "a",
        tools: [readFile, writeFile],
        phases: [phase({ name: "one", prompt: "go", deliverable: anySchema })],
      })
    );
    const mutating = summary.phases[0]!.tools.filter((t) => t.kind === "tool" && t.mutates);
    expect(mutating.map((t) => t.name)).toEqual(["write_file"]);
  });

  it("refuses_an_agent_that_does_not_compile", () => {
    const broken = agent({ name: "broken", phases: [] });
    expect(() => describeAgent(broken)).toThrow();
  });
});
