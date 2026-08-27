/**
 * The tree view's geometry.
 *
 * Layout is the one part of the panel a jsdom render cannot judge: the DOM
 * says an element exists, not that two boxes are sitting on top of each other.
 * These assert the shape directly, against trees the runner really projects.
 */

import { describe, expect, it } from "vitest";
import { agent, phase, subAgent, tool } from "../../src/declare/index.js";
import * as lib from "../../src/index.js";
import type { AgentLib } from "../src/runner/lib.js";
import { project } from "../src/runner/project.js";
import type { AgentNode } from "../src/protocol.js";
import { layout, type LayoutBox } from "../src/webview/graph-layout.js";

const AGENT_LIB = lib as unknown as AgentLib;

const deliverable = {
  type: "object",
  properties: { answer: { type: "string", description: "The answer." } },
  required: ["answer"],
} as const;

const taskInput = {
  type: "object",
  properties: { task: { type: "string", description: "What to do." } },
  required: ["task"],
} as const;

function leaf(name: string) {
  return agent({ name, phases: [phase({ name: "work", prompt: "Do the work.", deliverable })] });
}

function call(name: string, child: ReturnType<typeof leaf>) {
  return subAgent({ name, description: `Call ${name}.`, input: taskInput, agent: child });
}

function tree(decl: unknown): AgentNode {
  return project(AGENT_LIB, decl, 3).tree;
}

/** Two children on one phase, so fan-out and phase-level edges are both covered. */
const fanOut = tree(
  agent({
    name: "lead",
    phases: [
      phase({ name: "plan", prompt: "Plan it.", deliverable }),
      phase({
        name: "deliver",
        prompt: "Hand it out.",
        deliverable,
        tools: [call("call_implementer", leaf("implementer")), call("call_reviewer", leaf("reviewer"))],
      }),
    ],
  })
);

/** An agent-wide sub-agent, which the compiler exposes on every phase as well. */
const agentWide = tree(
  agent({
    name: "newsroom",
    tools: [call("research", leaf("researcher"))],
    phases: [
      phase({ name: "write", prompt: "Write it.", deliverable }),
      phase({ name: "edit", prompt: "Edit it.", deliverable }),
    ],
  })
);

const threeDeep = tree(
  agent({
    name: "top",
    phases: [
      phase({
        name: "go",
        prompt: "Go.",
        deliverable,
        tools: [
          call(
            "call_middle",
            agent({
              name: "middle",
              phases: [
                phase({ name: "step", prompt: "Step.", deliverable, tools: [call("call_bottom", leaf("bottom"))] }),
              ],
            })
          ),
        ],
      }),
    ],
  })
);

function agents(boxes: readonly LayoutBox[]): LayoutBox[] {
  return boxes.filter((b) => b.kind === "agent");
}

function overlaps(a: LayoutBox, b: LayoutBox): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe("every agent in the tree gets a box, and no two of them collide", () => {
  it("draws one box per agent and one row per phase", () => {
    const { boxes } = layout(fanOut);

    expect(agents(boxes).map((b) => b.path)).toEqual(["lead", "lead>implementer", "lead>reviewer"]);
    expect(boxes.filter((b) => b.kind === "phase").map((b) => b.path)).toContain("lead/deliver");
  });

  it("keeps sibling agents apart, which is the whole job of the layout", () => {
    for (const root of [fanOut, agentWide, threeDeep]) {
      const boxes = agents(layout(root).boxes);
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(overlaps(boxes[i]!, boxes[j]!), `${boxes[i]!.path} overlaps ${boxes[j]!.path}`).toBe(false);
        }
      }
    }
  });

  it("keeps each phase row inside the agent box it belongs to", () => {
    const { boxes } = layout(fanOut);
    const byPath = new Map(boxes.map((b) => [b.path, b]));

    for (const row of boxes.filter((b) => b.kind === "phase")) {
      const parent = byPath.get(row.parent)!;
      expect(parent).toBeDefined();
      expect(row.x).toBeGreaterThanOrEqual(parent.x);
      expect(row.y).toBeGreaterThanOrEqual(parent.y);
      expect(row.x + row.width).toBeLessThanOrEqual(parent.x + parent.width);
      expect(row.y + row.height).toBeLessThanOrEqual(parent.y + parent.height);
    }
  });

  it("puts a deeper agent further along than its parent", () => {
    const byPath = new Map(layout(threeDeep).boxes.map((b) => [b.path, b]));
    const top = byPath.get("top")!;
    const middle = byPath.get("top>middle")!;
    const bottom = byPath.get("top>middle>bottom")!;

    expect(middle.x).toBeGreaterThan(top.x);
    expect(bottom.x).toBeGreaterThan(middle.x);
  });
});

describe("an edge stands for one declaration, and comes from where it was declared", () => {
  it("leaves the phase that declares the sub-agent", () => {
    const { edges } = layout(fanOut);
    expect(edges.map((e) => [e.from, e.to])).toEqual([
      ["lead/deliver", "lead>implementer"],
      ["lead/deliver", "lead>reviewer"],
    ]);
  });

  it("leaves the agent, once, when the sub-agent is agent-wide", () => {
    // The compiler exposes an agent-level tool on every phase, so drawing an
    // edge per phase would claim two declarations where the author wrote one.
    const { boxes, edges } = layout(agentWide);

    expect(edges.map((e) => [e.from, e.to])).toEqual([["newsroom", "newsroom>researcher"]]);
    expect(agents(boxes).filter((b) => b.path === "newsroom>researcher")).toHaveLength(1);
  });

  it("gives every edge a path the browser can draw", () => {
    for (const root of [fanOut, agentWide, threeDeep]) {
      for (const edge of layout(root).edges) {
        expect(edge.d).toMatch(/^M[\d.]+ [\d.]+ C/);
      }
    }
  });
});

describe("the drawing fits the canvas it declares", () => {
  it("keeps every box inside the viewBox", () => {
    for (const root of [fanOut, agentWide, threeDeep]) {
      const result = layout(root);
      expect(result.viewBox).toBe(`0 0 ${result.width} ${result.height}`);
      for (const box of result.boxes) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(result.width);
        expect(box.y + box.height).toBeLessThanOrEqual(result.height);
      }
    }
  });

  it("lays the same tree out the same way twice", () => {
    // The panel re-renders on every trace event. A layout that drifted between
    // renders would make the diagram twitch for the whole run.
    expect(layout(fanOut)).toEqual(layout(fanOut));
  });
});

describe("a tool that changes things is called out where the authority sits", () => {
  it("marks the agent that holds a mutating tool", () => {
    const writer = agent({
      name: "writer",
      tools: [
        tool({
          name: "writeSource",
          description: "Write a file.",
          input: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } as const,
          mutates: true,
          handler: async () => "ok",
        }),
      ],
      phases: [phase({ name: "work", prompt: "Work.", deliverable })],
    });

    const box = layout(tree(writer)).boxes.find((b) => b.path === "writer")!;
    expect(box.mutates).toBe(true);
    expect(layout(fanOut).boxes.find((b) => b.path === "lead")!.mutates).toBe(false);
  });
});
