import { DomainError, type AccessService } from "./services";
import type { Repository } from "./database/repository";
import * as Y from "yjs";
import {
  EDITOR_PROTOCOL,
  EDITOR_UPDATE_MESSAGE,
  getDocumentEditorProtocol,
} from "@zeronote/shared";
export class SnapshotService {
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async ownerPage(deviceId: string, pageId: string) {
    const permission = await this.access.page(deviceId, pageId, true);
    await this.access.workspaceOwner(deviceId, permission.page.workspaceId);
    return permission.page;
  }
  async list(deviceId: string, pageId: string) {
    await this.ownerPage(deviceId, pageId);
    return this.repository.snapshots.list(pageId);
  }
  async create(
    deviceId: string,
    pageId: string,
    operationId: string,
    name: string,
  ) {
    await this.ownerPage(deviceId, pageId);
    return this.repository.snapshots.create(
      pageId,
      deviceId,
      operationId,
      name,
    );
  }
  async read(deviceId: string, id: string, editorProtocol = EDITOR_PROTOCOL) {
    const snapshot = await this.repository.snapshots.get(id);
    await this.ownerPage(deviceId, snapshot.pageId);
    if (snapshot.schemaVersion !== 1)
      throw new DomainError(409, "지원하지 않는 Snapshot 형식입니다.");
    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, snapshot.data);
      if (editorProtocol < getDocumentEditorProtocol(document))
        throw new DomainError(426, EDITOR_UPDATE_MESSAGE);
    } finally {
      document.destroy();
    }
    return this.repository.snapshots.detail(snapshot);
  }
  async remove(deviceId: string, id: string) {
    const snapshot = await this.repository.snapshots.get(id);
    await this.ownerPage(deviceId, snapshot.pageId);
    await this.repository.snapshots.remove(id);
  }
  async restore(deviceId: string, id: string, operationId: string) {
    const snapshot = await this.repository.snapshots.get(id);
    const page = await this.ownerPage(deviceId, snapshot.pageId);
    if (snapshot.schemaVersion !== 1)
      throw new DomainError(409, "지원하지 않는 Snapshot 형식입니다.");
    return this.repository.snapshots.restore(id, page, deviceId, operationId);
  }
}
