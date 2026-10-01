import { sql } from "drizzle-orm";
import * as Y from "yjs";
import {
  MANUAL_SNAPSHOT_LIMIT,
  cloneDocumentContent,
  bytesToBase64,
  type DocumentSnapshot,
  type Page,
  AUTO_SNAPSHOT_DAYS,
  MAX_DOCUMENT_BYTES,
} from "@zeronote/shared";
import { DomainError } from "../errors";
import type { Repository, Executor } from "./repository";
export interface SnapshotRecord extends DocumentSnapshot {
  data: Buffer;
}
const SNAPSHOT_COLUMNS = sql`id,page_id AS "pageId",kind,name,schema_version AS "schemaVersion",created_at::text AS "createdAt"`;
export class SnapshotStore {
  constructor(readonly repository: Repository) {}
  async list(pageId: string): Promise<DocumentSnapshot[]> {
    await this.repository.database.execute(
      sql`DELETE FROM document_snapshots WHERE page_id=${pageId} AND kind='automatic' AND automatic_day < (now() AT TIME ZONE 'UTC')::date - ${AUTO_SNAPSHOT_DAYS - 1}::integer`,
    );
    return this.repository.query<DocumentSnapshot>(
      sql`SELECT ${SNAPSHOT_COLUMNS} FROM document_snapshots WHERE page_id=${pageId} AND (kind='manual' OR automatic_day >= (now() AT TIME ZONE 'UTC')::date - ${AUTO_SNAPSHOT_DAYS - 1}::integer) ORDER BY created_at DESC`,
    );
  }
  async get(
    id: string,
    executor: Executor = this.repository.database,
  ): Promise<SnapshotRecord> {
    const [snapshot] = await this.repository.query<SnapshotRecord>(
      sql`SELECT ${SNAPSHOT_COLUMNS},data FROM document_snapshots WHERE id=${id} AND (kind='manual' OR automatic_day >= (now() AT TIME ZONE 'UTC')::date - ${AUTO_SNAPSHOT_DAYS - 1}::integer)`,
      executor,
    );
    if (!snapshot) throw new DomainError(404, "Snapshot을 찾을 수 없습니다.");
    return snapshot;
  }
  async replay<T>(
    operationId: string,
    deviceId: string,
    action: string,
    sourceId: string,
    executor: Executor,
  ): Promise<T | undefined> {
    const [record] = await this.repository.query<{
      deviceId: string;
      action: string;
      snapshotId: string;
      result: T;
    }>(
      sql`SELECT device_id AS "deviceId",action,snapshot_id AS "snapshotId",result FROM snapshot_operations WHERE operation_id=${operationId}`,
      executor,
    );
    if (!record) return undefined;
    if (
      record.deviceId !== deviceId ||
      record.action !== action ||
      record.snapshotId !== sourceId
    )
      throw new DomainError(409, "Operation identifier collision");
    return record.result;
  }
  async remember(
    operationId: string,
    deviceId: string,
    action: string,
    sourceId: string,
    result: unknown,
    executor: Executor,
  ): Promise<void> {
    await executor.execute(
      sql`INSERT INTO snapshot_operations(operation_id,device_id,action,snapshot_id,result) VALUES(${operationId},${deviceId},${action},${sourceId},${JSON.stringify(result)}::jsonb)`,
    );
  }
  async create(
    pageId: string,
    deviceId: string,
    operationId: string,
    name: string,
  ): Promise<DocumentSnapshot> {
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(92061002)`);
      await this.repository.documents.lock(pageId, tx);
      const previous = await this.replay<DocumentSnapshot>(
        operationId,
        deviceId,
        "create",
        pageId,
        tx,
      );
      if (previous) return previous;
      const [count] = await this.repository.query<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM document_snapshots WHERE page_id=${pageId} AND kind='manual'`,
        tx,
      );
      if (Number(count?.count ?? 0) >= MANUAL_SNAPSHOT_LIMIT)
        throw new DomainError(
          409,
          "수동 기록은 최대 3개입니다. 기존 기록을 삭제해주세요.",
        );
      await this.repository.documents.assertCapacity(tx);
      const document = new Y.Doc({ gc: false });
      try {
        for (const state of await this.repository.documents.load(pageId, tx))
          Y.applyUpdate(document, state);
        const [result] = await this.repository.query<DocumentSnapshot>(
          sql`INSERT INTO document_snapshots(id,page_id,creator_device_id,kind,name,data) VALUES(${crypto.randomUUID()},${pageId},${deviceId},'manual',${name},${Buffer.from(Y.encodeStateAsUpdate(document))}) RETURNING ${SNAPSHOT_COLUMNS}`,
          tx,
        );
        await this.remember(
          operationId,
          deviceId,
          "create",
          pageId,
          result,
          tx,
        );
        return result!;
      } finally {
        document.destroy();
      }
    });
  }
  async remove(id: string): Promise<void> {
    await this.repository.database.execute(
      sql`DELETE FROM document_snapshots WHERE id=${id}`,
    );
  }
  async restore(
    id: string,
    source: Page,
    deviceId: string,
    operationId: string,
  ): Promise<Page> {
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(92061002)`);
      await this.repository.documents.lock(source.id, tx);
      const previous = await this.replay<Page>(
        operationId,
        deviceId,
        "restore",
        id,
        tx,
      );
      if (previous) return previous;
      const snapshot = await this.get(id, tx);
      await this.repository.documents.assertCapacity(tx);
      const original = new Y.Doc({ gc: false });
      let copy: Y.Doc | undefined;
      try {
        Y.applyUpdate(original, snapshot.data);
        const pageId = crypto.randomUUID();
        copy = cloneDocumentContent(original, source.id, pageId);
        const suffix = ` (복구 ${new Date().toISOString().slice(0, 16).replace("T", " ")})`;
        const title =
          (copy.getText("title").toString() || source.title).slice(
            0,
            500 - suffix.length,
          ) + suffix;
        const text = copy.getText("title");
        text.delete(0, text.length);
        text.insert(0, title);
        const state = Y.encodeStateAsUpdate(copy);
        if (state.byteLength > MAX_DOCUMENT_BYTES)
          throw new DomainError(413, "복구 문서가 크기 제한을 초과했습니다.");
        const page: Page = {
          ...source,
          id: pageId,
          parentId: null,
          title,
          revision: 0,
          deletedAt: null,
          createdAt: new Date().toISOString(),
          isInbox: false,
        };
        await tx.execute(
          sql`INSERT INTO pages(id,workspace_id,parent_id,kind,title,revision,created_at,is_inbox) VALUES(${page.id},${page.workspaceId},NULL,${page.kind},${title},0,${page.createdAt},false)`,
        );
        await this.repository.documents.writeCheckpoint(
          pageId,
          state,
          "0",
          title,
          tx,
        );
        await this.remember(operationId, deviceId, "restore", id, page, tx);
        return page;
      } finally {
        original.destroy();
        copy?.destroy();
      }
    });
  }
  detail(snapshot: SnapshotRecord) {
    const { data, ...metadata } = snapshot;
    return { ...metadata, update: bytesToBase64(data) };
  }
}
