import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  AttachmentUploadSchema,
  detectAttachmentMime,
  safeAttachmentName,
  parseAttachmentRange,
  getAttachmentIds,
  remapAttachmentIds,
  MAX_ATTACHMENT_BYTES,
  isCanonicalBase64,
} from "./attachments";

describe("attachment transport and rendering safety", () => {
  it("validates the full 4MiB boundary without a RegExp stack overflow", () => {
    const data = Buffer.alloc(MAX_ATTACHMENT_BYTES, 65).toString("base64"),
      input = {
        id: crypto.randomUUID(),
        operationId: crypto.randomUUID(),
        name: "boundary.txt",
        data,
      };
    expect(isCanonicalBase64(data)).toBe(true);
    expect(AttachmentUploadSchema.safeParse(input).success).toBe(true);
    expect(
      AttachmentUploadSchema.safeParse({
        ...input,
        data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1).toString("base64"),
      }).success,
    ).toBe(false);
  });
  it("rejects wrong padding, misplaced padding, incomplete groups and nonzero pad bits", () => {
    for (const value of [
      "",
      "A",
      "A===",
      "AA=A",
      "AB==",
      "AAB=",
      "a?==",
      "AAAA\n",
    ])
      expect(isCanonicalBase64(value)).toBe(false);
    for (const value of ["AA==", "AAA=", "AAAA", "aGk="])
      expect(isCanonicalBase64(value)).toBe(true);
  });
  it("validates operation IDs and canonical base64 with bounded payloads", () => {
    const input = {
      id: crypto.randomUUID(),
      operationId: crypto.randomUUID(),
      name: "a.txt",
      data: "aGk=",
    };
    expect(AttachmentUploadSchema.parse(input)).toEqual(input);
    expect(
      AttachmentUploadSchema.safeParse({ ...input, data: "a?==" }).success,
    ).toBe(false);
    expect(
      AttachmentUploadSchema.safeParse({ ...input, id: "bad" }).success,
    ).toBe(false);
    expect(
      AttachmentUploadSchema.safeParse({ ...input, data: "" }).success,
    ).toBe(false);
  });
  it("removes traversal and header/control characters without losing Korean names", () => {
    expect(safeAttachmentName("../../보고서\r\n.pdf")).toBe("보고서.pdf");
    expect(safeAttachmentName("C:\\secret\\code.ts")).toBe("code.ts");
    expect(safeAttachmentName("\u0000")).toBe("attachment");
  });
  it("detects raster/media signatures and serves active formats as downloads", () => {
    expect(
      detectAttachmentMime(
        Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
        "x.html",
      ),
    ).toBe("image/png");
    expect(
      detectAttachmentMime(new TextEncoder().encode("%PDF-1.7"), "x.pdf"),
    ).toBe("application/pdf");
    expect(
      detectAttachmentMime(
        new TextEncoder().encode("<svg onload='alert(1)'/>"),
        "x.svg",
      ),
    ).toBe("application/octet-stream");
    expect(
      detectAttachmentMime(
        new TextEncoder().encode("<script>unsafe()</script>"),
        "x.html",
      ),
    ).toBe("text/plain");
    expect(detectAttachmentMime(Uint8Array.from([255, 0]), "x.ts")).toBe(
      "application/octet-stream",
    );
    expect(
      detectAttachmentMime(new TextEncoder().encode("RIFF....WAVE"), "x.wav"),
    ).toBe("audio/wav");
  });
});
describe("HTTP byte ranges", () => {
  it("supports normal, open and suffix ranges, clamped to file size", () => {
    expect(parseAttachmentRange(undefined, 20)).toBeNull();
    expect(parseAttachmentRange("bytes=2-5", 20)).toEqual({ start: 2, end: 5 });
    expect(parseAttachmentRange("bytes=5-", 20)).toEqual({ start: 5, end: 19 });
    expect(parseAttachmentRange("bytes=-5", 20)).toEqual({
      start: 15,
      end: 19,
    });
    expect(parseAttachmentRange("bytes=0-999", 20)).toEqual({
      start: 0,
      end: 19,
    });
  });
  it("rejects multipart, inverted, empty, zero suffix and out-of-range requests", () => {
    for (const range of [
      "bytes=0-2,4-5",
      "bytes=9-2",
      "bytes=-",
      "bytes=-0",
      "bytes=20-",
      "bytes=999999999999999999999-",
    ])
      expect(() => parseAttachmentRange(range, 20)).toThrow();
  });
});
it("finds and remaps attachment references after decoding untyped Yjs roots", () => {
  const original = new Y.Doc(),
    id = crypto.randomUUID(),
    next = crypto.randomUUID();
  const node = new Y.XmlElement("attachment");
  node.setAttribute("attachmentId", id);
  original.getXmlFragment("task:row").insert(0, [node]);
  const decoded = new Y.Doc();
  Y.applyUpdate(decoded, Y.encodeStateAsUpdate(original));
  expect(getAttachmentIds(decoded)).toEqual([id]);
  remapAttachmentIds(decoded, new Map([[id, next]]));
  expect(getAttachmentIds(decoded)).toEqual([next]);
  remapAttachmentIds(decoded, new Map());
  expect(getAttachmentIds(decoded)).toEqual([next]);
  decoded.destroy();
  original.destroy();
});
