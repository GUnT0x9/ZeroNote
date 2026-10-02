import "fake-indexeddb/auto";
import { afterEach, it, expect, vi } from "vitest";
import * as Y from "yjs";
import { database } from "./database";
import { api } from "./api";
import { stageAttachment } from "./attachments";
import {
  localFileUsage,
  removeUploadedFileCache,
  purgeUnusedAttachment,
  loadWorkspaceStorage,
} from "./storage";
import {
  WORKSPACE_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_BYTES,
  getDocumentProjection,
} from "@zeronote/shared";
vi.mock("./api", () => ({ api: vi.fn() }));
vi.mock("./documents", () => ({
  flushDocuments: vi.fn(),
  pauseDocumentForAttachmentUpload: vi.fn(),
}));
const workspaces: string[] = [];
async function fixture() {
  const workspaceId = crypto.randomUUID(),
    id = crypto.randomUUID();
  workspaces.push(workspaceId);
  await database.pages.put({
    id,
    workspaceId,
    parentId: null,
    kind: "document",
    title: "Files",
    revision: 0,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    isInbox: false,
    role: "owner",
  });
  const file = await stageAttachment(
    id,
    "unused.txt",
    new TextEncoder().encode("data"),
  );
  return { id, workspaceId, file };
}
afterEach(async () => {
  vi.resetAllMocks();
  for (const workspaceId of workspaces.splice(0)) {
    await database.pages.where("workspaceId").equals(workspaceId).delete();
    await database.documents.where("workspaceId").equals(workspaceId).delete();
    await database.attachments
      .where("workspaceId")
      .equals(workspaceId)
      .delete();
  }
});
it("validates server storage data and rejects a malformed response", async () => {
  const { workspaceId } = await fixture();
  const usage = {
    bytes: 0,
    count: 0,
    retained: 0,
    limit: WORKSPACE_ATTACHMENT_BYTES,
    fileLimit: MAX_ATTACHMENT_BYTES,
    files: [],
  };
  vi.mocked(api)
    .mockResolvedValueOnce(usage)
    .mockResolvedValueOnce({ ...usage, bytes: -1 });
  expect(await loadWorkspaceStorage(workspaceId)).toEqual(usage);
  await expect(loadWorkspaceStorage(workspaceId)).rejects.toThrow();
});
it("clears only uploaded cache, preserving pending and recovered bytes and other Workspaces", async () => {
  const { id, workspaceId, file } = await fixture();
  const kept = await stageAttachment(id, "pending.txt", Uint8Array.from([65]));
  const preserved = await stageAttachment(
    id,
    "preserved.txt",
    Uint8Array.from([66]),
  );
  await database.attachments.update(file.id, { status: "uploaded" });
  await database.attachments.update(preserved.id, { status: "preserved" });
  const protectedFiles = [];
  const originalPage = (await database.pages.get(id))!;
  for (const state of ["lost", "trash"]) {
    const target = { ...originalPage, id: crypto.randomUUID() };
    await database.pages.put(target);
    const protectedFile = await stageAttachment(
      target.id,
      `${state}.txt`,
      Uint8Array.from([67]),
    );
    await database.attachments.update(protectedFile.id, { status: "uploaded" });
    await database.pages.update(
      target.id,
      state === "lost"
        ? { accessLost: true }
        : { deletedAt: new Date().toISOString() },
    );
    protectedFiles.push(protectedFile);
  }
  const other = await fixture();
  expect(await localFileUsage(workspaceId)).toEqual({
    bytes: 8,
    count: 5,
    pending: 4,
  });
  await removeUploadedFileCache(workspaceId);
  expect(await database.attachments.get(file.id)).toBeUndefined();
  expect((await database.attachments.get(kept.id))?.data).toEqual(kept.data);
  expect((await database.attachments.get(preserved.id))?.data).toEqual(
    preserved.data,
  );
  for (const protectedFile of protectedFiles)
    expect((await database.attachments.get(protectedFile.id))?.data).toEqual(
      protectedFile.data,
    );
  expect(await database.attachments.get(other.file.id)).toBeDefined();
  await removeUploadedFileCache("missing");
  expect(await localFileUsage("missing")).toEqual({
    bytes: 0,
    count: 0,
    pending: 0,
  });
});
it("purges an unused uploaded file only after server confirmation and retains bytes on failure", async () => {
  const { workspaceId, file } = await fixture();
  await database.attachments.update(file.id, { status: "uploaded" });
  vi.mocked(api).mockRejectedValueOnce(new Error("Snapshot retains file"));
  await expect(
    purgeUnusedAttachment(workspaceId, file.id, file.name),
  ).rejects.toThrow("Snapshot");
  expect(await database.attachments.get(file.id)).toBeDefined();
  vi.mocked(api).mockResolvedValueOnce({ purged: true });
  await purgeUnusedAttachment(workspaceId, file.id, file.name);
  expect(api).toHaveBeenCalledWith(
    `/workspaces/${workspaceId}/attachments/${file.id}/content`,
    "DELETE",
    { name: file.name },
  );
  expect(await database.attachments.get(file.id)).toBeUndefined();
});
it("blocks purging a pending file or a file still referenced by local content", async () => {
  const { id, workspaceId, file } = await fixture();
  await expect(
    purgeUnusedAttachment(workspaceId, file.id, file.name),
  ).rejects.toThrow("서버에 저장");
  await database.attachments.update(file.id, { status: "uploaded" });
  const document = new Y.Doc(),
    node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", file.id);
  document.getXmlFragment("content").insert(0, [node]);
  await database.documents.put({
    id,
    workspaceId,
    update: Y.encodeStateAsUpdate(document),
    ...getDocumentProjection(document),
    generation: 1,
    committedGeneration: 0,
    state: "saved",
    updatedAt: Date.now(),
  });
  document.destroy();
  await expect(
    purgeUnusedAttachment(workspaceId, file.id, file.name),
  ).rejects.toThrow("사용 중");
  expect(api).not.toHaveBeenCalled();
  expect(await database.attachments.get(file.id)).toBeDefined();
});
