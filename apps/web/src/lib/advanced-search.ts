import * as Y from "yjs";
import {
  getKnowledgeProjection,
  normalizeSearchText,
  parseSearchQuery,
  SearchQuerySchema,
  compareSearchHits,
  type KnowledgeProjection,
  type SearchQuery,
  type SearchClause,
  type SearchSource,
  type SearchHit,
  type PropertyValue,
  type DatabaseFilter,
} from "@zeronote/shared";
import type { WorkspaceData } from "./hooks";
import { availablePages } from "./search";
import type { LocalDocument } from "./database";

export interface SearchPropertyCondition {
  id: string;
  propertyId: string;
  operator: DatabaseFilter["operator"];
  value: PropertyValue;
}
export interface SearchFilters {
  workspaceId: string;
  type: "" | "document" | "database";
  tag: string;
  after: string;
  before: string;
  databaseId: string;
  properties: SearchPropertyCondition[];
}
export const EMPTY_SEARCH_FILTERS: SearchFilters = {
  workspaceId: "",
  type: "",
  tag: "",
  after: "",
  before: "",
  databaseId: "",
  properties: [],
};
export function buildSearchQuery(
  text: string,
  filters: SearchFilters,
): SearchQuery {
  const clauses = [...parseSearchQuery(text).clauses];
  const add = (
    field: Extract<SearchClause, { kind: "filter" }>["field"],
    value: string,
  ) => {
    if (value.trim())
      clauses.push({
        kind: "filter",
        field,
        value: field === "tag" ? normalizeSearchText(value) : value,
        excluded: false,
      });
  };
  add("workspace", filters.workspaceId);
  add("type", filters.type);
  add("tag", filters.tag);
  add("after", filters.after);
  add("before", filters.before);
  add("database", filters.databaseId);
  for (const condition of filters.properties)
    clauses.push({
      kind: "property",
      property: condition.propertyId,
      operator: condition.operator,
      value: condition.value,
      excluded: false,
    });
  return SearchQuerySchema.parse({ clauses });
}
export function localKnowledge(record: LocalDocument): KnowledgeProjection {
  if (record.knowledge) return record.knowledge;
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, record.update);
    return getKnowledgeProjection(document);
  } finally {
    document.destroy();
  }
}
export function localSearchSources(data: WorkspaceData): SearchSource[] {
  const documents = new Map(
    data.documents.map((record) => [record.id, record]),
  );
  return availablePages(data.pages).map((page) => {
    const record = documents.get(page.id);
    return {
      page,
      projection: record ? localKnowledge(record) : undefined,
      workspaceName:
        data.workspaces.find((workspace) => workspace.id === page.workspaceId)
          ?.name ?? "Workspace",
      updatedAt: record
        ? new Date(record.updatedAt).toISOString()
        : new Date(page.createdAt).toISOString(),
    };
  });
}
/** Once server scope is known, stale clean caches cannot reintroduce a server non-match. */
export function mergeSearchHits(
  remote: SearchHit[],
  local: SearchHit[],
  pendingPageIds: Set<string>,
  limit = 30,
): SearchHit[] {
  const merged = new Map(
    remote.map((hit) => [`${hit.pageId}:${hit.rowId ?? ""}`, hit]),
  );
  for (const hit of local)
    if (pendingPageIds.has(hit.pageId))
      merged.set(`${hit.pageId}:${hit.rowId ?? ""}`, hit);
  return [...merged.values()].sort(compareSearchHits).slice(0, limit);
}
