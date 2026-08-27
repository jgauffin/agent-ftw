/**
 * Owns the runner subprocess: spawning it, talking to it, and killing it.
 *
 * The child runs under tsx so it can import the user's TypeScript directly.
 * `--import` is given an absolute file URL rather than the bare specifier
 * `tsx`, because Node resolves a bare `--import` against the working
 * directory, and the working directory has to be the user's workspace so
 * relative paths inside their tool handlers mean what they mean when they run
 * the file themselves.
 */

import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import type { FromRunner, ToRunner } from "../protocol.js";

export interface RunnerHandlers {
  onMessage(msg: FromRunner): void;
  /** stdout/stderr from the user's own code, forwarded verbatim. */
  onLog(stream: "stdout" | "stderr", text: string): void;
  onExit(code: number | null, signal: string | null): void;
}

export class RunnerClient {
  private child: ChildProcess | null = null;

  /**
   * @param runnerScript Absolute path to the bundled runner entry.
   * @param cwd Directory the child runs in: the user's workspace, not the extension's.
   */
  constructor(
    private readonly runnerScript: string,
    private readonly cwd: string,
    private readonly handlers: RunnerHandlers
  ) {}

  get running(): boolean {
    return this.child !== null;
  }

  start(): void {
    if (this.child) return;

    const child = fork(this.runnerScript, [], {
      cwd: this.cwd,
      execArgv: ["--import", tsxLoaderUrl()],
      // `silent` keeps the child's stdout off the extension host's own stream
      // and gives us pipes to forward into an Output channel instead.
      silent: true,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    child.stdout?.on("data", (d: Buffer) => this.handlers.onLog("stdout", d.toString()));
    child.stderr?.on("data", (d: Buffer) => this.handlers.onLog("stderr", d.toString()));
    child.on("message", (m) => this.handlers.onMessage(m as FromRunner));
    child.on("exit", (code, signal) => {
      this.child = null;
      this.handlers.onExit(code, signal);
    });
    child.on("error", (e) => this.handlers.onLog("stderr", `runner failed to start: ${e.message}\n`));

    this.child = child;
  }

  send(msg: ToRunner): void {
    if (!this.child) {
      this.start();
    }
    this.child?.send(msg);
  }

  /**
   * Kill the child outright rather than asking it to stop. A run blocked in a
   * user's tool handler will not come back on request, and the studio must
   * stay responsive.
   */
  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }
}

let cachedLoaderUrl: string | null = null;

function tsxLoaderUrl(): string {
  if (cachedLoaderUrl) return cachedLoaderUrl;
  // Resolve from this extension's own package, which is where tsx is installed.
  const require = createRequire(pathToFileURL(path.join(__dirname, "package.json")).href);
  cachedLoaderUrl = pathToFileURL(require.resolve("tsx")).href;
  return cachedLoaderUrl;
}
