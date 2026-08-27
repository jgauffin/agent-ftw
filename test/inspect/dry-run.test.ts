import { describe, it, expect } from "vitest";
import { agent, checklist, phase, subAgent, tool } from "../../src/declare/index.js";
import { callableTools, dryRunAdapter, stripAdapters } from "../../src/inspect/dry-run.js";
import { describeAgent } from "../../src/inspect/describe.js";
import { Session } from "../../src/runtime/session.js";
import type { Hooks } from "../../src/hooks/index.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";

const emptyInput = { type: "object", properties: {}, required: [] } as const;

const triageSchema = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["low", "high"] },
    steps: { type: "array", items: { type: "string" }, minItems: 1 },
  },
  required: ["severity", "steps"],
} as const;

function hooks(extra: Partial<Hooks> = {}): Hooks {
  return { askUser: async () => ({ selected: [] }), ...extra };
}

function dryRunSession(decl: Parameters<typeof stripAdapters>[0], callTools: readonly string[] = []) {
  const stripped = stripAdapters(decl);
  return new Session({
    agent: stripped,
    defaultAdapter: dryRunAdapter({ callTools }),
    hooks: hooks(),
  });
}

describe("dry run", () => {
  it("ends_every_phase_with_a_deliverable_its_own_schema_accepts", async () => {
    const a = agent({
      name: "a",
      phases: [
        phase({ name: "triage", prompt: "go", deliverable: triageSchema }),
        phase({ name: "plan", prompt: "go", deliverable: triageSchema }),
      ],
    });

    const session = dryRunSession(a);
    const out = await session.run("input");
    await session.dispose();

    // The framework rejects a payload that fails the schema, so arriving here
    // with a value at all is the assertion; the shape confirms which phase.
    expect(out).toEqual({ severity: "low", steps: ["<step>"] });
  });

  it("does_not_call_tool_handlers_unless_it_is_told_to", async () => {
    let called = false;
    const sendMail = tool({
      name: "send_mail",
      description: "Send mail.",
      input: emptyInput,
      mutates: true,
      handler: async () => {
        called = true;
        return "sent";
      },
    });

    const a = agent({
      name: "a",
      tools: [sendMail],
      phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
    });

    const session = dryRunSession(a);
    await session.run("input");
    await session.dispose();
    expect(called).toBe(false);
  });

  it("calls_a_tool_handler_with_a_synthesized_input_when_allowed", async () => {
    const seen: unknown[] = [];
    const search = tool({
      name: "search",
      description: "Search.",
      input: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      } as const,
      handler: async (input) => {
        seen.push(input);
        return "results";
      },
    });

    const a = agent({
      name: "a",
      tools: [search],
      phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
    });

    const session = dryRunSession(a, ["search"]);
    await session.run("input");
    await session.dispose();
    expect(seen).toEqual([{ query: "<query>" }]);
  });

  it("uses_a_supplied_deliverable_instead_of_synthesizing_one", async () => {
    const a = agent({
      name: "a",
      phases: [phase({ name: "triage", prompt: "go", deliverable: triageSchema })],
    });

    const session = new Session({
      agent: a,
      defaultAdapter: dryRunAdapter({
        deliverables: { finish_triage: { severity: "high", steps: ["boom"] } },
      }),
      hooks: hooks(),
    });
    const out = await session.run("input");
    await session.dispose();
    expect(out).toEqual({ severity: "high", steps: ["boom"] });
  });

  it("passes_a_checklist_rather_than_sending_the_run_into_a_revision_loop", async () => {
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "one",
          prompt: "go",
          deliverable: triageSchema,
          checklist: checklist({
            prompt: "check it",
            schema: {
              type: "object",
              properties: {
                checks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: { name: { type: "string" }, passed: { type: "boolean" } },
                    required: ["name", "passed"],
                  },
                },
              },
              required: ["checks"],
            } as const,
          }),
        }),
      ],
    });

    const session = dryRunSession(a);
    const out = await session.run("input");
    await session.dispose();
    expect(out).toEqual({ severity: "low", steps: ["<step>"] });
  });

  it("reports_the_schema_gaps_it_had_to_guess_around", async () => {
    const notes: string[] = [];
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "one",
          prompt: "go",
          deliverable: {
            type: "object",
            properties: { path: { type: "string", pattern: "^src/" } },
            required: ["path"],
          } as const,
        }),
      ],
    });

    const session = new Session({
      agent: a,
      defaultAdapter: dryRunAdapter({ onSynthesis: (n) => notes.push(...n.gaps) }),
      hooks: hooks(),
    });
    // The synthesized value cannot match the pattern, so the framework rejects
    // it; the run failing is the point, and the gap says why.
    await expect(session.run("input")).rejects.toThrow();
    await session.dispose();
    expect(notes.join(" ")).toContain("pattern");
  });

  it("says_plainly_that_it_cannot_end_a_phase_the_host_terminates", async () => {
    const a = agent({
      name: "a",
      phases: [
        phase({
          name: "one",
          prompt: "go",
          deliverable: triageSchema,
          // Nothing resolves it: a dry run has no host to press the button.
          terminator: { kind: "external", await: () => new Promise<unknown>(() => {}) },
        }),
      ],
    });

    const session = dryRunSession(a);
    await expect(session.run("input")).rejects.toThrow(/external terminator/);
    await session.dispose();
  });

  it("runs_a_sub_agents_own_pipeline_when_the_sub_agent_is_callable", async () => {
    const child = agent({
      name: "child",
      phases: [phase({ name: "work", prompt: "go", deliverable: triageSchema })],
    });
    const parent = agent({
      name: "parent",
      tools: [subAgent({ name: "call_child", description: "d", input: emptyInput, agent: child })],
      phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
    });

    const phasesRun: string[] = [];
    const session = new Session({
      agent: stripAdapters(parent),
      defaultAdapter: dryRunAdapter({ callTools: ["call_child"] }),
      hooks: hooks({ trace: (e) => e.type === "phase.end" && phasesRun.push(`${e.agent}/${e.phase}`) }),
    });
    await session.run("input");
    await session.dispose();
    expect(phasesRun).toEqual(["child/work", "parent/one"]);
  });
});

describe("stripAdapters", () => {
  it("removes_a_declared_adapter_so_no_phase_reaches_a_real_model", async () => {
    const declared = fakeAdapter();
    const a = agent({
      name: "a",
      adapter: declared,
      phases: [
        phase({
          name: "one",
          prompt: "go",
          deliverable: triageSchema,
          adapter: declared,
          checklist: checklist({ prompt: "c", schema: triageSchema, adapter: declared }),
        }),
      ],
    });

    const stripped = stripAdapters(a);
    expect(stripped.adapter).toBeUndefined();
    expect(stripped.phases[0]!.adapter).toBeUndefined();
    expect(stripped.phases[0]!.checklist?.adapter).toBeUndefined();
    // The original is untouched: a caller may still want to run it for real.
    expect(a.phases[0]!.adapter).toBe(declared);
  });

  it("keeps_a_sub_agent_shared_by_two_parents_as_one_declaration", () => {
    const child = agent({
      name: "child",
      phases: [phase({ name: "work", prompt: "go", deliverable: triageSchema })],
    });
    const parent = agent({
      name: "parent",
      tools: [
        subAgent({ name: "first", description: "d", input: emptyInput, agent: child }),
        subAgent({ name: "second", description: "d", input: emptyInput, agent: child }),
      ],
      phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
    });

    const stripped = stripAdapters(parent);
    const [first, second] = stripped.tools;
    expect(first!.kind === "subAgent" && second!.kind === "subAgent").toBe(true);
    expect((first as { agent: unknown }).agent).toBe((second as { agent: unknown }).agent);
  });
});

describe("callableTools", () => {
  const readOnly = tool({ name: "read", description: "d", input: emptyInput, handler: async () => "" });
  const mutating = tool({
    name: "write",
    description: "d",
    input: emptyInput,
    mutates: true,
    handler: async () => "",
  });

  it("calls_nothing_by_default", () => {
    const summary = describeAgent(
      agent({
        name: "a",
        tools: [readOnly, mutating],
        phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
      })
    );
    expect(callableTools(summary, "none")).toEqual([]);
  });

  it("leaves_out_a_tool_that_declares_it_changes_something", () => {
    const summary = describeAgent(
      agent({
        name: "a",
        tools: [readOnly, mutating],
        phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
      })
    );
    expect(callableTools(summary, "safe")).toEqual(["read"]);
    expect([...callableTools(summary, "all")].sort()).toEqual(["read", "write"]);
  });

  it("leaves_out_a_sub_agent_whose_tree_holds_a_mutating_tool", () => {
    const child = agent({
      name: "child",
      tools: [mutating],
      phases: [phase({ name: "work", prompt: "go", deliverable: triageSchema })],
    });
    const parent = agent({
      name: "parent",
      delegable: [mutating],
      tools: [subAgent({ name: "call_child", description: "d", input: emptyInput, agent: child })],
      phases: [phase({ name: "one", prompt: "go", deliverable: triageSchema })],
    });

    const summary = describeAgent(parent);
    expect(callableTools(summary, "safe")).toEqual([]);
    expect(callableTools(summary, "all")).toContain("call_child");
  });

  it("never_offers_the_delegate_tool_because_a_batch_cannot_be_synthesized", () => {
    const worker = agent({
      name: "worker",
      phases: [phase({ name: "work", prompt: "go", deliverable: triageSchema })],
    });
    const lead = agent({
      name: "lead",
      role: "coordinator",
      tools: [subAgent({ name: "hand_off", description: "d", input: emptyInput, agent: worker })],
      phases: [phase({ name: "plan", prompt: "go", deliverable: triageSchema })],
    });

    expect(callableTools(describeAgent(lead), "all")).not.toContain("delegate");
  });
});
