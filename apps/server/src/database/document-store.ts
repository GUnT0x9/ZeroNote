import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  MAX_DOCUMENT_BYTES,
  STORAGE_LIMIT_BYTES,
  STORAGE_WARNING_BYTES,
  getDocumentProjection,
  AUTO_SNAPSHOT_DAYS,
} from "@zeronote/shared";
import { DomainError } from "../errors";
import type { Repository, Executor } from "./repository";
export class DocumentStore {
  constructor(readonly repository: Repository) {}
  async capacity(executor: Executor = this.repository.database) {
    const [row] = await this.repository.query<{ bytes: string }>(
      sql`SELECT pg_database_size(current_database())::text AS bytes`,
      executor,
    );
    const bytes = Number(row?.bytes ?? 0);
    return {
      bytes,
      warning: bytes >= STORAGE_WARNING_BYTES,
      blocked: bytes >= STORAGE_LIMIT_BYTES,
    };
  }
  async assertCapacity(
    executor: Executor = this.repository.database,
  ): Promise<void> {
    if ((await this.capacity(executor)).blocked)
      throw new DomainError(
        507,
        "서버 저장 공간이 부족합니다. 로컬 변경을 Export하고 관리자에게 알려주세요.",
      );
  }
  async load(
    pageId: string,
    executor: Executor = this.repository.database,
  ): Promise<Uint8Array[]> {
    const rows = await this.repository.query<{ data: Buffer }>(
      sql`
      SELECT data FROM (
        SELECT 0::bigint AS position,data FROM document_checkpoints WHERE page_id=${pageId}
        UNION ALL SELECT id AS position,data FROM document_updates WHERE page_id=${pageId}
        AND id>COALESCE((SELECT through_update_id FROM document_checkpoints WHERE page_id=${pageId}),0)
      ) states ORDER BY position`,
      executor,
    );
    return rows.map((row) => new Uint8Array(row.data));
  }
  async lock(pageId: string, executor: Executor): Promise<void> {
    const pages = await this.repository.query(
      sql`SELECT id FROM pages WHERE id=${pageId} FOR UPDATE`,
      executor,
    );
    if (!pages.length) throw new DomainError(404, "Page를 찾을 수 없습니다.");
  }
  async commit(
    pageId: string,
    operationId: string,
    update: Uint8Array,
  ): Promise<void> {
    if (update.byteLength > MAX_DOCUMENT_BYTES)
      throw new DomainError(413, "문서 크기 제한을 초과했습니다.");
    const hash = createHash("sha256").update(update).digest("hex");
    await this.repository.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(92061002)`);
      await this.lock(pageId, tx);
      const [prior] = await this.repository.query<{
        pageId: string;
        hash: string;
      }>(
        sql`SELECT page_id AS "pageId",payload_hash AS hash FROM document_operations WHERE operation_id=${operationId}`,
        tx,
      );
      if (prior) {
        if (prior.pageId !== pageId || prior.hash !== hash)
          throw new DomainError(409, "Operation identifier collision");
        return;
      }
      const document = new Y.Doc({ gc: false });
      try {
        for (const state of await this.load(pageId, tx))
          Y.applyUpdate(document, state);
        const before = Y.snapshot(document);
        try {
          Y.applyUpdate(document, update);
        } catch {
          throw new DomainError(400, "문서를 처리할 수 없습니다.");
        }
        const state = Y.encodeStateAsUpdate(document);
        if (
          state.byteLength > MAX_DOCUMENT_BYTES ||
          document.getText("title").length > 500
        )
          throw new DomainError(413, "문서 크기 제한을 초과했습니다.");
        await this.assertCapacity(tx);
        await tx.execute(
          sql`INSERT INTO document_operations(operation_id,page_id,payload_hash) VALUES(${operationId},${pageId},${hash})`,
        );
        const [row] = await this.repository.query<{ id: string }>(
          sql`INSERT INTO document_updates(page_id,operation_id,data) VALUES(${pageId},${operationId},${Buffer.from(update)}) RETURNING id::text`,
          tx,
        );
        await this.writeCheckpoint(
          pageId,
          state,
          row!.id,
          getDocumentProjection(document).title,
          tx,
        );
        if (!Y.equalSnapshots(before, Y.snapshot(document)))
          await this.automaticSnapshot(pageId, state, tx);
      } finally {
        document.destroy();
      }
    });
  }
  async writeCheckpoint(
    pageId: string,
    state: Uint8Array,
    through: string,
    title: string,
    executor: Executor,
  ): Promise<void> {
    await executor.execute(
      sql`INSERT INTO document_checkpoints(page_id,data,through_update_id) VALUES(${pageId},${Buffer.from(state)},${through}::bigint) ON CONFLICT(page_id) DO UPDATE SET data=excluded.data,through_update_id=excluded.through_update_id,updated_at=now()`,
    );
    await executor.execute(
      sql`UPDATE pages SET title=${title} WHERE id=${pageId}`,
    );
    await executor.execute(
      sql`DELETE FROM document_updates WHERE page_id=${pageId} AND id<=${through}::bigint`,
    );
  }
  async automaticSnapshot(
    pageId: string,
    state: Uint8Array,
    executor: Executor,
  ): Promise<void> {
    await executor.execute(
      sql`DELETE FROM document_snapshots WHERE page_id=${pageId} AND kind='automatic' AND automatic_day < (now() AT TIME ZONE 'UTC')::date - ${AUTO_SNAPSHOT_DAYS - 1}::integer`,
    );
    await executor.execute(
      sql`INSERT INTO document_snapshots(id,page_id,kind,data,automatic_day) VALUES(${crypto.randomUUID()},${pageId},'automatic',${Buffer.from(state)},(now() AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING`,
    );
  }
  async compact(pageId: string): Promise<void> {
    await this.repository.database.transaction(async (tx) => {
      await this.lock(pageId, tx);
      const document = new Y.Doc({ gc: false });
      try {
        for (const state of await this.load(pageId, tx))
          Y.applyUpdate(document, state);
        const [row] = await this.repository.query<{ id: string }>(
          sql`SELECT COALESCE(max(id),(SELECT through_update_id FROM document_checkpoints WHERE page_id=${pageId}),0)::text AS id FROM document_updates WHERE page_id=${pageId}`,
          tx,
        );
        await this.writeCheckpoint(
          pageId,
          Y.encodeStateAsUpdate(document),
          row!.id,
          getDocumentProjection(document).title,
          tx,
        );
      } finally {
        document.destroy();
      }
    });
  }
}
