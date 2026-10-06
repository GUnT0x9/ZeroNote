import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  addDatabaseProperty,
  createTaskRow,
  writeDatabaseValue,
  getTaskRows,
  getDatabaseProperties,
  compileFormula,
  bytesToBase64,
  type WorkspaceExport,
} from "@zeronote/shared";
import { createExportDatabaseReader } from "./database-export";
import {
  renderPageHtml,
  renderPageMarkdown,
  portableWorkspaceFiles,
} from "./portable-archive";
function fixture() {
  const source = new Y.Doc(),
    target = new Y.Doc(),
    sourceId = crypto.randomUUID(),
    targetId = crypto.randomUUID();
  const rowId = createTaskRow(source, "계획"),
    targetRowId = createTaskRow(target, "연결 자료");
  const points = addDatabaseProperty(target, "점수", "number");
  writeDatabaseValue(target, targetRowId, points, 7);
  const relation = addDatabaseProperty(
    source,
    "자료",
    "relation",
    [],
    crypto.randomUUID(),
    { relation: { databaseId: targetId } },
  );
  writeDatabaseValue(source, rowId, relation, [targetRowId]);
  const total = addDatabaseProperty(
    source,
    "집계",
    "rollup",
    [],
    crypto.randomUUID(),
    {
      rollup: {
        relationPropertyId: relation,
        targetPropertyId: points,
        operation: "sum",
      },
    },
  );
  addDatabaseProperty(source, "두 배", "formula", [], crypto.randomUUID(), {
    formula: {
      source: 'prop("집계") * 2',
      ast: compileFormula('prop("집계") * 2', getDatabaseProperties(source)),
    },
  });
  const file = addDatabaseProperty(source, "첨부", "file"),
    fileId = crypto.randomUUID();
  writeDatabaseValue(source, rowId, file, [fileId]);
  const input: WorkspaceExport = {
    schemaVersion: 1,
    name: "계산 Export",
    exportedAt: "now",
    pages: [
      {
        id: sourceId,
        parentId: null,
        title: "계획",
        kind: "database",
        isInbox: false,
        document: bytesToBase64(Y.encodeStateAsUpdate(source)),
      },
      {
        id: targetId,
        parentId: null,
        title: "자료",
        kind: "database",
        isInbox: false,
        document: bytesToBase64(Y.encodeStateAsUpdate(target)),
      },
    ],
    attachments: [
      {
        id: fileId,
        pageId: sourceId,
        name: "guide.txt",
        mime: "text/plain",
        size: 1,
        hash: "a".repeat(64),
        createdAt: "now",
        data: "QQ==",
      },
    ],
  };
  return { source, target, sourceId, targetId, total, input };
}
it("exports calculated fields, stable Relation titles and File names to Markdown/HTML/CSV", () => {
  const f = fixture();
  const computed = createExportDatabaseReader(f.input, f.sourceId, f.source);
  expect(
    computed.reader.label(
      getTaskRows(f.source)[0]!,
      getDatabaseProperties(f.source).find(
        (property) => property.id === f.total,
      )!,
    ),
  ).toBe("7");
  computed.dispose();
  for (const text of [
    renderPageHtml(f.input, f.sourceId),
    renderPageMarkdown(f.input, f.sourceId),
    ...Object.entries(portableWorkspaceFiles(f.input, "notion"))
      .filter(([name]) => name.endsWith(".csv"))
      .map(([, data]) => new TextDecoder().decode(data)),
  ].slice(0, 3)) {
    expect(text).toContain("연결 자료");
    expect(text).toContain("14");
    expect(text).toContain("guide.txt");
  }
  f.source.destroy();
  f.target.destroy();
});
it("does not resolve outside-scope databases or accept another Page's file metadata", () => {
  const f = fixture();
  f.input.pages = f.input.pages.filter((page) => page.id !== f.targetId);
  f.input.attachments![0]!.pageId = f.targetId;
  const html = renderPageHtml(f.input, f.sourceId);
  expect(html).toContain("오류:");
  expect(html).not.toContain("연결 자료");
  expect(html).not.toContain("guide.txt");
  f.source.destroy();
  f.target.destroy();
});
