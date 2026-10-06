import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  KnowledgeProjectionSchema,
  getKnowledgeProjection,
  knowledgeSourceText,
  normalizeSearchText,
  type KnowledgeProjection,
} from "@zeronote/shared";
import type { Repository, Executor } from "./repository";

const SEARCH_BACKFILL_BATCH_SIZE = 50;
export class SearchStore {
  constructor(readonly repository: Repository) {}
  async write(
    pageId: string,
    document: Y.Doc,
    executor: Executor,
  ): Promise<void> {
    const projection = getKnowledgeProjection(document);
    await executor.execute(sql`INSERT INTO search_documents(page_id,projection,search_text)
      VALUES(${pageId},${JSON.stringify(projection)}::jsonb,${normalizeSearchText(knowledgeSourceText(projection))})
      ON CONFLICT(page_id) DO UPDATE SET projection=excluded.projection,search_text=excluded.search_text,updated_at=now()`);
  }
  async list(
    pageIds: string[],
  ): Promise<
    { pageId: string; projection: KnowledgeProjection; updatedAt: string }[]
  > {
    if (!pageIds.length) return [];
    const rows = await this.repository.query<{
      pageId: string;
      projection: unknown;
      updatedAt: string;
    }>(
      sql`SELECT page_id AS "pageId",projection,updated_at::text AS "updatedAt"
        FROM search_documents WHERE page_id IN
          (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(pageIds)}::jsonb)) ORDER BY page_id`,
    );
    return rows.map((row) => ({
      ...row,
      projection: KnowledgeProjectionSchema.parse(row.projection),
    }));
  }
  /** Startup-only migration of committed content, with the same Page lock as writers. */
  async backfill(): Promise<void> {
    for (;;) {
      const missing = await this.repository.query<{ id: string }>(sql`
        SELECT p.id FROM pages p LEFT JOIN search_documents s ON s.page_id=p.id
        WHERE s.page_id IS NULL ORDER BY p.id LIMIT ${SEARCH_BACKFILL_BATCH_SIZE}`);
      if (!missing.length) return;
      for (const { id } of missing) await this.backfillPage(id);
    }
  }
  private async backfillPage(pageId: string): Promise<void> {
    await this.repository.database.transaction(async (tx) => {
      const pages = await this.repository.query(
        sql`SELECT id FROM pages WHERE id=${pageId} FOR UPDATE`,
        tx,
      );
      if (!pages.length) return;
      const existing = await this.repository.query(
        sql`SELECT page_id FROM search_documents WHERE page_id=${pageId}`,
        tx,
      );
      if (existing.length) return;
      const document = new Y.Doc();
      try {
        for (const update of await this.repository.documents.load(pageId, tx))
          Y.applyUpdate(document, update);
        // A Page with no committed CRDT state still has its registered title.
        if (!document.getText("title").length) {
          const [page] = await this.repository.query<{ title: string }>(
            sql`SELECT title FROM pages WHERE id=${pageId}`,
            tx,
          );
          document.getText("title").insert(0, page?.title ?? "");
        }
        await this.write(pageId, document, tx);
      } finally {
        document.destroy();
      }
    });
  }
}
