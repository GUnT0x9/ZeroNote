import {
  MAX_ATTACHMENT_BYTES,
  WORKSPACE_ATTACHMENT_BYTES,
  MAX_WORKSPACE_ATTACHMENTS,
  AttachmentMetadataSchema,
  ExportAttachmentSchema,
  bytesToBase64,
  base64ToBytes,
  canEdit,
  detectAttachmentMime,
  safeAttachmentName,
} from "@zeronote/shared";
import { database, errorMessage, type LocalAttachment } from "./database";
import { api, ApiError } from "./api";

export async function attachmentDigest(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(data));
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function stageAttachment(
  pageId: string,
  name: string,
  data: Uint8Array,
): Promise<LocalAttachment> {
  const page = await database.pages.get(pageId);
  if (!page || page.accessLost || page.deletedAt || !canEdit(page.role))
    throw new Error("파일을 추가할 Page의 Editor 권한이 필요합니다.");
  if (!data.length || data.length > MAX_ATTACHMENT_BYTES)
    throw new Error("파일은 비어 있지 않은 4MiB 이하 파일을 선택해주세요.");
  const safeName = safeAttachmentName(name);
  const record: LocalAttachment = {
    id: crypto.randomUUID(),
    pageId,
    workspaceId: page.workspaceId,
    name: safeName,
    mime: detectAttachmentMime(data, safeName),
    size: data.length,
    hash: await attachmentDigest(data),
    data: Uint8Array.from(data),
    createdAt: new Date().toISOString(),
    operationId: crypto.randomUUID(),
    status: "pending",
  };
  await database.transaction("rw", database.attachments, async () => {
    const files = await database.attachments
      .where("workspaceId")
      .equals(page.workspaceId)
      .toArray();
    if (
      files.length >= MAX_WORKSPACE_ATTACHMENTS ||
      files.reduce((sum, file) => sum + file.size, 0) + data.length >
        WORKSPACE_ATTACHMENT_BYTES
    )
      throw new Error("Workspace 파일 저장 한도를 초과했습니다.");
    await database.attachments.add(record);
  });
  return record;
}
export async function loadAttachment(
  id: string,
  pageId: string,
): Promise<LocalAttachment> {
  const cached = await database.attachments.get(id);
  if (cached && cached.pageId === pageId) return cached;
  const page = await database.pages.get(pageId);
  if (!page || page.accessLost) throw new Error("파일에 접근할 수 없습니다.");
  const result = ExportAttachmentSchema.parse(await api(`/attachments/${id}`));
  if (result.id !== id || result.pageId !== pageId)
    throw new Error("파일의 Page 정보가 일치하지 않습니다.");
  const data = base64ToBytes(result.data);
  if (
    data.length !== result.size ||
    (await attachmentDigest(data)) !== result.hash
  )
    throw new Error("파일이 손상되었습니다. 다시 내려받아주세요.");
  const record: LocalAttachment = {
    ...AttachmentMetadataSchema.parse(result),
    workspaceId: page.workspaceId,
    data,
    operationId: crypto.randomUUID(),
    status: "uploaded",
  };
  await database.attachments.put(record);
  return record;
}
export async function syncAttachments(): Promise<void> {
  for (const file of await database.attachments
    .where("status")
    .equals("pending")
    .toArray()) {
    const page = await database.pages.get(file.pageId);
    if (!page || page.accessLost || page.deletedAt || !canEdit(page.role)) {
      await database.attachments.update(file.id, {
        status: "preserved",
        error: "Page 권한이 변경되어 파일을 이 기기에 보존했습니다.",
      });
      continue;
    }
    if (
      (await database.workspaces.get(file.workspaceId))?.pendingCreation ||
      (await database.operations
        .filter((operation) => operation.payload.pageId === file.pageId)
        .count())
    )
      continue;
    try {
      const metadata = AttachmentMetadataSchema.parse(
        await api(`/pages/${file.pageId}/attachments`, "POST", {
          operationId: file.operationId,
          id: file.id,
          name: file.name,
          data: bytesToBase64(file.data),
        }),
      );
      if (metadata.id !== file.id || metadata.hash !== file.hash)
        throw new Error("파일 저장 응답이 일치하지 않습니다.");
      await database.attachments.update(file.id, {
        ...metadata,
        status: "uploaded",
        error: undefined,
      });
    } catch (error) {
      const preserved =
        error instanceof ApiError && [403, 409, 410].includes(error.status);
      await database.attachments.update(file.id, {
        error: errorMessage(error),
        ...(preserved ? { status: "preserved" as const } : {}),
      });
      if (!preserved) throw error;
    }
  }
}
