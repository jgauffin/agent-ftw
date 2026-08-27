// A file the CLI is pointed at. Exported, because a declaration in a local
// variable is invisible to everything but this file.
import { agent, phase, tool } from "../../../src/index.js";

const lookup = tool({
  name: "lookup_report",
  description: "Read the bug report.",
  input: {
    type: "object",
    properties: { id: { type: "string", description: "The report id." } },
    required: ["id"],
  } as const,
  handler: async () => "a PNG upload returns 500",
});

export const triager = agent({
  name: "bug_triager",
  tools: [lookup],
  phases: [
    phase({
      name: "triage",
      prompt: "Read the report, then classify it by severity and area.",
      deliverable: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["low", "medium", "high"] },
          area: { type: "string", enum: ["api", "ui", "db"] },
          // No description and never named in the prompt: lint has something to say.
          note: { type: "string" },
        },
        required: ["severity", "area", "note"],
      } as const,
      turnBudget: 6,
    }),
  ],
});
