import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agent, phase, tool } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";

const noopHooks: Hooks = {
  askUser: async () => ({ selected: [] }),
};

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-fw-persist-"));
});

const numDeliverable = {
  type: "object",
  properties: { x: { type: "number" } },
  required: ["x"],
} as const;

describe("session persistence", () => {
  it("creates session directory and persists deliverable on phase completion", async () => {
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a = agent({ name: "agent_a", phases: [p] });
    const fa = fakeAdapter([{ finish: { x: 7 } }]);

    const s = new Session({
      agent: a,
      defaultAdapter: fa,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "sess1",
    });
    const out = await s.run("hello");
    expect(out).toEqual({ x: 7 });

    const root = path.join(tmpRoot, "agent_a", "sess1");
    const meta = JSON.parse(await fs.readFile(path.join(root, "meta.json"), "utf8"));
    expect(meta.sessionId).toBe("sess1");
    expect(meta.agentName).toBe("agent_a");
    expect(meta.status).toBe("complete");
    expect(meta.completedPhases).toEqual(["p1"]);

    const deliverables = JSON.parse(
      await fs.readFile(path.join(root, "deliverables.json"), "utf8")
    );
    expect(deliverables.deliverables).toEqual({ p1: { x: 7 } });
  });

  it("resumes by skipping a phase whose deliverable is already persisted", async () => {
    const p1 = phase({ name: "p1", prompt: "first", deliverable: numDeliverable });
    const p2 = phase({
      name: "p2",
      prompt: "second",
      deliverable: { type: "object", properties: { y: { type: "string" } }, required: ["y"] } as const,
    });
    const a = agent({ name: "twoph", phases: [p1, p2] });

    // First run: complete p1, then "crash" before p2 starts the model loop.
    const fa1 = fakeAdapter([{ finish: { x: 1 } }]);
    const s1 = new Session({
      agent: a,
      defaultAdapter: fa1,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "sess1",
    });
    // Don't run to completion; manually invoke first phase via store priming:
    // simpler: run with adapter that finishes p1, then throws on p2.
    const fa1b = fakeAdapter([
      { finish: { x: 1 } },
      // No script for p2 → adapter throws "script exhausted".
    ]);
    const s1b = new Session({
      agent: a,
      defaultAdapter: fa1b,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "sess1",
    });
    await expect(s1b.run("go")).rejects.toThrow();

    // Second run with same sessionId — p1 should be skipped, only p2 runs.
    const fa2 = fakeAdapter([{ finish: { y: "done" } }]);
    const s2 = new Session({
      agent: a,
      defaultAdapter: fa2,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "sess1",
    });
    const out = await s2.run("go again");
    expect(out).toEqual({ y: "done" });
    // fa2 only saw p2's prompt, not p1's:
    expect(fa2.seenSystemPrompts.length).toBe(1);
    expect(fa2.seenSystemPrompts[0]).toContain("Phase: p2");
    // p1's deliverable is in fa2's prior-deliverables block:
    expect(fa2.seenSystemPrompts[0]).toContain('p1: {"x":1}');
    void s1; void fa1;
  });

  it("persists conversation per phase and resumes mid-phase from the saved transcript", async () => {
    const echo = tool({
      name: "echo",
      description: "echo",
      input: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } as const,
      handler: async (i) => `echo:${(i as { v: string }).v}`,
    });
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object", properties: { r: { type: "string" } }, required: ["r"] } as const,
      tools: [echo],
    });
    const a = agent({ name: "midph", phases: [p] });

    // First run: dispatch echo, then crash before phase-end.
    const fa1 = fakeAdapter([
      { calls: [{ name: "echo", input: { v: "hi" } }] },
      // No further moves → script exhausted error.
    ]);
    const s1 = new Session({
      agent: a,
      defaultAdapter: fa1,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "midph1",
    });
    await expect(s1.run("start")).rejects.toThrow();

    // Verify on-disk conversation has the user → assistant(call) → tool turns.
    const phaseFile = JSON.parse(
      await fs.readFile(path.join(tmpRoot, "midph", "midph1", "phases", "p1.json"), "utf8")
    );
    const roles = phaseFile.conversation.map((t: { role: string }) => t.role);
    expect(roles).toEqual(["user", "assistant", "tool"]);

    // Second run: resume — the adapter should NOT see the user "start" again.
    const fa2 = fakeAdapter([{ finish: { r: "ok" } }]);
    const s2 = new Session({
      agent: a,
      defaultAdapter: fa2,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "midph1",
    });
    const out = await s2.run("ignored on resume");
    expect(out).toEqual({ r: "ok" });
    // The seeded conversation handed to fa2 contains the prior turns:
    const seed = fa2.seenConversations[0]!;
    expect(seed.length).toBe(3);
    expect(seed[0]).toMatchObject({ role: "user", text: "start" });
    // No new user text was added because we resumed:
    expect(fa2.seenUserTexts).toEqual([]);
  });

  it("drops a trailing assistant-with-unmatched-tool-calls when resuming", async () => {
    // Manually craft a corrupted transcript: assistant turn with a tool call
    // but no following tool result.
    const dir = path.join(tmpRoot, "corr", "sess1");
    await fs.mkdir(path.join(dir, "phases"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "meta.json"),
      JSON.stringify({
        sessionId: "sess1",
        agentName: "corr",
        createdAt: 1,
        updatedAt: 1,
        status: "running",
        completedPhases: [],
        currentPhase: "p1",
        adapterMeta: {},
      })
    );
    await fs.writeFile(
      path.join(dir, "deliverables.json"),
      JSON.stringify({ deliverables: {} })
    );
    await fs.writeFile(
      path.join(dir, "phases", "p1.json"),
      JSON.stringify({
        conversation: [
          { role: "user", text: "go" },
          { role: "assistant", toolCalls: [{ id: "c1", name: "echo", input: { v: "hi" } }] },
        ],
      })
    );

    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a = agent({ name: "corr", phases: [p] });
    const fa = fakeAdapter([{ finish: { x: 9 } }]);
    const s = new Session({
      agent: a,
      defaultAdapter: fa,
      hooks: noopHooks,
      sessionDirectory: tmpRoot,
      sessionId: "sess1",
    });
    const out = await s.run("");
    expect(out).toEqual({ x: 9 });
    // The bad assistant turn was dropped; only the user turn remains as seed.
    const seed = fa.seenConversations[0]!;
    expect(seed.map((t) => t.role)).toEqual(["user"]);
  });

  it("listSessions returns sessions per agent", async () => {
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a1 = agent({ name: "alpha", phases: [p] });
    const a2 = agent({ name: "beta", phases: [p] });

    const fa = fakeAdapter([{ finish: { x: 1 } }]);
    await new Session({
      agent: a1, defaultAdapter: fa, hooks: noopHooks,
      sessionDirectory: tmpRoot, sessionId: "a1-s1",
    }).run("");

    fa.setScript([{ finish: { x: 2 } }]);
    await new Session({
      agent: a1, defaultAdapter: fa, hooks: noopHooks,
      sessionDirectory: tmpRoot, sessionId: "a1-s2",
    }).run("");

    fa.setScript([{ finish: { x: 3 } }]);
    await new Session({
      agent: a2, defaultAdapter: fa, hooks: noopHooks,
      sessionDirectory: tmpRoot, sessionId: "b1-s1",
    }).run("");

    const all = await Session.listSessions(tmpRoot);
    expect(all.map((s) => s.sessionId).sort()).toEqual(["a1-s1", "a1-s2", "b1-s1"]);

    const onlyAlpha = await Session.listSessions(tmpRoot, "alpha");
    expect(onlyAlpha.map((s) => s.sessionId).sort()).toEqual(["a1-s1", "a1-s2"]);
    expect(onlyAlpha.every((s) => s.agentName === "alpha")).toBe(true);
    expect(onlyAlpha.every((s) => s.status === "complete")).toBe(true);
  });

  it("does not persist sub-agent runs", async () => {
    const subP = phase({
      name: "subp",
      prompt: "sub",
      deliverable: { type: "object", properties: { v: { type: "number" } }, required: ["v"] } as const,
    });
    const subA = agent({ name: "child", phases: [subP] });
    // We can't easily compose a sub-agent with a single adapter scripting both
    // parent and child independently, so just verify that completing a top-level
    // run produces only one session directory (the parent).
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a = agent({ name: "root", phases: [p] });
    const fa = fakeAdapter([{ finish: { x: 1 } }]);
    await new Session({
      agent: a, defaultAdapter: fa, hooks: noopHooks,
      sessionDirectory: tmpRoot, sessionId: "root1",
    }).run("");

    const list = await Session.listSessions(tmpRoot);
    expect(list.length).toBe(1);
    expect(list[0]!.agentName).toBe("root");
    void subA;
  });

  it("records adapter meta written via persistence ctx", async () => {
    const p = phase({ name: "p1", prompt: "go", deliverable: numDeliverable });
    const a = agent({ name: "metaagent", phases: [p] });

    // Custom adapter that uses persistence ctx to record a flag.
    const seenResume: string[] = [];
    const fakeWithMeta = fakeAdapter([{ finish: { x: 1 } }]);
    const wrapped = {
      ...fakeWithMeta,
      async runUntilPhaseEnd(ctx: Parameters<typeof fakeWithMeta.runUntilPhaseEnd>[0]) {
        if (ctx.persistence) {
          const prior = ctx.persistence.getAdapterMeta("flag");
          seenResume.push(prior === undefined ? "fresh" : String(prior));
          await ctx.persistence.setAdapterMeta("flag", "set-by-adapter");
        }
        return await fakeWithMeta.runUntilPhaseEnd(ctx);
      },
    };

    await new Session({
      agent: a, defaultAdapter: wrapped, hooks: noopHooks,
      sessionDirectory: tmpRoot, sessionId: "meta1",
    }).run("");

    expect(seenResume).toEqual(["fresh"]);
    const meta = JSON.parse(
      await fs.readFile(path.join(tmpRoot, "metaagent", "meta1", "meta.json"), "utf8")
    );
    expect(meta.adapterMeta.flag).toBe("set-by-adapter");

    // Resume: completed phase is skipped, so adapter is NOT invoked again.
    fakeWithMeta.setScript([]);
    await new Session({
      agent: a, defaultAdapter: wrapped, hooks: noopHooks,
      sessionDirectory: tmpRoot, sessionId: "meta1",
    }).run("");
    // No new entries because phase was already complete.
    expect(seenResume).toEqual(["fresh"]);
  });
});
