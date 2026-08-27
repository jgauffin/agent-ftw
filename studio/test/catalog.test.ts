/**
 * What the assignment picker is allowed to offer.
 *
 * The enumeration itself needs the editor and is tested by using it; deciding
 * what counts as a tool, and which of them can be reached from a given file,
 * does not.
 */

import { describe, expect, it } from "vitest";
import type { CatalogTool } from "../src/protocol.js";
import { offerableIn, unreachable } from "../src/catalog.js";
import { mightDeclareATool, scanFile } from "../src/catalog-scan.js";

const TOOLS = "/p/tools.ts";

const SOURCE = `import { tool, subAgent } from "agent-ftw";
import { helper } from "./helper.js";

export const readSource = tool({
  name: "readSource",
  description: "Read a file.",
  input: { type: "object", properties: {} } as const,
  handler: async () => "",
});

export const writeSource = tool({
  name: "writeSource",
  description: "Write a file.",
  input: { type: "object", properties: {} } as const,
  mutates: true,
  handler: async () => "",
});

const scratch = tool({
  name: "scratch",
  description: "Only this module uses it.",
  input: { type: "object", properties: {} } as const,
  handler: async () => "",
});
`;

describe("a file's tool declarations are found without running it", () => {
  it("reports the identifier and the declared name, which are not the same thing", () => {
    const found = scanFile(TOOLS, SOURCE);
    // `delegable: ["readSource"]` does not compile; `delegable: [readSource]` does.
    expect(found.map((t) => [t.identifier, t.name])).toEqual([
      ["readSource", "readSource"],
      ["writeSource", "writeSource"],
      ["scratch", "scratch"],
    ]);
  });

  it("carries whether a tool changes anything, which decides who may hold it", () => {
    const found = scanFile(TOOLS, SOURCE);
    expect(found.find((t) => t.name === "writeSource")?.mutates).toBe(true);
    expect(found.find((t) => t.name === "readSource")?.mutates).toBe(false);
  });

  it("marks a tool the module keeps to itself", () => {
    expect(scanFile(TOOLS, SOURCE).find((t) => t.name === "scratch")?.exported).toBe(false);
  });

  it("skips a file that declares nothing, before parsing it", () => {
    const plain = "export const answer = 42;\n";
    expect(mightDeclareATool(plain)).toBe(false);
    expect(scanFile("/p/plain.ts", plain)).toEqual([]);
  });
});

describe("only what a file can actually import is offered", () => {
  const catalog = scanFile(TOOLS, SOURCE);

  it("offers an exported tool anywhere", () => {
    expect(offerableIn(catalog, "/p/agents.ts").map((t) => t.name)).toEqual(["readSource", "writeSource"]);
  });

  it("offers a module-private tool only inside its own file, where it needs no import", () => {
    expect(offerableIn(catalog, TOOLS).map((t) => t.name)).toContain("scratch");
  });
});

describe("a tool nothing can call is worth saying out loud", () => {
  it("reports what the tree cannot reach", () => {
    const catalog: readonly CatalogTool[] = scanFile(TOOLS, SOURCE);
    // The projected tree only holds tools reachable from a phase, so a
    // declaration wired to nothing never appears in it.
    expect(unreachable(catalog, new Set(["readSource"])).map((t) => t.name)).toEqual(["writeSource", "scratch"]);
  });
});
