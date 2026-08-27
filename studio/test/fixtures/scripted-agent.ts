// A fixture the runner imports the way it imports a user's file: an exported
// agent plus an exported adapter, and nothing that runs on import.
//
// The adapter is scripted rather than networked so the end-to-end test is
// deterministic. The script deliberately gets the deliverable wrong once, so
// the run produces the diagnostics the studio exists to show.

import { agent, phase, tool } from "../../../src/declare/index.js";
import { fakeAdapter } from "../../../test/_fixtures/fake-adapter.js";

const consult = tool({
  name: "consult",
  description: "Ask the operator which way to go.",
  input: { type: "object", properties: {} } as const,
  handler: async (_input, ctx) => {
    const answer = await ctx.askUser({ prompt: "Which way?", options: ["left", "right"] });
    return { chose: answer.selected[0] ?? answer.other ?? "nothing" };
  },
});

export const adapter = fakeAdapter([
  { calls: [{ name: "consult", input: {} }] },
  // Missing the required `route`, so the framework rejects it and asks again.
  { finish: { note: "forgot the route" } },
  { finish: { route: "left", note: "asked first" } },
]);

export const navigator = agent({
  name: "navigator",
  tools: [consult],
  phases: [
    phase({
      name: "choose",
      prompt: "Ask which way to go, then commit to a route.",
      deliverable: {
        type: "object",
        properties: {
          route: { type: "string", description: "The route chosen." },
          note: { type: "string", description: "Why." },
        },
        required: ["route"],
      } as const,
      turnBudget: 6,
    }),
  ],
});
