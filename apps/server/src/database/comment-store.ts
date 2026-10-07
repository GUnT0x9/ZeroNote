import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  canComment,
  getTaskRows,
  sameCommentScope,
  type CommentInput,
  type PageComment,
  type Role,
} from "@zeronote/shared";
import { DomainError } from "../errors";
import type { Repository, Executor } from "./repository";

// Same transaction lock as document Commit and file cleanup.
import { CONTENT_WRITE_LOCK_ID } from "./locks";
type CommentRecord = PageComment & { rowId: string | null };
type Authorize = (
  executor: Executor,
) => Promise<{ role: Role; identityId: string }>;
export class CommentStore {
  constructor(readonly repository: Repository) {}
  async find(
    id: string,
    executor: Executor = this.repository.database,
  ): Promise<CommentRecord | undefined> {
    return (
      await this.repository.query<CommentRecord>(
        sql`SELECT c.id,c.page_id AS "pageId",c.row_id AS "rowId",c.parent_id AS "parentId",c.body,c.identity_id AS "identityId",i.name AS "authorName",c.resolved,c.created_at::text AS "createdAt" FROM comments c JOIN identities i ON i.id=c.identity_id WHERE c.id=${id}`,
        executor,
      )
    )[0];
  }
  async list(
    pageId: string,
    rowId: string | null = null,
  ): Promise<PageComment[]> {
    const comments = await this.repository.query<CommentRecord>(
      sql`SELECT c.id,c.page_id AS "pageId",c.row_id AS "rowId",c.parent_id AS "parentId",c.body,c.identity_id AS "identityId",i.name AS "authorName",c.resolved,c.created_at::text AS "createdAt" FROM comments c JOIN identities i ON i.id=c.identity_id WHERE c.page_id=${pageId} AND c.row_id IS NOT DISTINCT FROM ${rowId}::uuid ORDER BY c.created_at,c.id`,
    );
    // The previous Web validates a strict Page DTO without rowId.
    return rowId === null
      ? comments.map(({ rowId: _rowId, ...comment }) => comment)
      : comments;
  }
  async assertRow(
    pageId: string,
    rowId: string | null,
    executor: Executor = this.repository.database,
  ): Promise<void> {
    if (!rowId) return;
    const document = new Y.Doc();
    try {
      for (const update of await this.repository.documents.load(
        pageId,
        executor,
      ))
        Y.applyUpdate(document, update);
      const row = document.getMap<Y.Map<unknown>>("tasks").get(rowId);
      if (row instanceof Y.Map && row.get("deleted") === true)
        throw new DomainError(
          410,
          "삭제된 Task입니다. Comment 내용은 이 기기에 보관됩니다.",
        );
      const page = await this.repository.getPage(pageId, executor);
      if (
        page?.kind !== "database" ||
        !getTaskRows(document).some((row) => row.id === rowId)
      )
        throw new DomainError(404, "Task를 찾을 수 없습니다.");
    } finally {
      document.destroy();
    }
  }
  private async write<T>(
    pageId: string,
    authorize: Authorize,
    action: (tx: Executor, identityId: string) => Promise<T>,
  ): Promise<T> {
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${CONTENT_WRITE_LOCK_ID})`,
      );
      await this.repository.documents.lock(pageId, tx);
      const access = await authorize(tx);
      if (!canComment(access.role))
        throw new DomainError(403, "Comment 권한이 필요합니다.");
      return action(tx, access.identityId);
    });
  }
  async create(input: CommentInput, authorize: Authorize): Promise<void> {
    await this.write(input.pageId, authorize, async (tx, identityId) => {
      const existing = await this.find(input.id, tx);
      if (existing) {
        if (
          existing.identityId !== identityId ||
          !sameCommentScope(existing, input) ||
          existing.parentId !== input.parentId ||
          existing.body !== input.body
        )
          throw new DomainError(
            409,
            "Comment ID가 다른 내용이나 범위에 사용됐습니다.",
          );
        return;
      }
      await this.assertRow(input.pageId, input.rowId ?? null, tx);
      await this.assertParent(input, tx);
      await this.repository.documents.assertCapacity(tx);
      await tx.execute(
        sql`INSERT INTO comments(id,page_id,row_id,parent_id,body,identity_id) VALUES(${input.id},${input.pageId},${input.rowId ?? null},${input.parentId},${input.body},${identityId})`,
      );
    });
  }
  private async assertParent(input: CommentInput, tx: Executor): Promise<void> {
    if (!input.parentId) return;
    const parent = await this.find(input.parentId, tx);
    if (
      input.parentId === input.id ||
      !parent ||
      parent.parentId ||
      !sameCommentScope(parent, input)
    )
      throw new DomainError(
        400,
        "같은 Page 또는 Task의 최상위 Thread에 답글을 작성해주세요.",
      );
  }
  async resolve(
    pageId: string,
    id: string,
    rowId: string | null,
    resolved: boolean,
    authorize: Authorize,
  ): Promise<void> {
    await this.write(pageId, authorize, async (tx) => {
      const comment = await this.find(id, tx);
      if (
        !comment ||
        comment.parentId ||
        !sameCommentScope(comment, { pageId, rowId })
      )
        throw new DomainError(404, "해당 범위의 Thread를 찾을 수 없습니다.");
      await this.assertRow(pageId, rowId, tx);
      await tx.execute(
        sql`UPDATE comments SET resolved=${resolved} WHERE id=${id}`,
      );
    });
  }
}
