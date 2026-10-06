import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  getKnowledgeProjection,
  KnowledgeProjectionSchema,
  createKnowledgeDatabase,
  knowledgeSourceText,
  createTaskRow,
  updateTaskField,
  addDatabaseProperty,
  writeDatabaseValue,
  getDatabaseProperties,
  changeDatabaseProperty,
  createDatabaseValueReader,
  compileFormula,
  setPageTag,
  getTaskRows,
} from "./index";

function paragraph(fragment: Y.XmlFragment, value: string): void {
  const element = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  element.insert(0, [text]);
  fragment.insert(fragment.length, [element]);
  text.insert(0, value, { bold: {} });
}
it("indexes visible text without HTML markup while preserving literal angle brackets", () => {
  const doc = new Y.Doc();
  doc.getText("title").insert(0, "설계");
  setPageTag(doc, "문서");
  paragraph(doc.getXmlFragment("content"), "literal <angle> & data");
  expect(getKnowledgeProjection(doc)).toMatchObject({
    title: "설계",
    body: "literal <angle> & data",
    tags: ["문서"],
  });
  expect(
    KnowledgeProjectionSchema.parse(
      JSON.parse(JSON.stringify(getKnowledgeProjection(doc))),
    ),
  ).toEqual(getKnowledgeProjection(doc));
  doc.destroy();
});
it("includes only active Rows and active Property values, without derived/private labels", () => {
  const doc = new Y.Doc(),
    row = createTaskRow(doc, "Visible"),
    deleted = createTaskRow(doc, "Deleted");
  const plain = addDatabaseProperty(doc, "Notes", "text"),
    old = addDatabaseProperty(doc, "Old", "text"),
    relation = addDatabaseProperty(
      doc,
      "Linked",
      "relation",
      [],
      crypto.randomUUID(),
      { relation: { databaseId: crypto.randomUUID() } },
    ),
    file = addDatabaseProperty(doc, "File", "file"),
    targetId = crypto.randomUUID();
  writeDatabaseValue(doc, row, plain, "direct-value");
  writeDatabaseValue(doc, row, old, "old-secret");
  writeDatabaseValue(doc, row, relation, [targetId]);
  writeDatabaseValue(doc, row, file, [crypto.randomUUID()]);
  paragraph(doc.getXmlFragment(`task:${row}`), "active-body");
  paragraph(doc.getXmlFragment(`task:${deleted}`), "deleted-secret");
  changeDatabaseProperty(doc, old, { deleted: true });
  updateTaskField(doc, deleted, "deleted", true);
  const projection = getKnowledgeProjection(doc),
    text = knowledgeSourceText(projection);
  expect(projection.rows).toHaveLength(1);
  expect(projection.rows[0]?.values[old]).toBeUndefined();
  expect(text).toContain("direct-value");
  expect(text).toContain("active-body");
  expect(text).not.toContain("secret");
  expect(text).not.toContain(targetId);
  expect(projection.links).toEqual([
    {
      kind: "relation",
      pageId: getDatabaseProperties(doc).find((p) => p.id === relation)!
        .relation!.databaseId,
      rowId: targetId,
      sourceRowId: row,
    },
  ]);
  doc.destroy();
});
it("reconstructs a fresh minimal Database model for scoped Formula and Rollup computation", () => {
  const source = new Y.Doc(),
    target = new Y.Doc(),
    targetId = crypto.randomUUID(),
    row = createTaskRow(source, "Project"),
    linked = createTaskRow(target, "Private target"),
    points = addDatabaseProperty(target, "Points", "number"),
    relation = addDatabaseProperty(
      source,
      "Related",
      "relation",
      [],
      crypto.randomUUID(),
      { relation: { databaseId: targetId } },
    ),
    _total = addDatabaseProperty(
      source,
      "Total",
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
  addDatabaseProperty(source, "Twice", "formula", [], crypto.randomUUID(), {
    formula: {
      source: 'prop("Total") * 2',
      ast: compileFormula('prop("Total") * 2', getDatabaseProperties(source)),
    },
  });
  writeDatabaseValue(target, linked, points, 4);
  writeDatabaseValue(source, row, relation, [linked]);
  const projected = getKnowledgeProjection(source),
    copy = createKnowledgeDatabase(projected),
    targetCopy = createKnowledgeDatabase(getKnowledgeProjection(target));
  expect(copy.clientID).not.toBe(source.clientID);
  expect(getTaskRows(copy)).toEqual(getTaskRows(source));
  const property = getDatabaseProperties(copy).find((p) => p.name === "Twice")!,
    task = getTaskRows(copy)[0]!;
  expect(
    createDatabaseValueReader(crypto.randomUUID(), copy, {
      database: (id) => (id === targetId ? targetCopy : undefined),
    }).cell(task, property).value,
  ).toBe(8);
  expect(
    createDatabaseValueReader(crypto.randomUUID(), copy).cell(task, property)
      .error?.code,
  ).toBe("reference");
  expect(knowledgeSourceText(projected)).not.toContain("Private target");
  source.destroy();
  target.destroy();
  copy.destroy();
  targetCopy.destroy();
});
it("collects valid Page and Task links from main/Row bodies without indexing deleted Rows", () => {
  const doc = new Y.Doc(),
    pageId = crypto.randomUUID(),
    databaseId = crypto.randomUUID(),
    rowId = crypto.randomUUID(),
    row = createTaskRow(doc, "Task"),
    deleted = createTaskRow(doc, "Deleted");
  const mention = new Y.XmlElement("pageMention");
  mention.setAttribute("pageId", pageId);
  doc.getXmlFragment("content").insert(0, [mention]);
  const link = new Y.XmlElement("taskLink");
  link.setAttribute("databaseId", databaseId);
  link.setAttribute("rowId", rowId);
  doc.getXmlFragment(`task:${row}`).insert(0, [link]);
  const bad = new Y.XmlElement("pageMention");
  bad.setAttribute("pageId", "invalid");
  doc.getXmlFragment("content").insert(1, [bad]);
  const removed = new Y.XmlElement("pageMention");
  removed.setAttribute("pageId", crypto.randomUUID());
  doc.getXmlFragment(`task:${deleted}`).insert(0, [removed]);
  updateTaskField(doc, deleted, "deleted", true);
  expect(getKnowledgeProjection(doc).links).toEqual([
    { pageId, kind: "mention", sourceRowId: undefined },
    { pageId: databaseId, rowId, kind: "task", sourceRowId: row },
  ]);
  doc.destroy();
});
it("rejects corrupt stored projection contracts instead of accepting arbitrary computed fields", () => {
  const doc = new Y.Doc(),
    projection = getKnowledgeProjection(doc);
  expect(() =>
    KnowledgeProjectionSchema.parse({ ...projection, version: 2 }),
  ).toThrow();
  expect(() =>
    KnowledgeProjectionSchema.parse({
      ...projection,
      links: [{ pageId: "bad", kind: "mention" }],
    }),
  ).toThrow();
  expect(() =>
    KnowledgeProjectionSchema.parse({
      ...projection,
      derivedLabels: ["private"],
    }),
  ).toThrow();
  doc.destroy();
});
