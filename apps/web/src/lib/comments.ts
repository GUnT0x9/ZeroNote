import { z } from "zod";
import {
  CommentInputSchema,
  CommentSchema,
  commentsPath,
  orderPendingComments,
  sameCommentScope,
  type PageComment,
} from "@zeronote/shared";
import { database, type PendingComment } from "./database";
import { api, ApiError } from "./api";

export interface CommentScope {
  pageId: string;
  rowId?: string | null;
}
const DraftSchema = z
  .object({ body: z.string(), parentId: z.uuid().nullable() })
  .strict();
export type CommentDraft = z.infer<typeof DraftSchema>;
const draftWrites = new Map<string, Promise<unknown>>();
const draftKey = (scope: CommentScope) =>
  `comment-draft:${scope.pageId}:${scope.rowId ?? "page"}`;

function writeDraftInOrder<T>(
  scope: CommentScope,
  action: () => Promise<T>,
): Promise<T> {
  const key = draftKey(scope),
    previous = draftWrites.get(key);
  const next = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(action);
  draftWrites.set(key, next);
  void next
    .finally(() => {
      if (draftWrites.get(key) === next) draftWrites.delete(key);
    })
    .catch(() => undefined);
  return next;
}
export async function loadCommentDraft(
  scope: CommentScope,
): Promise<CommentDraft> {
  await draftWrites.get(draftKey(scope));
  const stored = await database.preferences.get(draftKey(scope));
  return stored
    ? DraftSchema.parse(JSON.parse(stored.value))
    : { body: "", parentId: null };
}
export function saveCommentDraft(
  scope: CommentScope,
  draft: CommentDraft,
): Promise<void> {
  const parsed = DraftSchema.parse(draft);
  return writeDraftInOrder(scope, async () => {
    await database.preferences.put({
      id: draftKey(scope),
      value: JSON.stringify(parsed),
    });
  });
}
export function queueComment(
  scope: CommentScope,
  draft: CommentDraft,
): Promise<string> {
  const id = crypto.randomUUID(),
    payload = CommentInputSchema.parse({
      id,
      pageId: scope.pageId,
      ...(scope.rowId ? { rowId: scope.rowId } : {}),
      parentId: draft.parentId,
      body: draft.body,
    });
  return writeDraftInOrder(scope, async () => {
    await database.transaction(
      "rw",
      database.pendingComments,
      database.preferences,
      async () => {
        await database.pendingComments.add({
          id,
          payload,
          createdAt: new Date().toISOString(),
        });
        await database.preferences.delete(draftKey(scope));
      },
    );
    return id;
  });
}
export async function cacheComments(
  scope: CommentScope,
  comments: PageComment[],
  signal?: AbortSignal,
): Promise<void> {
  if (comments.some((comment) => !sameCommentScope(comment, scope)))
    throw new Error("Comment 응답 범위가 일치하지 않습니다.");
  signal?.throwIfAborted();
  await database.transaction("rw", database.comments, async () => {
    signal?.throwIfAborted();
    const ids = await database.comments
      .where("pageId")
      .equals(scope.pageId)
      .filter((comment) => sameCommentScope(comment, scope))
      .primaryKeys();
    signal?.throwIfAborted();
    await database.comments.bulkDelete(ids);
    signal?.throwIfAborted();
    await database.comments.bulkPut(comments);
  });
}
export async function fetchComments(
  scope: CommentScope,
  signal?: AbortSignal,
): Promise<PageComment[]> {
  const response = z
    .array(CommentSchema)
    .parse(
      await api<unknown>(
        commentsPath(scope.pageId, scope.rowId),
        "GET",
        undefined,
        signal,
      ),
    );
  await cacheComments(scope, response, signal);
  return response;
}
export async function retryComment(id: string): Promise<void> {
  await database.pendingComments.update(id, {
    error: undefined,
    errorStatus: undefined,
  });
}
export async function removeQueuedComment(id: string): Promise<void> {
  await database.transaction("rw", database.pendingComments, async () => {
    if (
      await database.pendingComments
        .filter((comment) => comment.payload.parentId === id)
        .count()
    )
      throw new Error("전송 대기 답글을 먼저 제거해주세요.");
    await database.pendingComments.delete(id);
  });
}
async function commentIsWaiting(comment: PendingComment): Promise<boolean> {
  const page = await database.pages.get(comment.payload.pageId);
  const document = await database.documents.get(comment.payload.pageId);
  return (
    !!(
      page &&
      ((await database.workspaces.get(page.workspaceId))?.pendingCreation ||
        (await database.operations
          .filter((operation) => operation.payload.pageId === page.id)
          .count()))
    ) ||
    !!(
      document &&
      document.generation > document.committedGeneration &&
      document.state !== "preserved"
    )
  );
}
async function sendComment(comment: PendingComment): Promise<void> {
  if (!comment.acknowledged) {
    await api("/comments", "POST", comment.payload);
    await database.pendingComments.update(comment.id, { acknowledged: true });
  }
  const scope = comment.payload;
  const response = z
    .array(CommentSchema)
    .parse(await api<unknown>(commentsPath(scope.pageId, scope.rowId)));
  if (!response.some((item) => item.id === comment.id))
    throw new Error("서버에 저장된 Comment 확인을 기다리고 있습니다.");
  await database.transaction(
    "rw",
    database.pendingComments,
    database.comments,
    async () => {
      await cacheComments(scope, response);
      await database.pendingComments.delete(comment.id);
    },
  );
}
export async function syncPendingComments(
  canSend: (comment: PendingComment) => boolean | Promise<boolean> = () => true,
): Promise<void> {
  for (const comment of orderPendingComments(
    await database.pendingComments.toArray(),
  )) {
    if (
      comment.error ||
      !(await canSend(comment)) ||
      (await commentIsWaiting(comment))
    )
      continue;
    if (
      comment.payload.parentId &&
      (await database.pendingComments.get(comment.payload.parentId))
    )
      continue;
    try {
      await sendComment(comment);
    } catch (error) {
      if (
        error instanceof ApiError &&
        [400, 403, 404, 409, 410, 422, 507].includes(error.status)
      ) {
        await database.pendingComments.update(comment.id, {
          error: error.message,
          errorStatus: error.status,
        });
        continue;
      }
      throw error;
    }
  }
}
