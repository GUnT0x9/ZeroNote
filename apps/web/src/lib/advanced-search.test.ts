import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  createSearchEngine,
  createTaskRow,
  getKnowledgeProjection,
  parseSearchQuery,
  type SearchHit,
} from "@zeronote/shared";
import {
  EMPTY_SEARCH_FILTERS,
  buildSearchQuery,
  localSearchSources,
  mergeSearchHits,
} from "./advanced-search";
import type { WorkspaceData } from "./hooks";

function data(): WorkspaceData {
  const workspaceId = crypto.randomUUID(),
    pageId = crypto.randomUUID(),
    createdAt = new Date().toISOString(),
    doc = new Y.Doc();
  doc.getText("title").insert(0, "Cached DB");
  createTaskRow(doc, "Row title");
  const result: WorkspaceData = {
    loaded: true,
    workspaces: [
      {
        id: workspaceId,
        name: "WS",
        ownerIdentityId: crypto.randomUUID(),
        createdAt,
        pendingCreation: false,
      },
    ],
    pages: [
      {
        id: pageId,
        workspaceId,
        kind: "database",
        title: "Cached DB",
        parentId: null,
        revision: 0,
        deletedAt: null,
        createdAt,
        isInbox: false,
        role: "owner",
      },
    ],
    documents: [
      {
        id: pageId,
        workspaceId,
        update: Y.encodeStateAsUpdate(doc),
        title: "Cached DB",
        text: "",
        references: [],
        generation: 1,
        committedGeneration: 0,
        state: "saved",
        updatedAt: Date.now(),
      },
    ],
    operations: [],
    pendingComments: [],
    identities: [],
  };
  doc.destroy();
  return result;
}
it("turns UI filters into the same AST as operators, with typed Property conditions", () => {
  const workspaceId = crypto.randomUUID(),
    databaseId = crypto.randomUUID();
  const query = buildSearchQuery("release", {
    ...EMPTY_SEARCH_FILTERS,
    workspaceId,
    type: "database",
    databaseId,
    tag: " ＦＯＯ ",
    after: "2026-10-01",
    before: "2026-11-01",
    properties: [
      { id: "condition", propertyId: "Points", operator: "gte", value: 5 },
    ],
  });
  expect(query).toEqual(
    parseSearchQuery(
      `release workspace:${workspaceId} type:database tag:foo after:2026-10-01 before:2026-11-01 database:${databaseId} prop:Points:gte:5`,
    ),
  );
  expect(() => buildSearchQuery('"unclosed', EMPTY_SEARCH_FILTERS)).toThrow();
  expect(() =>
    buildSearchQuery("", { ...EMPTY_SEARCH_FILTERS, after: "2026-02-30" }),
  ).toThrow();
});
it("loads legacy cached Rows once and excludes lost access, Trash ancestors and cycles", () => {
  const input = data(),
    sources = localSearchSources(input),
    engine = createSearchEngine(sources);
  expect(
    engine.search(parseSearchQuery('"Row title"')).hits[0]?.rowId,
  ).toBeTruthy();
  expect(input.documents[0]?.knowledge).toBeUndefined(); // search does not dirty a legacy cache
  engine.dispose();
  input.pages[0]!.ancestorTrashed = true;
  expect(localSearchSources(input)).toEqual([]);
  input.pages[0]!.ancestorTrashed = false;
  input.pages[0]!.accessLost = true;
  expect(localSearchSources(input)).toEqual([]);
});
it("keeps pending creations but never resurrects clean local non-matches or stale Row hits", () => {
  const input = data(),
    engine = createSearchEngine(localSearchSources(input)),
    local = engine.search(parseSearchQuery("Cached")).hits[0]!;
  const remote: SearchHit = {
    ...local,
    title: "Current remote",
    snippet: "fresh",
  };
  expect(mergeSearchHits([], [local], new Set())).toEqual([]);
  expect(mergeSearchHits([remote], [local], new Set())).toEqual([remote]);
  expect(mergeSearchHits([], [local], new Set([local.pageId]))).toEqual([
    local,
  ]);
  engine.dispose();
});
it("measures the actual matcher over 1000 Pages, a 500-block body and 1000 Rows", () => {
  const input = data(),
    prototype = input.pages[0]!;
  input.pages = Array.from({ length: 1000 }, (_, index) => ({
    ...prototype,
    id: crypto.randomUUID(),
    kind: index === 999 ? ("database" as const) : ("document" as const),
    title: `Benchmark ${index}`,
  }));
  const doc = new Y.Doc();
  for (let row = 0; row < 1000; row++) createTaskRow(doc, `Scale Task ${row}`);
  const last = input.pages[999]!;
  input.documents = [
    {
      ...input.documents[0]!,
      id: last.id,
      title: last.title,
      knowledge: { ...getKnowledgeProjection(doc), title: last.title },
    },
  ];
  const body = Array(500).fill("Performance block").join(" "),
    sources = localSearchSources(input);
  sources[998]!.projection = {
    version: 1,
    title: "Benchmark 998",
    body,
    tags: [],
    links: [],
    mode: "task",
    properties: [],
    rows: [],
  };
  const engine = createSearchEngine(sources);
  engine.search(parseSearchQuery("")); // Index/model preparation precedes keystroke measurement.
  const start = performance.now(),
    result = engine.search(parseSearchQuery('"Scale Task 999"'));
  expect(result.hits).toHaveLength(1);
  expect(performance.now() - start).toBeLessThan(200);
  engine.dispose();
  doc.destroy();
});
