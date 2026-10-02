import { z } from "zod";
import * as Y from "yjs";

export const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
export const WORKSPACE_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_WORKSPACE_ATTACHMENTS = 200;
export const AttachmentMetadataSchema = z.object({
  id: z.uuid(),
  pageId: z.uuid(),
  name: z.string().min(1).max(240),
  mime: z.string().max(120),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_BYTES),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.string(),
});
export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>;
export const AttachmentUploadSchema = z
  .object({
    operationId: z.uuid(),
    id: z.uuid(),
    name: z.string().min(1).max(240),
    data: z
      .string()
      .min(4)
      .max(Math.ceil(MAX_ATTACHMENT_BYTES / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict();
export type AttachmentUpload = z.infer<typeof AttachmentUploadSchema>;
export const ExportAttachmentSchema = AttachmentMetadataSchema.extend({
  data: AttachmentUploadSchema.shape.data,
}).strict();

export function safeAttachmentName(name: string): string {
  const basename = name.split(/[/\\]/).at(-1) ?? "";
  const characters = Array.from(basename).filter((character) => {
    const code = character.codePointAt(0)!;
    return code >= 32 && code !== 127 && !(code >= 0xd800 && code <= 0xdfff);
  });
  let safe = "";
  for (const character of characters) {
    if (safe.length + character.length > 240) break;
    safe += character;
  }
  return safe.trim() || "attachment";
}
export function detectAttachmentMime(data: Uint8Array, name: string): string {
  const starts = (signature: number[]) =>
    signature.every((byte, index) => data[index] === byte);
  const text = (start: number, end: number) =>
    String.fromCharCode(...data.slice(start, end));
  if (starts([137, 80, 78, 71, 13, 10, 26, 10])) return "image/png";
  if (starts([255, 216, 255])) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(text(0, 6))) return "image/gif";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WEBP") return "image/webp";
  if (text(4, 8) === "ftyp" && ["avif", "avis"].includes(text(8, 12)))
    return "image/avif";
  if (text(0, 5) === "%PDF-") return "application/pdf";
  if (text(0, 4) === "RIFF" && text(8, 12) === "WAVE") return "audio/wav";
  if (
    text(0, 3) === "ID3" ||
    (data[0] === 255 && ((data[1] ?? 0) & 224) === 224)
  )
    return "audio/mpeg";
  if (text(0, 4) === "OggS")
    return /\.(ogv)$/i.test(name) ? "video/ogg" : "audio/ogg";
  if (text(4, 8) === "ftyp")
    return /\.(m4a)$/i.test(name) ? "audio/mp4" : "video/mp4";
  if (starts([26, 69, 223, 163]))
    return /\.(weba)$/i.test(name) ? "audio/webm" : "video/webm";
  if (
    /\.(txt|md|csv|json|js|jsx|ts|tsx|py|rs|go|java|sql|css|html|xml|yaml|yml|sh|c|h|cpp)$/i.test(
      name,
    )
  ) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(data);
      return "text/plain";
    } catch {
      /* Binary download. */
    }
  }
  return "application/octet-stream";
}
export function getAttachmentIds(document: Y.Doc): string[] {
  const ids = new Set<string>();
  const walk = (fragment: Y.XmlFragment | Y.XmlElement) => {
    for (const node of fragment.toArray())
      if (node instanceof Y.XmlElement) {
        const id = node.getAttribute("attachmentId");
        if (typeof id === "string" && z.uuid().safeParse(id).success)
          ids.add(id);
        walk(node);
      }
  };
  walk(document.getXmlFragment("content"));
  for (const name of [...document.share.keys()])
    if (name.startsWith("task:")) walk(document.getXmlFragment(name));
  return [...ids];
}
export function remapAttachmentIds(
  document: Y.Doc,
  ids: Map<string, string>,
): void {
  const walk = (fragment: Y.XmlFragment | Y.XmlElement) => {
    for (const node of fragment.toArray())
      if (node instanceof Y.XmlElement) {
        const id = node.getAttribute("attachmentId");
        if (typeof id === "string" && ids.has(id))
          node.setAttribute("attachmentId", ids.get(id)!);
        walk(node);
      }
  };
  document.transact(() => {
    walk(document.getXmlFragment("content"));
    for (const name of [...document.share.keys()])
      if (name.startsWith("task:")) walk(document.getXmlFragment(name));
  });
}
export function parseAttachmentRange(
  range: string | undefined,
  size: number,
): { start: number; end: number } | null {
  if (!range) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid byte range");
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start ||
    (!match[1] && Number(match[2]) === 0)
  )
    throw new Error("Invalid byte range");
  return { start, end: Math.min(end, size - 1) };
}
