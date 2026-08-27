import { describe, expect, it } from "vitest";
import * as ts from "typescript";
import { agent, phase } from "../../../src/declare/index.js";
import { lint } from "../../../src/lint/index.js";
import { parseFile } from "../../src/source/parse.js";
import {
  DEFAULT_STYLE,
  type AgentDraft,
  type PhaseDraft,
  emitAgent,
  emitBoolean,
  emitImport,
  emitNumber,
  emitPhase,
  emitSchema,
  emitString,
  emitSubAgent,
  scaffoldAgent,
  scaffoldDeliverable,
  styleOf,
} from "../../src/source/emit.js";

const NARROW = { ...DEFAULT_STYLE, width: 40 };

describe("a string is written the way the file already writes strings", () => {
  it("uses the quote the file mostly uses", () => {
    const single = parseFile("/p/a.ts", { text: `const a = 'x'; const b = 'y'; const c = "z";\n`, version: 0 });

    expect(styleOf(single).quote).toBe("'");
  });

  it("escapes a newline rather than reaching for a template literal", () => {
    // A template literal changes what the surrounding code means if it is later
    // edited by hand.
    expect(emitString("one\ntwo")).toBe('"one\\ntwo"');
  });

  it("escapes the quote it is wrapped in, and backslashes", () => {
    expect(emitString('say "hi" \\ now')).toBe('"say \\"hi\\" \\\\ now"');
  });

  it("keeps a short string on one line", () => {
    expect(emitString("Draft it.", NARROW)).toBe('"Draft it."');
  });

  it("wraps a long string into the + chain this repo already writes prompts as", () => {
    const value = "Produce three distinct project ideas, each with a title and a one-line pitch.";
    const emitted = emitString(value, NARROW, "  ");

    expect(emitted).toContain(' +\n  "');
    expect(joined(emitted)).toBe(value);
  });

  it("keeps every character across a wrap, so nothing is lost at a line break", () => {
    const value = "a ".repeat(80).trim();
    expect(joined(emitString(value, NARROW, "    "))).toBe(value);
  });

  it("writes a word longer than the line rather than breaking it", () => {
    const value = "x".repeat(80);
    expect(joined(emitString(value, NARROW))).toBe(value);
  });
});

describe("numbers and booleans go in directly", () => {
  it("writes a negative budget as written", () => {
    expect(emitNumber(-3)).toBe("-3");
    expect(emitBoolean(true)).toBe("true");
  });

  it("refuses a value that is not a number rather than writing NaN into the file", () => {
    expect(() => emitNumber(Number.NaN)).toThrow();
  });
});

describe("a schema is written as TypeScript, not as JSON", () => {
  it("leaves identifier keys unquoted", () => {
    const emitted = emitSchema({ type: "object", properties: { title: { type: "string" } } }, NARROW);

    expect(emitted).toContain("type: ");
    expect(emitted).not.toContain('"type":');
  });

  it("quotes a key that is not an identifier", () => {
    expect(emitSchema({ "not-an-identifier": 1 })).toBe('{ "not-an-identifier": 1 }');
  });

  it("restores `as const`, without which the deliverable's inferred type collapses", () => {
    expect(emitSchema({ type: "object" }, DEFAULT_STYLE, { asConst: true })).toBe('{ type: "object" } as const');
  });

  it("indents relative to where the property sits", () => {
    const emitted = emitSchema({ type: "object", properties: { a: { type: "string" }, b: { type: "string" } } }, NARROW, {
      indent: "    ",
    });

    expect(emitted.split("\n")[1]).toMatch(/^ {6}type: /);
    expect(emitted.endsWith("    }")).toBe(true);
  });

  it("writes an empty object and an empty array without a line break", () => {
    expect(emitSchema({ properties: {}, required: [] })).toBe("{ properties: {}, required: [] }");
  });
});

describe("an emitted declaration is valid TypeScript", () => {
  const emitted: readonly [string, string][] = [
    ["phase", `const p = ${emitPhase({ name: "draft", prompt: "Draft it.", deliverable: scaffoldDeliverable() })};`],
    [
      "subAgent",
      `const s = ${emitSubAgent({
        name: "call_implementer",
        description: "Hand one step to the implementer.",
        input: scaffoldDeliverable("step"),
        agent: "implementer",
      })};`,
    ],
    ["agent", `const a = ${emitAgent(scaffoldAgent("planner"))};`],
    ["import", emitImport("./tools.js", ["search", "writeFile"])],
  ];

  it.each(emitted)("%s parses with no syntactic diagnostics", (_kind, text) => {
    expect(syntaxErrors(text)).toEqual([]);
  });

  it("refuses an agent with no phases, because `validate` would throw on it", () => {
    expect(() => emitAgent({ name: "empty", phases: [] })).toThrow(/at least one phase/);
  });
});

describe("a scaffold is clean the moment it is written", () => {
  it("produces no lint findings, so the studio's own Problems panel stays quiet", () => {
    const draft = scaffoldAgent("planner");

    expect(lint(asDecl(draft))).toEqual([]);
  });

  it("gives every free-form string a description, which is what lint asks for", () => {
    const schema = scaffoldDeliverable("summary") as { properties: Record<string, { description?: string }> };

    expect(schema.properties["summary"]!.description).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------

/** The concatenation an emitted `+` chain stands for. */
function joined(emitted: string): string {
  const source = parseFile("/p/a.ts", { text: `const x = ${emitted};\n`, version: 0 });
  const statement = source.ast.statements[0] as ts.VariableStatement;
  const initializer = statement.declarationList.declarations[0]!.initializer!;

  const read = (node: ts.Expression): string => {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isBinaryExpression(node)) return read(node.left) + read(node.right);
    throw new Error(`Unexpected ${ts.SyntaxKind[node.kind]}`);
  };
  return read(initializer);
}

function syntaxErrors(text: string): readonly string[] {
  const file = ts.createSourceFile("/p/emitted.ts", text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  return (file as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, " ")
  );
}

/** The same draft, built through the real factories, so `lint` can see it. */
function asDecl(draft: AgentDraft) {
  return agent({
    name: draft.name,
    phases: draft.phases.map((p: PhaseDraft) =>
      phase({
        name: p.name,
        prompt: p.prompt,
        deliverable: p.deliverable as never,
        ...(p.turnBudget !== undefined ? { turnBudget: p.turnBudget } : {}),
      })
    ),
  });
}
