/**
 * @vitest-environment jsdom
 *
 * What the panel shows while a run is still going.
 *
 * A phase that is waiting on a model emits nothing for as long as the model
 * takes to answer, which on a local 27b is tens of seconds. Everything the
 * panel knows during that window it has to have rendered already, so these
 * assert the mid-run frames rather than the final one.
 */

import { describe, expect, it } from "vitest";
import { compileTemplate } from "@relax.js/core/html";
import { agent, phase } from "../../src/declare/index.js";
import * as lib from "../../src/index.js";
import type { AgentLib } from "../src/runner/lib.js";
import { project } from "../src/runner/project.js";
import type { StudioState, TraceEnvelope } from "../src/protocol.js";
import { RunModel } from "../src/run-model.js";
import { TEMPLATE } from "../src/webview/template.js";
import { buildContext } from "../src/webview/view-model.js";

const AGENT_LIB = lib as unknown as AgentLib;

const deliverable = {
  type: "object",
  properties: { text: { type: "string", description: "Anything." } },
  required: ["text"],
} as const;

const planner = agent({
  name: "planner",
  phases: [
    phase({ name: "brainstorm", prompt: "Think.", deliverable }),
    phase({ name: "pick_best", prompt: "Choose.", deliverable }),
  ],
});

function runningState(): StudioState {
  const { tree, findings } = project(AGENT_LIB, planner, 3);
  return {
    file: "/tmp/planner.ts",
    agents: [{ exportName: "planner", agentName: "planner", phaseCount: 2 }],
    selectedExport: "planner",
    tree,
    findings,
    selectedPath: null,
    status: "running",
    error: null,
    pending: null,
    output: undefined,
    pins: [],
    locks: {},
    edits: [],
    editError: null,
    catalog: [],
    tab: "run",
  };
}

/** Events are stamped at 1000, so `now` is a fixed offset from that. */
const NOW = 1000 + 12_300;

function render(model: RunModel, now = NOW): HTMLElement {
  const host = document.createElement("div");
  const tpl = compileTemplate(TEMPLATE);
  host.appendChild(tpl.content);
  tpl.render(buildContext(runningState(), model, null, "text", now) as never, {} as never);
  return host;
}

function envelope(type: string, fields: Record<string, unknown> = {}): TraceEnvelope {
  const { runId, agent: a, phase: p, ...detail } = fields;
  return {
    type,
    ts: 1000,
    ...(typeof runId === "string" ? { runId } : {}),
    ...(typeof a === "string" ? { agent: a } : {}),
    ...(typeof p === "string" ? { phase: p } : {}),
    detail,
  };
}

/** Everything the framework emits before the first model response comes back. */
function waitingOnFirstModelCall(): RunModel {
  const model = new RunModel();
  model.apply(envelope("agent.start", { runId: "root", agent: "planner", parentRunId: null, input: "go" }));
  model.apply(envelope("phase.start", { runId: "root", agent: "planner", phase: "brainstorm" }));
  return model;
}

describe("a run that has started but produced nothing yet is still visible", () => {
  it("shows the agent and the phase in the timeline", () => {
    const host = render(waitingOnFirstModelCall());
    const labels = [...host.querySelectorAll(".timeline .events .label")].map((n) => n.textContent);

    expect(labels).toEqual(["planner", "brainstorm"]);
    expect(host.querySelector(".timeline .hint")).toBeNull();
  });

  it("marks the phase as running rather than leaving it looking finished", () => {
    const host = render(waitingOnFirstModelCall());
    const phaseRow = [...host.querySelectorAll(".timeline .events li")].at(-1)!;

    expect(phaseRow.className).toContain("running");
    expect(phaseRow.querySelector(".marker")!.className).toContain("running");
  });

  it("says what it is waiting for, not just how little it has done", () => {
    // "0 turns" on a phase that has been waiting twenty seconds reads as a
    // panel that has stopped working.
    const host = render(waitingOnFirstModelCall());
    const detail = [...host.querySelectorAll(".timeline .events .note")].at(-1)!.textContent ?? "";

    expect(detail).toContain("waiting for the model");
  });

  it("shows a clock, since it is the only thing that moves between model turns", () => {
    const model = waitingOnFirstModelCall();
    expect([...render(model, 1000 + 3_000).querySelectorAll(".timeline .events .note")].at(-1)!.textContent).toContain(
      "3.0s"
    );
    expect([...render(model, 1000 + 9_500).querySelectorAll(".timeline .events .note")].at(-1)!.textContent).toContain(
      "9.5s"
    );
  });

  it("lights the same phase up on the map", () => {
    // The timeline says what is happening; the map says where. A run that only
    // showed in one of them would leave the other looking stale.
    const host = render(waitingOnFirstModelCall());
    const running = [...host.querySelectorAll(".map .phase")].filter((n) =>
      n.getAttribute("class")?.includes("running")
    );

    expect(running.map((n) => n.querySelector(".node-name")?.textContent)).toEqual(["brainstorm"]);
  });
});

describe("progress between model turns is visible", () => {
  it("counts turns as they arrive rather than only at the end", () => {
    const model = waitingOnFirstModelCall();
    model.apply(envelope("model.turn", { runId: "root", agent: "planner", phase: "brainstorm", turn: {} }));

    const detail = [...render(model).querySelectorAll(".timeline .events .note")].at(-1)!.textContent ?? "";
    expect(detail).toContain("1 turn ");
    expect(detail).not.toContain("1 turns");

    model.apply(envelope("model.turn", { runId: "root", agent: "planner", phase: "brainstorm", turn: {} }));
    expect([...render(model).querySelectorAll(".timeline .events .note")].at(-1)!.textContent).toContain("2 turns");
  });

  it("shows a tool call while its result is still outstanding", () => {
    const model = waitingOnFirstModelCall();
    model.apply(
      envelope("tool.call", { runId: "root", agent: "planner", phase: "brainstorm", tool: "search", callId: "1" })
    );

    const detail = [...render(model).querySelectorAll(".timeline .events .note")].at(-1)!.textContent ?? "";
    expect(detail).toContain("search");
  });
});
