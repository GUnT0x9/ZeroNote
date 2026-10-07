import type * as Y from "yjs";
import {
  createKnowledgeDatabase,
  type KnowledgeProjection,
} from "./knowledge-projection";
import {
  createDatabaseValueReader,
  type DatabaseValueReader,
} from "./database-computation";
import {
  matchesDatabasePropertyFilter,
  type DatabaseProperty,
  type PropertyValue,
} from "./database";
import { normalizeSearchText } from "./search-normalize";
import {
  compareSearchHits,
  type SearchHit,
  type SearchResponse,
} from "./search-results";
import type { SearchClause, SearchQuery } from "./search-query";
import type { Page, TaskRow } from "./index";

const MAX_FUZZY_TEXT = 32_768,
  MAX_FUZZY_WORDS = 2048,
  MAX_FUZZY_WORD_LENGTH = 64;
const SNIPPET_LENGTH = 180;
export interface SearchSource {
  page: Pick<Page, "id" | "workspaceId" | "kind" | "title" | "createdAt">;
  projection?: KnowledgeProjection;
  workspaceName: string;
  updatedAt: string;
}
export interface SearchScope {
  fileName?: (pageId: string, fileId: string) => string | undefined;
  personName?: (workspaceId: string, identityId: string) => string | undefined;
}
export function matchesSearchMetadataFilters(
  source: SearchSource,
  query: SearchQuery,
): boolean {
  const { page } = source;
  const hit: SearchHit = {
    pageId: page.id,
    workspaceId: page.workspaceId,
    rowId: null,
    kind: page.kind,
    title: page.title,
    pageTitle: page.title,
    workspaceName: source.workspaceName,
    updatedAt: source.updatedAt,
    tags: [],
    snippet: "",
    score: 0,
    fuzzy: false,
  };
  return query.clauses.every(
    (clause) =>
      clause.kind !== "filter" ||
      !["workspace", "type", "database"].includes(clause.field) ||
      filterMatch(hit, clause) !== clause.excluded,
  );
}
interface SearchCell {
  property: DatabaseProperty;
  value: PropertyValue;
  label: string;
  available: boolean;
}
interface Candidate {
  hit: SearchHit;
  body: string;
  normalized: string;
  title: string;
  words?: string[];
  cells?: SearchCell[];
}
function searchSnippet(candidate: Candidate, query: SearchQuery): string {
  const conditions = query.clauses.filter(
    (clause) => clause.kind === "property",
  );
  const properties =
    candidate.cells?.filter(
      (cell) =>
        cell.available &&
        cell.value !== null &&
        cell.value !== "" &&
        cell.label &&
        cell.property.id !== "title" &&
        (conditions.length
          ? conditions.some(
              (clause) =>
                clause.property === cell.property.id ||
                normalizeSearchText(clause.property) ===
                  normalizeSearchText(cell.property.name),
            )
          : !["createdAt", "updatedAt"].includes(cell.property.id)),
    ) ?? [];
  const raw =
    (conditions.length
      ? properties
          .map((cell) => `${cell.property.name}: ${cell.label}`)
          .join(" · ")
      : candidate.body ||
        properties
          .map((cell) => `${cell.property.name}: ${cell.label}`)
          .join(" · ")) || candidate.hit.tags.join(" · ");
  const text = raw.normalize("NFKC").replace(/\s+/gu, " ").trim(),
    normalized = normalizeSearchText(text);
  const positions = query.clauses.flatMap((clause) =>
    clause.kind === "text" && !clause.excluded
      ? [normalized.indexOf(normalizeSearchText(clause.value))].filter(
          (position) => position >= 0,
        )
      : [],
  );
  const start = Math.max(0, (positions[0] ?? 0) - 40);
  return `${start ? "…" : ""}${text.slice(start, start + SNIPPET_LENGTH)}`;
}

/** Bounded single edit, including adjacent transposition. Exact/phrase/exclusion do not use this. */
export function isSingleSearchEdit(a: string, b: string): boolean {
  const left = Array.from(a),
    right = Array.from(b);
  if (
    Math.abs(left.length - right.length) > 1 ||
    Math.max(left.length, right.length) > MAX_FUZZY_WORD_LENGTH
  )
    return false;
  let index = 0;
  while (
    left[index] === right[index] &&
    index < Math.min(left.length, right.length)
  )
    index++;
  if (index === Math.min(left.length, right.length)) return true;
  if (left.length === right.length) {
    if (left.slice(index + 1).join("") === right.slice(index + 1).join(""))
      return true;
    return (
      left[index] === right[index + 1] &&
      left[index + 1] === right[index] &&
      left.slice(index + 2).join("") === right.slice(index + 2).join("")
    );
  }
  return left.length > right.length
    ? left.slice(index + 1).join("") === right.slice(index).join("")
    : left.slice(index).join("") === right.slice(index + 1).join("");
}
function textMatch(
  candidate: Candidate,
  clause: Extract<SearchClause, { kind: "text" }>,
): { score: number; fuzzy: boolean; position: number } | null {
  const term = normalizeSearchText(clause.value),
    position = candidate.normalized.indexOf(term);
  if (position >= 0)
    return {
      score:
        candidate.title === term
          ? 100
          : candidate.title.startsWith(term)
            ? 70
            : candidate.title.includes(term)
              ? 50
              : 10,
      fuzzy: false,
      position,
    };
  if (
    clause.phrase ||
    clause.excluded ||
    term.length < 3 ||
    term.length > MAX_FUZZY_WORD_LENGTH ||
    !/\p{L}/u.test(term) ||
    /\s/u.test(term)
  )
    return null;
  candidate.words ??=
    candidate.normalized
      .slice(0, MAX_FUZZY_TEXT)
      .match(/[\p{L}\p{N}_]+/gu)
      ?.slice(0, MAX_FUZZY_WORDS) ?? [];
  const word = candidate.words.find((value) => isSingleSearchEdit(term, value));
  return word
    ? { score: 1, fuzzy: true, position: candidate.normalized.indexOf(word) }
    : null;
}
function filterMatch(
  hit: SearchHit,
  clause: Extract<SearchClause, { kind: "filter" }>,
): boolean {
  const value = normalizeSearchText(clause.value);
  if (clause.field === "type") return hit.kind === value;
  if (clause.field === "tag")
    return hit.tags.some((tag) => normalizeSearchText(tag) === value);
  if (clause.field === "workspace")
    return (
      hit.workspaceId === value ||
      normalizeSearchText(hit.workspaceName) === value
    );
  if (clause.field === "database")
    return hit.kind === "database" && hit.pageId === value;
  const day = hit.updatedAt.slice(0, 10);
  return clause.field === "after" ? day >= value : day < value;
}
function propertyMatch(
  candidate: Candidate,
  clause: Extract<SearchClause, { kind: "property" }>,
): boolean | null {
  if (!candidate.cells) return null;
  const byId = candidate.cells.find(
    (cell) => cell.property.id === clause.property,
  );
  const named = candidate.cells.filter(
    (cell) =>
      normalizeSearchText(cell.property.name) ===
      normalizeSearchText(clause.property),
  );
  const cell = byId ?? (named.length === 1 ? named[0] : undefined);
  // Missing/ambiguous/inaccessible values are unknown, including under negation.
  if (!cell?.available) return null;
  return matchesDatabasePropertyFilter(
    cell.value,
    cell.property,
    {
      propertyId: cell.property.id,
      operator: clause.operator,
      value: clause.value,
    },
    cell.label,
  );
}
function matchCandidate(
  candidate: Candidate,
  query: SearchQuery,
): SearchHit | null {
  let score = 0,
    fuzzy = false;
  for (const clause of query.clauses) {
    let matched: boolean | null;
    if (clause.kind === "text") {
      const match = textMatch(candidate, clause);
      matched = match !== null;
      if (match && !clause.excluded) {
        score += match.score;
        fuzzy ||= match.fuzzy;
      }
    } else
      matched =
        clause.kind === "filter"
          ? filterMatch(candidate.hit, clause)
          : propertyMatch(candidate, clause);
    if (matched === null || matched === clause.excluded) return null;
  }
  return {
    ...candidate.hit,
    score,
    fuzzy,
    snippet: searchSnippet(candidate, query),
  };
}

/** Snapshot of already-authorized source values. Recreate after edits or permission changes. */
export function createSearchEngine(
  sources: SearchSource[],
  scope: SearchScope = {},
) {
  const byId = new Map(sources.map((source) => [source.page.id, source]));
  const models = new Map<string, Y.Doc>(),
    candidates = new Map<string, Candidate[]>();
  let unavailableProperties = 0;
  const model = (id: string): Y.Doc | undefined => {
    const source = byId.get(id);
    if (source?.page.kind !== "database" || !source.projection)
      return undefined;
    let document = models.get(id);
    if (!document) {
      document = createKnowledgeDatabase(source.projection);
      models.set(id, document);
    }
    return document;
  };
  const readCells = (
    row: TaskRow,
    properties: DatabaseProperty[],
    reader: DatabaseValueReader,
  ): SearchCell[] =>
    properties.map((property) => {
      const cell = reader.cell(row, property);
      if (cell.error) unavailableProperties++;
      return {
        property,
        value: cell.value,
        label: cell.error ? "" : reader.label(row, property),
        available: !cell.error,
      };
    });
  const makeCandidate = (
    hit: SearchHit,
    body: string,
    cells?: SearchCell[],
  ): Candidate => {
    const text = [
      hit.title,
      body,
      ...hit.tags,
      ...(cells?.filter((cell) => cell.available).map((cell) => cell.label) ??
        []),
    ].join(" ");
    return {
      hit,
      body,
      normalized: normalizeSearchText(text),
      title: normalizeSearchText(hit.title),
      cells,
    };
  };
  const prepare = (source: SearchSource): Candidate[] => {
    const { page, projection } = source,
      title = projection?.title || page.title;
    const hit: SearchHit = {
      pageId: page.id,
      workspaceId: page.workspaceId,
      rowId: null,
      kind: page.kind,
      title,
      pageTitle: title,
      workspaceName: source.workspaceName,
      updatedAt: source.updatedAt,
      tags: projection?.tags ?? [],
      snippet: "",
      score: 0,
      fuzzy: false,
    };
    const result = [makeCandidate(hit, projection?.body ?? "")],
      document = model(page.id);
    if (!document || !projection) return result;
    const reader = createDatabaseValueReader(page.id, document, {
      database: (id) =>
        byId.get(id)?.page.workspaceId === page.workspaceId
          ? model(id)
          : undefined,
      fileName: scope.fileName,
      personName: (id) => scope.personName?.(page.workspaceId, id),
    });
    for (const { row, body } of projection.rows) {
      const cells = readCells(row, projection.properties, reader);
      result.push(
        makeCandidate(
          {
            ...hit,
            rowId: row.id,
            title: row.title || "제목 없음",
            tags: [...new Set([...hit.tags, ...row.labels])],
            updatedAt: row.updatedAt ?? source.updatedAt,
          },
          body,
          cells,
        ),
      );
    }
    return result;
  };
  return {
    search(
      query: SearchQuery,
      limit = 30,
      pageIds: string[] = sources.map((source) => source.page.id),
    ): SearchResponse {
      const hits: SearchHit[] = [];
      for (const id of pageIds) {
        const source = byId.get(id);
        if (!source || !matchesSearchMetadataFilters(source, query)) continue;
        let items = candidates.get(id);
        if (!items) {
          items = prepare(source);
          candidates.set(id, items);
        }
        for (const candidate of items) {
          // Blank query lists Pages; Row discovery requires a query/filter.
          if (candidate.hit.rowId && !query.clauses.length) continue;
          const hit = matchCandidate(candidate, query);
          if (hit) hits.push(hit);
        }
      }
      return {
        hits: hits.sort(compareSearchHits).slice(0, limit),
        searchedPages: pageIds.filter((id) => byId.has(id)).length,
        unavailableProperties,
      };
    },
    dispose(): void {
      for (const document of models.values()) document.destroy();
      models.clear();
      candidates.clear();
    },
  };
}
