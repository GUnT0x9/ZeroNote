import { expect, it } from "vitest";
import * as Y from "yjs";
import {
  createKnowledgeView,
  getKnowledgeHead,
  getKnowledgeProjection,
  knowledgeWords,
  knowledgeBodyText,
  KnowledgeRequestSchema,
  KnowledgeResponseSchema,
  knowledgeLinkKey,
  createTaskRow,
  setPageTag,
  type KnowledgeSource,
} from "./index";

const workspaceId = crypto.randomUUID();
function source(
  title: string,
  overrides: Partial<KnowledgeSource["page"]> = {},
): KnowledgeSource {
  return {
    page: {
      id: crypto.randomUUID(),
      workspaceId,
      title,
      kind: "document",
      trashed: false,
      ...overrides,
    },
    head: { tags: [], links: [], rows: [], words: [] },
  };
}
function view(sources: KnowledgeSource[], root: KnowledgeSource, offset = 0) {
  return KnowledgeResponseSchema.parse(
    createKnowledgeView(sources, { pageId: root.page.id, offset }),
  );
}
it("builds directed Mention, Task and Relation edges and Backlinks from unopened heads", () => {
  const root = source("Root"),
    a = source("A", { kind: "database" }),
    rowId = crypto.randomUUID();
  root.head!.links = [
    { pageId: a.page.id, rowId, kind: "task" },
    { pageId: a.page.id, kind: "mention" },
  ];
  a.head!.rows = [{ id: rowId, title: "Row" }];
  a.head!.links = [
    { pageId: root.page.id, sourceRowId: rowId, kind: "mention" },
  ];
  const result = view([a, root], root);
  expect(result.nodes.map((node) => node.id)).toEqual([
    root.page.id,
    a.page.id,
  ]);
  expect(result.edges).toContainEqual({
    sourceId: root.page.id,
    targetId: a.page.id,
    kinds: ["mention", "task"],
  });
  expect(result.incoming).toEqual([
    {
      sourceId: a.page.id,
      sourceTitle: "A",
      sourceRowId: rowId,
      sourceRowTitle: "Row",
      kind: "mention",
    },
  ]);
  expect(result.issues).toEqual([]);
  expect(knowledgeLinkKey(root.head!.links[0]!)).toContain(rowId);
});
it("never resolves hidden targets, separates Trash/missing Rows from uncached Rows and excludes removed source Rows", () => {
  const root = source("Root"),
    trashed = source("Hidden Trash title", { trashed: true }),
    database = source("Database", { kind: "database" }),
    uncached = source("Uncached", { kind: "database" }),
    unknown = crypto.randomUUID(),
    rowId = crypto.randomUUID();
  delete uncached.head;
  root.head!.links = [
    { pageId: trashed.page.id, kind: "mention" },
    { pageId: unknown, kind: "mention" },
    { pageId: database.page.id, rowId, kind: "relation" },
    { pageId: uncached.page.id, rowId, kind: "task" },
    { pageId: database.page.id, sourceRowId: rowId, kind: "mention" },
  ];
  const result = view([root, trashed, database, uncached], root);
  expect(result.issues.map((issue) => issue.status).sort()).toEqual([
    "missing_row",
    "trashed",
    "unverified",
    "unverified",
  ]);
  expect(result.nodes).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("Hidden Trash title");
  expect(result.related).toEqual([]);
});
it("does not follow Relation links across Workspace boundaries or show a deleted root", () => {
  const root = source("Root", { kind: "database" }),
    other = source("Other", {
      kind: "database",
      workspaceId: crypto.randomUUID(),
    }),
    rowId = crypto.randomUUID(),
    sourceRowId = crypto.randomUUID();
  root.head!.rows = [{ id: sourceRowId, title: "Origin" }];
  other.head!.rows = [{ id: rowId, title: "Target" }];
  root.head!.links = [
    { pageId: other.page.id, sourceRowId, rowId, kind: "relation" },
  ];
  expect(view([root, other], root).issues[0]?.status).toBe("unverified");
  root.page.trashed = true;
  expect(view([root, other], root).root).toBeNull();
  expect(view([], root).nodes).toEqual([]);
});
it("ranks related Pages by reproducible link/Tag/body evidence and isolates other Workspaces", () => {
  const root = source("Root"),
    direct = source("Direct"),
    tag = source("Tag"),
    body = source("Body"),
    privateWorkspace = source("Other Workspace", {
      workspaceId: crypto.randomUUID(),
    });
  root.head!.tags = ["Ｄｅｓｉｇｎ"];
  root.head!.words = ["storage", "offline"];
  direct.head!.links = [{ pageId: root.page.id, kind: "mention" }];
  tag.head!.tags = ["design"];
  body.head!.words = ["offline", "storage"];
  privateWorkspace.head!.tags = ["design"];
  const sources = [root, body, privateWorkspace, tag, direct];
  expect(view(sources, root).related.map((entry) => entry.title)).toEqual([
    "Direct",
    "Tag",
    "Body",
  ]);
  expect(view(sources, root).related).toEqual(
    view([...sources].reverse(), root).related,
  );
  expect(view(sources, root).related.map((entry) => entry.reasons)).toEqual([
    ["문서 연결"],
    ["공통 Tag: design"],
    ["본문: offline, storage"],
  ]);
});
it("bounds graphs at 200 Nodes with deterministic paging and preserves all known issue counts", () => {
  const root = source("Root"),
    neighbors = Array.from({ length: 230 }, (_, index) =>
      source(`Node ${String(index).padStart(3, "0")}`),
    );
  root.head!.links = neighbors.map((target) => ({
    pageId: target.page.id,
    kind: "mention",
  }));
  root.head!.links.push(
    ...Array.from({ length: 205 }, () => ({
      pageId: crypto.randomUUID(),
      kind: "mention" as const,
    })),
  );
  const first = view([root, ...neighbors], root),
    next = view([root, ...neighbors], root, 199);
  expect(first.nodes).toHaveLength(200);
  expect(first.neighborCount).toBe(230);
  expect(next.nodes).toHaveLength(32);
  expect(
    new Set([...first.nodes, ...next.nodes].map((node) => node.id)).size,
  ).toBe(231);
  expect(first.issues).toHaveLength(200);
  expect(first.issueCount).toBe(205);
  expect(view([root], root, 1000).nodes).toHaveLength(1);
});
it("bounds body evidence and ignores common words, title-only matches and historical Row text", () => {
  expect(knowledgeWords("The storage STORAGE offline and 그리고")).toEqual([
    "storage",
    "offline",
  ]);
  expect(knowledgeWords(" ".repeat(8192) + "outside")).toEqual([]);
  expect(
    knowledgeWords(
      Array.from({ length: 100 }, (_, index) => `word${index}`).join(" "),
    ),
  ).toHaveLength(64);
  const doc = new Y.Doc();
  doc.getText("title").insert(0, "title-secret");
  setPageTag(doc, "Tag");
  createTaskRow(doc, "Row title");
  const head = getKnowledgeHead(getKnowledgeProjection(doc));
  expect(head.words).toEqual([]);
  expect(head.rows).toHaveLength(1);
  expect(head.tags).toEqual(["Tag"]);
  expect(
    knowledgeBodyText("main", [{ body: "x".repeat(2000) }, { body: "tail" }]),
  ).toBe("main " + "x".repeat(1024) + " tail");
  doc.destroy();
});
it("validates requests strictly and does not accept arbitrary Graph fields or oversized overlays", () => {
  const pageId = crypto.randomUUID();
  expect(KnowledgeRequestSchema.parse({ pageId })).toEqual({
    pageId,
    offset: 0,
    overlays: [],
  });
  expect(() =>
    KnowledgeRequestSchema.parse({ pageId, role: "owner" }),
  ).toThrow();
  expect(() => KnowledgeRequestSchema.parse({ pageId, offset: -1 })).toThrow();
  expect(() =>
    KnowledgeRequestSchema.parse({ pageId, overlays: Array(33).fill({}) }),
  ).toThrow();
});
