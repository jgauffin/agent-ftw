import { describe, expect, it } from "vitest";
import { parseFile } from "../../src/source/parse.js";
import { inventory } from "../../src/source/inventory.js";

function scan(source: string) {
  return inventory(parseFile("/p/agents.ts", { text: source, version: 0 }));
}

const SOURCE = `import { agent, phase, subAgent, tool } from "agent-ftw";
import type { AgentDecl } from "agent-ftw";
import * as node from "node:path";

const search = tool({
  name: "search",
  description: "Search the knowledge base.",
  input: {},
  handler: async () => "ok",
});

export const writeFile = tool({
  name: "write_file",
  description: "Write a file.",
  input: {},
  mutates: true,
  handler: async () => "ok",
});

const unreachable = tool({ name: "orphan", description: "Nothing calls this.", input: {}, handler: async () => 1 });

export const planner = agent({
  name: "planner",
  phases: [phase({ name: "draft", prompt: "p", deliverable: {}, tools: [search] })],
});
`;

describe("one scan answers what a file declares", () => {
  it("resolves a declared name to the identifier an edit has to write", () => {
    const search = scan(SOURCE).declarations.find((d) => d.name === "search");

    // `delegable: [search]` compiles; `delegable: ["search"]` does not.
    expect(search?.identifier).toBe("search");
  });

  it("records which declarations the file exports", () => {
    const byIdentifier = new Map(scan(SOURCE).declarations.map((d) => [d.identifier, d]));

    expect(byIdentifier.get("planner")?.exported).toBe(true);
    expect(byIdentifier.get("search")?.exported).toBe(false);
  });

  it("carries the mutating flag, which decides whether a coordinator may hold the tool", () => {
    const byIdentifier = new Map(scan(SOURCE).declarations.map((d) => [d.identifier, d]));

    expect(byIdentifier.get("writeFile")?.mutates).toBe(true);
    expect(byIdentifier.get("search")?.mutates).toBe(false);
  });

  it("lists a tool nothing is wired to, which the projected tree cannot show", () => {
    const identifiers = scan(SOURCE).declarations.map((d) => d.identifier);

    expect(identifiers).toContain("unreachable");
  });

  it("anchors an insert on the whole statement rather than the call inside it", () => {
    const search = scan(SOURCE).declarations.find((d) => d.identifier === "search")!;

    expect(SOURCE.slice(search.statement.start, search.statement.end).startsWith("const search = tool(")).toBe(true);
    expect(SOURCE.slice(search.call.start, search.call.end).startsWith("{")).toBe(true);
  });

  it("leaves a name that is not a literal blank rather than guessing it", () => {
    const scanned = scan(`import { tool } from "agent-ftw";\nconst t = tool({ name: makeName(), description: "x" });\n`);

    expect(scanned.declarations[0]).toMatchObject({ identifier: "t", name: "", description: "x" });
  });

  it("tells the declaration kinds apart", () => {
    const kinds = new Map(scan(SOURCE).declarations.map((d) => [d.identifier, d.kind]));

    expect(kinds.get("search")).toBe("tool");
    expect(kinds.get("planner")).toBe("agent");
  });
});

describe("one scan answers what a file imports", () => {
  it("marks a named import as extendable, just inside its closing brace", () => {
    const named = scan(SOURCE).imports.find((i) => i.kind === "named")!;

    expect(named.extendAt).not.toBeNull();
    expect(SOURCE.slice(named.extendAt!, named.extendAt! + 1)).toBe("}");
    expect(named.bindings.map((b) => b.local)).toEqual(["agent", "phase", "subAgent", "tool"]);
  });

  it("refuses to extend a namespace import, which has no binding list to add to", () => {
    const namespace = scan(SOURCE).imports.find((i) => i.kind === "namespace")!;

    expect(namespace.extendAt).toBeNull();
    expect(namespace.bindings).toEqual([{ local: "node", imported: "*" }]);
  });

  it("refuses to extend a type-only import, because a value cannot go in one", () => {
    const typeOnly = scan(SOURCE).imports.find((i) => i.kind === "typeOnly")!;

    expect(typeOnly.extendAt).toBeNull();
  });

  it("maps an aliased binding back to the name the other module exports", () => {
    const scanned = scan(`import { phase as step } from "agent-ftw";\n`);

    expect(scanned.imports[0]!.bindings).toEqual([{ local: "step", imported: "phase" }]);
  });
});
