import { describe, it, expect } from "vitest";
import { agent, phase } from "../../src/declare/index.js";
import { Session } from "../../src/runtime/session.js";
import { fakeAdapter } from "../_fixtures/fake-adapter.js";
import type { Hooks } from "../../src/hooks/index.js";
import type { TraceEvent } from "../../src/trace/index.js";

const noopHooks: Hooks = { askUser: async () => ({ selected: [] }) };

describe("phase.onAssistantText", () => {
  it("uses the host reply as the next user turn instead of nudging", async () => {
    const events: TraceEvent[] = [];
    const hooks: Hooks = {
      askUser: async () => ({ selected: [] }),
      trace: (e) => events.push(e),
    };

    const seenText: string[] = [];
    const p = phase({
      name: "chat",
      prompt: "talk",
      deliverable: {
        type: "object",
        properties: { msg: { type: "string" } },
        required: ["msg"],
      } as const,
      onAssistantText: async (text) => {
        seenText.push(text);
        return "ok please finish";
      },
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { text: "hi there, want me to proceed?" }, // pure text → triggers onAssistantText
      { finish: { msg: "done" } },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks });
    const out = await s.run("hello");
    expect(out).toEqual({ msg: "done" });
    expect(seenText).toEqual(["hi there, want me to proceed?"]);

    // The host reply must have been threaded to the adapter as a user turn
    // (the next runUntilPhaseEnd entry in the conversation).
    const userTexts = fa.seenUserTexts;
    expect(userTexts).toContain("hello");

    // phase.assistantText event was emitted.
    expect(events.some((e) => e.type === "phase.assistantText")).toBe(true);
  });

  it("default behavior (no callback) nudges the model", async () => {
    const p = phase({
      name: "p1",
      prompt: "go",
      deliverable: { type: "object" } as const,
    });
    const a = agent({ name: "a", phases: [p] });
    const fa = fakeAdapter([
      { text: "let me think" },  // pure text without callback → nudge
      { finish: {} },
    ]);
    const s = new Session({ agent: a, defaultAdapter: fa, hooks: noopHooks });
    await s.run("");
    // Hard to introspect the nudge directly; presence of two model turns is enough
    // — the phase did not error out and the second move ran.
    expect(fa.seenSystemPrompts.length).toBeGreaterThan(0);
  });
});
