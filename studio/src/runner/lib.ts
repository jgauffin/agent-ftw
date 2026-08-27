/**
 * Locates the `agent-ftw` the user's own code is built against.
 *
 * The studio must not run an agent against its own bundled copy of the
 * library while the declaration was built by a different one. Nothing in
 * `validate`/`Session` uses `instanceof` (the declaration types discriminate
 * on `kind` strings), so two copies would not crash, they would drift: a
 * version mismatch would show up as a missing trace variant or an unfamiliar
 * compile error rather than as an import failure.
 */

import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { promises as fs } from "node:fs";

/** The slice of the library the studio calls. */
export interface AgentLib {
  validate(decl: unknown, opts?: { maxDepth?: number; depth?: number }): unknown;
  lint(decl: unknown): readonly unknown[];
  Session: new (opts: unknown) => SessionLike;
  DEFAULT_TURN_BUDGET: number;
  DEFAULT_MAX_DEPTH: number;
  /**
   * Optional: added after the studio was first written, so a project pinned to
   * an older library still loads and simply cannot pin.
   */
  pinDeliverables?(opts: {
    directory: string;
    agentName: string;
    sessionId: string;
    deliverables: Readonly<Record<string, unknown>>;
  }): Promise<readonly string[]>;
  validateAgainstSchema?(schema: unknown, value: unknown): { valid: boolean; errors: readonly string[] };
}

/** The slice of `Session` the studio drives. */
export interface SessionLike {
  readonly id: string;
  run(input: unknown): Promise<unknown>;
  cancel(reason?: string): void;
  dispose(): Promise<void>;
}

export interface ResolvedLib {
  readonly lib: AgentLib;
  /** Absolute path the library was loaded from. Shown in the panel so a wrong copy is visible. */
  readonly from: string;
  /** How it was found, for the same reason. */
  readonly how: "package" | "source";
}

/**
 * Resolve the library for a user file. Tries the installed package first, then
 * falls back to a checkout's own `src/index.ts`, which is how this repo's
 * `examples/` run, since they import `../src/...` rather than the package name.
 */
export async function resolveLib(userFile: string): Promise<ResolvedLib> {
  const fromPackage = tryResolvePackage(userFile);
  if (fromPackage) {
    const lib = (await import(pathToFileURL(fromPackage).href)) as unknown as AgentLib;
    return { lib, from: fromPackage, how: "package" };
  }

  const fromSource = await findSourceIndex(userFile);
  if (fromSource) {
    const lib = (await import(pathToFileURL(fromSource).href)) as unknown as AgentLib;
    return { lib, from: fromSource, how: "source" };
  }

  throw new Error(
    `Could not find agent-ftw from ${userFile}. Install it in the project, or open a file inside an agent-ftw checkout.`
  );
}

function tryResolvePackage(userFile: string): string | null {
  try {
    const require = createRequire(pathToFileURL(userFile).href);
    return require.resolve("agent-ftw");
  } catch {
    return null;
  }
}

/** Walk up from the user's file looking for the library checkout it lives in. */
async function findSourceIndex(userFile: string): Promise<string | null> {
  let dir = path.dirname(path.resolve(userFile));
  for (;;) {
    const candidate = path.join(dir, "src", "index.ts");
    const pkg = path.join(dir, "package.json");
    if ((await isFile(candidate)) && (await isAgentFtwPackage(pkg))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

async function isAgentFtwPackage(pkgPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(pkgPath, "utf8");
    return (JSON.parse(raw) as { name?: string }).name === "agent-ftw";
  } catch {
    return false;
  }
}
