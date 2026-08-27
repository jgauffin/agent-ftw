/**
 * What a file's exports amount to.
 *
 * A file that declares a coordinator exports its children too, so the studio
 * has to tell "three trees" from "one tree exported three times". Getting that
 * wrong shows an empty panel for a file that plainly has a tree in it.
 */

import { describe, expect, it } from "vitest";
import * as lib from "../../src/index.js";
import type { AgentLib } from "../src/runner/lib.js";
import { discover } from "../src/runner/discover.js";
import { openable } from "../src/agent-choice.js";

const AGENT_LIB = lib as unknown as AgentLib;
const COORDINATOR = new URL("../../examples/08-coordinator.ts", import.meta.url).pathname.replace(/^\//, "");

describe("the exports of the repo's own coordinator example", () => {
  it("reports which agents another export contracts", async () => {
    const found = await discover(AGENT_LIB, COORDINATOR, 3);
    const byExport = new Map(found.agents.map((a) => [a.exportName, a]));

    expect([...byExport.keys()].sort()).toEqual(["implementer", "lead", "reviewer"]);
    expect(byExport.get("implementer")?.containedBy).toBe("lead");
    expect(byExport.get("reviewer")?.containedBy).toBe("lead");
    // Nothing contracts the coordinator, which is what makes it the whole tree.
    expect(byExport.get("lead")?.containedBy).toBeUndefined();
  });

  it("opens on the coordinator rather than asking which of three was meant", async () => {
    const found = await discover(AGENT_LIB, COORDINATOR, 3);
    expect(openable(found.agents)?.exportName).toBe("lead");
  });

  it("finds the adapter the file exports, so no model is substituted", async () => {
    const found = await discover(AGENT_LIB, COORDINATOR, 3);
    expect(found.adapter).not.toBeNull();
  });
});
