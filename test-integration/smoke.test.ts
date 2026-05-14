import { describe, it, expect, beforeAll } from "vitest";
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
  if (runtime) {
    // Give visibility into which backend is exercising the integration suite.
    // eslint-disable-next-line no-console
    console.log(`[integration] using ${runtime.describe}`);
  }
});

describe.skipIf(process.env.AGENT_PIPELINE_SKIP_INTEGRATION === "1")(
  "integration: phase loop end-to-end",
  () => {
    it.runIf(true)("returns a structured deliverable from a real model", async () => {
      if (!runtime) {
        // No Claude CLI on PATH and no Ollama reachable. Skip rather than fail —
        // CI without either provider is a valid configuration.
        return;
      }

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
      const a = agent({
        name: "smoke",
        phases: [p],
      });
      const session = new Session({
        agent: a,
        defaultAdapter: runtime.adapter,
        hooks: noopHooks,
      });

      const out = (await session.run("Please greet me.")) as { greeting: string };
      expect(typeof out.greeting).toBe("string");
      expect(out.greeting.length).toBeGreaterThan(0);
    });
  }
);
