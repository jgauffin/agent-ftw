// The parent half of the path-equality fixture.
//
// Between them these two files exercise every way the projection reaches a
// node: a phase written inline, a phase held in a const, a sub-agent reached
// through a phase's `tools`, and a child agent that only a relative import
// makes visible.

import { agent, phase, subAgent } from "../../../../src/declare/index.js";
import { implementer } from "./implementer.js";

const plan = phase({
  name: "plan",
  prompt: "Decide what to change.",
  deliverable: {
    type: "object",
    properties: { steps: { type: "array", items: { type: "string", description: "One step." } } },
    required: ["steps"],
  } as const,
});

const callImplementer = subAgent({
  name: "call_implementer",
  description: "Hand one step to the implementer.",
  input: {
    type: "object",
    properties: { step: { type: "string", description: "The step to implement." } },
    required: ["step"],
  } as const,
  agent: implementer,
});

export const lead = agent({
  name: "lead",
  phases: [
    plan,
    phase({
      name: "deliver",
      prompt: "Summarise what was implemented.",
      tools: [callImplementer],
      deliverable: {
        type: "object",
        properties: { summary: { type: "string", description: "What changed, in one paragraph." } },
        required: ["summary"],
      } as const,
    }),
  ],
});
