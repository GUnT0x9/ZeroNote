import { z } from "zod";
import {
  AttachmentMetadataSchema,
  type AttachmentMetadata,
} from "@zeronote/shared";
import { database } from "./database";
import { api } from "./api";
const METADATA_PREFIX = "attachment-metadata:";
// Retained versions may outlive the 200 active-file allowance.
const MAX_CACHED_ATTACHMENT_METADATA = 2000;
const MetadataListSchema = z
  .array(AttachmentMetadataSchema)
  .max(MAX_CACHED_ATTACHMENT_METADATA)
  .refine(
    (files) => new Set(files.map((file) => file.id)).size === files.length,
    "중복 파일입니다.",
  );
export function attachmentMetadataKey(pageId: string): string {
  return METADATA_PREFIX + pageId;
}
function parseCachedMetadata(value: string | undefined): AttachmentMetadata[] {
  if (!value) return [];
  try {
    return MetadataListSchema.parse(JSON.parse(value));
  } catch {
    return [];
  }
}
export async function cacheAttachmentMetadata(
  pageId: string,
  records: AttachmentMetadata[],
  replace = false,
): Promise<void> {
  const files = MetadataListSchema.parse(records);
  if (files.some((file) => file.pageId !== pageId))
    throw new Error("파일의 Page 정보가 일치하지 않습니다.");
  await database.transaction("rw", database.preferences, async () => {
    const id = attachmentMetadataKey(pageId),
      saved = await database.preferences.get(id);
    const merged = new Map(
      (replace ? [] : parseCachedMetadata(saved?.value)).map((file) => [
        file.id,
        file,
      ]),
    );
    for (const file of files) merged.set(file.id, file);
    const value = JSON.stringify(
      MetadataListSchema.parse([...merged.values()]),
    );
    if (saved?.value !== value) await database.preferences.put({ id, value });
  });
}
export async function cachedAttachmentMetadata(
  pageId: string,
): Promise<AttachmentMetadata[]> {
  const saved = await database.preferences.get(attachmentMetadataKey(pageId));
  const records = new Map(
    parseCachedMetadata(saved?.value)
      .filter((file) => file.pageId === pageId)
      .map((file) => [file.id, file]),
  );
  // A cursor also supports older/imported caches without retaining all file bytes.
  await database.attachments
    .where("pageId")
    .equals(pageId)
    .each((file) => {
      records.set(file.id, AttachmentMetadataSchema.parse(file));
    });
  return [...records.values()];
}
const loading = new Map<string, Promise<AttachmentMetadata[]>>();
export async function loadAttachmentMetadata(
  pageId: string,
  retained = false,
): Promise<AttachmentMetadata[]> {
  const page = await database.pages.get(pageId);
  if (
    !page ||
    page.accessLost ||
    (page.deletedAt && !retained) ||
    (retained && page.role !== "owner")
  )
    throw new Error("파일에 접근할 수 없습니다.");
  // Metadata revisions start at zero on the server too. Only a queued create
  // operation means the Page has not been registered remotely yet.
  const pendingCreation = await database.operations
    .filter(
      (operation) =>
        operation.payload.pageId === pageId &&
        operation.payload.action === "create",
    )
    .first();
  if (!navigator.onLine || pendingCreation)
    return cachedAttachmentMetadata(pageId);
  const key = `${pageId}:${retained}`;
  const active = loading.get(key);
  if (active) return active;
  const request = (async () => {
    const files = MetadataListSchema.parse(
      await api(`/pages/${pageId}/attachments${retained ? "?retained=1" : ""}`),
    );
    // Live and Snapshot panels can fetch together. Keep names already received
    // for retained versions; the document and byte endpoint still enforce access.
    await cacheAttachmentMetadata(pageId, files);
    return cachedAttachmentMetadata(pageId);
  })();
  loading.set(key, request);
  try {
    return await request;
  } finally {
    loading.delete(key);
  }
}
