import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  MAX_ATTACHMENT_BYTES,
  WORKSPACE_ATTACHMENT_BYTES,
  MAX_WORKSPACE_ATTACHMENTS,
  STORAGE_LIMIT_BYTES,
  safeAttachmentName,
  detectAttachmentMime,
  type AttachmentMetadata,
  type AttachmentUpload,
  getAttachmentIds,
  remapAttachmentIds,
} from "@zeronote/shared";
import type * as Y from "yjs";
import type { Repository, Executor } from "./repository";
import { DomainError } from "../errors";

const METADATA = sql`id,page_id AS "pageId",name,mime,size,payload_hash AS hash,created_at::text AS "createdAt"`;
export interface AttachmentRecord extends AttachmentMetadata {
  data: Buffer;
  deletedAt: string | null;
}
export class AttachmentStore {
  constructor(readonly repository: Repository) {}
  async list(pageId: string): Promise<AttachmentMetadata[]> {
    return this.repository.query<AttachmentMetadata>(
      sql`SELECT ${METADATA} FROM attachments WHERE page_id=${pageId} AND deleted_at IS NULL ORDER BY created_at,id`,
    );
  }
  async get(
    id: string,
    executor: Executor = this.repository.database,
  ): Promise<AttachmentRecord> {
    const [record] = await this.repository.query<AttachmentRecord>(
      sql`SELECT ${METADATA},data,deleted_at::text AS "deletedAt" FROM attachments WHERE id=${id}`,
      executor,
    );
    if (!record) throw new DomainError(404, "파일을 찾을 수 없습니다.");
    return record;
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
      sql`SELECT COALESCE(sum(size),0)::text AS bytes,count(*)::text AS count,count(*) FILTER (WHERE deleted_at IS NOT NULL)::text AS retained FROM attachments WHERE workspace_id=${workspaceId}`,
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
    // Snapshot references retain their bytes until Workspace deletion.
    await this.repository.database.execute(
      sql`UPDATE attachments SET deleted_at=COALESCE(deleted_at,now()) WHERE id=${id}`,
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
