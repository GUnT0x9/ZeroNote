import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { database, type LocalPage } from "./database";
import {
  attachmentMetadataKey,
  cacheAttachmentMetadata,
  cachedAttachmentMetadata,
  loadAttachmentMetadata,
} from "./attachment-metadata";
import { api } from "./api";
import { stageAttachment } from "./attachments";
vi.mock("./api", () => ({ api: vi.fn(), ApiError: class extends Error {} }));
const ids: string[] = [];
async function page() {
  const value: LocalPage = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    parentId: null,
    title: "Files",
    kind: "database",
    revision: 1,
    deletedAt: null,
    isInbox: false,
    createdAt: new Date().toISOString(),
    role: "owner",
  };
  await database.pages.put(value);
  ids.push(value.id);
  return value;
}
afterEach(async () => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  for (const id of ids.splice(0)) {
    await database.pages.delete(id);
    await database.operations
      .filter((operation) => operation.payload.pageId === id)
      .delete();
    await database.attachments.where("pageId").equals(id).delete();
    await database.preferences.delete(attachmentMetadataKey(id));
  }
});
it("stores metadata without bytes and merges same-Page local files", async () => {
  const target = await page(),
    file = await stageAttachment(target.id, "notes.txt", new Uint8Array([1]));
  const cached = await cachedAttachmentMetadata(target.id);
  expect(cached[0]?.name).toBe(file.name);
  expect(cached[0]).not.toHaveProperty("data");
  expect(
    (await database.preferences.get(attachmentMetadataKey(target.id)))?.value,
  ).not.toContain('"data"');
  await expect(
    cacheAttachmentMetadata(crypto.randomUUID(), cached),
  ).rejects.toThrow("Page");
  await expect(
    cacheAttachmentMetadata(target.id, [cached[0]!, cached[0]!]),
  ).rejects.toThrow();
});
it("reads existing/imported bytes and repairs a malformed name cache", async () => {
  const target = await page(),
    file = await stageAttachment(target.id, "before.txt", new Uint8Array([1]));
  await database.preferences.put({
    id: attachmentMetadataKey(target.id),
    value: "corrupt",
  });
  expect((await cachedAttachmentMetadata(target.id))[0]?.id).toBe(file.id);
  await cacheAttachmentMetadata(
    target.id,
    await cachedAttachmentMetadata(target.id),
  );
  expect(
    JSON.parse(
      (await database.preferences.get(attachmentMetadataKey(target.id)))!.value,
    ),
  ).toHaveLength(1);
});
it("loads names Online once, uses offline names and denies inaccessible Pages", async () => {
  const target = await page(),
    file = await stageAttachment(target.id, "a.txt", new Uint8Array([1]));
  const [metadata] = await cachedAttachmentMetadata(target.id);
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(api).mockResolvedValue([metadata]);
  const values = await Promise.all([
    loadAttachmentMetadata(target.id),
    loadAttachmentMetadata(target.id),
  ]);
  expect(values[0][0]?.id).toBe(file.id);
  expect(api).toHaveBeenCalledTimes(1);
  vi.stubGlobal("navigator", { onLine: false });
  expect((await loadAttachmentMetadata(target.id))[0]?.id).toBe(file.id);
  expect(api).toHaveBeenCalledTimes(1);
  await database.pages.update(target.id, { accessLost: true });
  await expect(loadAttachmentMetadata(target.id)).rejects.toThrow("접근");
});
it("rejects a cross-Page server response without replacing a valid local cache", async () => {
  const target = await page(),
    other = await page();
  await stageAttachment(target.id, "keep.txt", new Uint8Array([1]));
  await stageAttachment(other.id, "other.txt", new Uint8Array([2]));
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(api).mockResolvedValue(await cachedAttachmentMetadata(other.id));
  await expect(loadAttachmentMetadata(target.id)).rejects.toThrow("Page");
  expect((await cachedAttachmentMetadata(target.id))[0]?.name).toBe("keep.txt");
});
it("allows Owner retained names for Trash and refuses the mode for a collaborator", async () => {
  const target = await page();
  await stageAttachment(target.id, "snapshot.txt", new Uint8Array([1]));
  const metadata = await cachedAttachmentMetadata(target.id);
  await database.pages.update(target.id, {
    deletedAt: new Date().toISOString(),
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(api).mockResolvedValue(metadata);
  await expect(loadAttachmentMetadata(target.id)).rejects.toThrow("접근");
  expect((await loadAttachmentMetadata(target.id, true))[0]?.name).toBe(
    "snapshot.txt",
  );
  expect(api).toHaveBeenCalledWith(
    `/pages/${target.id}/attachments?retained=1`,
  );
  await database.pages.update(target.id, { role: "editor" });
  await expect(loadAttachmentMetadata(target.id, true)).rejects.toThrow("접근");
});

it("fetches names for a registered zero-revision Viewer Page", async () => {
  const target = await page();
  const file = await stageAttachment(
    target.id,
    "shared.txt",
    new Uint8Array([1]),
  );
  const [metadata] = await cachedAttachmentMetadata(target.id);
  await database.attachments.where("pageId").equals(target.id).delete();
  await database.preferences.delete(attachmentMetadataKey(target.id));
  await database.pages.update(target.id, { revision: 0, role: "viewer" });
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(api).mockResolvedValue([metadata]);
  expect((await loadAttachmentMetadata(target.id))[0]?.id).toBe(file.id);
  expect(api).toHaveBeenCalledWith(`/pages/${target.id}/attachments`);
});
it("keeps locally created Pages local until their Metadata create is acknowledged", async () => {
  const target = await page();
  await database.pages.update(target.id, { revision: 0 });
  await stageAttachment(target.id, "pending.txt", new Uint8Array([1]));
  const operationId = crypto.randomUUID();
  await database.operations.put({
    id: operationId,
    sequence: Date.now(),
    status: "pending",
    payload: {
      operationId,
      action: "create",
      pageId: target.id,
      workspaceId: target.workspaceId,
      expectedRevision: 0,
      page: target,
    },
  });
  vi.stubGlobal("navigator", { onLine: true });
  expect((await loadAttachmentMetadata(target.id))[0]?.name).toBe(
    "pending.txt",
  );
  expect(api).not.toHaveBeenCalled();
  await database.operations.delete(operationId);
  vi.mocked(api).mockResolvedValue(await cachedAttachmentMetadata(target.id));
  expect((await loadAttachmentMetadata(target.id))[0]?.name).toBe(
    "pending.txt",
  );
  expect(api).toHaveBeenCalledTimes(1);
});

it("keeps Snapshot names when an active-file list arrives afterward", async () => {
  const target = await page();
  await stageAttachment(target.id, "current.txt", new Uint8Array([1]));
  await stageAttachment(target.id, "snapshot.txt", new Uint8Array([2]));
  const files = await cachedAttachmentMetadata(target.id);
  await database.attachments.where("pageId").equals(target.id).delete();
  await database.preferences.delete(attachmentMetadataKey(target.id));
  vi.stubGlobal("navigator", { onLine: true });
  vi.mocked(api).mockResolvedValueOnce(files).mockResolvedValueOnce([files[0]]);
  await loadAttachmentMetadata(target.id, true);
  expect(
    (await loadAttachmentMetadata(target.id)).map((file) => file.name),
  ).toEqual(["current.txt", "snapshot.txt"]);
  expect(api).toHaveBeenCalledTimes(2);
});
