#!/usr/bin/env node
/**
 * The `agent-ftw` command line.
 *
 * Two things an author (or a coding agent writing on their behalf) cannot
 * otherwise find out without paying a model to tell them: whether the
 * declaration holds together, and whether the machinery around it works. That
 * is `check` and `dry-run`, and deliberately nothing else — anything that needs
 * a real model belongs in the author's own script, where the adapters are.
 */

import { fork } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ToolPolicy } from "../inspect/dry-run.js";
import { checkAgents } from "./check.js";
import { dryRun } from "./dry-run.js";
import {
  currentLoaderEnv,
  findAgents,
  importHint,
  loadModule,
  planLoader,
  TSX_MARKER,
  type FoundAgent,
} from "./load.js";
import { renderCheck, renderDryRun } from "./render.js";

/** Where the CLI writes. Injected so the commands can be tested without a terminal. */
export interface CliIO {
  out(text: string): void;
  err(text: string): void;
}

/** Nothing wrong. */
const EXIT_OK = 0;
/** The agent has problems: findings, a failed compile, a failed dry run. */
const EXIT_PROBLEMS = 1;
/** The command itself was wrong: bad arguments, unreadable file. */
const EXIT_USAGE = 2;

const USAGE = `agent-ftw — check an agent declaration without running a model

  agent-ftw check <file> [options]
      Compile every exported agent and lint it. Prints the phase tree, the
      tools each phase exposes (injected ones included), and every finding.

  agent-ftw dry-run <file> [options]
      Run the pipeline with deliverables built from the schemas instead of a
      model. Proves the handoffs, the budgets, the tool wiring and the accept
      predicates. Declared adapters are ignored, so no model is called.

Options
  --export <name>      Which exported agent to use (dry-run needs exactly one)
  --json               Emit the report as JSON instead of text
  --max-depth <n>      Compile/run depth limit for the sub-agent tree

dry-run only
  --tools <policy>     none (default) | safe | all
                       safe calls tools that declare no mutation; all calls
                       every tool handler, including ones that change things.
  --input <json|@file> Value handed to the first phase
  --fixtures <file>    JSON object of deliverables keyed by phase-end tool name
  --turn-budget <n>    Ceiling for the whole run tree

Exit codes: 0 clean, 1 problems found, 2 bad usage.`;

/** Flags that take a value; everything else is a boolean switch. */
const VALUED_FLAGS = new Set(["export", "max-depth", "tools", "input", "fixtures", "turn-budget"]);

interface Args {
  readonly command: string | null;
  readonly file: string | null;
  readonly flags: ReadonlyMap<string, string | true>;
  readonly problem: string | null;
}

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string | true>();
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    const name = eq === -1 ? body : body.slice(0, eq);

    if (eq !== -1) {
      flags.set(name, body.slice(eq + 1));
      continue;
    }
    if (!VALUED_FLAGS.has(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) {
      return { command: null, file: null, flags, problem: `--${name} needs a value` };
    }
    flags.set(name, value);
    i++;
  }

  return {
    command: positional[0] ?? null,
    file: positional[1] ?? null,
    flags,
    problem: positional.length > 2 ? `unexpected argument "${positional[2]}"` : null,
  };
}

export async function runCli(argv: readonly string[], io: CliIO): Promise<number> {
  const args = parseArgs(argv);
  if (args.problem) {
    io.err(`${args.problem}\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (args.flags.has("version")) {
    io.out(await version());
    return EXIT_OK;
  }
  if (args.flags.has("help") || args.command === "help" || args.command === null) {
    io.out(USAGE);
    return args.command === null && !args.flags.has("help") ? EXIT_USAGE : EXIT_OK;
  }
  if (args.command !== "check" && args.command !== "dry-run") {
    io.err(`unknown command "${args.command}"\n\n${USAGE}`);
    return EXIT_USAGE;
  }
  if (!args.file) {
    io.err(`${args.command} needs a file\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  const json = args.flags.has("json");
  const maxDepth = numberFlag(args.flags, "max-depth");
  if (maxDepth instanceof Error) {
    io.err(maxDepth.message);
    return EXIT_USAGE;
  }

  let found: readonly FoundAgent[];
  try {
    found = findAgents(await loadModule(args.file));
  } catch (e) {
    // The user's module threw while being imported. Their error, verbatim: a
    // paraphrase would send them looking in the wrong file.
    const hint = importHint(args.file, e);
    io.err(
      `could not import ${args.file}\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}` +
        (hint ? `\n\n${hint}` : "")
    );
    return EXIT_USAGE;
  }

  const wanted = args.flags.get("export");
  const selected =
    typeof wanted === "string" ? found.filter((f) => f.exportName === wanted) : found;
  if (typeof wanted === "string" && selected.length === 0) {
    io.err(
      `no agent exported as "${wanted}". Exported: ${found.map((f) => f.exportName).join(", ") || "(none)"}`
    );
    return EXIT_USAGE;
  }

  return args.command === "check"
    ? runCheck(args.file, selected, { json, maxDepth }, io)
    : await runDryRun(args.file, selected, args, { json, maxDepth }, io);
}

interface CommonOptions {
  readonly json: boolean;
  readonly maxDepth: number | undefined;
}

function runCheck(
  file: string,
  found: readonly FoundAgent[],
  common: CommonOptions,
  io: CliIO
): number {
  const report = checkAgents(file, found, common.maxDepth !== undefined ? { maxDepth: common.maxDepth } : {});
  io.out(common.json ? JSON.stringify(report, null, 2) : renderCheck(report));
  return report.ok ? EXIT_OK : EXIT_PROBLEMS;
}

async function runDryRun(
  file: string,
  found: readonly FoundAgent[],
  args: Args,
  common: CommonOptions,
  io: CliIO
): Promise<number> {
  if (found.length === 0) {
    io.err(`${file} exports no agent to run.`);
    return EXIT_USAGE;
  }
  if (found.length > 1) {
    io.err(
      `${file} exports more than one agent; pick one with --export: ${found.map((f) => f.exportName).join(", ")}`
    );
    return EXIT_USAGE;
  }

  const policy = args.flags.get("tools") ?? "none";
  if (policy !== "none" && policy !== "safe" && policy !== "all") {
    io.err(`--tools must be none, safe or all`);
    return EXIT_USAGE;
  }
  const turnBudget = numberFlag(args.flags, "turn-budget");
  if (turnBudget instanceof Error) {
    io.err(turnBudget.message);
    return EXIT_USAGE;
  }

  let input: unknown = "<dry run>";
  let deliverables: Record<string, unknown> | undefined;
  try {
    const rawInput = args.flags.get("input");
    if (typeof rawInput === "string") input = await readValue(rawInput);
    const fixtures = args.flags.get("fixtures");
    if (typeof fixtures === "string") deliverables = (await readValue(`@${fixtures}`)) as Record<string, unknown>;
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return EXIT_USAGE;
  }

  const report = await dryRun(file, found[0]!, {
    tools: policy as ToolPolicy,
    input,
    ...(deliverables ? { deliverables } : {}),
    ...(common.maxDepth !== undefined ? { maxDepth: common.maxDepth } : {}),
    ...(turnBudget !== undefined ? { turnBudget } : {}),
  });

  io.out(common.json ? JSON.stringify(report, null, 2) : renderDryRun(report));
  return report.ok && report.rejections.length === 0 && report.toolCalls.every((t) => t.error === null)
    ? EXIT_OK
    : EXIT_PROBLEMS;
}

/** `@path` reads a JSON file; anything else is parsed as JSON literal. */
async function readValue(raw: string): Promise<unknown> {
  const text = raw.startsWith("@") ? await readFile(raw.slice(1), "utf8") : raw;
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    if (raw.startsWith("@")) throw new Error(`${raw.slice(1)} is not valid JSON: ${(e as Error).message}`);
    // A bare word is a perfectly reasonable thing to hand a first phase.
    return raw;
  }
}

function numberFlag(flags: ReadonlyMap<string, string | true>, name: string): number | undefined | Error {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  const n = typeof raw === "string" ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : new Error(`--${name} must be a positive integer`);
}

async function version(): Promise<string> {
  const url = new URL("../../package.json", import.meta.url);
  try {
    const pkg = JSON.parse(await readFile(url, "utf8")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch (e) {
    return `unknown (could not read ${url.pathname}: ${e instanceof Error ? e.message : String(e)})`;
  }
}

/**
 * Entry point. Re-launches under a TypeScript loader when the target file needs
 * one, because a loader has to be in place before the first import, which is
 * long before this process could decide it wanted one.
 */
async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const io: CliIO = {
    out: (t) => process.stdout.write(`${t}\n`),
    err: (t) => process.stderr.write(`${t}\n`),
  };

  const file = parseArgs(argv).file;
  if (file) {
    const plan = planLoader(file, currentLoaderEnv(file));
    if (plan.kind === "unsupported") {
      io.err(`cannot read ${file}: ${plan.reason}`);
      process.exit(EXIT_USAGE);
    }
    if (plan.kind === "tsx") {
      process.exit(await relaunch(plan.loaderUrl, argv));
    }
  }

  process.exit(await runCli(argv, io));
}

function relaunch(loaderUrl: string, argv: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = fork(fileURLToPath(import.meta.url), [...argv], {
      execArgv: ["--import", loaderUrl],
      env: { ...process.env, [TSX_MARKER]: "1" },
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? EXIT_PROBLEMS));
    child.on("error", (e) => {
      process.stderr.write(`could not start the TypeScript loader: ${e.message}\n`);
      resolve(EXIT_USAGE);
    });
  });
}

// Only when run as a program. Importing this module (the tests do) must not
// start anything.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  void main();
}
