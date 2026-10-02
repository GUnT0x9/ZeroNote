import "fake-indexeddb/auto";
import { afterEach, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { getDocumentProjection } from "@zeronote/shared";
import { database, type LocalPage } from "./database";
import {
  openDocument,
  connectDocument,
  pauseDocumentForAttachmentUpload,
  removeLocalDocument,
} from "./documents";
import { stageAttachment } from "./attachments";
vi.mock("./api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));
vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: class {
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => undefined);
    destroy = vi.fn();
  },
}));
const pages: string[] = [];
async function fixture() {
  vi.stubGlobal("navigator", { onLine: true });
  const page: LocalPage = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    parentId: null,
    kind: "document",
    title: "Files",
    role: "owner",
    revision: 0,
    deletedAt: null,
    isInbox: false,
    createdAt: new Date().toISOString(),
  };
  pages.push(page.id);
  await database.pages.put(page);
  const doc = new Y.Doc();
  await database.documents.put({
    id: page.id,
    workspaceId: page.workspaceId,
    update: Y.encodeStateAsUpdate(doc),
    ...getDocumentProjection(doc),
    generation: 0,
    committedGeneration: 0,
    state: "saved",
    updatedAt: Date.now(),
  });
  doc.destroy();
  const session = await openDocument(page);
  const provider = new HocuspocusProvider({
    url: "wss://example.invalid/collaboration",
    name: page.id,
    document: session.document,
  });
  session.provider = provider;
  return { session, provider, page };
}
afterEach(async () => {
  for (const id of pages.splice(0)) {
    await removeLocalDocument(id);
    await database.pages.delete(id);
    await database.attachments.where("pageId").equals(id).delete();
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("pauses realtime while a referenced file is pending and resumes only after its upload", async () => {
  const { session, provider, page } = await fixture();
  const file = await stageAttachment(
    page.id,
    "pending.txt",
    Uint8Array.from([65]),
  );
  expect(provider.disconnect).toHaveBeenCalledTimes(1);
  // Staging pauses before the editor inserts its Block, including that async gap.
  expect(await connectDocument(session, page)).toBeUndefined();
  expect(provider.connect).not.toHaveBeenCalled();
  const node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", file.id);
  session.document.getXmlFragment("content").insert(0, [node]);
  expect(await connectDocument(session, page)).toBeUndefined();
  expect(provider.connect).not.toHaveBeenCalled();
  await database.attachments.update(file.id, { status: "uploaded" });
  expect(await connectDocument(session, page)).toBe(provider);
  expect(provider.connect).toHaveBeenCalledTimes(1);
  await database.attachments.update(file.id, { status: "preserved" });
  expect(await connectDocument(session, page)).toBeUndefined();
  session.document.getXmlFragment("content").delete(0, 1);
  expect(await connectDocument(session, page)).toBe(provider);
  expect(provider.connect).toHaveBeenCalledTimes(2);
});
it("does not block a remote file without a local cache and keeps inaccessible Pages disconnected", async () => {
  const { session, provider, page } = await fixture();
  const node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", crypto.randomUUID());
  session.document.getXmlFragment("content").insert(0, [node]);
  expect(await connectDocument(session, page)).toBe(provider);
  pauseDocumentForAttachmentUpload(page.id);
  expect(provider.disconnect).toHaveBeenCalledOnce();
  expect(
    await connectDocument(session, { ...page, accessLost: true }),
  ).toBeUndefined();
  expect(
    await connectDocument(session, {
      ...page,
      deletedAt: new Date().toISOString(),
    }),
  ).toBeUndefined();
  pauseDocumentForAttachmentUpload("missing");
  expect(provider.connect).toHaveBeenCalledOnce();
});
