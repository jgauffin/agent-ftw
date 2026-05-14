// 02 — One phase + one custom tool.
//
// `tool()` declares a function the model can invoke during the phase. The
// framework validates the model's input against `input` (JSON schema) before
// calling the handler, so the handler can trust the shape — though it receives
// `unknown` and must narrow.
//
// Run with:  npx tsx examples/02-agent-with-tool.ts

import { agent, phase, tool } from "../src/declare/index.js";
import { Session } from "../src/runtime/session.js";
import { makeAdapter, makeHooks } from "./shared.js";

const lookupCity = tool({
  name: "lookup_city",
  description: "Returns latitude and longitude for a city name.",
  input: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
  } as const,
  handler: async (input) => {
    const { city } = input as { city: string };
    const db: Record<string, { lat: number; lon: number }> = {
      Stockholm: { lat: 59.33, lon: 18.07 },
      Tokyo:     { lat: 35.68, lon: 139.69 },
      Paris:     { lat: 48.86, lon: 2.35 },
    };
    return db[city] ?? { error: `unknown city: ${city}` };
  },
});

const lookupPhase = phase({
  name: "geocode",
  prompt: "Look up the user's city and return its coordinates.",
  tools: [lookupCity],
  deliverable: {
    type: "object",
    properties: {
      city: { type: "string" },
      lat: { type: "number" },
      lon: { type: "number" },
    },
    required: ["city", "lat", "lon"],
  } as const,
});

const geocoder = agent({
  name: "geocoder",
  phases: [lookupPhase],
});

async function main(): Promise<void> {
  const session = new Session({
    agent: geocoder,
    defaultAdapter: makeAdapter(),
    hooks: makeHooks(),
  });
  try {
    const result = await session.run("I live in Tokyo.");
    console.log("\n=== Final ===\n", result);
  } finally {
    await session.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  (globalThis as { process?: { exit?: (n: number) => void } }).process?.exit?.(1);
});
