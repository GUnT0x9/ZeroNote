import "fake-indexeddb/auto";
import { afterEach, it, expect, vi } from "vitest";
import { database, type LocalPage } from "./database";
import {
  stageAttachment,
  loadAttachment,
  syncAttachments,
  attachmentDigest,
  stageAttachmentFile,
} from "./attachments";
import { api } from "./api";
import { attachmentMetadataKey } from "./attachment-metadata";
import {
  bytesToBase64,
  MAX_ATTACHMENT_BYTES,
  AttachmentMetadataSchema,
} from "@zeronote/shared";
vi.mock("./api", () => ({
  api: vi.fn(),
  ApiError: class extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));
const ids: string[] = [];
async function page(role: LocalPage["role"] = "owner") {
  const value: LocalPage = {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    parentId: null,
    kind: "document",
    title: "Attachments",
    revision: 0,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    isInbox: false,
    role,
  };
  await database.pages.put(value);
  ids.push(value.id);
  return value;
}
afterEach(async () => {
  vi.resetAllMocks();
  for (const id of ids.splice(0)) {
    await database.pages.delete(id);
    await database.attachments.where("pageId").equals(id).delete();
    await database.preferences.delete(attachmentMetadataKey(id));
  }
});
it("checks a selected File size before allocating bytes and stages a valid file", async () => {
  const target = await page(),
    read = vi.fn(async () => Uint8Array.from([65]).buffer);
  await expect(
    stageAttachmentFile(target.id, {
      size: MAX_ATTACHMENT_BYTES + 1,
      name: "large",
      arrayBuffer: read,
    }),
  ).rejects.toThrow("4MiB");
  await expect(
    stageAttachmentFile(target.id, {
      size: 0,
      name: "empty",
      arrayBuffer: read,
    }),
  ).rejects.toThrow("4MiB");
  expect(read).not.toHaveBeenCalled();
  const saved = await stageAttachmentFile(target.id, {
    size: 1,
    name: "a.txt",
    arrayBuffer: read,
  });
  expect(saved.data).toEqual(Uint8Array.from([65]));
  expect(read).toHaveBeenCalledOnce();
});
it("saves bytes locally before upload and keeps pending bytes after a failed upload", async () => {
  const target = await page(),
    data = new TextEncoder().encode("코드");
  const file = await stageAttachment(target.id, "code.ts", data);
  expect((await loadAttachment(file.id, target.id)).data).toEqual(data);
  expect(file.status).toBe("pending");
  expect(file.hash).toBe(await attachmentDigest(data));
  vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
  await expect(syncAttachments()).rejects.toThrow("offline");
  expect((await database.attachments.get(file.id))?.data).toEqual(data);
  expect((await database.attachments.get(file.id))?.status).toBe("pending");
});
it("changes status only after matching server commit and preserves files on permission loss", async () => {
  const target = await page(),
    file = await stageAttachment(
      target.id,
      "a.txt",
      new TextEncoder().encode("a"),
    );
  vi.mocked(api).mockResolvedValueOnce(file);
  await syncAttachments();
  expect((await database.attachments.get(file.id))?.status).toBe("uploaded");
  const second = await stageAttachment(
    target.id,
    "b.txt",
    new TextEncoder().encode("b"),
  );
  await database.pages.update(target.id, { accessLost: true });
  await syncAttachments();
  expect((await database.attachments.get(second.id))?.status).toBe("preserved");
  expect((await loadAttachment(second.id, target.id)).data).toEqual(
    second.data,
  );
});
it("validates Page role and rejects empty/oversize files before any write", async () => {
  const viewer = await page("viewer"),
    owner = await page();
  await expect(
    stageAttachment(viewer.id, "x", Uint8Array.from([1])),
  ).rejects.toThrow("Editor");
  await expect(
    stageAttachment(owner.id, "x", new Uint8Array()),
  ).rejects.toThrow("4MiB");
  await expect(
    stageAttachment(owner.id, "x", new Uint8Array(MAX_ATTACHMENT_BYTES + 1)),
  ).rejects.toThrow("4MiB");
  expect(
    await database.attachments.where("pageId").equals(owner.id).count(),
  ).toBe(0);
});
it("caches verified remote bytes and rejects corrupt or cross-page responses", async () => {
  const target = await page(),
    file = await stageAttachment(target.id, "x.txt", Uint8Array.from([120]));
  await database.attachments.delete(file.id);
  vi.mocked(api).mockResolvedValueOnce({
    ...AttachmentMetadataSchema.parse(file),
    data: bytesToBase64(file.data),
  });
  expect((await loadAttachment(file.id, target.id)).status).toBe("uploaded");
  await database.attachments.delete(file.id);
  vi.mocked(api).mockResolvedValueOnce({
    ...AttachmentMetadataSchema.parse(file),
    data: bytesToBase64(Uint8Array.from([121])),
  });
  await expect(loadAttachment(file.id, target.id)).rejects.toThrow("손상");
  vi.mocked(api).mockResolvedValueOnce({
    ...AttachmentMetadataSchema.parse(file),
    pageId: crypto.randomUUID(),
    data: bytesToBase64(file.data),
  });
  await expect(loadAttachment(file.id, target.id)).rejects.toThrow("일치");
});
it("uses a persistent operation ID for retries and rejects false acknowledgements", async () => {
  const target = await page(),
    file = await stageAttachment(target.id, "x.txt", Uint8Array.from([120]));
  vi.mocked(api).mockResolvedValueOnce({ ...file, hash: "0".repeat(64) });
  await expect(syncAttachments()).rejects.toThrow("일치");
  expect((await database.attachments.get(file.id))?.status).toBe("pending");
  vi.mocked(api).mockResolvedValueOnce(file);
  await syncAttachments();
  expect(vi.mocked(api).mock.calls[0]?.[2]).toEqual(
    vi.mocked(api).mock.calls[1]?.[2],
  );
});
