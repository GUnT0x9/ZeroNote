import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  createSearchEngine,
  isSingleSearchEdit,
  parseSearchQuery,
  SearchRequestSchema,
  SearchResponseSchema,
  getKnowledgeProjection,
  createTaskRow,
  addDatabaseProperty,
  writeDatabaseValue,
  getDatabaseProperties,
  compileFormula,
  type SearchSource,
} from "./index";

const workspaceId = crypto.randomUUID(),
  edited = "2026-10-06T02:00:00.000Z";
function source(
  title: string,
  body = "",
  document?: Y.Doc,
  scope = workspaceId,
): SearchSource {
  const projection = document ? getKnowledgeProjection(document) : undefined;
  return {
    page: {
      id: crypto.randomUUID(),
      workspaceId: scope,
      kind: document ? "database" : "document",
      title,
      createdAt: edited,
    },
    workspaceName: "내 Workspace",
    updatedAt: edited,
    projection: projection
      ? { ...projection, title }
      : {
          version: 1,
          title,
          body,
          tags: ["설계"],
          links: [],
          mode: "task",
          properties: [],
          rows: [],
        },
  };
}
function hits(sources: SearchSource[], query: string) {
  const engine = createSearchEngine(sources);
  try {
    return engine.search(parseSearchQuery(query));
  } finally {
    engine.dispose();
  }
}
it("searches full body, NFKC text and tags with title results first", () => {
  const pages = [
    source("본문", "ｚｅｒｏｎｏｔｅ <literal> 한글"),
    source("ZeroNote"),
  ];
  expect(hits(pages, "zeronote").hits.map((hit) => hit.title)).toEqual([
    "ZeroNote",
    "본문",
  ]);
  expect(hits(pages, '"<literal>" tag:설계').hits[0]?.title).toBe("본문");
  expect(hits(pages, "한글").hits).toHaveLength(1);
  expect(
    hits([source("Long", "x".repeat(50_000) + " fullbodyterm")], "fullbodyterm")
      .hits,
  ).toHaveLength(1);
});
it("supports AND, exact phrases and exact exclusions without fuzzy negation", () => {
  const pages = [
    source("Alpha", "red blue zebra"),
    source("Beta", "red green zebar"),
  ];
  expect(hits(pages, '"red blue" -zebar').hits.map((hit) => hit.title)).toEqual(
    ["Alpha"],
  );
  expect(hits(pages, "red -zebra").hits.map((hit) => hit.title)).toEqual([
    "Beta",
  ]);
  expect(hits(pages, '"red blua"').hits).toHaveLength(0);
});
it("ranks exact results ahead of one-edit results including Korean and transposition", () => {
  const pages = [source("zebar"), source("Other", "zebra"), source("문서검색")];
  const result = hits(pages, "zebra").hits;
  expect(result.map((hit) => hit.title)).toEqual(["Other", "zebar"]);
  expect(result.map((hit) => hit.fuzzy)).toEqual([false, true]);
  expect(hits(pages, "문서검샥").hits[0]?.fuzzy).toBe(true);
  expect(hits(pages, "ze").hits).toHaveLength(2); // exact partial only
  expect(
    hits([source("Hidden", "x".repeat(33_000) + " zebar")], "zebra").hits,
  ).toHaveLength(0);
});
it.each([
  ["abc", "abcd", true],
  ["abc", "acb", true],
  ["abc", "xbc", true],
  ["abc", "axy", false],
  ["a".repeat(65), "a".repeat(65), false],
])("bounds edit comparison %s / %s", (a, b, result) => {
  expect(isSingleSearchEdit(a, b)).toBe(result);
});
it("combines type, workspace, tag, database and UTC edited-day filters", () => {
  const db = new Y.Doc(),
    database = source("Tasks", "", db),
    page = source("Doc");
  expect(
    hits([database, page], `type:database database:${database.page.id}`).hits[0]
      ?.pageId,
  ).toBe(database.page.id);
  expect(
    hits(
      [page],
      'workspace:"내 Workspace" after:2026-10-06 before:2026-10-07 tag:설계',
    ).hits,
  ).toHaveLength(1);
  expect(hits([page], "before:2026-10-06").hits).toHaveLength(0);
  expect(hits([page], "-tag:설계").hits).toHaveLength(0);
  db.destroy();
});
it("searches Row body and typed Property values without returning a duplicate parent match", () => {
  const doc = new Y.Doc(),
    row = createTaskRow(doc, "Release"),
    number = addDatabaseProperty(doc, "Points", "number"),
    check = addDatabaseProperty(doc, "Ready", "checkbox");
  writeDatabaseValue(doc, row, number, 7);
  writeDatabaseValue(doc, row, check, true);
  const item = source("Project", "", doc);
  item.projection!.rows[0]!.body = "launch notes";
  expect(hits([item], "launch").hits[0]?.rowId).toBe(row);
  expect(
    hits([item], "prop:Points:gte:7 prop:Ready:equals:true").hits.map(
      (hit) => hit.rowId,
    ),
  ).toEqual([row]);
  expect(hits([item], "prop:Points:gt:7").hits).toHaveLength(0);
  expect(hits([item], "-prop:Missing:equals:7").hits).toHaveLength(0);
  expect(hits([item], "").hits.map((hit) => hit.rowId)).toEqual([null]);
  doc.destroy();
});
it("rejects ambiguous property names while IDs keep a stable match", () => {
  const doc = new Y.Doc(),
    row = createTaskRow(doc, "Row"),
    first = addDatabaseProperty(doc, "Same", "number"),
    second = addDatabaseProperty(doc, "Other", "number");
  writeDatabaseValue(doc, row, first, 4);
  writeDatabaseValue(doc, row, second, 9);
  const item = source("DB", "", doc);
  item.projection!.properties.find((p) => p.id === second)!.name = "Same";
  expect(hits([item], "prop:Same:equals:4").hits).toHaveLength(0);
  expect(hits([item], `prop:${first}:equals:4`).hits[0]?.rowId).toBe(row);
  doc.destroy();
});
it("computes Formula/Rollup from allowed same-Workspace sources and skips unknown values under exclusion", () => {
  const targetDoc = new Y.Doc(),
    sourceDoc = new Y.Doc(),
    targetRow = createTaskRow(targetDoc, "Private target"),
    row = createTaskRow(sourceDoc, "Source"),
    target = source("Target DB", "", targetDoc);
  const points = addDatabaseProperty(targetDoc, "Points", "number");
  writeDatabaseValue(targetDoc, targetRow, points, 4);
  const relation = addDatabaseProperty(
    sourceDoc,
    "Linked",
    "relation",
    [],
    crypto.randomUUID(),
    { relation: { databaseId: target.page.id } },
  );
  writeDatabaseValue(sourceDoc, row, relation, [targetRow]);
  addDatabaseProperty(sourceDoc, "Total", "rollup", [], crypto.randomUUID(), {
    rollup: {
      relationPropertyId: relation,
      targetPropertyId: points,
      operation: "sum",
    },
  });
  addDatabaseProperty(sourceDoc, "Twice", "formula", [], crypto.randomUUID(), {
    formula: {
      source: 'prop("Total") * 2',
      ast: compileFormula(
        'prop("Total") * 2',
        getDatabaseProperties(sourceDoc),
      ),
    },
  });
  target.projection = {
    ...getKnowledgeProjection(targetDoc),
    title: "Target DB",
  };
  const origin = source("Origin", "", sourceDoc);
  expect(hits([origin, target], "prop:Twice:equals:8").hits[0]?.rowId).toBe(
    row,
  );
  expect(hits([origin], "prop:Twice:equals:0").hits).toHaveLength(0);
  expect(hits([origin], "-prop:Twice:equals:8").hits).toHaveLength(0);
  expect(hits([origin], '"Private target"').hits).toHaveLength(0);
  const otherWorkspace = {
    ...target,
    page: { ...target.page, workspaceId: crypto.randomUUID() },
  };
  expect(
    hits([origin, otherWorkspace], "prop:Twice:equals:8").hits,
  ).toHaveLength(0);
  sourceDoc.destroy();
  targetDoc.destroy();
});
it("uses scoped file/person labels and omits missing file values", () => {
  const doc = new Y.Doc(),
    row = createTaskRow(doc, "Row"),
    file = addDatabaseProperty(doc, "File", "file"),
    fileId = crypto.randomUUID();
  writeDatabaseValue(doc, row, file, [fileId]);
  const item = source("DB", "", doc),
    engine = createSearchEngine([item], { fileName: () => "report.pdf" });
  expect(
    engine.search(parseSearchQuery('prop:File:contains:"report.pdf"')).hits[0]
      ?.rowId,
  ).toBe(row);
  expect(hits([item], "-prop:File:empty").hits).toHaveLength(0);
  engine.dispose();
  doc.destroy();
});
it("validates AST/request/response bounds and temporary overlays", () => {
  const item = source("Test"),
    input = { query: parseSearchQuery("Test"), workspaceId: null };
  expect(SearchRequestSchema.parse(input).overlays).toEqual([]);
  expect(SearchRequestSchema.safeParse({ ...input, limit: 51 }).success).toBe(
    false,
  );
  expect(
    SearchRequestSchema.safeParse({
      ...input,
      overlays: [
        { pageId: "bad", projection: item.projection, updatedAt: edited },
      ],
    }).success,
  ).toBe(false);
  expect(SearchRequestSchema.safeParse({ ...input, extra: true }).success).toBe(
    false,
  );
  expect(SearchResponseSchema.parse(hits([item], "Test")).hits[0]?.title).toBe(
    "Test",
  );
});
