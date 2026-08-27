/**
 * Drives the real runner subprocess the way the extension does.
 *
 * Everything else in the studio is a pure function over data. This is the one
 * seam where three things have to line up at once: tsx loading the user's
 * TypeScript, the IPC protocol, and the framework's own hooks. None of them
 * fail in a way the type checker can see.
 */

import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FromRunner, ToRunner, TraceEnvelope } from "../src/protocol.js";
import { RunModel, summarize } from "../src/run-model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runnerScript = path.join(here, "..", "src", "runner", "main.ts");
const fixture = path.join(here, "fixtures", "scripted-agent.ts");
const require = createRequire(import.meta.url);
const tsxLoader = pathToFileURL(require.resolve("tsx")).href;

let child: ChildProcess | null = null;

afterEach(() => {
  child?.kill();
  child = null;
});

interface Session {
  send(msg: ToRunner): void;
  /** Resolves with every message received up to and including the matching one. */
  waitFor(predicate: (m: FromRunner) => boolean): Promise<FromRunner[]>;
  readonly messages: FromRunner[];
  readonly stderr: string[];
}

function startRunner(onMessage?: (m: FromRunner, session: Session) => void): Session {
  const proc = fork(runnerScript, [], {
    cwd: path.join(here, ".."),
    execArgv: ["--import", tsxLoader],
    silent: true,
    stdio: ["pipe", "pipe", "pipe", "ipc"],
  });
  child = proc;

  const messages: FromRunner[] = [];
  const stderr: string[] = [];
  const waiters: { predicate: (m: FromRunner) => boolean; resolve(v: FromRunner[]): void }[] = [];

  const session: Session = {
    send: (msg) => proc.send(msg),
    messages,
    stderr,
    waitFor: (predicate) =>
      new Promise((resolve) => {
        const already = messages.find(predicate);
        if (already) {
          resolve([...messages]);
          return;
        }
        waiters.push({ predicate, resolve });
      }),
  };

  proc.stderr?.on("data", (d: Buffer) => stderr.push(d.toString()));
  proc.on("message", (raw) => {
    const m = raw as FromRunner;
    messages.push(m);
    onMessage?.(m, session);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i]!.predicate(m)) {
        waiters.splice(i, 1)[0]!.resolve([...messages]);
      }
    }
  });

  return session;
}

describe("the runner reports the agents a file exports without running them", () => {
  it("lists the exported agent and does not start a run", async () => {
    const session = startRunner();
    session.send({ t: "discover", file: fixture });

    const messages = await session.waitFor((m) => m.t === "discovered");
    const discovered = messages.find((m) => m.t === "discovered");

    expect(discovered?.t === "discovered" && discovered.agents).toEqual([
      { exportName: "navigator", agentName: "navigator", phaseCount: 1 },
    ]);
    expect(messages.some((m) => m.t === "trace")).toBe(false);
  });
});

describe("only an explicit discover reports the file's agents", () => {
  it("does not re-announce them when inspecting", async () => {
    // The panel selects an agent when it is told what a file exports. If
    // inspecting that agent announces the file's exports again, the panel
    // selects and inspects again, and the two spin against each other.
    const session = startRunner();
    session.send({ t: "discover", file: fixture });
    await session.waitFor((m) => m.t === "discovered");

    session.send({ t: "inspect", file: fixture, exportName: "navigator" });
    const messages = await session.waitFor((m) => m.t === "tree");

    expect(messages.filter((m) => m.t === "discovered")).toHaveLength(1);
  });
});

describe("inspecting an agent yields a tree that survived the process boundary", () => {
  it("projects phases, injected tools, and lint findings as plain data", async () => {
    const session = startRunner();
    session.send({ t: "inspect", file: fixture, exportName: "navigator" });

    const messages = await session.waitFor((m) => m.t === "tree");
    const tree = messages.find((m) => m.t === "tree");
    if (tree?.t !== "tree") throw new Error("no tree");

    expect(tree.tree.name).toBe("navigator");
    expect(tree.tree.phases.map((p) => p.name)).toEqual(["choose"]);
    expect(tree.tree.phases[0]!.turnBudget).toBe(6);
    expect(tree.tree.phases[0]!.tools.map((t) => t.name)).toContain("finish_choose");
    expect(tree.tree.phases[0]!.tools.map((t) => t.name)).toContain("consult");
  });
});

describe("a run reaches the operator and reports what went wrong along the way", () => {
  it("asks the user, retries a rejected deliverable, and finishes", async () => {
    const asked: FromRunner[] = [];
    const session = startRunner((m, s) => {
      if (m.t === "ask") {
        asked.push(m);
        s.send({ t: "askResult", id: m.id, selected: ["left"] });
      }
    });

    session.send({
      t: "run",
      file: fixture,
      exportName: "navigator",
      input: "go",
      sessionDirectory: path.join(here, "..", "node_modules", ".studio-e2e-sessions"),
    });

    const messages = await session.waitFor((m) => m.t === "done" || m.t === "failed");
    const failed = messages.find((m) => m.t === "failed");
    expect(failed, failed?.t === "failed" ? failed.error : "").toBeUndefined();

    // The prompt actually reached the panel rather than being auto-answered.
    expect(asked).toHaveLength(1);
    expect(asked[0]?.t === "ask" && asked[0].prompt).toBe("Which way?");
    // The framework appends its own free-text option to whatever was declared.
    expect(asked[0]?.t === "ask" && asked[0].options).toContain("right");

    const done = messages.find((m) => m.t === "done");
    expect(done?.t === "done" && done.output).toEqual({ route: "left", note: "asked first" });

    const model = new RunModel();
    for (const m of messages) {
      if (m.t === "trace") model.apply(m.event as TraceEnvelope);
    }

    const choose = model.root!.phases[0]!;
    expect(choose.status).toBe("done");
    expect(choose.deliverableAttempts).toBe(2);
    expect(choose.rejections[0]!.join(" ")).toContain("route");
    expect(choose.toolCalls).toBeGreaterThanOrEqual(1);
    expect(summarize(model).rejectedDeliverables).toBe(1);
  });
});

describe("pinning a phase makes the run start after it", () => {
  it("replays the pinned deliverable and runs only what is left", async () => {
    const session = startRunner();
    session.send({
      t: "run",
      file: path.join(here, "fixtures", "two-phase-agent.ts"),
      exportName: "planner",
      input: "go",
      sessionDirectory: path.join(here, "..", "node_modules", ".studio-pin-e2e", `s${Date.now()}`),
      sessionId: "pinned",
      pins: { brainstorm: { text: "an idea I typed by hand" } },
    });

    const messages = await session.waitFor((m) => m.t === "done" || m.t === "failed");
    const failed = messages.find((m) => m.t === "failed");
    expect(failed, failed?.t === "failed" ? failed.error : "").toBeUndefined();

    const model = new RunModel();
    for (const m of messages) {
      if (m.t === "trace") model.apply(m.event as TraceEnvelope);
    }

    const [brainstorm, refine] = model.root!.phases;
    expect(brainstorm!.phase).toBe("brainstorm");
    expect(brainstorm!.deliverable).toEqual({ text: "an idea I typed by hand" });
    // Marked as replayed, so the timeline does not read as though it was free.
    expect(brainstorm!.cached).toBe(true);
    expect(brainstorm!.turns).toBe(0);

    expect(refine!.phase).toBe("refine");
    expect(refine!.turns).toBeGreaterThan(0);
  });

  it("refuses a pin that does not match the phase's own deliverable schema", async () => {
    // A pin that does not validate would be handed downstream as if the agent
    // had produced it, and the run would fail somewhere other than the mistake.
    const session = startRunner();
    session.send({
      t: "run",
      file: path.join(here, "fixtures", "two-phase-agent.ts"),
      exportName: "planner",
      input: "go",
      sessionDirectory: path.join(here, "..", "node_modules", ".studio-pin-e2e", `s${Date.now()}b`),
      sessionId: "bad-pin",
      pins: { brainstorm: { wrong: 1 } },
    });

    const messages = await session.waitFor((m) => m.t === "done" || m.t === "failed");
    const failed = messages.find((m) => m.t === "failed");

    expect(failed?.t === "failed" && failed.error).toContain("brainstorm");
    expect(failed?.t === "failed" && failed.error).toContain("deliverable schema");
  });
});

describe("an agent with no adapter anywhere is refused rather than run against a substitute", () => {
  it("names the phase that needs one", async () => {
    const noAdapter = path.join(here, "fixtures", "adapterless-agent.ts");
    const session = startRunner();
    session.send({
      t: "run",
      file: noAdapter,
      exportName: "stranded",
      input: "go",
      sessionDirectory: path.join(here, "..", "node_modules", ".studio-e2e-sessions"),
    });

    const messages = await session.waitFor((m) => m.t === "done" || m.t === "failed");
    const failed = messages.find((m) => m.t === "failed");

    expect(failed?.t === "failed" && failed.error).toContain("no adapter declared");
    // Naming the phase is the point: "no adapter" alone does not say where.
    expect(failed?.t === "failed" && failed.error).toContain("nowhere");
  });
});
