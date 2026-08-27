/**
 * The runner: a Node subprocess that imports the user's TypeScript, projects
 * the agent it exports, and runs it.
 *
 * This lives out of process because the VS Code extension host cannot execute
 * the user's TypeScript, and because a tool handler that hangs or exits should
 * take down a subprocess rather than the editor.
 *
 * Trace events and prompts travel over the `fork` IPC channel, not stdout.
 * stdout belongs to the user's own `console.log` calls inside tool handlers,
 * which the extension forwards to an Output channel unmangled.
 */

import type { DiscoveredAgent, FromRunner, ToRunner } from "../protocol.js";
import { Bridge } from "./bridge.js";
import { discover } from "./discover.js";
import { collectInputSchemas, project } from "./project.js";
import { resolveLib, type AgentLib, type SessionLike } from "./lib.js";
import { undeclaredAdapter } from "./adapter.js";

function send(msg: FromRunner): void {
  process.send?.(msg);
}

const bridge = new Bridge(send);

let session: SessionLike | null = null;
/** Cached per file so an inspect followed by a run does not import twice. */
let cache: {
  file: string;
  lib: AgentLib;
  decls: ReadonlyMap<string, unknown>;
  adapter: unknown | null;
} | null = null;

process.on("message", (msg: ToRunner) => {
  void handle(msg).catch((e: unknown) => fail(e));
});

// A tool handler that rejects without a catch would otherwise kill the runner
// with no explanation reaching the panel.
process.on("unhandledRejection", (reason: unknown) => fail(reason));

send({ t: "ready" });

async function handle(msg: ToRunner): Promise<void> {
  switch (msg.t) {
    case "discover":
      send({ t: "discovered", agents: agentsOf(await load(msg.file), declsFor(msg.file)) });
      return;
    case "inspect":
      await inspect(msg.file, msg.exportName);
      return;
    case "run":
      await run(msg);
      return;
    case "cancel":
      session?.cancel("cancelled from studio");
      bridge.abandon("run cancelled");
      return;
    default:
      bridge.handle(msg);
  }
}

/**
 * Import the file and cache what it exports. Silent by design: announcing the
 * file's agents here would mean an inspect or a run re-announces them, the
 * panel responds by selecting and inspecting again, and the two spin against
 * each other. Only a `discover` message reports agents.
 */
async function load(file: string): Promise<AgentLib> {
  if (cache?.file === file) return cache.lib;
  const { lib } = await resolveLib(file);
  const found = await discover(lib, file, lib.DEFAULT_MAX_DEPTH);
  cache = { file, lib, decls: found.declsByExport, adapter: found.adapter };
  return lib;
}

function declsFor(file: string): ReadonlyMap<string, unknown> {
  return cache?.file === file ? cache.decls : new Map();
}

/** Re-describes cached declarations without re-importing the module. */
function agentsOf(lib: AgentLib, decls: ReadonlyMap<string, unknown>): DiscoveredAgent[] {
  return [...decls.entries()].map(([exportName, decl]) => {
    const d = decl as { name: string; phases: readonly unknown[] };
    const base = { exportName, agentName: d.name, phaseCount: d.phases.length };
    try {
      lib.validate(decl, { maxDepth: lib.DEFAULT_MAX_DEPTH });
      return base;
    } catch (e) {
      return { ...base, compileError: e instanceof Error ? e.message : String(e) };
    }
  });
}

async function inspect(file: string, exportName: string): Promise<void> {
  const lib = await load(file);
  const decl = declFor(file, exportName);
  // Every export is scanned, not just the selected one: the wrapper that says
  // what this agent expects is usually a different agent in the same file.
  const { tree, findings } = project(
    lib,
    decl,
    lib.DEFAULT_MAX_DEPTH,
    collectInputSchemas(declsFor(file).values())
  );
  send({ t: "tree", tree, findings });
}

async function run(msg: Extract<ToRunner, { t: "run" }>): Promise<void> {
  const lib = await load(msg.file);
  const decl = declFor(msg.file, msg.exportName);

  const { tree, findings } = project(
    lib,
    decl,
    lib.DEFAULT_MAX_DEPTH,
    collectInputSchemas(declsFor(msg.file).values())
  );
  send({ t: "tree", tree, findings });

  const name = (decl as { name: string }).name;
  const sessionId = msg.sessionId ?? undefined;
  if (msg.pins && Object.keys(msg.pins).length > 0) {
    await applyPins(lib, tree, name, msg.sessionDirectory, sessionId, msg.pins);
  }

  session = new lib.Session({
    agent: decl,
    // Agent- and phase-level adapters still win; this only fills the slot the
    // agent cannot declare for itself.
    defaultAdapter: cache?.adapter ?? undeclaredAdapter(name),
    hooks: bridge.hooks(),
    sessionDirectory: msg.sessionDirectory,
    ...(msg.sessionId !== undefined ? { sessionId: msg.sessionId } : {}),
  });

  const current = session;
  try {
    const output = await current.run(msg.input);
    send({ t: "done", output, sessionId: current.id });
  } finally {
    bridge.abandon("run finished");
    session = null;
    await current.dispose();
  }
}

/**
 * Write the pinned deliverables so the run starts at the first phase that is
 * not pinned.
 *
 * Each one is checked against the schema its own phase declares first. A pin
 * that does not validate would be handed to the next phase as if the agent had
 * produced it, and the run would go wrong somewhere downstream of the actual
 * mistake, which is the failure mode the studio exists to remove.
 */
async function applyPins(
  lib: AgentLib,
  tree: { phases: readonly { name: string; deliverable: unknown }[] },
  agentName: string,
  directory: string,
  sessionId: string | undefined,
  pins: Readonly<Record<string, unknown>>
): Promise<void> {
  if (!lib.pinDeliverables) {
    throw new Error(
      "This project's agent-ftw has no `pinDeliverables`, so phases cannot be pinned. Upgrade it, or run without pins."
    );
  }
  if (!sessionId) throw new Error("Pinning needs a session id, and none was given.");

  const schemas = new Map(tree.phases.map((p) => [p.name, p.deliverable]));
  const problems: string[] = [];

  for (const [phase, payload] of Object.entries(pins)) {
    const schema = schemas.get(phase);
    if (schema === undefined) {
      problems.push(`"${phase}" is not a phase of ${agentName}`);
      continue;
    }
    const check = lib.validateAgainstSchema?.(schema, payload);
    if (check && !check.valid) {
      problems.push(`"${phase}" does not match its deliverable schema: ${check.errors.join("; ")}`);
    }
  }

  if (problems.length > 0) {
    throw new Error(`Pinned deliverables were rejected.\n${problems.map((p) => `  ${p}`).join("\n")}`);
  }

  await lib.pinDeliverables({ directory, agentName, sessionId, deliverables: pins });
}

function declFor(file: string, exportName: string): unknown {
  const decl = cache?.file === file ? cache.decls.get(exportName) : undefined;
  if (decl === undefined) {
    throw new Error(`No agent exported as "${exportName}" in ${file}.`);
  }
  return decl;
}

function fail(e: unknown): void {
  const error = e instanceof Error ? e : new Error(String(e));
  bridge.abandon(error.message);
  send({ t: "failed", error: error.message, ...(error.stack !== undefined ? { stack: error.stack } : {}) });
}
