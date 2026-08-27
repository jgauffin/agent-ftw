// Two phases, so a pin on the first has something to skip.
//
// The adapter's script is one move long on purpose: if the pinned phase were
// run after all, the script would be exhausted and the run would fail loudly
// rather than quietly costing a turn.

import { agent, phase } from "../../../src/declare/index.js";
import { fakeAdapter } from "../../../test/_fixtures/fake-adapter.js";

const deliverable = {
  type: "object",
  properties: { text: { type: "string", description: "Anything." } },
  required: ["text"],
} as const;

export const adapter = fakeAdapter([{ finish: { text: "refined" } }]);

export const planner = agent({
  name: "pinnable",
  phases: [
    phase({ name: "brainstorm", prompt: "Think of something.", deliverable }),
    phase({ name: "refine", prompt: "Improve it.", deliverable }),
  ],
});
