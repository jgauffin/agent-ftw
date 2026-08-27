// Plain JavaScript, and the declarations written out by hand: this is what the
// CLI meets when it is pointed at compiled output rather than source, and it
// keeps the loader test honest about not depending on a TypeScript pipeline.
const deliverable = {
  type: "object",
  properties: { summary: { type: "string", description: "One line about what happened." } },
  required: ["summary"],
};

export const first = {
  kind: "agent",
  name: "first_agent",
  tools: [],
  phases: [{ kind: "phase", name: "one", prompt: "Do the first thing.", deliverable, tools: [] }],
};

export const second = {
  kind: "agent",
  name: "second_agent",
  tools: [],
  phases: [{ kind: "phase", name: "two", prompt: "Do the second thing.", deliverable, tools: [] }],
};

// Not an agent; the CLI must ignore it rather than trip over it.
export const helper = { kind: "tool", name: "not_an_agent" };
