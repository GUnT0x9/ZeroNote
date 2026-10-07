import * as Y from "yjs";
import { z } from "zod";
import { getTaskRows } from "./index";
import {
  getDatabaseProperties,
  readDatabaseValue,
  writeDatabaseValue,
} from "./database";
import {
  KnowledgeLinkSchema,
  type KnowledgeLink,
} from "./knowledge-projection";

function sourceRow(document: Y.Doc, link: KnowledgeLink) {
  const row = link.sourceRowId
    ? getTaskRows(document).find((entry) => entry.id === link.sourceRowId)
    : undefined;
  if (link.sourceRowId && !row)
    throw new Error("원래 Row가 삭제되었거나 변경되었습니다.");
  return row;
}
export function replacementRelationProperties(
  document: Y.Doc,
  link: KnowledgeLink,
) {
  const row = sourceRow(document, link);
  if (!row || link.kind !== "relation" || !link.rowId) return [];
  return getDatabaseProperties(document).filter((property) => {
    if (
      property.type !== "relation" ||
      property.relation?.databaseId !== link.pageId
    )
      return false;
    const value = readDatabaseValue(document, row, property);
    return Array.isArray(value) && value.includes(link.rowId!);
  });
}
function linkElements(document: Y.Doc, link: KnowledgeLink): Y.XmlElement[] {
  sourceRow(document, link);
  const elements: Y.XmlElement[] = [];
  const visit = (node: Y.XmlFragment | Y.XmlElement) => {
    if (
      node instanceof Y.XmlElement &&
      ((link.kind === "mention" &&
        node.nodeName === "pageMention" &&
        node.getAttribute("pageId") === link.pageId) ||
        (link.kind === "task" &&
          node.nodeName === "taskLink" &&
          node.getAttribute("databaseId") === link.pageId &&
          node.getAttribute("rowId") === link.rowId))
    )
      elements.push(node);
    for (const child of node.toArray())
      if (child instanceof Y.XmlElement) visit(child);
  };
  visit(
    document.getXmlFragment(
      link.sourceRowId ? `task:${link.sourceRowId}` : "content",
    ),
  );
  return elements;
}
/** Explicitly replaces matching links in one body, or one selected Relation cell. */
export function replaceKnowledgeLink(
  document: Y.Doc,
  value: KnowledgeLink,
  target: { pageId: string; rowId?: string },
  propertyId?: string,
): number {
  const link = KnowledgeLinkSchema.parse(value);
  z.uuid().parse(target.pageId);
  if (link.kind !== "mention") z.uuid().parse(target.rowId);
  if (link.kind === "relation") {
    const property = replacementRelationProperties(document, link).find(
        (entry) => entry.id === propertyId,
      ),
      row = sourceRow(document, link);
    if (!property || !row || target.pageId !== link.pageId)
      throw new Error(
        "원래 Relation 속성과 같은 Database의 Row를 선택해주세요.",
      );
    const current = readDatabaseValue(document, row, property);
    if (!Array.isArray(current))
      throw new Error("원래 Relation이 변경되었습니다.");
    writeDatabaseValue(document, row.id, property.id, [
      ...new Set(current.map((id) => (id === link.rowId ? target.rowId! : id))),
    ]);
    return 1;
  }
  const elements = linkElements(document, link);
  if (!elements.length)
    throw new Error(
      "원래 링크가 변경되었습니다. 연결 상태를 다시 확인해주세요.",
    );
  document.transact(() => {
    for (const element of elements) {
      element.setAttribute(
        link.kind === "mention" ? "pageId" : "databaseId",
        target.pageId,
      );
      if (link.kind === "task") element.setAttribute("rowId", target.rowId!);
    }
  });
  return elements.length;
}
