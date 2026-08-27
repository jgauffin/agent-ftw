// The child half of the path-equality fixture.
//
// It lives in its own module because that is how the repo's own examples are
// written, and because addressing `lead>implementer` has to work when the
// declaration is only reachable through a relative import.

import { agent, phase } from "../../../../src/declare/index.js";

export const implementer = agent({
  name: "implementer",
  phases: [
    phase({
      name: "implement",
      prompt: "Implement what the plan asks for.",
      deliverable: {
        type: "object",
        properties: { diff: { type: "string", description: "The change, as a unified diff." } },
        required: ["diff"],
      } as const,
    }),
  ],
});
