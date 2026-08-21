import { describe, it, expect } from "vitest";
import { agent, phase, tool, subAgent } from "../../src/declare/index.js";
import { validate, CompileError } from "../../src/compile/index.js";
import type { AgentDecl, ToolDecl } from "../../src/declare/index.js";

const readFile = tool({
  name: "readFile",
  description: "read a file",
  input: { type: "object" } as const,
  handler: async () => "contents",
});

const editFile = tool({
  name: "editFile",
  description: "edit a file",
  input: { type: "object" } as const,
  mutates: true,
  handler: async () => "written",
});

const okPhase = phase({ name: "p", prompt: "go", deliverable: { type: "object" } as const });

function worker(name: string, tools: readonly ToolDecl[]): AgentDecl {
  return agent({ name, phases: [phase({ ...okPhase, name: "w", tools })] });
}

/** A parent that calls `child` as a sub-agent, handing down `delegable`. */
function parentOf(child: AgentDecl, opts: { delegable?: readonly ToolDecl[]; role?: "coordinator" | "worker"; tools?: readonly ToolDecl[] } = {}): AgentDecl {
  return agent({
    name: "parent",
    ...(opts.role !== undefined ? { role: opts.role } : {}),
    ...(opts.delegable !== undefined ? { delegable: opts.delegable } : {}),
    phases: [
      phase({
        name: "p",
        prompt: "go",
        deliverable: { type: "object" } as const,
        tools: [
          ...(opts.tools ?? []),
          subAgent({
            name: "callChild",
            description: "delegate",
            input: { type: "object" } as const,
            agent: child,
          }),
        ],
      }),
    ],
  });
}

describe("authority", () => {
  it("refuses a sub-agent tool the parent never handed down", () => {
    const a = parentOf(worker("child", [editFile]));
    expect(() => validate(a)).toThrow(/does not list in `delegable`/);
  });

  it("accepts a sub-agent tool the parent handed down", () => {
    const a = parentOf(worker("child", [editFile]), { delegable: [editFile] });
    expect(() => validate(a)).not.toThrow();
  });

  it("lets a coordinator delegate authority it does not hold itself", () => {
    // The point of splitting `tools` from `delegable`: the coordinator cannot
    // edit anything, but the leaf it directs can.
    const a = parentOf(worker("child", [editFile]), {
      role: "coordinator",
      tools: [readFile],
      delegable: [editFile],
    });
    expect(() => validate(a)).not.toThrow();
  });

  it("refuses a coordinator that holds a mutating tool itself", () => {
    const a = parentOf(worker("child", []), { role: "coordinator", tools: [editFile] });
    expect(() => validate(a)).toThrow(/holds mutating tool/);
  });

  it("allows a worker to hold a mutating tool", () => {
    expect(() => validate(worker("w", [editFile]))).not.toThrow();
  });

  it("narrows authority at every level rather than only the first", () => {
    // grandchild wants editFile; child hands down only readFile.
    const grandchild = worker("grandchild", [editFile]);
    const child = agent({
      name: "child",
      delegable: [readFile],
      phases: [
        phase({
          name: "c",
          prompt: "go",
          deliverable: { type: "object" } as const,
          tools: [
            subAgent({
              name: "callGrandchild",
              description: "delegate",
              input: { type: "object" } as const,
              agent: grandchild,
            }),
          ],
        }),
      ],
    });
    const root = parentOf(child, { delegable: [readFile, editFile] });
    expect(() => validate(root)).toThrow(/"grandchild" declares tool "editFile"/);
  });
});

describe("depth limit", () => {
  function chain(levels: number): AgentDecl {
    let node = agent({ name: `level${levels}`, phases: [{ ...okPhase }] });
    for (let i = levels - 1; i >= 0; i--) {
      node = agent({
        name: `level${i}`,
        phases: [
          phase({
            name: "p",
            prompt: "go",
            deliverable: { type: "object" } as const,
            tools: [
              subAgent({
                name: "down",
                description: "delegate",
                input: { type: "object" } as const,
                agent: node,
              }),
            ],
          }),
        ],
      });
    }
    return node;
  }

  it("accepts a tree within the depth limit", () => {
    // Depths 0, 1, 2 under the default limit of 3.
    expect(() => validate(chain(2))).not.toThrow();
  });

  it("refuses a tree deeper than the limit", () => {
    expect(() => validate(chain(3))).toThrow(CompileError);
    expect(() => validate(chain(3))).toThrow(/past the limit/);
  });

  it("honours a raised limit", () => {
    expect(() => validate(chain(3), { maxDepth: 4 })).not.toThrow();
  });

  it("honours a lowered limit", () => {
    expect(() => validate(chain(1), { maxDepth: 1 })).toThrow(/past the limit/);
  });
});
