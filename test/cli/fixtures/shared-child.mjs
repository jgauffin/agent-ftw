// Two exported agents that both reach the same sub-agent. Linting either one
// walks into the child, so its findings would otherwise be printed twice.
const undescribed = {
  type: "object",
  // No description, and no phase prompt mentions it: one lint finding, in the child.
  properties: { note: { type: "string" } },
  required: ["note"],
};

const child = {
  kind: "agent",
  name: "shared_child",
  tools: [],
  phases: [{ kind: "phase", name: "work", prompt: "Do the work.", deliverable: undescribed, tools: [] }],
};

const callChild = {
  kind: "subAgent",
  name: "call_child",
  description: "Hand the work to the child.",
  input: { type: "object", properties: {}, required: [] },
  agent: child,
};

const described = {
  type: "object",
  properties: { summary: { type: "string", description: "One line about what happened." } },
  required: ["summary"],
};

export const first = {
  kind: "agent",
  name: "first_parent",
  tools: [callChild],
  phases: [{ kind: "phase", name: "one", prompt: "Do the first thing.", deliverable: described, tools: [] }],
};

export const second = {
  kind: "agent",
  name: "second_parent",
  tools: [callChild],
  phases: [{ kind: "phase", name: "two", prompt: "Do the second thing.", deliverable: described, tools: [] }],
};
