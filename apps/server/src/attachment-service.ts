import {
  AttachmentUploadSchema,
  PurgeAttachmentSchema,
  bytesToBase64,
} from "@zeronote/shared";
import type { Repository } from "./database/repository";
import { DomainError, type AccessService } from "./services";

export class AttachmentService {
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async list(deviceId: string, pageId: string) {
    await this.access.page(deviceId, pageId);
    return this.repository.attachments.list(pageId);
  }
  async upload(deviceId: string, pageId: string, input: unknown) {
    const permission = await this.access.editor(deviceId, pageId);
    return this.repository.attachments.upload(
      pageId,
      permission.page.workspaceId,
      deviceId,
      AttachmentUploadSchema.parse(input),
    );
  }
  async read(deviceId: string, id: string) {
    const record = await this.repository.attachments.get(id);
    const permission = await this.access.page(deviceId, record.pageId, true);
    if (permission.role !== "owner")
      await this.access.page(deviceId, record.pageId);
    if (record.deletedAt && permission.role !== "owner")
      throw new DomainError(410, "삭제된 파일입니다.");
    return record;
  }
  async download(deviceId: string, id: string) {
    const {
      data,
      deletedAt: _deleted,
      ...metadata
    } = await this.read(deviceId, id);
    return { ...metadata, data: bytesToBase64(data) };
  }
  async remove(deviceId: string, id: string) {
    const record = await this.repository.attachments.get(id);
    await this.access.editor(deviceId, record.pageId);
    await this.repository.attachments.remove(id);
    return { deleted: true };
  }
  async storage(deviceId: string, workspaceId: string) {
    await this.access.workspaceOwner(deviceId, workspaceId);
    return this.repository.attachments.storage(workspaceId);
  }
  async purge(
    deviceId: string,
    workspaceId: string,
    id: string,
    input: unknown,
  ) {
    await this.access.workspaceOwner(deviceId, workspaceId);
    const { name } = PurgeAttachmentSchema.parse(input);
    return this.repository.attachments.purge(workspaceId, id, name);
  }
}
