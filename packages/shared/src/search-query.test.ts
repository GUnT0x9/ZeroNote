import { expect, it } from "vitest";
import {
  normalizeSearchText,
  parseSearchQuery,
  SearchQuerySchema,
  SearchSyntaxError,
} from "./search-query";

it("normalizes Unicode, case and whitespace consistently", () => {
  expect(normalizeSearchText("  ＺＥＲＯ\t노트\nA  ")).toBe("zero 노트 a");
  expect(normalizeSearchText("가")).toBe("가");
  expect(normalizeSearchText(" \n ")).toBe("");
});

it("parses terms, excluded phrases, metadata and typed property conditions", () => {
  expect(
    parseSearchQuery(
      'release -"old notes" type:page tag:"Team Work" workspace:"개인 공간" after:2026-10-01 prop:"Story Points":gte:3',
    ),
  ).toEqual({
    clauses: [
      { kind: "text", value: "release", phrase: false, excluded: false },
      { kind: "text", value: "old notes", phrase: true, excluded: true },
      { kind: "filter", field: "type", value: "document", excluded: false },
      { kind: "filter", field: "tag", value: "team work", excluded: false },
      {
        kind: "filter",
        field: "workspace",
        value: "개인 공간",
        excluded: false,
      },
      { kind: "filter", field: "after", value: "2026-10-01", excluded: false },
      {
        kind: "property",
        property: "Story Points",
        operator: "gte",
        value: 3,
        excluded: false,
      },
    ],
  });
});

it("preserves quoted colon values and literal HTTP URLs", () => {
  const query = parseSearchQuery(
    '"a:b" https://example.com:443/x prop:"Budget: USD":equals:"3" -tag:Private',
  );
  expect(query.clauses[0]).toMatchObject({ value: "a:b", phrase: true });
  expect(query.clauses[1]).toMatchObject({
    kind: "text",
    value: "https://example.com:443/x",
  });
  expect(query.clauses[2]).toMatchObject({
    property: "Budget: USD",
    value: "3",
  });
  expect(query.clauses[3]).toMatchObject({ field: "tag", excluded: true });
});

it("accepts empty queries and distinguishes booleans and empty conditions", () => {
  expect(parseSearchQuery(" \n ")).toEqual({ clauses: [] });
  expect(
    parseSearchQuery("prop:Done:equals:true prop:Date:empty prop:Cost:gt:-2e2")
      .clauses,
  ).toEqual([
    {
      kind: "property",
      property: "Done",
      operator: "equals",
      value: true,
      excluded: false,
    },
    {
      kind: "property",
      property: "Date",
      operator: "empty",
      value: null,
      excluded: false,
    },
    {
      kind: "property",
      property: "Cost",
      operator: "gt",
      value: -200,
      excluded: false,
    },
  ]);
});

it("keeps markup and escaped quotes as data", () => {
  expect(
    parseSearchQuery('"say \\"hi\\"" "<script>alert(1)</script>"').clauses,
  ).toHaveLength(2);
  expect(parseSearchQuery('"say \\"hi\\""').clauses[0]).toMatchObject({
    value: 'say "hi"',
  });
});

it.each([
  '"unclosed',
  '""',
  "-",
  "tag:",
  'tag:" "',
  "unknown:value",
  "type:task",
  "before:2026-02-30",
  "after:today",
  "tag:a:b",
  '"tag":a',
  'hello"world"',
  '"hello"world',
  '"bad\\n"',
  "prop:Score:execute:3",
  "prop:Score:gte",
  "prop:Score:empty:1",
  "prop:Score:equals:1e999",
  'prop:" ":equals:3',
  `tag:${"a".repeat(65)}`,
])("rejects malformed or unsupported input: %s", (source) => {
  expect(() => parseSearchQuery(source)).toThrow(SearchSyntaxError);
});

it("bounds query length and condition count with source positions", () => {
  expect(() => parseSearchQuery("a".repeat(513))).toThrow(/513번째/);
  expect(() => parseSearchQuery(Array(33).fill("a").join(" "))).toThrow(/32개/);
  expect(parseSearchQuery(Array(32).fill("a").join(" ")).clauses).toHaveLength(
    32,
  );
});

it("rejects unknown request fields and unsafe numeric AST values", () => {
  expect(
    SearchQuerySchema.safeParse({ clauses: [], sql: "DROP TABLE pages" })
      .success,
  ).toBe(false);
  expect(
    SearchQuerySchema.safeParse({
      clauses: [
        {
          kind: "property",
          property: "Score",
          operator: "gte",
          value: Infinity,
          excluded: false,
        },
      ],
    }).success,
  ).toBe(false);
});

it.each([
  ["type", "task"],
  ["before", "2026-02-30"],
  ["after", "today"],
  ["tag", "a".repeat(65)],
  ["workspace", " "],
])(
  "validates untrusted %s filter values as well as parsed strings",
  (field, value) => {
    expect(
      SearchQuerySchema.safeParse({
        clauses: [{ kind: "filter", field, value, excluded: false }],
      }).success,
    ).toBe(false);
  },
);

it("accepts validated filter ASTs with canonical types and valid dates", () => {
  expect(
    SearchQuerySchema.safeParse({
      clauses: [
        { kind: "filter", field: "type", value: "database", excluded: false },
        {
          kind: "filter",
          field: "before",
          value: "2024-02-29",
          excluded: false,
        },
        { kind: "filter", field: "tag", value: "a".repeat(64), excluded: true },
      ],
    }).success,
  ).toBe(true);
});
