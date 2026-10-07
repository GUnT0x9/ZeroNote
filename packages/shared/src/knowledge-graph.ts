import { z } from "zod";
import {
  KnowledgeLinkSchema,
  KnowledgeProjectionSchema,
  type KnowledgeLink,
  type KnowledgeProjection,
} from "./knowledge-projection";
import { normalizeSearchText } from "./search-normalize";

export const KNOWLEDGE_NODE_LIMIT = 200;
export const KNOWLEDGE_EDGE_LIMIT = 800;
export const KNOWLEDGE_LIST_LIMIT = 200;
export const KNOWLEDGE_TEXT_LIMIT = 8192;
const RELATED_PAGE_LIMIT = 12;
const KNOWLEDGE_WORD_LIMIT = 64;
export const KNOWLEDGE_ROW_TEXT_LIMIT = 1024;
const COMMON_WORDS = new Set(
  "the and that this with from have will your you are for was not can into our its has but about document page task todo done progress 그리고 또는 대한 위한 하는 있는 없는 문서 페이지 작업 내용 합니다 있습니다".split(
    " ",
  ),
);
const RowLabelSchema = z.object({ id: z.uuid(), title: z.string() }).strict();
export const KnowledgeHeadContentSchema = z
  .object({
    tags: z.array(z.string()),
    links: z.array(KnowledgeLinkSchema),
    rows: z.array(RowLabelSchema),
    text: z.string().max(KNOWLEDGE_TEXT_LIMIT),
  })
  .strict();
export const KnowledgeHeadSchema = KnowledgeHeadContentSchema.omit({
  text: true,
}).extend({ words: z.array(z.string()).max(KNOWLEDGE_WORD_LIMIT) });
export type KnowledgeHead = z.infer<typeof KnowledgeHeadSchema>;
export interface KnowledgeSource {
  page: {
    id: string;
    workspaceId: string;
    title: string;
    kind: "document" | "database";
    trashed: boolean;
  };
  head?: KnowledgeHead;
}
export const KnowledgeRequestSchema = z
  .object({
    pageId: z.uuid(),
    offset: z.number().int().min(0).max(1_000_000).default(0),
    overlays: z
      .array(
        z
          .object({ pageId: z.uuid(), projection: KnowledgeProjectionSchema })
          .strict(),
      )
      .max(32)
      .default([]),
  })
  .strict();
export type KnowledgeRequest = z.infer<typeof KnowledgeRequestSchema>;
const KnowledgeNodeSchema = z
  .object({
    id: z.uuid(),
    workspaceId: z.uuid(),
    title: z.string(),
    kind: z.enum(["document", "database"]),
  })
  .strict();
const KnowledgeEdgeSchema = z
  .object({
    sourceId: z.uuid(),
    targetId: z.uuid(),
    kinds: z
      .array(z.enum(["mention", "task", "relation"]))
      .min(1)
      .max(3),
  })
  .strict();
const IncomingLinkSchema = z
  .object({
    sourceId: z.uuid(),
    sourceTitle: z.string(),
    sourceRowId: z.uuid().optional(),
    sourceRowTitle: z.string().optional(),
    targetRowId: z.uuid().optional(),
    kind: z.enum(["mention", "task", "relation"]),
  })
  .strict();
const RelatedPageSchema = KnowledgeNodeSchema.extend({
  score: z.number().int().positive(),
  reasons: z.array(z.string()).min(1).max(3),
});
export const KnowledgeIssueSchema = z
  .object({
    link: KnowledgeLinkSchema,
    status: z.enum(["trashed", "missing_row", "unverified"]),
  })
  .strict();
export type KnowledgeIssue = z.infer<typeof KnowledgeIssueSchema>;
export const KnowledgeResponseSchema = z
  .object({
    root: KnowledgeNodeSchema.nullable(),
    nodes: z.array(KnowledgeNodeSchema).max(KNOWLEDGE_NODE_LIMIT),
    edges: z.array(KnowledgeEdgeSchema).max(KNOWLEDGE_EDGE_LIMIT),
    neighborCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    incoming: z.array(IncomingLinkSchema).max(KNOWLEDGE_LIST_LIMIT),
    incomingCount: z.number().int().nonnegative(),
    related: z.array(RelatedPageSchema).max(RELATED_PAGE_LIMIT),
    issues: z.array(KnowledgeIssueSchema).max(KNOWLEDGE_LIST_LIMIT),
    issueCount: z.number().int().nonnegative(),
  })
  .strict();
export type KnowledgeResponse = z.infer<typeof KnowledgeResponseSchema>;
export type KnowledgeNode = z.infer<typeof KnowledgeNodeSchema>;

export function knowledgeWords(text: string): string[] {
  const counts = new Map<string, number>();
  for (const match of normalizeSearchText(
    text.slice(0, KNOWLEDGE_TEXT_LIMIT),
  ).matchAll(/[\p{L}][\p{L}\p{N}_-]{1,39}/gu)) {
    const word = match[0];
    if (!COMMON_WORDS.has(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .slice(0, KNOWLEDGE_WORD_LIMIT)
    .map(([word]) => word);
}
export function knowledgeHeadFromContent(
  content: z.infer<typeof KnowledgeHeadContentSchema>,
): KnowledgeHead {
  return {
    tags: content.tags,
    links: content.links,
    rows: content.rows,
    words: knowledgeWords(content.text),
  };
}
export function getKnowledgeHead(
  projection: KnowledgeProjection,
): KnowledgeHead {
  return knowledgeHeadFromContent({
    tags: projection.tags,
    links: projection.links,
    rows: projection.rows.map(({ row }) => ({ id: row.id, title: row.title })),
    text: knowledgeBodyText(projection.body, projection.rows),
  });
}
export function knowledgeBodyText(
  body: string,
  rows: { body: string }[],
): string {
  return [
    body,
    ...rows.map((row) => row.body.slice(0, KNOWLEDGE_ROW_TEXT_LIMIT)),
  ]
    .join(" ")
    .slice(0, KNOWLEDGE_TEXT_LIMIT);
}
export function knowledgeLinkKey(link: KnowledgeLink): string {
  return `${link.kind}:${link.pageId}:${link.rowId ?? ""}:${link.sourceRowId ?? ""}`;
}
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareNodes(a: KnowledgeNode, b: KnowledgeNode): number {
  return (
    compareText(normalizeSearchText(a.title), normalizeSearchText(b.title)) ||
    compareText(a.id, b.id)
  );
}
function nodeFor(source: KnowledgeSource): KnowledgeNode {
  return {
    id: source.page.id,
    workspaceId: source.page.workspaceId,
    title: source.page.title,
    kind: source.page.kind,
  };
}
interface PreparedSource {
  source: KnowledgeSource;
  rows: Map<string, string>;
}
function linkIssue(
  source: KnowledgeSource,
  link: KnowledgeLink,
  index: Map<string, PreparedSource>,
): KnowledgeIssue["status"] | undefined {
  const target = index.get(link.pageId);
  if (!target) return "unverified";
  if (
    link.kind === "relation" &&
    target.source.page.workspaceId !== source.page.workspaceId
  )
    return "unverified";
  if (target.source.page.trashed) return "trashed";
  if (link.rowId) {
    if (target.source.page.kind !== "database") return "missing_row";
    if (!target.source.head) return "unverified";
    if (!target.rows.has(link.rowId)) return "missing_row";
  }
  return undefined;
}
function collectConnections(
  rootId: string,
  index: Map<string, PreparedSource>,
) {
  const edges = new Map<string, z.infer<typeof KnowledgeEdgeSchema>>(),
    incoming: z.infer<typeof IncomingLinkSchema>[] = [],
    issues: KnowledgeIssue[] = [];
  for (const { source, rows } of index.values()) {
    if (source.page.trashed) continue;
    const seen = new Set<string>();
    for (const link of source.head?.links ?? []) {
      if (link.sourceRowId && !rows.has(link.sourceRowId)) continue;
      const key = knowledgeLinkKey(link);
      if (seen.has(key)) continue;
      seen.add(key);
      const status = linkIssue(source, link, index);
      if (status) {
        if (source.page.id === rootId) issues.push({ link, status });
        continue;
      }
      const edgeKey = `${source.page.id}:${link.pageId}`;
      const edge = edges.get(edgeKey) ?? {
        sourceId: source.page.id,
        targetId: link.pageId,
        kinds: [],
      };
      if (!edge.kinds.includes(link.kind)) edge.kinds.push(link.kind);
      edges.set(edgeKey, edge);
      if (link.pageId === rootId && source.page.id !== rootId)
        incoming.push({
          sourceId: source.page.id,
          sourceTitle: source.page.title,
          sourceRowId: link.sourceRowId,
          sourceRowTitle: link.sourceRowId
            ? rows.get(link.sourceRowId)
            : undefined,
          targetRowId: link.rowId,
          kind: link.kind,
        });
    }
  }
  return { edges: [...edges.values()], incoming, issues };
}
function relatedPages(
  root: KnowledgeSource,
  index: Map<string, PreparedSource>,
  edges: z.infer<typeof KnowledgeEdgeSchema>[],
): KnowledgeResponse["related"] {
  const neighbors = new Set(
    edges
      .filter(
        (edge) =>
          edge.sourceId === root.page.id || edge.targetId === root.page.id,
      )
      .flatMap((edge) => [edge.sourceId, edge.targetId]),
  );
  const tags = new Set((root.head?.tags ?? []).map(normalizeSearchText)),
    words = new Set(root.head?.words ?? []);
  const result: KnowledgeResponse["related"] = [];
  for (const { source } of index.values()) {
    if (
      source.page.id === root.page.id ||
      source.page.trashed ||
      source.page.workspaceId !== root.page.workspaceId
    )
      continue;
    const commonTags = (source.head?.tags ?? []).filter((tag) =>
        tags.has(normalizeSearchText(tag)),
      ),
      commonWords = (source.head?.words ?? [])
        .filter((word) => words.has(word))
        .sort(compareText),
      direct = neighbors.has(source.page.id),
      score = (direct ? 100 : 0) + commonTags.length * 12 + commonWords.length;
    if (!score) continue;
    const reasons: string[] = [];
    if (direct) reasons.push("문서 연결");
    if (commonTags.length)
      reasons.push(`공통 Tag: ${commonTags.slice(0, 3).join(", ")}`);
    if (commonWords.length)
      reasons.push(`본문: ${commonWords.slice(0, 3).join(", ")}`);
    result.push({ ...nodeFor(source), score, reasons });
  }
  return result
    .sort((a, b) => b.score - a.score || compareNodes(a, b))
    .slice(0, RELATED_PAGE_LIMIT);
}
/** Callers supply only authorized Metadata and source heads. No lookup of hidden targets occurs. */
export function createKnowledgeView(
  sources: KnowledgeSource[],
  request: Pick<KnowledgeRequest, "pageId" | "offset">,
): KnowledgeResponse {
  const index = new Map(
      sources.map((source) => [
        source.page.id,
        {
          source,
          rows: new Map(
            (source.head?.rows ?? []).map((row) => [row.id, row.title]),
          ),
        },
      ]),
    ),
    root = index.get(request.pageId)?.source;
  const empty: KnowledgeResponse = {
    root: null,
    nodes: [],
    edges: [],
    neighborCount: 0,
    edgeCount: 0,
    offset: request.offset,
    incoming: [],
    incomingCount: 0,
    related: [],
    issues: [],
    issueCount: 0,
  };
  if (!root || root.page.trashed) return empty;
  const { edges, incoming, issues } = collectConnections(root.page.id, index),
    neighborIds = new Set(
      edges
        .filter(
          (edge) =>
            edge.sourceId === root.page.id || edge.targetId === root.page.id,
        )
        .flatMap((edge) => [edge.sourceId, edge.targetId]),
    );
  neighborIds.delete(root.page.id);
  const neighbors = [...neighborIds]
    .flatMap((id) => {
      const source = index.get(id)?.source;
      return source ? [nodeFor(source)] : [];
    })
    .sort(compareNodes);
  const nodes = [
      nodeFor(root),
      ...neighbors.slice(
        request.offset,
        request.offset + KNOWLEDGE_NODE_LIMIT - 1,
      ),
    ],
    displayed = new Set(nodes.map((node) => node.id)),
    shownEdges = edges.filter(
      (edge) => displayed.has(edge.sourceId) && displayed.has(edge.targetId),
    );
  incoming.sort(
    (a, b) =>
      compareText(
        normalizeSearchText(a.sourceTitle),
        normalizeSearchText(b.sourceTitle),
      ) ||
      compareText(a.sourceId, b.sourceId) ||
      compareText(a.sourceRowId ?? "", b.sourceRowId ?? "") ||
      compareText(a.targetRowId ?? "", b.targetRowId ?? "") ||
      compareText(a.kind, b.kind),
  );
  issues.sort((a, b) =>
    compareText(knowledgeLinkKey(a.link), knowledgeLinkKey(b.link)),
  );
  shownEdges.sort((a, b) =>
    compareText(`${a.sourceId}:${a.targetId}`, `${b.sourceId}:${b.targetId}`),
  );
  for (const edge of shownEdges) edge.kinds.sort(compareText);
  return {
    root: nodeFor(root),
    nodes,
    edges: shownEdges.slice(0, KNOWLEDGE_EDGE_LIMIT),
    neighborCount: neighbors.length,
    edgeCount: shownEdges.length,
    offset: request.offset,
    incoming: incoming.slice(0, KNOWLEDGE_LIST_LIMIT),
    incomingCount: incoming.length,
    related: relatedPages(root, index, edges),
    issues: issues.slice(0, KNOWLEDGE_LIST_LIMIT),
    issueCount: issues.length,
  };
}
