import { describe, it, expect, beforeAll } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agent, phase } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import type { Hooks } from "../src/hooks/index.js";
import { discoverRuntime, type DiscoveredRuntime } from "./_fixtures/runtime.js";

const noopHooks: Hooks = {
  askUser: async () => ({ selected: [] }),
};

let runtime: DiscoveredRuntime | null = null;

beforeAll(async () => {
  runtime = await discoverRuntime();
});

describe.skipIf(process.env.AGENT_PIPELINE_SKIP_INTEGRATION === "1")(
  "integration: session persistence",
  () => {
    it("persists deliverable, lists session, and skips completed phases on resume", async () => {
      if (!runtime) return;

      const sessionDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "agent-fw-int-"));
      const sessionId = "int-session-1";

      const p = phase({
        name: "echo",
        prompt:
          "Reply by calling the phase-end tool with payload { greeting: 'hello' }. Do not call any other tool.",
        deliverable: {
          type: "object",
          properties: { greeting: { type: "string" } },
          required: ["greeting"],
        } as const,
      });
      const a = agent({ name: "persist_smoke", phases: [p] });

      // First run — real model, persisted.
      const s1 = new Session({
        agent: a,
        defaultAdapter: runtime.adapter,
        hooks: noopHooks,
        sessionDirectory,
        sessionId,
      });
      const out1 = (await s1.run("Please greet me.")) as { greeting: string };
      expect(typeof out1.greeting).toBe("string");
      expect(out1.greeting.length).toBeGreaterThan(0);

      // listSessions sees it.
      const listed = await Session.listSessions(sessionDirectory);
      expect(listed.map((x) => x.sessionId)).toContain(sessionId);
      const info = listed.find((x) => x.sessionId === sessionId)!;
      expect(info.agentName).toBe("persist_smoke");
      expect(info.status).toBe("complete");
      expect(info.completedPhases).toEqual(["echo"]);

      // Second run with the same sessionId — phase is already complete on disk,
      // so the model is NOT consulted. The recorded deliverable comes back.
      const baseAdapter = runtime.adapter;
      let modelInvocations = 0;
      const wrapped = {
        ...baseAdapter,
        async runUntilPhaseEnd(...args: Parameters<typeof baseAdapter.runUntilPhaseEnd>) {
          modelInvocations++;
          return await baseAdapter.runUntilPhaseEnd(...args);
        },
      };
      const s2 = new Session({
        agent: a,
        defaultAdapter: wrapped,
        hooks: noopHooks,
        sessionDirectory,
        sessionId,
      });
      const out2 = (await s2.run("ignored on resume")) as { greeting: string };
      expect(out2).toEqual(out1);
      expect(modelInvocations).toBe(0);
    });
  }
);
