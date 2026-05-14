import { describe, it, expect } from "vitest";
import { agent, phase } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";
import type { Adapter } from "../../src/adapters/types.js";

const noopHooks: Hooks = { askUser: async () => ({ selected: [] }) };

describe("Session.fork (feature A)", () => {
  it("seed=\"deliverable\" hands the parent's last phase deliverable to the fork", async () => {
    const a = agent({
      name: "a",      phases: [
        phase({
          name: "p",
          prompt: "x",
          deliverable: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } as const,
        }),
      ],
    });

    const parentFa = fakeAdapter([{ finish: { v: "parent-out" } }]);
    const parent = new Session({ agent: a, defaultAdapter: parentFa, hooks: noopHooks });
    const parentResult = await parent.run("seed-input");
    expect(parentResult).toEqual({ v: "parent-out" });

    const forkFa = fakeAdapter([{ finish: { v: "fork-out" } }]);
    const { session: child, seed } = await parent.fork({ seed: "deliverable" });
    // fork() reuses the parent's defaultAdapter, so to run the child with a
    // fresh script we rebuild a Session with a new adapter.
    const childRebuilt = new Session({ agent: a, defaultAdapter: forkFa, hooks: noopHooks });
    const childResult = await childRebuilt.run(seed);
    expect(seed).toEqual({ v: "parent-out" });
    expect(childResult).toEqual({ v: "fork-out" });
    // The fork's first phase saw the parent deliverable JSON as user text.
    expect(forkFa.seenUserTexts[0]).toContain("parent-out");
    void child;
  });

  it("seed=\"deliverable\" before any phase has finished throws a clear error", async () => {
    const a = agent({
      name: "a",      phases: [phase({ name: "p", prompt: "x", deliverable: { type: "object" } as const })],
    });
    const s = new Session({
      agent: a,
      defaultAdapter: fakeAdapter([{ finish: {} }]),
      hooks: noopHooks,
    });
    await expect(s.fork({ seed: "deliverable" })).rejects.toThrow(/before any phase completed/);
  });

  it("seed=\"summarize\" invokes the localModel adapter's runStructured", async () => {
    const a = agent({
      name: "a",      phases: [
        phase({
          name: "p",
          prompt: "x",
          deliverable: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } as const,
        }),
      ],
    });

    const parentFa = fakeAdapter([{ finish: { v: "done" } }]);

    // The default adapter drives the phase loop AND the summarize call. Wrap a
    // fakeAdapter for the loop and capture the structured-call text ourselves.
    const summaryCalls: unknown[] = [];
    const composite: Adapter = {
      runUntilPhaseEnd: (ctx) => parentFa.runUntilPhaseEnd(ctx),
      async runStructured(args) {
        summaryCalls.push(args.userText);
        return { summary: "compressed", carryOver: { foo: "bar" } };
      },
    };

    const parent = new Session({
      agent: a,
      defaultAdapter: composite,
      hooks: noopHooks,
    });
    await parent.run("");

    const { seed } = await parent.fork({ seed: "summarize", summarizeInstructions: "be terse" });
    expect(seed).toEqual({ summary: "compressed", carryOver: { foo: "bar" } });
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0]).toContain("be terse");
    expect(summaryCalls[0]).toContain("done"); // last deliverable referenced
  });

  it("emits a fork.created trace event with parent and child session ids", async () => {
    const a = agent({
      name: "a",      phases: [
        phase({
          name: "p",
          prompt: "x",
          deliverable: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } as const,
        }),
      ],
    });
    const events: TraceEvent[] = [];
    const parent = new Session({
      agent: a,
      defaultAdapter: fakeAdapter([{ finish: { v: "done" } }]),
      hooks: { ...noopHooks, trace: (e) => events.push(e) },
    });
    await parent.run("");
    const fork = await parent.fork({ seed: "deliverable" });
    const fk = events.find((e) => e.type === "fork.created");
    expect(fk).toBeTruthy();
    if (fk && fk.type === "fork.created") {
      expect(fk.parentSessionId).toBe(parent.id);
      expect(fk.childSessionId).toBe(fork.session.id);
      expect(fk.seed).toBe("deliverable");
    }
  });

  it("forked Session has an independent AbortController", async () => {
    const a = agent({
      name: "a",      phases: [
        phase({ name: "p", prompt: "x", deliverable: { type: "object", properties: { v: { type: "string" } }, required: ["v"] } as const }),
      ],
    });
    const parent = new Session({
      agent: a,
      defaultAdapter: fakeAdapter([{ finish: { v: "done" } }]),
      hooks: noopHooks,
    });
    await parent.run("");
    const { session: child } = await parent.fork({ seed: "deliverable" });

    parent.cancel("done");
    expect(parent.signal.aborted).toBe(true);
    expect(child.signal.aborted).toBe(false);

    child.cancel("child-done");
    expect(child.signal.aborted).toBe(true);
  });
});
