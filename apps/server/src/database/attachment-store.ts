import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  MAX_ATTACHMENT_BYTES,
  WORKSPACE_ATTACHMENT_BYTES,
  MAX_WORKSPACE_ATTACHMENTS,
  STORAGE_LIMIT_BYTES,
  AUTO_SNAPSHOT_DAYS,
  safeAttachmentName,
  detectAttachmentMime,
  type AttachmentMetadata,
  type AttachmentUpload,
  type AttachmentStorage,
  getAttachmentIds,
  remapAttachmentIds,
} from "@zeronote/shared";
import * as Y from "yjs";
import type { Repository, Executor } from "./repository";
import { DomainError } from "../errors";

const METADATA = sql`id,page_id AS "pageId",name,mime,size,payload_hash AS hash,created_at::text AS "createdAt"`;
export interface AttachmentRecord extends AttachmentMetadata {
  data: Buffer;
  deletedAt: string | null;
}
export class AttachmentStore {
  constructor(readonly repository: Repository) {}
  async list(pageId: string, retained = false): Promise<AttachmentMetadata[]> {
    return this.repository.query<AttachmentMetadata>(
      sql`SELECT ${METADATA} FROM attachments WHERE page_id=${pageId} AND (${retained} OR deleted_at IS NULL) AND purged_at IS NULL ORDER BY created_at,id`,
    );
  }
  async get(
    id: string,
    executor: Executor = this.repository.database,
  ): Promise<AttachmentRecord> {
    const [record] = await this.repository.query<
      AttachmentRecord & { purgedAt: string | null }
    >(
      sql`SELECT ${METADATA},data,deleted_at::text AS "deletedAt",purged_at::text AS "purgedAt" FROM attachments WHERE id=${id}`,
      executor,
    );
    if (!record) throw new DomainError(404, "파일을 찾을 수 없습니다.");
    if (record.purgedAt) throw new DomainError(410, "영구 정리된 파일입니다.");
    const { purgedAt: _purged, ...available } = record;
    return available;
  }
  async storage(workspaceId: string): Promise<AttachmentStorage> {
    const files = await this.repository.query<
      AttachmentStorage["files"][number]
    >(
      sql`SELECT a.id,a.page_id AS "pageId",a.name,a.mime,a.size,a.payload_hash AS hash,a.created_at::text AS "createdAt",a.deleted_at::text AS "deletedAt",p.title AS "pageTitle",p.deleted_at::text AS "pageDeletedAt" FROM attachments a JOIN pages p ON p.id=a.page_id WHERE a.workspace_id=${workspaceId} AND a.purged_at IS NULL ORDER BY a.created_at DESC,a.id`,
    );
    return {
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      count: files.length,
      retained: files.filter((file) => file.deletedAt).length,
      limit: WORKSPACE_ATTACHMENT_BYTES,
      fileLimit: MAX_ATTACHMENT_BYTES,
      files,
    };
  }
  async purge(
    workspaceId: string,
    id: string,
    name: string,
  ): Promise<{ id: string; purged: true }> {
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(92061002)`);
      const [file] = await this.repository.query<{
        pageId: string;
        name: string;
        purgedAt: string | null;
      }>(
        sql`SELECT page_id AS "pageId",name,purged_at::text AS "purgedAt" FROM attachments WHERE workspace_id=${workspaceId} AND id=${id} FOR UPDATE`,
        tx,
      );
      if (!file) throw new DomainError(404, "파일을 찾을 수 없습니다.");
      if (file.name !== name)
        throw new DomainError(400, "파일 이름이 일치하지 않습니다.");
      if (file.purgedAt) return { id, purged: true };
      await this.repository.documents.lock(file.pageId, tx);
      if (
        this.referencesFile(
          await this.repository.documents.load(file.pageId, tx),
          id,
        )
      )
        throw new DomainError(
          409,
          "현재 문서나 휴지통 문서에서 사용 중인 파일입니다.",
        );
      const snapshots = await this.repository.query<{ data: Buffer }>(
        sql`SELECT data FROM document_snapshots WHERE page_id=${file.pageId} AND (kind='manual' OR automatic_day >= (now() AT TIME ZONE 'UTC')::date - ${AUTO_SNAPSHOT_DAYS - 1}::integer)`,
        tx,
      );
      if (
        snapshots.some((snapshot) => this.referencesFile([snapshot.data], id))
      )
        throw new DomainError(
          409,
          "기록에서 보관 중인 파일입니다. 필요 없는 기록을 먼저 삭제해주세요.",
        );
      const publicReaders = await this.repository.query(
        sql`SELECT 1 FROM public_sessions s JOIN public_shares sh ON sh.id=s.share_id WHERE s.expires_at>now() AND sh.revoked_at IS NULL AND (sh.expires_at IS NULL OR sh.expires_at>now()) AND ${id}::uuid=ANY(s.frozen_files) LIMIT 1`,
        tx,
      );
      if (publicReaders.length)
        throw new DomainError(
          409,
          "1회 열람 공유에서 보관 중인 파일입니다. 공유를 해제하거나 읽기 시간이 끝난 뒤 정리해주세요.",
        );
      await tx.execute(
        sql`UPDATE attachments SET data=decode('','hex'),deleted_at=COALESCE(deleted_at,now()),purged_at=now() WHERE id=${id}`,
      );
      return { id, purged: true };
    });
  }
  private referencesFile(updates: Uint8Array[], id: string): boolean {
    const document = new Y.Doc();
    try {
      for (const update of updates) Y.applyUpdate(document, update);
      return getAttachmentIds(document).includes(id);
    } finally {
      document.destroy();
    }
  }
  async usage(
    workspaceId: string,
    executor: Executor = this.repository.database,
  ) {
    const [value] = await this.repository.query<{
      bytes: string;
      count: string;
      retained: string;
    }>(
      sql`SELECT COALESCE(sum(size),0)::text AS bytes,count(*)::text AS count,count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS retained FROM attachments WHERE workspace_id=${workspaceId} AND purged_at IS NULL`,
      executor,
    );
    return {
      bytes: Number(value?.bytes ?? 0),
      count: Number(value?.count ?? 0),
      retained: Number(value?.retained ?? 0),
      limit: WORKSPACE_ATTACHMENT_BYTES,
      fileLimit: MAX_ATTACHMENT_BYTES,
    };
  }
  async assertSpace(
    workspaceId: string,
    bytes: number,
    count: number,
    executor: Executor,
  ): Promise<void> {
    const usage = await this.usage(workspaceId, executor);
    if (
      usage.bytes + bytes > WORKSPACE_ATTACHMENT_BYTES ||
      usage.count + count > MAX_WORKSPACE_ATTACHMENTS
    )
      throw new DomainError(
        507,
        "Workspace 파일 저장 한도를 초과했습니다. 파일은 이 기기에 보관됩니다.",
      );
    const capacity = await this.repository.documents.capacity(executor);
    if (capacity.bytes + bytes > STORAGE_LIMIT_BYTES)
      throw new DomainError(
        507,
        "서버 저장 공간이 부족합니다. 파일은 이 기기에 보관됩니다.",
      );
  }
  async upload(
    pageId: string,
    workspaceId: string,
    deviceId: string,
    input: AttachmentUpload,
  ): Promise<AttachmentMetadata> {
    const data = Buffer.from(input.data, "base64"),
      name = safeAttachmentName(input.name);
    if (
      !data.length ||
      data.length > MAX_ATTACHMENT_BYTES ||
      data.toString("base64") !== input.data
    )
      throw new DomainError(
        413,
        "파일은 4MiB 이하이며 비어 있지 않아야 합니다.",
      );
    const hash = createHash("sha256").update(data).digest("hex"),
      requestHash = createHash("sha256")
        .update(JSON.stringify([pageId, input.id, name, hash]))
        .digest("hex");
    return this.repository.database.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(92061002)`);
      const [prior] = await this.repository.query<{
        attachmentId: string;
        hash: string;
      }>(
        sql`SELECT attachment_id AS "attachmentId",payload_hash AS hash FROM attachment_operations WHERE operation_id=${input.operationId}`,
        tx,
      );
      if (
        prior &&
        (prior.attachmentId !== input.id || prior.hash !== requestHash)
      )
        throw new DomainError(
          409,
          "파일 Operation ID가 다른 요청에 사용됐습니다.",
        );
      const [existing] = await this.repository.query<AttachmentMetadata>(
        sql`SELECT ${METADATA} FROM attachments WHERE id=${input.id}`,
        tx,
      );
      if (
        existing &&
        (existing.pageId !== pageId ||
          existing.hash !== hash ||
          existing.name !== name)
      )
        throw new DomainError(409, "파일 ID가 다른 파일에 사용됐습니다.");
      if (!existing) {
        await this.assertSpace(workspaceId, data.length, 1, tx);
        await tx.execute(
          sql`INSERT INTO attachments(id,page_id,workspace_id,name,mime,size,payload_hash,data,created_by) VALUES(${input.id},${pageId},${workspaceId},${name},${detectAttachmentMime(data, name)},${data.length},${hash},${data},${deviceId})`,
        );
      }
      await tx.execute(
        sql`INSERT INTO attachment_operations(operation_id,attachment_id,page_id,payload_hash) VALUES(${input.operationId},${input.id},${pageId},${requestHash}) ON CONFLICT(operation_id) DO NOTHING`,
      );
      const {
        data: _data,
        deletedAt: _deleted,
        ...metadata
      } = await this.get(input.id, tx);
      return metadata;
    });
  }
  async remove(id: string): Promise<void> {
    // Marked files remain readable by the Owner for Snapshot recovery.
    // purge() removes bytes only after proving no current or retained references.
    await this.repository.database.execute(
      sql`UPDATE attachments SET deleted_at=COALESCE(deleted_at,now()) WHERE id=${id}`,
    );
  }
  async assertReferences(
    document: Y.Doc,
    pageId: string,
    executor: Executor,
  ): Promise<void> {
    const ids = getAttachmentIds(document);
    if (!ids.length) return;
    if (ids.length > MAX_WORKSPACE_ATTACHMENTS)
      throw new DomainError(422, "문서의 파일 개수 제한을 초과했습니다.");
    const records = await this.repository.query<{
      id: string;
      pageId: string;
      purgedAt: string | null;
    }>(
      sql`SELECT id,page_id AS "pageId",purged_at::text AS "purgedAt" FROM attachments WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
      executor,
    );
    if (
      records.length !== ids.length ||
      records.some((record) => record.pageId !== pageId || record.purgedAt)
    )
      throw new DomainError(
        422,
        "저장되지 않았거나 영구 정리된 파일을 참조하고 있습니다. 로컬 파일을 Export하거나 새로 첨부해주세요.",
      );
  }
  async copyReferences(
    document: Y.Doc,
    sourcePageId: string,
    targetPageId: string,
    workspaceId: string,
    deviceId: string,
    executor: Executor,
  ): Promise<void> {
    const originals: AttachmentRecord[] = [];
    for (const id of getAttachmentIds(document)) {
      const record = await this.get(id, executor);
      if (record.pageId !== sourcePageId)
        throw new DomainError(403, "다른 Page의 파일은 복사할 수 없습니다.");
      originals.push(record);
    }
    await this.assertSpace(
      workspaceId,
      originals.reduce((sum, item) => sum + item.size, 0),
      originals.length,
      executor,
    );
    const ids = new Map<string, string>();
    for (const record of originals) {
      const id = crypto.randomUUID();
      ids.set(record.id, id);
      await executor.execute(
        sql`INSERT INTO attachments(id,page_id,workspace_id,name,mime,size,payload_hash,data,created_by) VALUES(${id},${targetPageId},${workspaceId},${record.name},${record.mime},${record.size},${record.hash},${record.data},${deviceId})`,
      );
    }
    remapAttachmentIds(document, ids);
  }
}
