import * as Y from "yjs";
import { z } from "zod";
import { createTaskRow, getTaskRows } from "./index";
import { cloneXmlContent } from "./xml";
import {
  TaskEstimateSchema,
  MAX_TASK_TEMPLATES,
  MAX_TASK_LABELS,
} from "./task-schema";
import { PageTagSchema } from "./page-tags";
import { setTaskLabel } from "./task-extension";
import {
  DatabasePropertySchema,
  getDatabaseProperties,
  readDatabaseValue,
  validateDatabaseValue,
  MAX_DATABASE_PROPERTIES,
  type DatabaseProperty,
  type PropertyValue,
} from "./database";
import { PropertyValueSchema } from "./database-values";
const AUTOMATIC_PROPERTY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "updated_time",
]);

export const TaskTemplateSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(160),
    title: z.string().max(500),
    priority: z.enum(["low", "medium", "high"]),
    assigneeId: z.uuid().nullable(),
    estimateMinutes: TaskEstimateSchema,
    labels: z.array(PageTagSchema).max(MAX_TASK_LABELS),
    sourceRowId: z.uuid(),
    createdAt: z.iso.datetime(),
    deleted: z.boolean(),
    properties: z
      .array(z.lazy(() => DatabasePropertySchema))
      .max(MAX_DATABASE_PROPERTIES)
      .default([]),
    values: z.record(z.string(), PropertyValueSchema).default({}),
  })
  .strict()
  .refine(
    (template) =>
      new Set(template.properties.map((property) => property.id)).size ===
        template.properties.length &&
      template.properties.every(
        (property) =>
          !property.builtin && !AUTOMATIC_PROPERTY_TYPES.has(property.type),
      ) &&
      Object.keys(template.values).every((id) =>
        template.properties.some((property) => property.id === id),
      ),
    "Template 속성 정의가 올바르지 않습니다.",
  );
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;
export function getTaskTemplates(document: Y.Doc): TaskTemplate[] {
  return [...document.getMap<Y.Map<unknown>>("taskTemplates")]
    .flatMap(([id, map]) => {
      if (!(map instanceof Y.Map)) return [];
      const parsed = TaskTemplateSchema.safeParse({ ...map.toJSON(), id });
      return parsed.success && !parsed.data.deleted ? [parsed.data] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
function taskTemplateMap(document: Y.Doc, id: string): Y.Map<unknown> {
  const map = document
    .getMap<Y.Map<unknown>>("taskTemplates")
    .get(z.uuid().parse(id));
  if (!(map instanceof Y.Map) || map.get("deleted") === true)
    throw new Error("Template을 찾을 수 없습니다.");
  return map;
}
export function saveTaskTemplate(
  document: Y.Doc,
  rowId: string,
  name: string,
): string {
  const row = getTaskRows(document).find((item) => item.id === rowId);
  if (!row) throw new Error("Task를 찾을 수 없습니다.");
  const properties = getDatabaseProperties(document).filter(
    (property) =>
      !property.builtin && !AUTOMATIC_PROPERTY_TYPES.has(property.type),
  );
  const values = Object.fromEntries(
    properties.map((property) => [
      property.id,
      validateDatabaseValue(
        property,
        readDatabaseValue(document, row, property),
      ),
    ]),
  );
  if (getTaskTemplates(document).length >= MAX_TASK_TEMPLATES)
    throw new Error(
      "Task Template은 최대 20개입니다. 먼저 기존 Template을 삭제해주세요.",
    );
  const id = crypto.randomUUID(),
    template = TaskTemplateSchema.parse({
      id,
      name,
      title: row.title,
      priority: row.priority,
      assigneeId: row.assigneeId,
      estimateMinutes: row.estimateMinutes,
      labels: row.labels,
      sourceRowId: row.id,
      createdAt: new Date().toISOString(),
      deleted: false,
      properties,
      values,
    });
  const body = cloneXmlContent(document.getXmlFragment(`task:${row.id}`));
  document.transact(() => {
    const map = new Y.Map<unknown>();
    document.getMap<Y.Map<unknown>>("taskTemplates").set(id, map);
    for (const [key, value] of Object.entries(template))
      if (key !== "id") map.set(key, value);
    document.getXmlFragment(`task-template:${id}`).insert(0, body);
  });
  return id;
}
export function changeTaskTemplate(
  document: Y.Doc,
  id: string,
  change: { name?: string; deleted?: boolean },
): void {
  const map = taskTemplateMap(document, id);
  const parsed = TaskTemplateSchema.parse({ ...map.toJSON(), id, ...change });
  document.transact(() => {
    if (change.name !== undefined) map.set("name", parsed.name);
    if (change.deleted !== undefined) {
      map.set("deleted", parsed.deleted);
      if (parsed.deleted) {
        const body = document.getXmlFragment(`task-template:${id}`);
        body.delete(0, body.length);
      }
    }
  });
}
export function createTaskFromTemplate(
  document: Y.Doc,
  databaseId: string,
  templateId: string,
  title?: string,
  omitChangedProperties = false,
): string {
  z.uuid().parse(databaseId);
  const template = TaskTemplateSchema.parse({
      ...taskTemplateMap(document, templateId).toJSON(),
      id: templateId,
    }),
    id = crypto.randomUUID();
  const nextTitle = z
    .string()
    .max(500)
    .parse(title ?? template.title);
  const custom = compatibleTemplateValues(
    document,
    template,
    omitChangedProperties,
  );
  const body = cloneXmlContent(
    document.getXmlFragment(`task-template:${templateId}`),
    (key, value, node) =>
      key === "rowId" &&
      value === template.sourceRowId &&
      node.getAttribute("databaseId") === databaseId
        ? id
        : value,
  );
  document.transact(() => {
    createTaskRow(document, nextTitle, id);
    const row = document.getMap<Y.Map<unknown>>("tasks").get(id)!;
    row.set("priority", template.priority);
    row.set("assigneeId", template.assigneeId);
    row.set("estimateMinutes", template.estimateMinutes);
    for (const [propertyId, value] of custom) {
      const property = template.properties.find(
        (property) => property.id === propertyId,
      )!;
      row.set(
        `property:${propertyId}`,
        property.type === "relation" &&
          property.relation?.databaseId === databaseId &&
          Array.isArray(value)
          ? [
              ...new Set(
                value.map((value) =>
                  value === template.sourceRowId ? id : value,
                ),
              ),
            ]
          : structuredClone(value),
      );
    }
    for (const label of template.labels) setTaskLabel(document, id, label);
    document.getXmlFragment(`task:${id}`).insert(0, body);
  });
  return id;
}
function templatePropertyMatches(
  current: DatabaseProperty | undefined,
  saved: DatabaseProperty,
): boolean {
  return (
    !!current &&
    current.type === saved.type &&
    current.relation?.databaseId === saved.relation?.databaseId
  );
}
export function changedTaskTemplateProperties(
  document: Y.Doc,
  template: TaskTemplate,
): string[] {
  const current = new Map(
    getDatabaseProperties(document).map((property) => [property.id, property]),
  );
  return template.properties
    .filter((property) => {
      const candidate = current.get(property.id);
      if (!templatePropertyMatches(candidate, property)) return true;
      try {
        validateDatabaseValue(candidate!, template.values[property.id] ?? null);
        return false;
      } catch {
        return true;
      }
    })
    .map((property) => property.name);
}
function compatibleTemplateValues(
  document: Y.Doc,
  template: TaskTemplate,
  omitChanged: boolean,
): [string, PropertyValue][] {
  const current = new Map(
      getDatabaseProperties(document).map((property) => [
        property.id,
        property,
      ]),
    ),
    result: [string, PropertyValue][] = [];
  for (const property of template.properties) {
    const candidate = current.get(property.id);
    try {
      if (!templatePropertyMatches(candidate, property))
        throw new Error("속성 변경");
      result.push([
        property.id,
        validateDatabaseValue(candidate!, template.values[property.id] ?? null),
      ]);
    } catch {
      if (!omitChanged)
        throw new Error(
          "Template의 속성이 변경됐습니다. 변경된 속성을 제외할지 확인해주세요.",
        );
    }
  }
  return result;
}
export function assertTaskTemplates(document: Y.Doc): void {
  let count = 0;
  for (const [id, map] of document.getMap<Y.Map<unknown>>("taskTemplates")) {
    if (!(map instanceof Y.Map))
      throw new Error("Task Template 형식이 올바르지 않습니다.");
    if (map.get("deleted") === true) continue;
    const template = TaskTemplateSchema.parse({ ...map.toJSON(), id });
    for (const property of template.properties)
      validateDatabaseValue(property, template.values[property.id] ?? null);
    if (++count > MAX_TASK_TEMPLATES)
      throw new Error("Task Template은 최대 20개입니다.");
  }
}
