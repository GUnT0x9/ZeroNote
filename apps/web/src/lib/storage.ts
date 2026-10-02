import * as Y from "yjs";
import { AttachmentStorageSchema, getAttachmentIds } from "@zeronote/shared";
import { database } from "./database";
import { api } from "./api";
import { flushDocuments } from "./documents";

export async function loadWorkspaceStorage(workspaceId: string) {
  return AttachmentStorageSchema.parse(
    await api(`/workspaces/${workspaceId}/attachments/storage`),
  );
}
export async function localFileUsage(workspaceId: string) {
  const files = await database.attachments
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  const protectedPageIds = await retainedFilePageIds(workspaceId);
  return {
    bytes: files.reduce((sum, file) => sum + file.size, 0),
    count: files.length,
    pending: files.filter(
      (file) => file.status !== "uploaded" || protectedPageIds.has(file.pageId),
    ).length,
  };
}
async function retainedFilePageIds(workspaceId: string): Promise<Set<string>> {
  const pages = await database.pages
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  return new Set(
    pages
      .filter((page) => page.accessLost || page.deletedAt)
      .map((page) => page.id),
  );
}
export async function removeUploadedFileCache(
  workspaceId: string,
): Promise<void> {
  // Uncommitted and access-lost copies remain available for recovery/Export.
  await database.transaction(
    "rw",
    [database.attachments, database.pages],
    async () => {
      const protectedPageIds = await retainedFilePageIds(workspaceId);
      await database.attachments
        .where("workspaceId")
        .equals(workspaceId)
        .filter(
          (file) =>
            file.status === "uploaded" && !protectedPageIds.has(file.pageId),
        )
        .delete();
    },
  );
}
export async function purgeUnusedAttachment(
  workspaceId: string,
  id: string,
  name: string,
): Promise<void> {
  await flushDocuments();
  const cached = await database.attachments.get(id);
  if (
    cached &&
    (cached.workspaceId !== workspaceId || cached.status !== "uploaded")
  )
    throw new Error("아직 서버에 저장되지 않은 파일은 정리할 수 없습니다.");
  const records = await database.documents
    .where("workspaceId")
    .equals(workspaceId)
    .toArray();
  for (const record of records) {
    const document = new Y.Doc();
    try {
      Y.applyUpdate(document, record.update);
      if (getAttachmentIds(document).includes(id))
        throw new Error(
          "이 기기의 문서에서 사용 중인 파일입니다. Block을 제거하고 동기화해주세요.",
        );
    } finally {
      document.destroy();
    }
  }
  await api(`/workspaces/${workspaceId}/attachments/${id}/content`, "DELETE", {
    name,
  });
  await database.attachments.delete(id);
}
