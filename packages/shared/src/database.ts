import { z } from "zod";
import {
  PropertyValueSchema,
  DatabaseFilterSchema,
  type PropertyValue,
  type DatabaseFilter,
} from "./database-values";
export {
  PropertyValueSchema,
  DatabaseFilterSchema,
  FilterOperators,
  type PropertyValue,
  type DatabaseFilter,
} from "./database-values";
import * as Y from "yjs";
import type { DatabaseValueReader } from "./database-computation";
import {
  assertFormulaNode,
  MAX_FORMULA_LENGTH,
  type FormulaNode,
} from "./formula";
import {
  getTaskRows,
  replaceSharedText,
  updateTaskField,
  isValidDateOnly,
  type TaskRow,
  type Identity,
} from "./index";

export const MAX_DATABASE_PROPERTIES = 64;
export const MAX_DATABASE_LINKS = 50;
export const MAX_DATABASE_VIEWS = 20;
export const PropertyTypes = [
  "text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "checkbox",
  "person",
  "url",
  "email",
  "phone",
  "created_time",
  "updated_time",
  "file",
  "formula",
  "relation",
  "rollup",
] as const;
export const PropertyTypeSchema = z.enum(PropertyTypes);
export type PropertyType = z.infer<typeof PropertyTypeSchema>;
export const PropertyOptionSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(80),
  })
  .strict();
export const RollupOperations = [
  "count",
  "count_values",
  "unique",
  "sum",
  "average",
  "min",
  "max",
] as const;
export const FormulaDefinitionSchema = z
  .object({
    source: z.string().min(1).max(MAX_FORMULA_LENGTH),
    ast: z.custom<FormulaNode>((value) => {
      try {
        assertFormulaNode(value);
        return true;
      } catch {
        return false;
      }
    }, "수식 형식이 올바르지 않습니다."),
  })
  .strict();
export const RelationDefinitionSchema = z
  .object({ databaseId: z.uuid() })
  .strict();
export const RollupDefinitionSchema = z
  .object({
    relationPropertyId: z.string().min(1).max(80),
    targetPropertyId: z.string().min(1).max(80),
    operation: z.enum(RollupOperations),
  })
  .strict();
export type FormulaDefinition = z.infer<typeof FormulaDefinitionSchema>;
export type RelationDefinition = z.infer<typeof RelationDefinitionSchema>;
export type RollupDefinition = z.infer<typeof RollupDefinitionSchema>;
export interface DatabasePropertyConfiguration {
  formula?: FormulaDefinition;
  relation?: RelationDefinition;
  rollup?: RollupDefinition;
}
export const DatabasePropertySchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    type: PropertyTypeSchema,
    options: z.array(PropertyOptionSchema).max(50).default([]),
    builtin: z.boolean().default(false),
    deleted: z.boolean().default(false),
    formula: FormulaDefinitionSchema.optional(),
    relation: RelationDefinitionSchema.optional(),
    rollup: RollupDefinitionSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.options.map((option) => option.id)).size ===
      value.options.length,
    "Duplicate option IDs",
  )
  .refine(
    (value) =>
      ["formula", "relation", "rollup"].every(
        (kind) =>
          (value.type === kind) ===
          !!value[kind as keyof DatabasePropertyConfiguration],
      ),
    "속성 종류와 설정이 일치해야 합니다.",
  );
export type DatabaseProperty = z.infer<typeof DatabasePropertySchema>;
export const DatabaseViewKinds = [
  "table",
  "board",
  "calendar",
  "timeline",
  "gallery",
  "list",
] as const;
export type DatabaseViewKind = (typeof DatabaseViewKinds)[number];
export const DatabaseViewSchema = z
  .object({
    id: z.string().min(1).max(80),
    name: z.string().trim().min(1).max(80),
    kind: z.enum(DatabaseViewKinds),
    filters: z.array(DatabaseFilterSchema).max(20).default([]),
    sorts: z
      .array(
        z
          .object({
            propertyId: z.string(),
            direction: z.enum(["asc", "desc"]),
          })
          .strict(),
      )
      .max(5)
      .default([]),
    groupBy: z.string().nullable().default(null),
    datePropertyId: z.string().nullable().default("dueDate"),
    endDatePropertyId: z.string().nullable().default(null),
    hiddenPropertyIds: z.array(z.string()).max(80).default([]),
  })
  .strict();
export type DatabaseView = z.infer<typeof DatabaseViewSchema>;
export const DEFAULT_HIDDEN_PROPERTIES = [
  "startDate",
  "endDate",
  "createdAt",
  "updatedAt",
];
const option = (id: string, name: string) => ({ id, name });
const builtin = (
  id: string,
  name: string,
  type: PropertyType,
  options: DatabaseProperty["options"] = [],
): DatabaseProperty => ({
  id,
  name,
  type,
  options,
  builtin: true,
  deleted: false,
});
const TASK_PROPERTIES: DatabaseProperty[] = [
  builtin("title", "Task", "text"),
  builtin("status", "Status", "status", [
    option("todo", "Todo"),
    option("in_progress", "In progress"),
    option("done", "Done"),
  ]),
  builtin("assigneeId", "Assignee", "person"),
  builtin("dueDate", "Due date", "date"),
  builtin("priority", "Priority", "select", [
    option("low", "Low"),
    option("medium", "Medium"),
    option("high", "High"),
  ]),
  builtin("startDate", "Start date", "date"),
  builtin("endDate", "End date", "date"),
  builtin("createdAt", "Created time", "created_time"),
  builtin("updatedAt", "Updated time", "updated_time"),
];
export function getDatabaseMode(document: Y.Doc): "task" | "generic" {
  return document.getMap("databaseConfig").get("mode") === "generic"
    ? "generic"
    : "task";
}
export function initializeGenericDatabase(document: Y.Doc): void {
  if (getTaskRows(document).length)
    throw new Error("기존 Task Database는 변환할 수 없습니다.");
  document.getMap("databaseConfig").set("mode", "generic");
}
export function getDatabaseProperties(document: Y.Doc): DatabaseProperty[] {
  const defaults =
    getDatabaseMode(document) === "generic"
      ? [
          builtin("title", "이름", "text"),
          ...TASK_PROPERTIES.filter((property) =>
            ["createdAt", "updatedAt"].includes(property.id),
          ),
        ]
      : TASK_PROPERTIES;
  return [
    ...defaults,
    ...Array.from(
      document.getMap<Y.Map<unknown>>("databaseProperties").entries(),
    ).flatMap(([id, row]) => {
      if (!(row instanceof Y.Map)) return [];
      const parsed = DatabasePropertySchema.safeParse({
        ...row.toJSON(),
        id,
        builtin: false,
      });
      return parsed.success && !parsed.data.deleted ? [parsed.data] : [];
    }),
  ];
}
export function addDatabaseProperty(
  document: Y.Doc,
  name: string,
  type: PropertyType,
  names: string[] = [],
  id: string = crypto.randomUUID(),
  configuration: DatabasePropertyConfiguration = {},
): string {
  if (
    getDatabaseProperties(document).filter((property) => !property.builtin)
      .length >= MAX_DATABASE_PROPERTIES
  )
    throw new Error("속성은 최대 64개입니다.");
  if (getDatabaseProperties(document).some((property) => property.id === id))
    throw new Error("속성 ID가 이미 있습니다.");
  const options = [
    ...new Set(names.map((value) => value.trim()).filter(Boolean)),
  ].map((value) => option(crypto.randomUUID(), value));
  if (["select", "multi_select", "status"].includes(type) && !options.length)
    throw new Error("선택 항목을 하나 이상 입력해주세요.");
  const property = DatabasePropertySchema.parse({
    id,
    name,
    type,
    options,
    builtin: false,
    deleted: false,
    ...configuration,
  });
  const row = new Y.Map<unknown>();
  document.transact(() => {
    document.getMap<Y.Map<unknown>>("databaseProperties").set(id, row);
    for (const [key, value] of Object.entries(property)) row.set(key, value);
  });
  return id;
}
export function changeDatabaseProperty(
  document: Y.Doc,
  id: string,
  change: { name?: string; deleted?: boolean } & Pick<
    DatabasePropertyConfiguration,
    "formula" | "rollup" | "relation"
  >,
): void {
  const property = getDatabaseProperties(document).find(
    (entry) => entry.id === id,
  );
  if (!property || property.builtin)
    throw new Error("기본 속성은 변경하거나 삭제할 수 없습니다.");
  const parsed = DatabasePropertySchema.parse({ ...property, ...change });
  document.transact(() => {
    const map = document.getMap<Y.Map<unknown>>("databaseProperties").get(id)!;
    for (const key of Object.keys(change) as (keyof typeof change)[])
      map.set(key, parsed[key]);
    if (
      change.relation &&
      property.relation?.databaseId !== change.relation.databaseId
    )
      for (const row of document.getMap<Y.Map<unknown>>("tasks").values())
        if (row instanceof Y.Map) row.delete(`property:${id}`);
  });
}
export function readDatabaseValue(
  document: Y.Doc,
  row: TaskRow,
  property: DatabaseProperty,
): PropertyValue {
  if (["formula", "rollup"].includes(property.type)) return null;
  if (property.type === "created_time") return row.createdAt;
  if (property.type === "updated_time") return row.updatedAt;
  const value: unknown = property.builtin
    ? row[property.id as keyof TaskRow]
    : document
        .getMap<Y.Map<unknown>>("tasks")
        .get(row.id)
        ?.get(`property:${property.id}`);
  const parsed = PropertyValueSchema.safeParse(
    value ?? (property.type === "checkbox" ? false : null),
  );
  return parsed.success ? parsed.data : null;
}
export function validateDatabaseValue(
  property: DatabaseProperty,
  value: unknown,
): PropertyValue {
  if (value === null || value === "") return null;
  if (property.type === "number") return z.number().finite().parse(value);
  if (property.type === "checkbox") return z.boolean().parse(value);
  if (["file", "relation"].includes(property.type))
    return z
      .array(z.uuid())
      .max(MAX_DATABASE_LINKS)
      .refine((ids) => new Set(ids).size === ids.length, "중복 항목입니다.")
      .parse(value);
  if (property.type === "multi_select")
    return z
      .array(z.enum(property.options.map((entry) => entry.id)))
      .max(MAX_DATABASE_LINKS)
      .parse(value);
  const text = z.string().max(10000).parse(value);
  if (property.type === "date" && !isValidDateOnly(text))
    throw new Error("유효한 날짜를 입력해주세요.");
  if (
    ["select", "status"].includes(property.type) &&
    !property.options.some((entry) => entry.id === text)
  )
    throw new Error("유효한 선택 항목이 아닙니다.");
  if (property.type === "person") z.uuid().parse(text);
  if (property.type === "url") {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol))
      throw new Error("http 또는 https URL만 사용할 수 있습니다.");
  }
  if (property.type === "email") z.email().parse(text);
  return text;
}
export function writeDatabaseValue(
  document: Y.Doc,
  rowId: string,
  propertyId: string,
  value: unknown,
): void {
  const property = getDatabaseProperties(document).find(
    (entry) => entry.id === propertyId,
  );
  const row = document.getMap<Y.Map<unknown>>("tasks").get(rowId);
  if (!property || !row || row.get("deleted") === true)
    throw new Error("속성 또는 항목을 찾을 수 없습니다.");
  if (
    ["created_time", "updated_time", "formula", "rollup"].includes(
      property.type,
    )
  )
    throw new Error("자동 기록 속성은 수정할 수 없습니다.");
  const parsed = validateDatabaseValue(property, value);
  if (property.builtin && property.id !== "title") {
    updateTaskField(
      document,
      rowId,
      property.id as Exclude<keyof TaskRow, "id" | "title">,
      parsed,
    );
    return;
  }
  document.transact(() => {
    if (property.id === "title") {
      const title = row.get("title");
      if (title instanceof Y.Text)
        replaceSharedText(
          title,
          z
            .string()
            .max(500)
            .parse(parsed ?? ""),
        );
    } else row.set(`property:${property.id}`, parsed);
    row.set("updatedAt", new Date().toISOString());
  });
}
export function databaseValueLabel(
  property: DatabaseProperty,
  value: PropertyValue,
  identities: Identity[] = [],
): string {
  if (value === null) return "미지정";
  if (Array.isArray(value))
    return value
      .map(
        (id) => property.options.find((entry) => entry.id === id)?.name ?? id,
      )
      .join(", ");
  if (typeof value === "boolean") return value ? "체크됨" : "미체크";
  if (["select", "status"].includes(property.type))
    return (
      property.options.find((entry) => entry.id === value)?.name ??
      String(value)
    );
  if (property.type === "person")
    return (
      identities.find((entry) => entry.id === value)?.name ?? "알 수 없는 기기"
    );
  return String(value);
}
export function defaultDatabaseView(
  kind: DatabaseViewKind,
  document: Y.Doc,
): DatabaseView {
  const dates = getDatabaseProperties(document).filter(
    (property) => property.type === "date",
  );
  return DatabaseViewSchema.parse({
    id: `default-${kind}`,
    name: kind[0]!.toUpperCase() + kind.slice(1),
    kind,
    groupBy:
      kind === "board"
        ? (getDatabaseProperties(document).find((property) =>
            ["status", "select"].includes(property.type),
          )?.id ?? null)
        : null,
    datePropertyId:
      dates.find((property) => property.id === "dueDate")?.id ??
      dates[0]?.id ??
      null,
    hiddenPropertyIds: DEFAULT_HIDDEN_PROPERTIES,
  });
}
export function getDatabaseViews(document: Y.Doc): DatabaseView[] {
  return Array.from(
    document.getMap<Y.Map<unknown>>("databaseViews").entries(),
  ).flatMap(([id, map]) => {
    const parsed = DatabaseViewSchema.safeParse(
      map instanceof Y.Map ? { ...map.toJSON(), id } : null,
    );
    return parsed.success ? [parsed.data] : [];
  });
}
export function saveDatabaseView(document: Y.Doc, view: DatabaseView): void {
  const parsed = DatabaseViewSchema.parse(view),
    maps = document.getMap<Y.Map<unknown>>("databaseViews");
  if (!maps.has(parsed.id) && maps.size >= MAX_DATABASE_VIEWS)
    throw new Error("보기는 최대 20개입니다.");
  const ids = new Set(
    getDatabaseProperties(document).map((property) => property.id),
  );
  if (
    [
      ...parsed.filters.map((filter) => filter.propertyId),
      ...parsed.sorts.map((sort) => sort.propertyId),
      parsed.groupBy,
      parsed.datePropertyId,
      parsed.endDatePropertyId,
    ].some((id) => id !== null && !ids.has(id))
  )
    throw new Error("삭제된 속성은 보기에서 사용할 수 없습니다.");
  document.transact(() => {
    let map = maps.get(parsed.id);
    if (!map) {
      map = new Y.Map();
      maps.set(parsed.id, map);
    }
    for (const [key, value] of Object.entries(parsed))
      if (JSON.stringify(map.get(key)) !== JSON.stringify(value))
        map.set(key, value);
  });
}
export function deleteDatabaseView(document: Y.Doc, id: string): void {
  document.getMap("databaseViews").delete(id);
}
export function remapDatabasePageIds(
  document: Y.Doc,
  ids: Map<string, string>,
): void {
  document.transact(() => {
    for (const property of document
      .getMap<Y.Map<unknown>>("databaseProperties")
      .values()) {
      if (!(property instanceof Y.Map)) continue;
      const relation = RelationDefinitionSchema.safeParse(
        property.get("relation"),
      );
      if (relation.success && ids.has(relation.data.databaseId))
        property.set("relation", {
          ...relation.data,
          databaseId: ids.get(relation.data.databaseId)!,
        });
    }
  });
}
export function assertDatabaseState(document: Y.Doc): void {
  const custom = document.getMap<Y.Map<unknown>>("databaseProperties");
  const builtinIds = new Set(
    getDatabaseProperties(document)
      .filter((property) => property.builtin)
      .map((property) => property.id),
  );
  let active = 0;
  for (const [id, value] of custom) {
    if (!(value instanceof Y.Map))
      throw new Error("속성 정의 형식이 올바르지 않습니다.");
    if (value.get("deleted") === true) continue;
    if (++active > MAX_DATABASE_PROPERTIES || builtinIds.has(id))
      throw new Error("속성 개수 또는 ID가 올바르지 않습니다.");
    const parsed = DatabasePropertySchema.safeParse({
      ...value.toJSON(),
      id,
      builtin: false,
    });
    if (!parsed.success) throw new Error("속성 정의 형식이 올바르지 않습니다.");
    if (["file", "relation"].includes(parsed.data.type))
      for (const row of document.getMap<Y.Map<unknown>>("tasks").values())
        if (row instanceof Y.Map && row.get("deleted") !== true)
          validateDatabaseValue(parsed.data, row.get(`property:${id}`) ?? null);
  }
}
function isEmpty(value: PropertyValue): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}
export function matchesDatabaseFilter(
  value: PropertyValue,
  filter: DatabaseFilter,
): boolean {
  if (filter.operator === "empty") return isEmpty(value);
  if (filter.operator === "not_empty") return !isEmpty(value);
  if (filter.operator === "contains")
    return String(value ?? "")
      .toLocaleLowerCase()
      .includes(String(filter.value ?? "").toLocaleLowerCase());
  const equal = Array.isArray(value)
    ? value.includes(String(filter.value))
    : value === filter.value;
  if (filter.operator === "equals") return equal;
  if (filter.operator === "not_equals") return !equal;
  if (isEmpty(value) || isEmpty(filter.value)) return false;
  const comparison =
    typeof value === "number" && typeof filter.value === "number"
      ? value - filter.value
      : String(value).localeCompare(String(filter.value));
  return filter.operator === "gt"
    ? comparison > 0
    : filter.operator === "gte"
      ? comparison >= 0
      : filter.operator === "lt"
        ? comparison < 0
        : comparison <= 0;
}
export function matchesDatabasePropertyFilter(
  value: PropertyValue,
  property: DatabaseProperty,
  filter: DatabaseFilter,
  label?: string,
): boolean {
  const computed = ["formula", "rollup"].includes(property.type);
  const typedFilter =
    computed &&
    typeof filter.value === "string" &&
    typeof value === "number" &&
    filter.value.trim() !== "" &&
    Number.isFinite(Number(filter.value))
      ? { ...filter, value: Number(filter.value) }
      : computed &&
          typeof value === "boolean" &&
          ["true", "false"].includes(String(filter.value))
        ? { ...filter, value: filter.value === "true" }
        : filter;
  const useLabel =
    label !== undefined &&
    ["file", "relation"].includes(property.type) &&
    !["empty", "not_empty"].includes(filter.operator);
  return matchesDatabaseFilter(useLabel ? label : value, typedFilter);
}
export function queryDatabaseRows(
  document: Y.Doc,
  view: DatabaseView,
  query = "",
  identities: Identity[] = [],
  reader?: DatabaseValueReader,
): TaskRow[] {
  const properties = getDatabaseProperties(document),
    lookup = new Map(properties.map((property) => [property.id, property]));
  const rows = getTaskRows(document).filter(
    (row) =>
      (row.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
        (!!reader &&
          properties.some(
            (property) =>
              !reader.cell(row, property).error &&
              reader
                .label(row, property)
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
          ))) &&
      view.filters.every((filter) => {
        const property = lookup.get(filter.propertyId);
        if (!property) return true;
        const result = reader?.cell(row, property);
        if (result?.error) return false;
        const value = reader
          ? result!.value
          : readDatabaseValue(document, row, property);
        return matchesDatabasePropertyFilter(
          value,
          property,
          filter,
          reader &&
            ["file", "relation"].includes(property.type) &&
            !["empty", "not_empty"].includes(filter.operator)
            ? reader.label(row, property)
            : undefined,
        );
      }),
  );
  return rows.sort((a, b) => {
    for (const sort of view.sorts) {
      const property = lookup.get(sort.propertyId);
      if (!property) continue;
      const left = reader
          ? reader.cell(a, property).value
          : readDatabaseValue(document, a, property),
        right = reader
          ? reader.cell(b, property).value
          : readDatabaseValue(document, b, property);
      if (isEmpty(left) || isEmpty(right)) {
        if (isEmpty(left) !== isEmpty(right)) return isEmpty(left) ? 1 : -1;
        continue;
      }
      const choiceRank = (value: PropertyValue) => {
        const index = property.options.findIndex((entry) => entry.id === value);
        return index < 0 ? Number.MAX_SAFE_INTEGER : index;
      };
      const comparison =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : ["select", "status"].includes(property.type)
            ? choiceRank(left) - choiceRank(right)
            : (reader
                ? reader.label(a, property)
                : databaseValueLabel(property, left, identities)
              ).localeCompare(
                reader
                  ? reader.label(b, property)
                  : databaseValueLabel(property, right, identities),
                "ko",
                { numeric: true },
              );
      if (comparison)
        return sort.direction === "asc" ? comparison : -comparison;
    }
    return 0;
  });
}
export interface DatabaseGroup {
  key: string;
  label: string;
  value: PropertyValue;
  rows: TaskRow[];
}
export function groupDatabaseRows(
  document: Y.Doc,
  rows: TaskRow[],
  propertyId: string | null,
  identities: Identity[] = [],
  reader?: DatabaseValueReader,
): DatabaseGroup[] {
  const property = getDatabaseProperties(document).find(
    (entry) => entry.id === propertyId,
  );
  if (!property) return [{ key: "all", label: "전체", value: null, rows }];
  const groups = new Map<string, DatabaseGroup>();
  for (const entry of property.options)
    groups.set(JSON.stringify(entry.id), {
      key: JSON.stringify(entry.id),
      label: entry.name,
      value: entry.id,
      rows: [],
    });
  if (property.type === "checkbox")
    for (const value of [false, true])
      groups.set(JSON.stringify(value), {
        key: JSON.stringify(value),
        label: databaseValueLabel(property, value),
        value,
        rows: [],
      });
  if (property.type === "person")
    for (const identity of identities)
      groups.set(JSON.stringify(identity.id), {
        key: JSON.stringify(identity.id),
        label: identity.name,
        value: identity.id,
        rows: [],
      });
  for (const row of rows) {
    const result = reader?.cell(row, property);
    const value = reader
        ? result!.value
        : readDatabaseValue(document, row, property),
      key = result?.error ? "computation-error" : JSON.stringify(value);
    if (!groups.has(key))
      groups.set(key, {
        key,
        label: reader
          ? reader.label(row, property)
          : databaseValueLabel(property, value, identities),
        value,
        rows: [],
      });
    groups.get(key)!.rows.push(row);
  }
  return [...groups.values()];
}
export function calendarMonthDays(month: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month) || !isValidDateOnly(`${month}-01`))
    throw new Error("유효한 월이 아닙니다.");
  const first = new Date(`${month}-01T00:00:00Z`),
    start = new Date(first);
  start.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}
export function shiftCalendarMonth(month: string, delta: number): string {
  calendarMonthDays(month);
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 7);
}
export function databaseRowDateRange(
  document: Y.Doc,
  row: TaskRow,
  view: DatabaseView,
): { start: string; end: string } | null {
  const properties = getDatabaseProperties(document),
    startProperty = properties.find(
      (property) =>
        property.id === view.datePropertyId && property.type === "date",
    ),
    endProperty = properties.find(
      (property) =>
        property.id === view.endDatePropertyId && property.type === "date",
    );
  const start = startProperty
      ? readDatabaseValue(document, row, startProperty)
      : null,
    end = endProperty ? readDatabaseValue(document, row, endProperty) : start;
  if (typeof start !== "string" || !isValidDateOnly(start)) return null;
  return {
    start,
    end:
      typeof end === "string" && isValidDateOnly(end) && end >= start
        ? end
        : start,
  };
}
