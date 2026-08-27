/**
 * @vitest-environment jsdom
 *
 * The panel before it has a tree to show.
 *
 * Every other render test hands the panel a projected tree, which is the state
 * it reaches second. The state it opens in has none, and a panel that renders
 * nothing at all there reads as a broken extension rather than as a question
 * waiting to be answered.
 */

import { describe, expect, it } from "vitest";
import { compileTemplate } from "@relax.js/core/html";
import type { DiscoveredAgent, StudioState } from "../src/protocol.js";
import { RunModel } from "../src/run-model.js";
import { TEMPLATE } from "../src/webview/template.js";
import { buildContext } from "../src/webview/view-model.js";
import { openable } from "../src/agent-choice.js";

function state(patch: Partial<StudioState> = {}): StudioState {
  return {
    file: null,
    agents: [],
    selectedExport: null,
    tree: null,
    findings: [],
    selectedPath: null,
    status: "idle",
    error: null,
    pending: null,
    output: undefined,
    pins: [],
    locks: {},
    edits: [],
    editError: null,
    catalog: [],
    tab: "settings",
    ...patch,
  };
}

function renderPanel(s: StudioState): HTMLElement {
  const host = document.createElement("div");
  const tpl = compileTemplate(TEMPLATE);
  host.appendChild(tpl.content);
  tpl.render(buildContext(s, new RunModel(), null) as never, {} as never);
  return host;
}

/** The three exports of `examples/08-coordinator.ts`, as discovery reports them. */
const COORDINATOR_FILE: readonly DiscoveredAgent[] = [
  { exportName: "implementer", agentName: "implementer", phaseCount: 1, containedBy: "lead" },
  { exportName: "reviewer", agentName: "reviewer", phaseCount: 1, containedBy: "lead" },
  { exportName: "lead", agentName: "lead", phaseCount: 1 },
];

describe("a file that exports a coordinator and its children opens on the whole tree", () => {
  it("picks the agent nothing else contracts", () => {
    // Three exports are one tree seen from three places, not three trees. The
    // panel used to refuse to choose and show nothing at all.
    expect(openable(COORDINATOR_FILE)?.exportName).toBe("lead");
  });

  it("still opens a file with a single agent", () => {
    expect(openable([{ exportName: "greeter", agentName: "greeter", phaseCount: 1 }])?.exportName).toBe("greeter");
  });

  it("waits when a file really does hold two unrelated trees", () => {
    // Two things nothing contains is a genuine question, and guessing between
    // them would show the wrong one half the time.
    expect(
      openable([
        { exportName: "triager", agentName: "triager", phaseCount: 1 },
        { exportName: "publisher", agentName: "publisher", phaseCount: 1 },
      ])
    ).toBeNull();
  });

  it("waits when a file exports nothing", () => {
    expect(openable([])).toBeNull();
  });
});

describe("the panel says what it is waiting for rather than going blank", () => {
  it("renders before anything has been inspected", () => {
    const host = renderPanel(state());
    expect(host.querySelector(".studio")).not.toBeNull();
    expect(host.querySelector(".status-controls")).not.toBeNull();
  });

  it("asks which tree to show when a file holds more than one", () => {
    const host = renderPanel(
      state({
        agents: [
          { exportName: "triager", agentName: "triager", phaseCount: 1 },
          { exportName: "publisher", agentName: "publisher", phaseCount: 1 },
        ],
      })
    );

    expect(host.querySelector(".map .hint")?.textContent).toContain("Agent");
    // The picker it points at has to actually be there.
    expect(host.querySelector(".agent-picker select")).not.toBeNull();
  });

  it("says which agent contracts a sub-agent, so the list reads as one tree", () => {
    const host = renderPanel(state({ agents: COORDINATOR_FILE }));
    const options = [...host.querySelectorAll(".agent-picker option")].map((o) => o.textContent);

    expect(options).toContain("implementer (a sub-agent of lead)");
    expect(options).toContain("lead");
  });
});
