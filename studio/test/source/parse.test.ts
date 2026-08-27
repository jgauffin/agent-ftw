import { describe, expect, it } from "vitest";
import { SourceSet, candidatePaths, countUses, mapReader, parseFile, resolveIdentifier } from "../../src/source/parse.js";

async function setOf(files: Record<string, string>): Promise<SourceSet> {
  return new SourceSet(mapReader(files));
}

async function resolve(files: Record<string, string>, entry: string, identifier: string) {
  const set = await setOf(files);
  const from = (await set.load(entry))!;
  return resolveIdentifier(set, from, identifier);
}

describe("a name is followed to the declaration it stands for", () => {
  it("finds a const declared in the same file", async () => {
    const outcome = await resolve(
      { "/p/a.ts": `const draft = phase({ name: "draft" });\nexport const planner = agent({ phases: [draft] });\n` },
      "/p/a.ts",
      "draft"
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.target.crossFile).toBe(false);
    expect(outcome.target.initializer.getText()).toContain('name: "draft"');
  });

  it("follows a relative import into the module that exports the name", async () => {
    const outcome = await resolve(
      {
        "/p/lead.ts": `import { implementer } from "./implementer.js";\nexport const lead = agent({ tools: [implementer] });\n`,
        "/p/implementer.ts": `export const implementer = agent({ name: "implementer" });\n`,
      },
      "/p/lead.ts",
      "implementer"
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.target.file.file).toBe("/p/implementer.ts");
    expect(outcome.target.crossFile).toBe(true);
  });

  it("looks for the exported name rather than the local one when the import is aliased", async () => {
    const outcome = await resolve(
      {
        "/p/lead.ts": `import { implementer as worker } from "./team.js";\nconst lead = agent({ tools: [worker] });\n`,
        "/p/team.ts": `export const implementer = agent({ name: "implementer" });\n`,
      },
      "/p/lead.ts",
      "worker"
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.target.identifier).toBe("implementer");
  });

  it("follows a re-export through a barrel module", async () => {
    const outcome = await resolve(
      {
        "/p/lead.ts": `import { implementer } from "./team/index.js";\nconst lead = agent({ tools: [implementer] });\n`,
        "/p/team/index.ts": `export { implementer } from "./implementer.js";\n`,
        "/p/team/implementer.ts": `export const implementer = agent({ name: "implementer" });\n`,
      },
      "/p/lead.ts",
      "implementer"
    );

    expect(outcome.kind).toBe("found");
    if (outcome.kind !== "found") return;
    expect(outcome.target.file.file).toBe("/p/team/implementer.ts");
  });

  it("stops at a package specifier rather than guessing where the package lives", async () => {
    const outcome = await resolve(
      { "/p/a.ts": `import { phase } from "agent-ftw";\nconst x = phase({});\n` },
      "/p/a.ts",
      "phase"
    );

    expect(outcome).toEqual({ kind: "external", specifier: "agent-ftw" });
  });

  it("reports a missing module rather than throwing", async () => {
    const outcome = await resolve(
      { "/p/a.ts": `import { gone } from "./nowhere.js";\nconst x = agent({ tools: [gone] });\n` },
      "/p/a.ts",
      "gone"
    );

    expect(outcome.kind).toBe("not-found");
  });

  it("reports a name nothing declares rather than throwing", async () => {
    const outcome = await resolve({ "/p/a.ts": `const x = 1;\n` }, "/p/a.ts", "missing");
    expect(outcome.kind).toBe("not-found");
  });

  it("refuses a cycle rather than following it forever", async () => {
    const outcome = await resolve(
      {
        "/p/a.ts": `export { thing } from "./b.js";\n`,
        "/p/b.ts": `export { thing } from "./a.js";\n`,
      },
      "/p/a.ts",
      "thing"
    );

    expect(outcome.kind).toBe("not-found");
  });
});

describe("a relative specifier is tried in the order this repo writes them", () => {
  it("swaps .js for .ts, because the source says .js and the file on disk is .ts", () => {
    expect(candidatePaths("/p/lead.ts", "./tools.js")).toEqual([
      "/p/tools.js",
      "/p/tools.ts",
      "/p/tools.js.ts",
      "/p/tools.js/index.ts",
      "/p/tools.js.tsx",
    ]);
  });

  it("appends .ts and then /index.ts for an extensionless specifier", () => {
    expect(candidatePaths("/p/lead.ts", "../team/worker")).toEqual([
      "/team/worker",
      "/team/worker.ts",
      "/team/worker/index.ts",
      "/team/worker.tsx",
    ]);
  });
});

describe("a value referred to more than once is shared", () => {
  const source = `const schema = { type: "object" } as const;
const a = phase({ name: "a", deliverable: schema });
const b = phase({ name: "b", deliverable: schema });
`;

  it("counts every declaration that mentions the name", () => {
    expect(countUses(parseFile("/p/a.ts", { text: source, version: 0 }).ast, "schema")).toBe(2);
  });

  it("does not count the declaration itself as a use", () => {
    const only = `const schema = { type: "object" } as const;\nconst a = phase({ deliverable: schema });\n`;
    expect(countUses(parseFile("/p/a.ts", { text: only, version: 0 }).ast, "schema")).toBe(1);
  });

  it("does not count a property whose key happens to match the name", () => {
    const keyed = `const description = "x";\nconst a = tool({ description: "unrelated" });\n`;
    expect(countUses(parseFile("/p/a.ts", { text: keyed, version: 0 }).ast, "description")).toBe(0);
  });
});

describe("a file is read once per resolution pass", () => {
  it("reports the version its text was taken at, so a stale edit can be refused", async () => {
    let reads = 0;
    const set = new SourceSet(async () => {
      reads++;
      return { text: "const x = 1;\n", version: 7 };
    });

    const first = await set.load("/p/a.ts");
    const second = await set.load("/p/a.ts");

    expect(reads).toBe(1);
    expect(first).toBe(second);
    expect(first!.version).toBe(7);
  });
});
