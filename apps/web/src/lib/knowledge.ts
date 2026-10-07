import { getKnowledgeHead, type KnowledgeSource } from "@zeronote/shared";
import type { WorkspaceData } from "./hooks";
import { localKnowledge } from "./advanced-search";
import { availablePages } from "./search";

export function localKnowledgeSources(data: WorkspaceData): {
  sources: KnowledgeSource[];
  unreadable: number;
} {
  const active = new Set(availablePages(data.pages).map((page) => page.id)),
    records = new Map(data.documents.map((record) => [record.id, record]));
  let unreadable = 0;
  const sources = data.pages
    .filter((page) => !page.accessLost)
    .map((page): KnowledgeSource => {
      const source: KnowledgeSource = {
        page: {
          id: page.id,
          workspaceId: page.workspaceId,
          title: page.title,
          kind: page.kind,
          trashed: !active.has(page.id),
        },
      };
      const record = records.get(page.id);
      if (record && record.state !== "preserved" && active.has(page.id)) {
        try {
          source.head = getKnowledgeHead(localKnowledge(record));
        } catch {
          unreadable++;
        }
      }
      return source;
    });
  return { sources, unreadable };
}
