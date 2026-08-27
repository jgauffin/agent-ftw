/**
 * Getting a live agent declaration out of a user's file.
 *
 * Importing the module runs everything at its top level. That is the price of
 * the real declaration — handlers, adapters and `accept` predicates included —
 * rather than a parse of what the source appears to say. A file meant to be
 * inspected has to be importable without starting a run.
 */

import { createRequire } from "node:module";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentDecl } from "../declare/index.js";

/** How this process can import the target file, if at all. */
export type LoaderPlan =
  | { readonly kind: "direct" }
  | { readonly kind: "tsx"; readonly loaderUrl: string }
  | { readonly kind: "unsupported"; readonly reason: string };

/** The facts a loader decision is made from, gathered by {@link currentLoaderEnv}. */
export interface LoaderEnv {
  /** True when this process was already re-launched under a TypeScript loader. */
  readonly alreadyLoaded: boolean;
  /** Absolute path of `tsx`'s entry point, when the project has it installed. */
  readonly tsxEntry: string | null;
  /** Node's own type stripping, i.e. `process.features.typescript`. */
  readonly nativeTypes: false | "strip" | "transform";
}

/** Environment variable marking a process that was re-launched under tsx. */
export const TSX_MARKER = "AGENT_FTW_TSX";

const TS_EXTENSIONS = new Set([".ts", ".mts", ".cts"]);

/**
 * Decide how to import `file`.
 *
 * `tsx` is preferred over Node's built-in type stripping because stripping
 * cannot rewrite import specifiers: TypeScript source that imports `./x.js`
 * meaning `./x.ts` is the normal convention, and Node resolves it literally
 * and fails. tsx resolves it the way the TypeScript compiler would.
 */
export function planLoader(file: string, env: LoaderEnv): LoaderPlan {
  if (!TS_EXTENSIONS.has(path.extname(file).toLowerCase())) return { kind: "direct" };
  if (env.alreadyLoaded) return { kind: "direct" };
  if (env.tsxEntry) return { kind: "tsx", loaderUrl: pathToFileURL(env.tsxEntry).href };
  if (env.nativeTypes !== false) return { kind: "direct" };
  return {
    kind: "unsupported",
    reason:
      "this Node cannot import TypeScript. Install tsx in the project (npm i -D tsx), " +
      "use Node 22.18 or newer, or point at compiled JavaScript.",
  };
}

/** Gather {@link LoaderEnv} from the running process and the user's project. */
export function currentLoaderEnv(file: string): LoaderEnv {
  return {
    alreadyLoaded: process.env[TSX_MARKER] === "1",
    tsxEntry: resolveTsx(file),
    nativeTypes: process.features.typescript ?? false,
  };
}

/**
 * Find `tsx` from the user's file first, then from this package.
 *
 * The user's project comes first so the loader matches whatever they run their
 * own scripts with.
 */
function resolveTsx(file: string): string | null {
  for (const from of [pathToFileURL(path.resolve(file)).href, import.meta.url]) {
    try {
      return createRequire(from).resolve("tsx");
    } catch {
      // Not installed there; try the next origin.
    }
  }
  return null;
}

/**
 * An extra line to print when an import failed for a reason the raw error
 * describes badly, or "" when the error speaks for itself.
 *
 * Node's own type stripping resolves import specifiers literally, so the
 * ordinary TypeScript convention of importing `./x.js` to mean `./x.ts` fails
 * with a "cannot find module" naming a file the author never wrote. Nothing in
 * that message points at the loader, which is the actual problem.
 */
export function importHint(file: string, error: unknown): string {
  const tsFile = TS_EXTENSIONS.has(path.extname(file).toLowerCase());
  const notFound = (error as { code?: unknown }).code === "ERR_MODULE_NOT_FOUND";
  if (!tsFile || !notFound || process.env[TSX_MARKER] === "1") return "";
  return (
    "This file was read with Node's built-in type stripping, which resolves import specifiers " +
    "literally: a TypeScript file importing \"./x.js\" to mean \"./x.ts\" will not resolve. " +
    "Install tsx in the project (npm i -D tsx) and run this again."
  );
}

/** Import the user's module. Throws whatever their top-level code throws. */
export async function loadModule(file: string): Promise<Record<string, unknown>> {
  const url = pathToFileURL(path.resolve(file)).href;
  return (await import(url)) as Record<string, unknown>;
}

/** An agent declaration found on a module's exports. */
export interface FoundAgent {
  readonly exportName: string;
  readonly decl: AgentDecl;
}

/**
 * Every agent the module exports, in export order.
 *
 * Exported, because a declaration held in a local variable is invisible to any
 * tool that is not the file itself.
 */
export function findAgents(mod: Record<string, unknown>): readonly FoundAgent[] {
  const out: FoundAgent[] = [];
  for (const [exportName, value] of Object.entries(mod)) {
    if (isAgentDecl(value)) out.push({ exportName, decl: value });
  }
  return out;
}

/** Structural check: declarations are plain data discriminated by `kind`. */
export function isAgentDecl(value: unknown): value is AgentDecl {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; name?: unknown; phases?: unknown };
  return v.kind === "agent" && typeof v.name === "string" && Array.isArray(v.phases);
}
