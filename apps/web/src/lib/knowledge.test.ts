import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import * as Y from "yjs";
import { getKnowledgeProjection } from "@zeronote/shared";
import { localKnowledgeSources } from "./knowledge";
import type { WorkspaceData } from "./hooks";

it("keeps known Trash metadata, drops revoked copies and marks uncached or unreadable bodies as unverified", () => {
  const workspaceId = crypto.randomUUID(),
    createdAt = new Date().toISOString(),
    doc = new Y.Doc();
  const pages: WorkspaceData["pages"] = Array.from(
    { length: 5 },
    (_, index) => ({
      id: crypto.randomUUID(),
      workspaceId,
      title: String(index),
      kind: "document",
      parentId: null,
      revision: 0,
      createdAt,
      deletedAt: null,
      isInbox: false,
      role: "owner",
    }),
  );
  pages[2]!.deletedAt = createdAt;
  pages[3]!.accessLost = true;
  const record = {
    workspaceId,
    update: Y.encodeStateAsUpdate(doc),
    title: "",
    text: "",
    references: [],
    generation: 1,
    committedGeneration: 0,
    state: "saved" as const,
    updatedAt: Date.now(),
  };
  const data: WorkspaceData = {
    loaded: true,
    pages,
    workspaces: [],
    identities: [],
    operations: [],
    pendingComments: [],
    documents: [
      { ...record, id: pages[0]!.id, knowledge: getKnowledgeProjection(doc) },
      { ...record, id: pages[2]!.id, knowledge: getKnowledgeProjection(doc) },
      { ...record, id: pages[3]!.id, knowledge: getKnowledgeProjection(doc) },
      { ...record, id: pages[4]!.id, update: new Uint8Array([255]) },
    ],
  };
  const result = localKnowledgeSources(data);
  expect(result.sources).toHaveLength(4);
  expect(
    result.sources.find((entry) => entry.page.id === pages[0]!.id)?.head,
  ).toBeDefined();
  expect(
    result.sources.find((entry) => entry.page.id === pages[1]!.id)?.head,
  ).toBeUndefined();
  expect(
    result.sources.find((entry) => entry.page.id === pages[2]!.id)?.page
      .trashed,
  ).toBe(true);
  expect(
    result.sources.find((entry) => entry.page.id === pages[2]!.id)?.head,
  ).toBeUndefined();
  expect(result.unreadable).toBe(1);
  expect(data.documents[3]!.update).toEqual(new Uint8Array([255]));
  doc.destroy();
});
