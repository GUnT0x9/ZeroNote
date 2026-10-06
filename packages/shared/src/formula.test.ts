import { describe, expect, it } from "vitest";
import {
  compileFormula,
  assertFormulaNode,
  evaluateFormula,
  FormulaError,
  MAX_FORMULA_LENGTH,
  type FormulaNode,
  type FormulaValue,
} from "./formula";
const properties = [
  { id: "points", name: "점수" },
  { id: "tags", name: "Tags" },
];
const run = (source: string, values: Record<string, FormulaValue> = {}) =>
  evaluateFormula(
    compileFormula(source, properties),
    (id) => values[id] ?? null,
  );

describe("Formula compiler and bounded interpreter", () => {
  it.each([
    ["2 + 3 * 4", 14],
    ["(2 + 3) * 4", 20],
    ["10 - 3 - 2", 5],
    ["-2 * +3", -6],
    ["1e2 + .5", 100.5],
    ["!false && (2 >= 1)", true],
    ['"a" + "b"', "ab"],
    ["7 % 4", 3],
    ["null == null", true],
    ["false != null", true],
    ["2 < 3 || false", true],
    ["4 <= 4 && 5 > 4", true],
  ])("parses and evaluates %s", (source, expected) => {
    expect(run(source as string)).toEqual({ value: expected, error: null });
  });
  it("stores stable property IDs and preserves references through serialization", () => {
    const node = compileFormula('prop("점수") * 2', properties);
    expect(node).toMatchObject({
      left: { type: "property", propertyId: "points" },
    });
    expect(
      evaluateFormula(JSON.parse(JSON.stringify(node)) as FormulaNode, (id) =>
        id === "points" ? 4 : null,
      ),
    ).toEqual({ value: 8, error: null });
  });
  it("rejects missing or ambiguous property names", () => {
    expect(() => compileFormula('prop("Missing")', properties)).toThrow(
      FormulaError,
    );
    expect(() =>
      compileFormula('prop("점수")', [
        ...properties,
        { id: "other", name: "점수" },
      ]),
    ).toThrow("중복");
    expect(() => compileFormula("prop(2)", properties)).toThrow("prop");
    expect(() => compileFormula('prop("점수", "Tags")', properties)).toThrow(
      "prop",
    );
  });
  it.each([
    ["abs(-4)", 4],
    ["floor(2.8)", 2],
    ["ceil(2.2)", 3],
    ["round(12.345, 2)", 12.35],
    ["min(8, 4, 6)", 4],
    ["max(8, 4, 6)", 8],
    ["sum(8, 4, 6)", 18],
    ['length("한글")', 2],
    ['concat("a", 3, true, null)', "a3true"],
    ['contains("alphabet", "pha")', true],
    ['lower("ABC")', "abc"],
    ['upper("abc")', "ABC"],
    ["empty(null)", true],
    ["format(12)", "12"],
    ['toNumber("12.5")', 12.5],
    ["if(true, 2, 3)", 2],
  ])("supports the explicit function %s", (source, expected) => {
    expect(run(source as string)).toEqual({ value: expected, error: null });
  });
  it("reads array values without executing or inventing property names", () => {
    const values = { tags: ["a", "b"] };
    expect(run('length(prop("Tags"))', values).value).toBe(2);
    expect(run('contains(prop("Tags"), "b")', values).value).toBe(true);
    expect(run('format(prop("Tags"))', values).value).toBe("a, b");
    expect(run('empty(prop("Tags"))', { tags: [] }).value).toBe(true);
  });
  it("evaluates conditional and boolean branches lazily", () => {
    expect(run("if(false, 1 / 0, 3)")).toEqual({ value: 3, error: null });
    expect(run("false && 1 / 0 == 2")).toEqual({ value: false, error: null });
    expect(run("true || 1 / 0 == 2")).toEqual({ value: true, error: null });
    const node = compileFormula('if(false, prop("점수"), 3)', properties);
    expect(
      evaluateFormula(node, () => {
        throw new FormulaError("cycle", "순환");
      }),
    ).toEqual({ value: 3, error: null });
  });
  it.each(["1 / 0", "1 % 0"])("returns a division error for %s", (source) => {
    expect(run(source)).toMatchObject({
      value: null,
      error: { code: "division_by_zero" },
    });
  });
  it.each([
    '1 + "2"',
    "null * 2",
    "if(2, 1, 3)",
    "if(true, 1)",
    "contains(1, 2)",
    'contains("a")',
    "abs(1, 2)",
    "round(1, 11)",
    "round(1, 0.5)",
    'toNumber("")',
    'toNumber("no")',
    '2 < "3"',
    "1e308 * 1e308",
    "sum()",
  ])("returns a type error for %s", (source) => {
    expect(run(source)).toMatchObject({ value: null, error: { code: "type" } });
  });
  it.each([
    "",
    "(1",
    "1 2",
    "1 +",
    "'unclosed",
    "'\\q'",
    "globalThis",
    "eval('1')",
    "constructor()",
    "process.exit()",
    "1; 2",
    "1e400",
  ])("rejects incomplete or executable input %s", (source) => {
    expect(() => compileFormula(source, properties)).toThrow(FormulaError);
  });
  it("decodes quoted escapes without treating them as source code", () => {
    expect(run("'it\\'s\\ntext' + \"\\t\"")).toEqual({
      value: "it's\ntext\t",
      error: null,
    });
  });
  it("limits source, nesting, argument count and result size", () => {
    expect(() =>
      compileFormula("1".repeat(MAX_FORMULA_LENGTH + 1), properties),
    ).toThrow("2,000");
    expect(() =>
      compileFormula("(".repeat(40) + "1" + ")".repeat(40), properties),
    ).toThrow("깊");
    expect(() =>
      compileFormula("sum(" + Array(17).fill("1").join(",") + ")", properties),
    ).toThrow("인수");
    expect(
      run('prop("점수") + prop("점수")', { points: "x".repeat(6000) }),
    ).toMatchObject({ value: null, error: { code: "limit" } });
  });
  it("keeps unavailable properties and dependency cycles distinguishable", () => {
    const node = compileFormula('prop("점수")', properties);
    expect(
      evaluateFormula(node, () => {
        throw new Error("unavailable");
      }),
    ).toMatchObject({ value: null, error: { code: "reference" } });
    expect(
      evaluateFormula(node, () => {
        throw new FormulaError("cycle", "순환 의존");
      }),
    ).toMatchObject({ value: null, error: { code: "cycle" } });
  });
  it("bounds evaluation of a forged cyclic AST", () => {
    const node: FormulaNode = {
      type: "unary",
      operator: "!",
      operand: { type: "literal", value: true },
    };
    node.operand = node;
    expect(evaluateFormula(node, () => null)).toMatchObject({
      value: null,
      error: { code: "limit" },
    });
    expect(
      evaluateFormula(
        { type: "call", name: "constructor", arguments: [] },
        () => null,
      ),
    ).toMatchObject({ error: { code: "syntax" } });
  });
  it("validates persisted ASTs before any property lookup", () => {
    expect(() =>
      assertFormulaNode(compileFormula('prop("점수") + 1', properties)),
    ).not.toThrow();
    for (const node of [
      null,
      [],
      { type: "property", propertyId: "" },
      { type: "literal", value: {} },
      { type: "call", name: "constructor", arguments: [] },
      { type: "binary", operator: "__proto__", left: null, right: null },
      { type: "literal", value: 1, secret: "extra" },
    ]) {
      let reads = 0;
      expect(
        evaluateFormula(node, () => {
          reads++;
          return 1;
        }),
      ).toMatchObject({ value: null, error: { code: "syntax" } });
      expect(reads).toBe(0);
    }
    expect(() =>
      assertFormulaNode({ type: "literal", value: Infinity }),
    ).toThrow(FormulaError);
    expect(() =>
      compileFormula(Array(80).fill("1").join("+"), properties),
    ).toThrow(FormulaError);
  });
});
