import { z } from "zod";
export const MAX_COMMENT_BODY_LENGTH = 10000;
export const CommentQuerySchema = z
  .object({ rowId: z.uuid().optional() })
  .strict();
export const CommentResolutionSchema = z
  .object({ resolved: z.boolean(), rowId: z.uuid().nullable().optional() })
  .strict();
export function commentsPath(pageId: string, rowId?: string | null): string {
  z.uuid().parse(pageId);
  if (rowId != null) z.uuid().parse(rowId);
  return `/pages/${pageId}/comments${rowId ? `?rowId=${rowId}` : ""}`;
}
export function sameCommentScope(
  a: { pageId: string; rowId?: string | null },
  b: { pageId: string; rowId?: string | null },
): boolean {
  return a.pageId === b.pageId && (a.rowId ?? null) === (b.rowId ?? null);
}
export function orderPendingComments<
  T extends {
    id: string;
    createdAt: string;
    payload: { parentId: string | null };
  },
>(comments: T[]): T[] {
  const sorted = [...comments].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const byId = new Map(sorted.map((comment) => [comment.id, comment])),
    done = new Set<string>(),
    result: T[] = [];
  for (const comment of sorted) {
    const chain: T[] = [],
      seen = new Set<string>();
    let current: T | undefined = comment;
    while (current && !done.has(current.id)) {
      if (seen.has(current.id))
        throw new Error("Comment 답글 관계에 순환이 있습니다.");
      seen.add(current.id);
      chain.push(current);
      current = current.payload.parentId
        ? byId.get(current.payload.parentId)
        : undefined;
    }
    for (const item of chain.reverse()) {
      done.add(item.id);
      result.push(item);
    }
  }
  return result;
}
