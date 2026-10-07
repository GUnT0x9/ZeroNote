import { randomBytes } from "node:crypto";
import * as Y from "yjs";
import {
  CHALLENGE_LIFETIME_MS,
  SESSION_LIFETIME_MS,
  MAX_DOCUMENT_BYTES,
  EDITOR_PROTOCOL,
  EDITOR_UPDATE_MESSAGE,
  getDocumentEditorProtocol,
  sha256Hex,
  normalizeRecoveryKey,
  canEdit,
  wouldCreateCycle,
  base64ToBytes,
  bytesToBase64,
  type Role,
  type Page,
  type PageOperation,
  type Metadata,
  type CommentInput,
} from "@zeronote/shared";
import {
  Repository,
  type DeviceRecord,
  type GrantRecord,
} from "./database/repository";

import { DomainError } from "./errors";
export { DomainError } from "./errors";
export class AccessService {
  constructor(readonly repository: Repository) {}
  async workspaceOwner(deviceId: string, workspaceId: string): Promise<void> {
    const membership = await this.repository.getMembership(
      deviceId,
      workspaceId,
    );
    if (
      !membership ||
      membership.revokedAt ||
      membership.identityId !== membership.ownerIdentityId
    )
      throw new DomainError(403, "Workspace Owner 권한이 필요합니다.");
  }
  async page(
    deviceId: string,
    pageId: string,
    allowDeleted = false,
  ): Promise<{ page: Page; role: Role; identityId: string; name: string }> {
    const page = await this.repository.getPage(pageId);
    if (!page) throw new DomainError(404, "Page를 찾을 수 없습니다.");
    const membership = await this.repository.getMembership(
      deviceId,
      page.workspaceId,
    );
    if (!membership || membership.revokedAt)
      throw new DomainError(403, "Page 접근 권한이 없습니다.");
    const pages = await this.repository.listPages(page.workspaceId);
    const role =
      membership.identityId === membership.ownerIdentityId
        ? "owner"
        : roleForPage(
            page,
            pages,
            await this.repository.listGrants(membership.identityId),
          );
    if (!role) throw new DomainError(403, "Page 접근 권한이 없습니다.");
    if (!allowDeleted && isTrashed(page, pages))
      throw new DomainError(410, "삭제된 Page입니다.");
    return {
      page,
      role,
      identityId: membership.identityId,
      name: membership.name,
    };
  }
  async editor(deviceId: string, pageId: string, allowDeleted = false) {
    const access = await this.page(deviceId, pageId, allowDeleted);
    if (!canEdit(access.role))
      throw new DomainError(403, "Editor 권한이 필요합니다.");
    return access;
  }
  async metadata(deviceId: string): Promise<Metadata> {
    const workspaces = await this.repository.listWorkspaces(deviceId);
    const result: Metadata = {
      workspaces,
      pages: [],
      identities: [],
      roles: {},
    };
    for (const workspace of workspaces) {
      const membership = await this.repository.getMembership(
        deviceId,
        workspace.id,
      );
      if (!membership) continue;
      const pages = await this.repository.listPages(workspace.id),
        grants = await this.repository.listGrants(membership.identityId),
        owner = membership.identityId === workspace.ownerIdentityId;
      for (const page of pages) {
        const role = owner ? "owner" : roleForPage(page, pages, grants);
        if (role) {
          result.pages.push({
            ...page,
            ancestorTrashed: !page.deletedAt && isTrashed(page, pages),
          });
          result.roles[page.id] = role;
        }
      }
      const identities = await this.repository.listIdentities(workspace.id);
      for (const identity of identities) {
        const theirGrants = owner
          ? []
          : await this.repository.listGrants(identity.id);
        const visible =
          owner ||
          identity.id === workspace.ownerIdentityId ||
          identity.id === membership.identityId ||
          result.pages.some(
            (page) =>
              page.workspaceId === workspace.id &&
              roleForPage(page, pages, theirGrants),
          );
        if (visible)
          result.identities.push({
            ...identity,
            workspaceId: workspace.id,
            role:
              identity.id === workspace.ownerIdentityId ? "owner" : "member",
          });
      }
    }
    return result;
  }
}
export function isTrashed(page: Page, pages: Page[]): boolean {
  const byId = new Map(pages.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let current: Page | undefined = page;
  while (current) {
    if (current.deletedAt || visited.has(current.id)) return true;
    visited.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}
export function roleForPage(
  page: Page,
  pages: Page[],
  grants: GrantRecord[],
): Role | undefined {
  const ancestorIds = new Set<string>();
  const parents = new Map(pages.map((item) => [item.id, item.parentId]));
  let parent = page.parentId;
  while (parent && !ancestorIds.has(parent)) {
    ancestorIds.add(parent);
    parent = parents.get(parent) ?? null;
  }
  const strength: Record<Role, number> = {
    owner: 3,
    editor: 2,
    commenter: 1,
    viewer: 0,
  };
  let best: Role | undefined;
  for (const grant of grants) {
    if (grant.revokedAt || grant.workspaceId !== page.workspaceId) continue;
    if (
      grant.pageId !== page.id &&
      !(grant.includeDescendants && ancestorIds.has(grant.pageId))
    )
      continue;
    if (best === undefined || strength[grant.role] > strength[best])
      best = grant.role;
  }
  return best;
}
export class AuthService {
  constructor(readonly repository: Repository) {}
  async register(device: DeviceRecord): Promise<void> {
    try {
      await crypto.subtle.importKey(
        "jwk",
        device.publicKey,
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
    } catch {
      throw new DomainError(400, "잘못된 Device Key입니다.");
    }
    const existing = await this.repository.getDevice(device.id);
    if (
      existing &&
      (existing.publicKey.x !== device.publicKey.x ||
        existing.publicKey.y !== device.publicKey.y)
    )
      throw new DomainError(409, "다른 Key가 등록된 기기입니다.");
    await this.repository.registerDevice(device);
  }
  async challenge(deviceId: string): Promise<{ id: string; nonce: string }> {
    if (!(await this.repository.getDevice(deviceId)))
      throw new DomainError(404, "등록되지 않은 기기입니다.");
    const id = crypto.randomUUID(),
      nonce = randomBytes(32).toString("base64url");
    await this.repository.createChallenge(
      id,
      deviceId,
      nonce,
      new Date(Date.now() + CHALLENGE_LIFETIME_MS),
    );
    return { id, nonce };
  }
  async verify(id: string, signature: string): Promise<string> {
    const challenge = await this.repository.getChallenge(id);
    if (!challenge || new Date(challenge.expiresAt).getTime() < Date.now())
      throw new DomainError(401, "인증 요청이 만료되었습니다.");
    const device = await this.repository.getDevice(challenge.deviceId);
    if (!device) throw new DomainError(401, "기기를 확인할 수 없습니다.");
    const publicKey = await crypto.subtle.importKey(
      "jwk",
      device.publicKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    let verified = false;
    try {
      verified = await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        publicKey,
        Uint8Array.from(base64ToBytes(signature)),
        new TextEncoder().encode(challenge.nonce),
      );
    } catch {
      throw new DomainError(401, "서명을 확인할 수 없습니다.");
    }
    if (!verified) throw new DomainError(401, "서명이 일치하지 않습니다.");
    const token = randomBytes(32).toString("base64url");
    const consumed = await this.repository.consumeChallengeAndCreateSession(
      id,
      device.id,
      await sha256Hex(token),
      new Date(Date.now() + SESSION_LIFETIME_MS),
    );
    if (!consumed) throw new DomainError(401, "이미 사용된 인증 요청입니다.");
    return token;
  }
  async deviceForToken(token: string | undefined): Promise<string> {
    const deviceId = token
      ? await this.repository.sessionDevice(await sha256Hex(token))
      : undefined;
    if (!deviceId) throw new DomainError(401, "기기 인증이 필요합니다.");
    return deviceId;
  }
}
export class WorkspaceService {
  private readonly queues = new Map<string, Promise<void>>();
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async recover(deviceId: string, key: string) {
    const workspace = await this.repository.recoverWorkspace(
      await sha256Hex(normalizeRecoveryKey(key)),
      deviceId,
    );
    if (!workspace)
      throw new DomainError(404, "Recovery Key가 일치하지 않습니다.");
    return workspace;
  }
  async pageOperation(
    deviceId: string,
    operation: PageOperation,
  ): Promise<Page> {
    const previous =
      this.queues.get(operation.workspaceId) ?? Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.queues.set(operation.workspaceId, current);
    await previous;
    try {
      return await this.performPageOperation(deviceId, operation);
    } finally {
      release();
      if (this.queues.get(operation.workspaceId) === current)
        this.queues.delete(operation.workspaceId);
    }
  }
  private async performPageOperation(
    deviceId: string,
    operation: PageOperation,
  ): Promise<Page> {
    const replay = await this.repository.getOperation(
      operation.operationId,
      deviceId,
    );
    if (replay) return replay;
    if (operation.action === "create") {
      await this.access.workspaceOwner(deviceId, operation.workspaceId);
      const page = operation.page;
      if (
        !page ||
        page.id !== operation.pageId ||
        page.workspaceId !== operation.workspaceId ||
        page.deletedAt
      )
        throw new DomainError(400, "Page 정보가 올바르지 않습니다.");
      if (page.parentId) {
        const parent = await this.access.editor(deviceId, page.parentId);
        if (parent.page.workspaceId !== page.workspaceId)
          throw new DomainError(400, "다른 Workspace의 부모입니다.");
      }
      const created = await this.repository.applyPageOperation(
        operation.operationId,
        deviceId,
        page,
        true,
        0,
      );
      if (!created) throw new DomainError(409, "이미 존재하는 Page입니다.");
      return created;
    }
    const access = await this.access.editor(deviceId, operation.pageId, true);
    if (access.page.workspaceId !== operation.workspaceId)
      throw new DomainError(400, "Workspace가 일치하지 않습니다.");
    const next = { ...access.page };
    if (operation.action === "move") {
      const parentId = operation.parentId ?? null;
      const pages = await this.repository.listPages(operation.workspaceId);
      if (wouldCreateCycle(next.id, parentId, pages))
        throw new DomainError(400, "Page를 자신의 하위로 이동할 수 없습니다.");
      if (parentId) {
        const parent = await this.access.editor(deviceId, parentId);
        if (parent.page.workspaceId !== next.workspaceId)
          throw new DomainError(400, "다른 Workspace의 부모입니다.");
      } else await this.access.workspaceOwner(deviceId, next.workspaceId);
      next.parentId = parentId;
    } else
      next.deletedAt =
        operation.action === "trash" ? new Date().toISOString() : null;
    const updated = await this.repository.applyPageOperation(
      operation.operationId,
      deviceId,
      next,
      false,
      operation.expectedRevision,
    );
    if (!updated)
      throw new DomainError(409, "다른 기기에서 구조가 변경되었습니다.");
    return updated;
  }
  async comment(deviceId: string, input: CommentInput): Promise<void> {
    const access = await this.access.page(deviceId, input.pageId);
    if (access.role === "viewer")
      throw new DomainError(403, "Comment 권한이 필요합니다.");
    if (input.parentId) {
      const comments = await this.repository.listComments(input.pageId);
      if (
        !comments.some(
          (comment) => comment.id === input.parentId && !comment.parentId,
        )
      )
        throw new DomainError(400, "같은 Page의 Thread에 답글을 작성해주세요.");
    }
    const existing = (await this.repository.listComments(input.pageId)).find(
      (comment) => comment.id === input.id,
    );
    if (existing && existing.identityId !== access.identityId)
      throw new DomainError(409, "Comment ID 충돌입니다.");
    await this.repository.createComment({
      ...input,
      identityId: access.identityId,
    });
  }
}
export class DocumentService {
  constructor(
    readonly repository: Repository,
    readonly access: AccessService,
  ) {}
  async load(pageId: string): Promise<Y.Doc> {
    const document = new Y.Doc({ gc: false });
    for (const update of await this.repository.loadDocument(pageId))
      Y.applyUpdate(document, update);
    return document;
  }
  async assertProtocol(
    pageId: string,
    editorProtocol: number,
  ): Promise<number> {
    const required = await this.repository.documents.minimumProtocol(pageId);
    if (editorProtocol < required)
      throw new DomainError(426, EDITOR_UPDATE_MESSAGE);
    return required;
  }
  async read(
    deviceId: string,
    pageId: string,
    editorProtocol = EDITOR_PROTOCOL,
  ): Promise<string> {
    await this.access.page(deviceId, pageId);
    await this.assertProtocol(pageId, editorProtocol);
    const document = await this.load(pageId);
    try {
      if (editorProtocol < getDocumentEditorProtocol(document))
        throw new DomainError(426, EDITOR_UPDATE_MESSAGE);
      return bytesToBase64(Y.encodeStateAsUpdate(document));
    } finally {
      document.destroy();
    }
  }
  async commit(
    deviceId: string,
    pageId: string,
    operationId: string,
    encoded: string,
    editorProtocol = EDITOR_PROTOCOL,
  ): Promise<Uint8Array> {
    await this.access.editor(deviceId, pageId);
    let update: Uint8Array;
    try {
      update = base64ToBytes(encoded);
    } catch {
      throw new DomainError(400, "잘못된 문서 데이터입니다.");
    }
    if (update.byteLength > MAX_DOCUMENT_BYTES)
      throw new DomainError(413, "문서 크기 제한을 초과했습니다.");
    await this.repository.appendUpdate(
      pageId,
      operationId,
      update,
      editorProtocol,
    );
    return update;
  }
}
