import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, runCli, type CliIO } from "../../src/cli/main.js";
import { findAgents, importHint, loadModule, planLoader, type LoaderEnv } from "../../src/cli/load.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const triager = path.join(FIXTURES, "triager.ts");
const twoAgents = path.join(FIXTURES, "two-agents.mjs");
const noPhases = path.join(FIXTURES, "no-phases.mjs");

interface Run {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function cli(...argv: string[]): Promise<Run> {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = { out: (t) => out.push(t), err: (t) => err.push(t) };
  const code = await runCli(argv, io);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("argument parsing", () => {
  it("reads_a_flag_written_either_way", () => {
    const spaced = parseArgs(["check", "a.ts", "--export", "triager"]);
    const equals = parseArgs(["check", "a.ts", "--export=triager"]);
    expect(spaced.flags.get("export")).toBe("triager");
    expect(equals.flags.get("export")).toBe("triager");
    expect(spaced.command).toBe("check");
    expect(spaced.file).toBe("a.ts");
  });

  it("refuses_a_valued_flag_left_without_its_value", () => {
    expect(parseArgs(["check", "a.ts", "--export", "--json"]).problem).toContain("--export");
  });

  it("reports_an_argument_it_has_no_meaning_for", () => {
    expect(parseArgs(["check", "a.ts", "b.ts"]).problem).toContain("b.ts");
  });
});

describe("loader planning", () => {
  const env = (overrides: Partial<LoaderEnv> = {}): LoaderEnv => ({
    alreadyLoaded: false,
    tsxEntry: null,
    nativeTypes: false,
    ...overrides,
  });

  it("imports_javascript_without_any_loader", () => {
    expect(planLoader("agent.js", env()).kind).toBe("direct");
    expect(planLoader("agent.mjs", env({ nativeTypes: "strip" })).kind).toBe("direct");
  });

  it("prefers_tsx_because_node_stripping_cannot_rewrite_import_specifiers", () => {
    const plan = planLoader("agent.ts", env({ tsxEntry: "/p/tsx.mjs", nativeTypes: "strip" }));
    expect(plan.kind).toBe("tsx");
  });

  it("falls_back_to_node_type_stripping_when_the_project_has_no_tsx", () => {
    expect(planLoader("agent.ts", env({ nativeTypes: "strip" })).kind).toBe("direct");
  });

  it("does_not_relaunch_a_process_that_is_already_under_the_loader", () => {
    expect(planLoader("agent.ts", env({ alreadyLoaded: true, tsxEntry: "/p/tsx.mjs" })).kind).toBe("direct");
  });

  it("says_what_to_install_when_typescript_cannot_be_read_at_all", () => {
    const plan = planLoader("agent.ts", env());
    expect(plan.kind).toBe("unsupported");
    expect(plan.kind === "unsupported" && plan.reason).toContain("tsx");
  });

  it("explains_a_missing_module_that_is_really_a_missing_typescript_loader", () => {
    // Node's stripping reports the `.js` specifier the author wrote, naming a
    // file that never existed. On its own that sends them to the wrong place.
    const notFound = Object.assign(new Error("Cannot find module 'src/index.js'"), {
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect(importHint("agent.ts", notFound)).toContain("tsx");
    expect(importHint("agent.js", notFound)).toBe("");
    expect(importHint("agent.ts", new Error("handler blew up"))).toBe("");
  });
});

describe("finding agents on a module", () => {
  it("takes_every_exported_declaration_and_ignores_everything_else", async () => {
    const found = findAgents(await loadModule(twoAgents));
    expect(found.map((f) => f.exportName)).toEqual(["first", "second"]);
  });
});

describe("check", () => {
  it("prints_the_phase_tree_and_the_injected_phase_end_tool", async () => {
    const run = await cli("check", triager);
    expect(run.out).toContain("bug_triager");
    expect(run.out).toContain("finish_triage");
    expect(run.out).toContain("lookup_report");
  });

  it("reports_a_finding_without_failing_the_command_over_a_warning", async () => {
    const run = await cli("check", triager);
    expect(run.out).toContain("deliverable.unexplained-string");
    expect(run.code).toBe(0);
  });

  it("fails_when_an_agent_does_not_compile_and_says_why", async () => {
    const run = await cli("check", noPhases);
    expect(run.code).toBe(1);
    expect(run.out).toContain("does not compile");
  });

  it("fails_when_the_file_exports_no_agent_at_all", async () => {
    const run = await cli("check", path.join(FIXTURES, "no-phases.mjs"), "--export", "missing");
    expect(run.code).toBe(2);
    expect(run.err).toContain("missing");
  });

  it("emits_a_machine_readable_report_on_request", async () => {
    const run = await cli("check", triager, "--json");
    const report = JSON.parse(run.out) as {
      ok: boolean;
      agents: { summary: { phases: { phaseEndToolName: string; turnBudget: number }[] } }[];
    };
    expect(report.ok).toBe(true);
    expect(report.agents[0]!.summary.phases[0]).toMatchObject({
      phaseEndToolName: "finish_triage",
      turnBudget: 6,
    });
  });

  it("checks_every_exported_agent_when_no_export_is_named", async () => {
    const run = await cli("check", twoAgents);
    expect(run.out).toContain("first_agent");
    expect(run.out).toContain("second_agent");
  });

  it("reports_a_shared_sub_agents_finding_once_however_many_exports_reach_it", async () => {
    const run = await cli("check", path.join(FIXTURES, "shared-child.mjs"), "--json");
    const report = JSON.parse(run.out) as { agents: { findings: { path: string }[] }[] };
    const paths = report.agents.flatMap((a) => a.findings.map((f) => f.path));
    expect(paths.filter((p) => p.startsWith("shared_child/"))).toHaveLength(1);
  });
});

describe("dry-run", () => {
  it("runs_the_pipeline_and_reports_the_final_deliverable", async () => {
    const run = await cli("dry-run", triager, "--export", "triager");
    expect(run.code).toBe(0);
    expect(run.out).toContain("bug_triager/triage");
    expect(run.out).toContain('"severity"');
  });

  it("leaves_tool_handlers_alone_unless_a_policy_allows_them", async () => {
    const quiet = JSON.parse((await cli("dry-run", triager, "--json")).out) as { toolCalls: unknown[] };
    expect(quiet.toolCalls).toEqual([]);

    const allowed = JSON.parse(
      (await cli("dry-run", triager, "--tools", "safe", "--json")).out
    ) as { toolCalls: { tool: string }[] };
    expect(allowed.toolCalls.map((t) => t.tool)).toEqual(["lookup_report"]);
  });

  it("insists_on_being_told_which_agent_when_the_file_exports_several", async () => {
    const run = await cli("dry-run", twoAgents);
    expect(run.code).toBe(2);
    expect(run.err).toContain("--export");
  });

  it("uses_a_supplied_deliverable_for_the_phase_it_names", async () => {
    const run = await cli(
      "dry-run",
      triager,
      "--fixtures",
      path.join(FIXTURES, "deliverables.json"),
      "--json"
    );
    const report = JSON.parse(run.out) as { phases: { deliverable: unknown }[] };
    expect(report.phases[0]!.deliverable).toEqual({ severity: "high", area: "api", note: "a real note" });
  });

  it("says_so_when_the_fixtures_file_cannot_be_read_instead_of_carrying_on", async () => {
    const run = await cli("dry-run", triager, "--fixtures", path.join(FIXTURES, "absent.json"));
    expect(run.code).toBe(2);
    expect(run.err).toContain("absent.json");
  });

  it("rejects_a_tool_policy_it_does_not_have", async () => {
    const run = await cli("dry-run", triager, "--tools", "everything");
    expect(run.code).toBe(2);
    expect(run.err).toContain("--tools");
  });
});

describe("usage", () => {
  it("explains_itself_when_asked_and_when_given_nothing", async () => {
    expect((await cli("--help")).code).toBe(0);
    expect((await cli()).code).toBe(2);
    expect((await cli()).out).toContain("agent-ftw check");
  });

  it("refuses_a_command_it_does_not_have", async () => {
    const run = await cli("lint", triager);
    expect(run.code).toBe(2);
    expect(run.err).toContain("unknown command");
  });
});
