/**
 * The source layer, run over code nobody wrote for it.
 *
 * The fixtures elsewhere in this suite were written to exercise particular
 * shapes, which makes them a poor answer to "does this work on real files".
 * `examples/` is real: it is the code the README points at and the studio is
 * demonstrated against, and if an address does not resolve there the addressing
 * model is wrong regardless of what the fixtures say.
 */

import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SourceSet, normalize, type SourceReader } from "../../src/source/parse.js";
import { bind, projectedPaths } from "../../src/source/locate.js";
import { inventory } from "../../src/source/inventory.js";

const EXAMPLES = normalize(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "examples"));

const reader: SourceReader = async (file) => {
  try {
    return { text: await fs.readFile(file, "utf8"), version: 0 };
  } catch {
    return null;
  }
};

const files = (await fs.readdir(EXAMPLES))
  .filter((name) => name.endsWith(".ts") && name !== "shared.ts")
  .map((name) => `${EXAMPLES}/${name}`);

describe("every agent in examples/ is addressable", () => {
  it.each(files)("%s resolves each declared agent to at least its own path", async (file) => {
    const set = new SourceSet(reader);
    const loaded = (await set.load(file))!;
    const agents = inventory(loaded).declarations.filter((d) => d.kind === "agent" && d.name !== "");
    expect(agents.length).toBeGreaterThan(0);

    for (const declared of agents) {
      const paths = await projectedPaths(set, file, declared.name);
      expect(paths).toContain(declared.name);
    }
  });

  it.each(files)("%s reads back the prompt of every phase it declares", async (file) => {
    const set = new SourceSet(reader);
    const loaded = (await set.load(file))!;
    const agents = inventory(loaded).declarations.filter((d) => d.kind === "agent" && d.name !== "");

    for (const declared of agents) {
      const phases = (await projectedPaths(set, file, declared.name)).filter((p) => p.includes("/"));
      // Without this the loop below would pass by never running.
      expect(phases.length).toBeGreaterThan(0);

      for (const phasePath of phases) {
        const result = await bind(set, file, { path: phasePath, construct: "phase", field: "prompt" });
        // Locked is a legitimate answer; ambiguous is not. Ambiguous means the
        // path the panel shows names something this layer cannot find.
        expect({ phasePath, kind: result.binding.kind }).not.toMatchObject({ kind: "ambiguous" });
      }
    }
  });
});
