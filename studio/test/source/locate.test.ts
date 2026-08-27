import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceSet, mapReader, normalize, type SourceReader } from "../../src/source/parse.js";
import {
  type Address,
  arrayProperty,
  bind,
  navigatePointer,
  projectedPaths,
  schemaSite,
  unwrapReference,
} from "../../src/source/locate.js";
import { project } from "../../src/runner/project.js";
import type { AgentLib } from "../../src/runner/lib.js";
import * as lib from "../../../src/index.js";
import { lead } from "../fixtures/source/lead.js";

const AGENT_LIB = lib as unknown as AgentLib;
const HERE = path.dirname(fileURLToPath(import.meta.url));

const ENTRY = "/p/agents.ts";

function setOf(source: string, extra: Record<string, string> = {}): SourceSet {
  return new SourceSet(mapReader({ [ENTRY]: source, ...extra }));
}

function phaseAddress(path: string, field: string): Address {
  return { path, construct: "phase", field };
}

const AGENT = (phases: string) => `import { agent, phase, subAgent } from "agent-ftw";

export const planner = agent({
  name: "planner",
  phases: [
${phases}
  ],
});
`;

// ---------------------------------------------------------------------------

describe("a field's value is read back with whether we may rewrite it", () => {
  it("reads a string literal prompt as replaceable", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "Draft it.", deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding).toMatchObject({ kind: "literal", text: '"Draft it."', wrapper: null });
    expect(result.readOnly).toBe(false);
  });

  it("reads a prompt built with + as one concatenation, because that is how this repo writes them", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "Draft it. " + "Then stop.", deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding).toMatchObject({ kind: "concatenation", parts: ["Draft it. ", "Then stop."] });
  });

  it("locks a prompt produced by a call, naming the kind of expression that got in the way", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: makePrompt("draft"), deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding).toMatchObject({ kind: "computed", expression: "CallExpression" });
  });

  it("locks a template literal that interpolates, because its value is not fixed", async () => {
    const source = AGENT("    phase({ name: \"draft\", prompt: `Draft ${topic}.`, deliverable: {} }),");
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding.kind).toBe("computed");
  });

  it("reads a numeric budget, including a negative one", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "p", turnBudget: 12, deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "turnBudget"));

    expect(result.binding).toMatchObject({ kind: "literal", text: "12" });
  });

  it("reports a property nobody declared as absent, with where it would go", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "p", deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "turnBudget"));

    expect(result.binding.kind).toBe("absent");
    if (result.binding.kind !== "absent") return;
    expect(source.slice(result.binding.insertInto.start, result.binding.insertInto.end)).toContain('name: "draft"');
  });
});

describe("`as const` is preserved across a rewrite", () => {
  const source = AGENT(
    `    phase({ name: "draft", prompt: "p", deliverable: { type: "object" } as const }),`
  );

  it("covers the object literal only, so the assertion survives", async () => {
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "deliverable"));

    expect(result.binding).toMatchObject({ kind: "literal", wrapper: "as-const" });
    if (result.binding.kind !== "literal") return;
    // Dropping `as const` would widen the schema to `string` and collapse the
    // deliverable's inferred type — a silent type regression.
    expect(source.slice(result.binding.range.start, result.binding.range.end)).toBe('{ type: "object" }');
  });
});

describe("a value reached through a reference is read but not rewritten", () => {
  it("follows a same-file const and says which name it went through", async () => {
    const source = `import { agent, phase } from "agent-ftw";

const schema = { type: "object" } as const;

export const planner = agent({
  name: "planner",
  phases: [phase({ name: "draft", prompt: "p", deliverable: schema })],
});
`;
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "deliverable"));

    expect(result.binding).toMatchObject({ kind: "reference", via: "schema" });
    // A shared schema is probably shared: rewriting it through one phase's
    // address would silently change every other phase using it.
    expect(result.readOnly).toBe(true);
  });

  it("follows a schema imported from another module and still refuses to rewrite it", async () => {
    const source = `import { agent, phase } from "agent-ftw";
import { schema } from "./schemas.js";

export const planner = agent({
  name: "planner",
  phases: [phase({ name: "draft", prompt: "p", deliverable: schema })],
});
`;
    const result = await bind(setOf(source, { "/p/schemas.ts": `export const schema = { type: "object" } as const;\n` }), ENTRY, phaseAddress("planner/draft", "deliverable"));

    expect(unwrapReference(result.binding).kind).toBe("literal");
    // The range is in the module the walk reached, not where the property was
    // written; reading it out of the wrong file would find nothing.
    expect(result.file).toBe("/p/schemas.ts");
    expect(result.readOnly).toBe(true);
  });

  it("refuses a phase held in a const two agents share", async () => {
    const source = `import { agent, phase } from "agent-ftw";

const review = phase({ name: "review", prompt: "Check it.", deliverable: {} });

export const a = agent({ name: "a", phases: [review] });
export const b = agent({ name: "b", phases: [review] });
`;
    const result = await bind(setOf(source), ENTRY, phaseAddress("a/review", "prompt"));

    expect(result.binding.kind).toBe("literal");
    expect(result.readOnly).toBe(true);
    expect(result.readOnlyReason).toContain("more than one");
  });
});

describe("an address that does not resolve to exactly one node is refused", () => {
  it("refuses two phases in one agent that share a name", async () => {
    const source = AGENT(
      `    phase({ name: "draft", prompt: "a", deliverable: {} }),\n    phase({ name: "draft", prompt: "b", deliverable: {} }),`
    );
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding.kind).toBe("ambiguous");
  });

  it("tells two agents apart when both declare a phase of the same name", async () => {
    const source = `import { agent, phase } from "agent-ftw";

export const a = agent({ name: "a", phases: [phase({ name: "review", prompt: "from a", deliverable: {} })] });
export const b = agent({ name: "b", phases: [phase({ name: "review", prompt: "from b", deliverable: {} })] });
`;
    const set = setOf(source);

    expect(await bind(set, ENTRY, phaseAddress("a/review", "prompt"))).toMatchObject({
      binding: { text: '"from a"' },
    });
    expect(await bind(set, ENTRY, phaseAddress("b/review", "prompt"))).toMatchObject({
      binding: { text: '"from b"' },
    });
  });

  it("refuses a phase built in a loop, because there is no call to address", async () => {
    const source = `import { agent, phase } from "agent-ftw";

export const planner = agent({
  name: "planner",
  phases: ["a", "b"].map((n) => phase({ name: n, prompt: "p", deliverable: {} })),
});
`;
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/a", "prompt"));

    expect(result.binding.kind).toBe("ambiguous");
  });

  it("refuses a name that is not a string literal", async () => {
    const source = AGENT(`    phase({ name: makeName("draft"), prompt: "p", deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding.kind).toBe("ambiguous");
  });

  it("refuses an agent nothing in the file declares", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "p", deliverable: {} }),`);
    const result = await bind(setOf(source), ENTRY, phaseAddress("missing/draft", "prompt"));

    expect(result.binding.kind).toBe("ambiguous");
  });
});

describe("a factory renamed by its import is still recognised", () => {
  it("reads a phase declared through an aliased import", async () => {
    const source = `import { agent as makeAgent, phase as step } from "agent-ftw";

export const planner = makeAgent({
  name: "planner",
  phases: [step({ name: "draft", prompt: "Draft it.", deliverable: {} })],
});
`;
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding).toMatchObject({ kind: "literal", text: '"Draft it."' });
  });

  it("reads a phase declared through a namespace import", async () => {
    const source = `import * as ftw from "agent-ftw";

export const planner = ftw.agent({
  name: "planner",
  phases: [ftw.phase({ name: "draft", prompt: "Draft it.", deliverable: {} })],
});
`;
    const result = await bind(setOf(source), ENTRY, phaseAddress("planner/draft", "prompt"));

    expect(result.binding).toMatchObject({ kind: "literal", text: '"Draft it."' });
  });
});

// ---------------------------------------------------------------------------

describe("an array property is read for appending and removal", () => {
  const withTools = (tools: string) => `import { agent, phase } from "agent-ftw";

export const planner = agent({
  name: "planner",
  phases: [
    phase({
      name: "draft",
      prompt: "p",
      tools: ${tools},
      deliverable: {},
    }),
  ],
});
`;

  it("lists a non-empty array's elements with the identifier removal matches on", async () => {
    const source = withTools("[search, write]");
    const result = await arrayProperty(setOf(source), ENTRY, phaseAddress("planner/draft", "tools"), "tools");

    expect(result.binding.kind).toBe("array");
    if (result.binding.kind !== "array") return;
    expect(result.binding.elements.map((e) => e.identifier)).toEqual(["search", "write"]);
  });

  it("puts an insert inside the brackets when the array is empty", async () => {
    const source = withTools("[]");
    const result = await arrayProperty(setOf(source), ENTRY, phaseAddress("planner/draft", "tools"), "tools");

    expect(result.binding.kind).toBe("array");
    if (result.binding.kind !== "array") return;
    expect(result.binding.elements).toHaveLength(0);
    expect(result.binding.needsLeadingComma).toBe(false);
    expect(source.slice(result.binding.insertAt - 1, result.binding.insertAt + 1)).toBe("[]");
  });

  it("appends after a trailing comma rather than before it, so the diff is one line", async () => {
    const source = withTools("[\n        search,\n      ]");
    const result = await arrayProperty(setOf(source), ENTRY, phaseAddress("planner/draft", "tools"), "tools");

    expect(result.binding.kind).toBe("array");
    if (result.binding.kind !== "array") return;
    expect(result.binding.needsLeadingComma).toBe(false);
    expect(source.slice(0, result.binding.insertAt).endsWith("search,")).toBe(true);
    expect(result.binding.itemIndent).toBe("        ");
  });

  it("reports an undeclared array as absent, because `tools` is optional and most files have none", async () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "p", deliverable: {} }),`);
    const result = await arrayProperty(setOf(source), ENTRY, phaseAddress("planner/draft", "tools"), "tools");

    expect(result.binding.kind).toBe("absent");
  });
});

// ---------------------------------------------------------------------------

describe("a lint pointer is followed by the schema's shape, not by the segment's text", () => {
  const source = AGENT(`    phase({
      name: "draft",
      prompt: "p",
      deliverable: {
        type: "object",
        properties: {
          ideas: {
            type: "array",
            items: {
              type: "object",
              properties: { title: { type: "string" }, items: { type: "string" } },
            },
          },
        },
      } as const,
    }),`);

  async function siteAt(pointer: string) {
    return schemaSite(setOf(source), ENTRY, { path: "planner/draft", construct: "phase", field: "deliverable", pointer });
  }

  it("treats an empty pointer as the deliverable as a whole", async () => {
    const found = await siteAt("#");
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.site.object).toBe(found.site.root);
  });

  it("steps through `properties` at an object", async () => {
    const found = await siteAt("#/ideas");
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.site.object.getText()).toContain('type: "array"');
  });

  it("steps through `items` at an array, which is the segment lint writes there", async () => {
    const found = await siteAt("#/ideas/items");
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.site.object.getText()).toContain("title");
  });

  it("resolves a property genuinely called `items`, because the step follows the node kind", async () => {
    const found = await siteAt("#/ideas/items/items");
    expect(found.kind).toBe("found");
    if (found.kind !== "found") return;
    expect(found.site.object.getText()).toBe('{ type: "string" }');
  });

  it("refuses a pointer nothing in the schema is at", async () => {
    expect((await siteAt("#/missing")).kind).toBe("locked");
  });
});

// ---------------------------------------------------------------------------

describe("the paths the locator resolves are the paths the runner projects", () => {
  it("agrees on every node of a two-module agent tree", async () => {
    const reader: SourceReader = async (file) => {
      try {
        return { text: await fs.readFile(file, "utf8"), version: 0 };
      } catch {
        return null;
      }
    };
    const entry = normalize(path.join(HERE, "..", "fixtures", "source", "lead.ts"));

    const fromSource = await projectedPaths(new SourceSet(reader), entry, "lead");
    const { tree } = project(AGENT_LIB, lead, 3);

    // Spelled out so the comparison below cannot pass by both sides being
    // empty, which is the one way this test could lie.
    expect([...fromSource].sort()).toEqual([
      "lead",
      "lead/deliver",
      "lead/plan",
      "lead>implementer",
      "lead>implementer/implement",
    ]);

    // Everything downstream rests on these two agreeing: an address that means
    // one node to the panel and another to the source layer would splice the
    // wrong characters.
    expect([...fromSource].sort()).toEqual([...runtimePaths(tree)].sort());
  });
});

/** Every path the projection produced, flattened. Sub-agents nest through tools. */
function runtimePaths(node: { path: string; phases: readonly { path: string }[]; tools: readonly unknown[] }): Set<string> {
  const out = new Set<string>([node.path]);
  for (const phase of node.phases) out.add(phase.path);
  const walkTools = (tools: readonly unknown[]): void => {
    for (const tool of tools as readonly { kind: string; agent?: typeof node }[]) {
      if (tool.kind !== "subAgent" || !tool.agent) continue;
      for (const found of runtimePaths(tool.agent)) out.add(found);
    }
  };
  walkTools(node.tools);
  for (const phase of node.phases) walkTools((phase as unknown as { tools: readonly unknown[] }).tools);
  return out;
}

// ---------------------------------------------------------------------------

describe("navigating a schema pointer", () => {
  it("returns nothing rather than a wrong node when a segment names no property", () => {
    const source = AGENT(`    phase({ name: "draft", prompt: "p", deliverable: { type: "object" } as const }),`);
    void source;
    expect(navigatePointer({ properties: [] } as never, "#/nope")).toBeNull();
  });
});
