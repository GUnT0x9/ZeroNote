import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { database, type PendingComment } from "./database";
import { api } from "./api";
import { ApiError } from "./http";
import {
  cacheComments,
  fetchComments,
  loadCommentDraft,
  queueComment,
  removeQueuedComment,
  retryComment,
  saveCommentDraft,
  syncPendingComments,
} from "./comments";
vi.mock("./api", async () => ({
  api: vi.fn(),
  ApiError: (await import("./http")).ApiError,
}));
const pageId = crypto.randomUUID(),
  rowId = crypto.randomUUID(),
  scope = { pageId, rowId };
const comment = (extra: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  pageId,
  rowId,
  parentId: null,
  body: "Review",
  identityId: crypto.randomUUID(),
  authorName: "Me",
  resolved: false,
  createdAt: new Date().toISOString(),
  ...extra,
});
const queued = (parentId: string | null = null): PendingComment => {
  const id = crypto.randomUUID();
  return {
    id,
    payload: { id, pageId, rowId, parentId, body: "Offline" },
    createdAt: new Date().toISOString(),
  };
};
afterEach(async () => {
  for (const table of database.tables) await table.clear();
  vi.resetAllMocks();
});
it("persists drafts independently and clears them only after a successful atomic Local enqueue", async () => {
  await Promise.all([
    saveCommentDraft(scope, { body: "First", parentId: null }),
    saveCommentDraft(scope, { body: "Latest", parentId: null }),
    saveCommentDraft({ pageId }, { body: "Page draft", parentId: null }),
  ]);
  expect(await loadCommentDraft(scope)).toEqual({
    body: "Latest",
    parentId: null,
  });
  expect(await loadCommentDraft({ pageId })).toEqual({
    body: "Page draft",
    parentId: null,
  });
  expect(
    await loadCommentDraft({ pageId, rowId: crypto.randomUUID() }),
  ).toEqual({ body: "", parentId: null });
  const fail = vi
    .spyOn(database.pendingComments, "add")
    .mockRejectedValueOnce(new Error("QuotaExceeded"));
  await expect(
    queueComment(scope, { body: "Latest", parentId: null }),
  ).rejects.toThrow("QuotaExceeded");
  expect(await loadCommentDraft(scope)).toEqual({
    body: "Latest",
    parentId: null,
  });
  fail.mockRestore();
  const id = await queueComment(scope, { body: " Latest ", parentId: null });
  expect((await database.pendingComments.get(id))?.payload).toMatchObject({
    body: "Latest",
    rowId,
  });
  expect(await loadCommentDraft(scope)).toEqual({ body: "", parentId: null });
  expect(await loadCommentDraft({ pageId })).toEqual({
    body: "Page draft",
    parentId: null,
  });
  expect(() => queueComment(scope, { body: " ", parentId: null })).toThrow();
});
it("replaces only one scoped cache and rejects foreign or canceled responses", async () => {
  const row = comment(),
    page = comment({ rowId: null }),
    other = comment({ rowId: crypto.randomUUID() });
  await database.comments.bulkPut([row, page, other]);
  const newer = comment();
  await cacheComments(scope, [newer]);
  expect(await database.comments.get(row.id)).toBeUndefined();
  expect(await database.comments.get(page.id)).toBeDefined();
  expect(await database.comments.get(other.id)).toBeDefined();
  await expect(cacheComments(scope, [page])).rejects.toThrow("범위");
  const controller = new AbortController();
  controller.abort();
  await expect(cacheComments(scope, [], controller.signal)).rejects.toThrow();
  expect(await database.comments.get(newer.id)).toBeDefined();
  vi.mocked(api).mockResolvedValueOnce([other]);
  await expect(fetchComments(scope)).rejects.toThrow("범위");
  vi.mocked(api).mockResolvedValueOnce([newer]);
  expect(await fetchComments(scope)).toEqual([newer]);
});
it("ignores a delayed response canceled after a Task scope switch", async () => {
  const cached = comment();
  await database.comments.put(cached);
  let release!: (value: unknown) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const controller = new AbortController(),
    loading = fetchComments(scope, controller.signal);
  controller.abort();
  release([]);
  await expect(loading).rejects.toThrow();
  expect(await database.comments.get(cached.id)).toBeDefined();
});
it("rejects malformed local draft records and preserves the failed write for retry", async () => {
  await database.preferences.put({
    id: `comment-draft:${pageId}:${rowId}`,
    value: "not JSON",
  });
  await expect(loadCommentDraft(scope)).rejects.toThrow();
  const fail = vi
    .spyOn(database.preferences, "put")
    .mockRejectedValueOnce(new Error("Storage full"));
  await expect(
    saveCommentDraft(scope, { body: "Keep me", parentId: null }),
  ).rejects.toThrow("Storage full");
  fail.mockRestore();
  await saveCommentDraft(scope, { body: "Retry", parentId: null });
  expect((await loadCommentDraft(scope)).body).toBe("Retry");
});
it("sends parent before reply after a clock change and acknowledges each committed ID only once", async () => {
  const parent = queued(),
    reply = queued(parent.id);
  parent.createdAt = "2026-10-08";
  reply.createdAt = "2026-10-07";
  await database.pendingComments.bulkPut([reply, parent]);
  const roots = [comment({ ...parent.payload }), comment({ ...reply.payload })];
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === "POST" ? {} : roots,
  );
  await syncPendingComments();
  expect(
    vi
      .mocked(api)
      .mock.calls.filter(([, method]) => method === "POST")
      .map(([, , body]) => body),
  ).toEqual([parent.payload, reply.payload]);
  expect(await database.pendingComments.count()).toBe(0);
  expect(await database.comments.count()).toBe(2);
});
it("keeps a committed payload through a failed confirmation and retries GET without reposting", async () => {
  const pending = queued();
  await database.pendingComments.put(pending);
  vi.mocked(api).mockImplementation(async (_path, method) => {
    if (method === "POST") return {};
    throw new ApiError(503, "Cold start");
  });
  await expect(syncPendingComments()).rejects.toThrow("Cold start");
  expect(await database.pendingComments.get(pending.id)).toMatchObject({
    acknowledged: true,
    payload: pending.payload,
  });
  vi.mocked(api).mockResolvedValue([comment({ ...pending.payload })]);
  await syncPendingComments();
  expect(
    vi.mocked(api).mock.calls.filter(([, method]) => method === "POST"),
  ).toHaveLength(1);
  expect(await database.pendingComments.count()).toBe(0);
});
it("preserves permanent failures, leaves their replies untouched and removes children before a parent", async () => {
  const parent = queued(),
    reply = queued(parent.id);
  await database.pendingComments.bulkPut([parent, reply]);
  vi.mocked(api).mockRejectedValue(new ApiError(410, "Deleted Task"));
  await syncPendingComments();
  expect(await database.pendingComments.get(parent.id)).toMatchObject({
    errorStatus: 410,
    error: "Deleted Task",
  });
  expect((await database.pendingComments.get(reply.id))?.error).toBeUndefined();
  expect(api).toHaveBeenCalledTimes(1);
  await expect(removeQueuedComment(parent.id)).rejects.toThrow("답글");
  expect(await database.pendingComments.count()).toBe(2);
  await retryComment(parent.id);
  expect(
    (await database.pendingComments.get(parent.id))?.error,
  ).toBeUndefined();
  await removeQueuedComment(reply.id);
  await removeQueuedComment(parent.id);
  expect(await database.pendingComments.count()).toBe(0);
});
it("defers unsaved documents and pending Page metadata without consuming the queue", async () => {
  const pending = queued(),
    workspaceId = crypto.randomUUID();
  await database.pendingComments.put(pending);
  await database.documents.put({
    id: pageId,
    workspaceId,
    update: new Uint8Array(),
    title: "Task",
    text: "",
    references: [],
    generation: 2,
    committedGeneration: 1,
    state: "saved",
    updatedAt: Date.now(),
  });
  await syncPendingComments();
  expect(api).not.toHaveBeenCalled();
  await database.documents.update(pageId, { committedGeneration: 2 });
  await database.pages.put({
    id: pageId,
    workspaceId,
    parentId: null,
    kind: "database",
    title: "To-Do",
    revision: 0,
    deletedAt: null,
    createdAt: "now",
    isInbox: false,
  });
  await database.workspaces.put({
    id: workspaceId,
    name: "Offline",
    ownerIdentityId: crypto.randomUUID(),
    createdAt: "now",
    pendingCreation: true,
  });
  await syncPendingComments();
  expect(api).not.toHaveBeenCalled();
  expect(await database.pendingComments.count()).toBe(1);
});
it("does not drop a payload if server confirmation lacks its ID or is from another scope", async () => {
  const pending = queued();
  await database.pendingComments.put(pending);
  vi.mocked(api).mockImplementation(async (_path, method) =>
    method === "POST" ? {} : [],
  );
  await expect(syncPendingComments()).rejects.toThrow("확인");
  expect((await database.pendingComments.get(pending.id))?.acknowledged).toBe(
    true,
  );
  vi.mocked(api).mockResolvedValue([
    comment({ ...pending.payload, rowId: crypto.randomUUID() }),
  ]);
  await expect(syncPendingComments()).rejects.toThrow("범위");
  expect(await database.pendingComments.count()).toBe(1);
});
