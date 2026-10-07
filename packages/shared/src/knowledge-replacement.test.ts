import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  replaceKnowledgeLink,
  replacementRelationProperties,
  createTaskRow,
  updateTaskField,
  addDatabaseProperty,
  writeDatabaseValue,
  readDatabaseValue,
  getDatabaseProperties,
  getTaskRows,
} from "./index";

it("replaces matching mentions in the selected body and keeps other bodies and non-link attributes intact", () => {
  const doc = new Y.Doc(),
    pageId = crypto.randomUUID(),
    target = crypto.randomUUID(),
    row = createTaskRow(doc, "Row");
  const nodes = [
    new Y.XmlElement("pageMention"),
    new Y.XmlElement("pageMention"),
    new Y.XmlElement("paragraph"),
  ];
  for (const node of nodes) node.setAttribute("pageId", pageId);
  doc.getXmlFragment("content").insert(0, nodes);
  const rowMention = new Y.XmlElement("pageMention");
  rowMention.setAttribute("pageId", pageId);
  doc.getXmlFragment(`task:${row}`).insert(0, [rowMention]);
  expect(
    replaceKnowledgeLink(doc, { pageId, kind: "mention" }, { pageId: target }),
  ).toBe(2);
  expect(nodes[0]!.getAttribute("pageId")).toBe(target);
  expect(nodes[2]!.getAttribute("pageId")).toBe(pageId);
  expect(rowMention.getAttribute("pageId")).toBe(pageId);
  expect(() =>
    replaceKnowledgeLink(doc, { pageId, kind: "mention" }, { pageId: target }),
  ).toThrow("원래 링크");
  doc.destroy();
});
it("replaces Task links only after validating the new Row and rejects a removed source Row without mutation", () => {
  const doc = new Y.Doc(),
    pageId = crypto.randomUUID(),
    rowId = crypto.randomUUID(),
    targetId = crypto.randomUUID(),
    targetRow = crypto.randomUUID(),
    sourceRowId = createTaskRow(doc, "Source"),
    link = new Y.XmlElement("taskLink");
  link.setAttribute("databaseId", pageId);
  link.setAttribute("rowId", rowId);
  doc.getXmlFragment(`task:${sourceRowId}`).insert(0, [link]);
  expect(() =>
    replaceKnowledgeLink(
      doc,
      { pageId, rowId, sourceRowId, kind: "task" },
      { pageId: targetId },
    ),
  ).toThrow();
  expect(link.getAttribute("databaseId")).toBe(pageId);
  expect(
    replaceKnowledgeLink(
      doc,
      { pageId, rowId, sourceRowId, kind: "task" },
      { pageId: targetId, rowId: targetRow },
    ),
  ).toBe(1);
  updateTaskField(doc, sourceRowId, "deleted", true);
  expect(() =>
    replaceKnowledgeLink(
      doc,
      { pageId: targetId, rowId: targetRow, sourceRowId, kind: "task" },
      { pageId, rowId },
    ),
  ).toThrow("원래 Row");
  doc.destroy();
});
it("requires an explicit Relation property and preserves unrelated values and other Relation cells", () => {
  const doc = new Y.Doc(),
    sourceRowId = createTaskRow(doc, "Source"),
    pageId = crypto.randomUUID(),
    rowId = crypto.randomUUID(),
    other = crypto.randomUUID(),
    replacement = crypto.randomUUID(),
    a = addDatabaseProperty(doc, "A", "relation", [], crypto.randomUUID(), {
      relation: { databaseId: pageId },
    }),
    b = addDatabaseProperty(doc, "B", "relation", [], crypto.randomUUID(), {
      relation: { databaseId: pageId },
    });
  writeDatabaseValue(doc, sourceRowId, a, [rowId, other, replacement]);
  writeDatabaseValue(doc, sourceRowId, b, [rowId]);
  const link = { pageId, rowId, sourceRowId, kind: "relation" as const };
  expect(replacementRelationProperties(doc, link).map((p) => p.id)).toEqual([
    a,
    b,
  ]);
  expect(() =>
    replaceKnowledgeLink(doc, link, { pageId, rowId: replacement }),
  ).toThrow("원래 Relation");
  expect(() =>
    replaceKnowledgeLink(
      doc,
      link,
      { pageId: crypto.randomUUID(), rowId: replacement },
      a,
    ),
  ).toThrow("같은 Database");
  expect(
    replaceKnowledgeLink(doc, link, { pageId, rowId: replacement }, a),
  ).toBe(1);
  const row = getTaskRows(doc)[0]!,
    props = getDatabaseProperties(doc);
  expect(
    readDatabaseValue(
      doc,
      row,
      props.find((p) => p.id === a)!,
    ),
  ).toEqual([replacement, other]);
  expect(
    readDatabaseValue(
      doc,
      row,
      props.find((p) => p.id === b)!,
    ),
  ).toEqual([rowId]);
  expect(
    replacementRelationProperties(doc, { pageId, kind: "mention" }),
  ).toEqual([]);
  doc.destroy();
});
