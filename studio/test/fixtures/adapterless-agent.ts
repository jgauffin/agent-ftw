// An agent that declares no adapter and whose module exports none either.
// The studio refuses to run this rather than reaching for a model of its own.

import { agent, phase } from "../../../src/declare/index.js";

export const stranded = agent({
  name: "stranded",
  phases: [
    phase({
      name: "nowhere",
      prompt: "This phase has no model to run against.",
      deliverable: {
        type: "object",
        properties: { answer: { type: "string", description: "Anything." } },
        required: ["answer"],
      } as const,
    }),
  ],
});
