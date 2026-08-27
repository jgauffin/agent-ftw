import { describe, expect, it } from "vitest";
import { SourceSet, mapReader, type SourceReader } from "../../src/source/parse.js";
import { arrayProperty, bind, resolveAddress, schemaSite, type Address } from "../../src/source/locate.js";
import { inventory } from "../../src/source/inventory.js";
import {
  appendElement,
  applyEdits,
  ensureImport,
  extendNamedImport,
  insertProperty,
  insertStatement,
  ordered,
  removeElement,
  replace,
} from "../../src/source/edit.js";
import { check } from "../../src/source/verify.js";
import { DEFAULT_STYLE, emitString } from "../../src/source/emit.js";
import type { TextEdit } from "../../src/source/text.js";

const ENTRY = "/p/agents.ts";

function readerFor(files: Record<string, string>): SourceReader {
  return mapReader({ ...files });
}

async function load(source: string, extra: Record<string, string> = {}) {
  const reader = readerFor({ [ENTRY]: source, ...extra });
  const set = new SourceSet(reader);
  return { reader, set, file: (await set.load(ENTRY))! };
}

const DRAFT = (body: string) => `import { agent, phase } from "agent-ftw";

export const planner = agent({
  name: "planner",
  phases: [
    phase({
${body}
    }),
  ],
});
`;

const PHASE: Address = { path: "planner/draft", construct: "phase", field: "prompt" };

// ---------------------------------------------------------------------------

describe("replacing a value touches only the value", () => {
  it("leaves every character outside the claimed range alone", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "Draft it.",   // keep this comment\n      deliverable: {},`);
    const { set } = await load(source);
    const binding = (await bind(set, ENTRY, PHASE)).binding;

    const edited = applyEdits(source, replace(ENTRY, binding, '"Rewrite it."'));

    expect(edited).toContain("// keep this comment");
    if (binding.kind !== "literal") throw new Error("expected a literal");
    expect(edited.slice(0, binding.range.start)).toBe(source.slice(0, binding.range.start));
    expect(edited.slice(binding.range.start + '"Rewrite it."'.length)).toBe(source.slice(binding.range.end));
  });

  it("leaves the file byte-identical when the value written back is the value read", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "Draft it.",\n      deliverable: {},`);
    const { set } = await load(source);
    const result = await bind(set, ENTRY, PHASE);
    if (result.binding.kind !== "literal") throw new Error("expected a literal");

    const value = source.slice(result.binding.range.start + 1, result.binding.range.end - 1);
    const rewritten = applyEdits(source, replace(ENTRY, result.binding, emitString(value, DEFAULT_STYLE)));

    // An emitter that quietly reformats would show up here and nowhere else.
    expect(rewritten).toBe(source);
  });

  it("reports the new value back through the locator, so a wrong splice cannot pass silently", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "Draft it.",\n      deliverable: {},`);
    const { reader, set } = await load(source);
    const binding = (await bind(set, ENTRY, PHASE)).binding;
    const edits = replace(ENTRY, binding, '"Rewrite it."');

    expect(await check(reader, ENTRY, edits, PHASE, '"Rewrite it."')).toEqual({ kind: "ok" });
  });

  it("catches a splice that did not land where it was claimed to", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "Draft it.",\n      deliverable: {},`);
    const { reader } = await load(source);
    const wrong: TextEdit[] = [{ file: ENTRY, start: 0, end: 0, newText: "// nothing changed\n" }];

    const verdict = await check(reader, ENTRY, wrong, PHASE, '"Rewrite it."');
    expect(verdict.kind).toBe("mismatch");
  });
});

// ---------------------------------------------------------------------------

describe("inserting a property that is not declared", () => {
  async function insertInto(source: string, name: string, value: string, after?: string) {
    const { set, file } = await load(source);
    const site = await schemaSite(set, ENTRY, {
      path: "planner/draft",
      construct: "phase",
      field: "deliverable",
      pointer: "#",
    });
    if (site.kind !== "found") throw new Error(site.reason);
    return applyEdits(source, insertProperty(file, site.site.object, name, value, after ? { after } : {}));
  }

  it("adds `required` after `properties`, matching the surrounding indentation", async () => {
    const source = DRAFT(`      name: "draft",
      prompt: "p",
      deliverable: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title." },
        },
      } as const,`);

    const edited = await insertInto(source, "required", '["title"]', "properties");

    expect(edited).toContain('        },\n        required: ["title"],\n      } as const');
  });

  it("keeps a one-line object on one line", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "p",\n      deliverable: { type: "object" } as const,`);

    const edited = await insertInto(source, "required", '["title"]');

    expect(edited).toContain('{ type: "object", required: ["title"] }');
  });

  it("fills an empty object rather than leaving a stray comma", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "p",\n      deliverable: {} as const,`);

    const edited = await insertInto(source, "type", '"object"');

    expect(edited).toContain('deliverable: { type: "object" } as const');
  });
});

// ---------------------------------------------------------------------------

describe("appending to an array property", () => {
  const withTools = (tools: string) => DRAFT(`      name: "draft",\n      prompt: "p",\n      tools: ${tools},\n      deliverable: {},`);

  async function append(source: string, element: string) {
    const { set, file } = await load(source);
    const address: Address = { path: "planner/draft", construct: "phase" };
    const binding = (await arrayProperty(set, ENTRY, address, "tools")).binding;
    const resolved = await resolveAddress(set, ENTRY, address);
    if (resolved.kind !== "resolved") throw new Error(resolved.reason);

    const outcome = appendElement(file, resolved.node.object, binding, "tools", element);
    return { outcome, edited: outcome.kind === "edits" ? applyEdits(source, outcome.edits) : source };
  }

  it("matches a multi-line array's indentation and its trailing-comma habit", async () => {
    const { edited } = await append(withTools("[\n        search,\n      ]"), "writeFile");

    expect(edited).toContain("        search,\n        writeFile,\n      ]");
  });

  it("adds the separator a single-line array is missing", async () => {
    const { edited } = await append(withTools("[search]"), "writeFile");

    expect(edited).toContain("tools: [search, writeFile],");
  });

  it("puts the first element inside an empty array", async () => {
    const { edited } = await append(withTools("[]"), "search");

    expect(edited).toContain("tools: [search],");
  });

  it("creates the property when the array is not declared at all", async () => {
    const source = DRAFT(`      name: "draft",\n      prompt: "p",\n      deliverable: {},`);
    const { edited } = await append(source, "search");

    expect(edited).toContain("tools: [search],");
  });

  it("emits nothing when the array already lists the name", async () => {
    const { outcome, edited } = await append(withTools("[search]"), "search");

    expect(outcome.kind).toBe("no-change");
    expect(edited).toBe(withTools("[search]"));
  });
});

describe("removing an element takes its separator with it", () => {
  const withTools = (tools: string) => DRAFT(`      name: "draft",\n      prompt: "p",\n      tools: ${tools},\n      deliverable: {},`);

  async function remove(source: string, identifier: string) {
    const { set, file } = await load(source);
    const binding = (await arrayProperty(set, ENTRY, { path: "planner/draft", construct: "phase" }, "tools")).binding;
    const outcome = removeElement(file, binding, identifier);
    return outcome.kind === "edits" ? applyEdits(source, outcome.edits) : source;
  }

  it("removes a middle element without disturbing its neighbours", async () => {
    expect(await remove(withTools("[a, b, c]"), "b")).toContain("tools: [a, c],");
  });

  it("removes the last element and the comma ahead of it", async () => {
    expect(await remove(withTools("[a, b]"), "b")).toContain("tools: [a],");
  });

  it("removes the only element, leaving an empty array", async () => {
    expect(await remove(withTools("[a]"), "a")).toContain("tools: [],");
  });

  it("removes the first element and the separator after it", async () => {
    expect(await remove(withTools("[a, b]"), "a")).toContain("tools: [b],");
  });

  it("changes nothing when the name is not in the array", async () => {
    const source = withTools("[a]");
    expect(await remove(source, "zzz")).toBe(source);
  });
});

// ---------------------------------------------------------------------------

describe("inserting a statement before the declaration that uses it", () => {
  it("puts a wrapper ahead of its parent, which would otherwise crash at import time", async () => {
    const source = `import { agent } from "agent-ftw";

export const lead = agent({ name: "lead", tools: [callReviewer] });
`;
    const { file } = await load(source);
    const use = source.indexOf("callReviewer");

    const edited = applyEdits(source, insertStatement(file, "const callReviewer = subAgent({});", { beforeStatementContaining: use }));

    expect(edited.indexOf("const callReviewer")).toBeLessThan(edited.indexOf("export const lead"));
  });
});

// ---------------------------------------------------------------------------

describe("imports", () => {
  const source = `import { agent, phase } from "../../src/declare/index.js";
import { search } from "./tools.js";

export const planner = agent({ name: "planner" });
`;

  it("adds a binding to the import that already carries the sibling factories", async () => {
    const { file } = await load(source);
    const outcome = extendNamedImport(file, inventory(file), "subAgent", ["agent", "phase"]);

    expect(outcome.kind).toBe("edits");
    if (outcome.kind !== "edits") return;
    expect(applyEdits(source, outcome.edits)).toContain(
      'import { agent, phase, subAgent } from "../../src/declare/index.js";'
    );
  });

  it("changes nothing when the name is already in scope", async () => {
    const { file } = await load(source);

    expect(extendNamedImport(file, inventory(file), "phase", ["agent"]).kind).toBe("no-change");
  });

  it("refuses rather than inventing a specifier when there is no import to extend", async () => {
    const bare = `import * as ftw from "agent-ftw";\nexport const planner = ftw.agent({ name: "planner" });\n`;
    const { file } = await load(bare);

    const outcome = extendNamedImport(file, inventory(file), "subAgent", ["agent", "phase"]);
    expect(outcome.kind).toBe("refused");
  });

  it("writes a new import statement, copying the file's `.js` habit", async () => {
    const { file } = await load(source);
    const outcome = ensureImport(file, inventory(file), "reviewer", "/p/team/reviewer.ts");

    expect(outcome.kind).toBe("edits");
    if (outcome.kind !== "edits") return;
    expect(applyEdits(source, outcome.edits)).toContain('import { reviewer } from "./team/reviewer.js";');
  });

  it("appends to an existing import when the specifier already matches", async () => {
    const { file } = await load(source);
    const outcome = ensureImport(file, inventory(file), "writeFile", "/p/tools.ts");

    expect(outcome.kind).toBe("edits");
    if (outcome.kind !== "edits") return;
    expect(applyEdits(source, outcome.edits)).toContain('import { search, writeFile } from "./tools.js";');
  });

  it("changes nothing when the name is already imported from that module", async () => {
    const { file } = await load(source);

    expect(ensureImport(file, inventory(file), "search", "/p/tools.ts").kind).toBe("no-change");
  });

  it("refuses rather than aliasing when the name already means something else", async () => {
    const { file } = await load(source);
    const outcome = ensureImport(file, inventory(file), "search", "/p/other.ts");

    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(outcome.reason).toContain("Rename");
  });
});

// ---------------------------------------------------------------------------

describe("edits are ordered and proven not to collide", () => {
  it("refuses a pair that overlaps, because that only ever means a bug", () => {
    const edits: TextEdit[] = [
      { file: ENTRY, start: 0, end: 10, newText: "a" },
      { file: ENTRY, start: 5, end: 12, newText: "b" },
    ];

    expect(() => ordered(edits)).toThrow(/overlap/);
  });

  it("applies several edits to one file as one change", () => {
    const edits: TextEdit[] = [
      { file: ENTRY, start: 6, end: 11, newText: "there" },
      { file: ENTRY, start: 0, end: 5, newText: "howdy" },
    ];

    expect(applyEdits("hello world", edits)).toBe("howdy there");
  });
});
