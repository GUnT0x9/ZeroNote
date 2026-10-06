import { z } from "zod";
import * as Y from "yjs";
import { TaskRowSchema, getTaskRows } from "./index";
import {
  DatabasePropertySchema,
  getDatabaseMode,
  getDatabaseProperties,
  readDatabaseValue,
  databaseValueLabel,
} from "./database";
import { PropertyValueSchema } from "./database-values";
import { getPageTags } from "./page-tags";

export const KnowledgeLinkSchema = z
  .object({
    pageId: z.uuid(),
    rowId: z.uuid().optional(),
    sourceRowId: z.uuid().optional(),
    kind: z.enum(["mention", "task", "relation"]),
  })
  .strict();
export const KnowledgeProjectionSchema = z
  .object({
    version: z.literal(1),
    title: z.string(),
    body: z.string(),
    tags: z.array(z.string()),
    links: z.array(KnowledgeLinkSchema),
    mode: z.enum(["task", "generic"]),
    properties: z.array(z.lazy(() => DatabasePropertySchema)),
    rows: z.array(
      z
        .object({
          row: z.lazy(() => TaskRowSchema),
          body: z.string(),
          values: z.record(z.string(), PropertyValueSchema),
        })
        .strict(),
    ),
  })
  .strict();
export type KnowledgeProjection = z.infer<typeof KnowledgeProjectionSchema>;
export type KnowledgeLink = z.infer<typeof KnowledgeLinkSchema>;

function readKnowledgeContent(
  node: Y.XmlFragment | Y.XmlElement | Y.XmlText,
  links: KnowledgeLink[],
  sourceRowId?: string,
): string {
  if (node instanceof Y.XmlText)
    return node
      .toDelta()
      .map((part: { insert: unknown }) =>
        typeof part.insert === "string" ? part.insert : "",
      )
      .join("");
  if (node instanceof Y.XmlElement) {
    const pageId = node.getAttribute("pageId"),
      databaseId = node.getAttribute("databaseId"),
      rowId = node.getAttribute("rowId");
    if (z.uuid().safeParse(pageId).success)
      links.push({ pageId: String(pageId), kind: "mention", sourceRowId });
    if (
      z.uuid().safeParse(databaseId).success &&
      z.uuid().safeParse(rowId).success
    )
      links.push({
        pageId: String(databaseId),
        rowId: String(rowId),
        kind: "task",
        sourceRowId,
      });
  }
  return node
    .toArray()
    .map((child) =>
      child instanceof Y.XmlHook
        ? ""
        : readKnowledgeContent(child, links, sourceRowId),
    )
    .join(" ");
}

/** Contains source values only. Request-scoped computed labels never enter this Index. */
export function getKnowledgeProjection(document: Y.Doc): KnowledgeProjection {
  const links: KnowledgeLink[] = [],
    properties = getDatabaseProperties(document);
  const body = readKnowledgeContent(document.getXmlFragment("content"), links);
  const rows = getTaskRows(document).map((row) => {
    const values = Object.fromEntries(
      properties
        .filter(
          (property) =>
            !property.builtin && !["formula", "rollup"].includes(property.type),
        )
        .map((property) => [
          property.id,
          readDatabaseValue(document, row, property),
        ]),
    );
    for (const property of properties) {
      if (!property.relation) continue;
      const ids = values[property.id];
      if (Array.isArray(ids))
        for (const rowId of ids)
          if (z.uuid().safeParse(rowId).success)
            links.push({
              pageId: property.relation.databaseId,
              rowId,
              sourceRowId: row.id,
              kind: "relation",
            });
    }
    return {
      row,
      values,
      body: readKnowledgeContent(
        document.getXmlFragment(`task:${row.id}`),
        links,
        row.id,
      ),
    };
  });
  return {
    version: 1,
    title: document.getText("title").toString(),
    body,
    tags: getPageTags(document),
    mode: getDatabaseMode(document),
    properties,
    rows,
    links: [
      ...new Map(links.map((link) => [JSON.stringify(link), link])).values(),
    ],
  };
}

/** Minimal model for the existing Database reader; no historical/deleted content is restored. */
export function createKnowledgeDatabase(
  projection: KnowledgeProjection,
): Y.Doc {
  const document = new Y.Doc();
  document.transact(() => {
    document.getMap("databaseConfig").set("mode", projection.mode);
    const properties = document.getMap<Y.Map<unknown>>("databaseProperties");
    for (const property of projection.properties.filter(
      (item) => !item.builtin,
    )) {
      const map = new Y.Map<unknown>();
      properties.set(property.id, map);
      for (const [key, value] of Object.entries(property)) map.set(key, value);
    }
    for (const { row, values } of projection.rows) {
      const map = new Y.Map<unknown>();
      document.getMap<Y.Map<unknown>>("tasks").set(row.id, map);
      for (const [key, value] of Object.entries(row))
        if (key !== "id")
          map.set(key, key === "title" ? new Y.Text(String(value)) : value);
      for (const [key, value] of Object.entries(values))
        map.set(`property:${key}`, value);
    }
  });
  return document;
}

export function knowledgeSourceText(projection: KnowledgeProjection): string {
  const directLabels = projection.rows.flatMap(({ row, values, body }) => [
    row.title,
    body,
    ...projection.properties.flatMap((property) => {
      if (
        ["relation", "formula", "rollup", "file", "person"].includes(
          property.type,
        )
      )
        return [];
      const value = property.builtin
        ? (row[property.id as keyof typeof row] ?? null)
        : (values[property.id] ?? null);
      const parsed = PropertyValueSchema.safeParse(value);
      return parsed.success ? [databaseValueLabel(property, parsed.data)] : [];
    }),
  ]);
  return [
    projection.title,
    projection.body,
    ...projection.tags,
    ...directLabels,
  ].join(" ");
}
