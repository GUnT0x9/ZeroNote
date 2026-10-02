import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";
import * as Y from "yjs";
import { it, expect } from "vitest";
import {
  bytesToBase64,
  importMarkdownContent,
  type WorkspaceExport,
} from "@zeronote/shared";
import { createPagePdf } from "./pdf-export";
const fontPath = join(
  dirname(fileURLToPath(import.meta.resolve("pretendard/package.json"))),
  "dist/public/static/alternative/Pretendard-Regular.ttf",
);
function fixture(content: string): WorkspaceExport {
  const document = new Y.Doc();
  importMarkdownContent(document, content, {
    page: () => undefined,
    file: () => undefined,
  });
  const input: WorkspaceExport = {
    schemaVersion: 1,
    name: "Export",
    exportedAt: "now",
    pages: [
      {
        id: crypto.randomUUID(),
        parentId: null,
        title: "한글 문서",
        kind: "document",
        isInbox: false,
        document: bytesToBase64(Y.encodeStateAsUpdate(document)),
      },
    ],
  };
  document.destroy();
  return input;
}
it("generates a paginated PDF with an embedded Pretendard font and Korean title", async () => {
  const input = fixture(
    Array.from(
      { length: 160 },
      (_, index) => `한글 본문 ${index} with English.`,
    ).join("\n\n"),
  );
  const bytes = await createPagePdf(
      input,
      input.pages[0]!.id,
      await readFile(fontPath),
    ),
    pdf = await PDFDocument.load(bytes);
  expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  expect(pdf.getTitle()).toBe("한글 문서");
  expect(pdf.getPageCount()).toBeGreaterThan(1);
  expect(pdf.getPage(0).getWidth()).toBeCloseTo(595.28);
});
it("reports missing Pages, damaged font and unsupported glyphs instead of producing empty data", async () => {
  const input = fixture("safe");
  await expect(
    createPagePdf(input, "missing", await readFile(fontPath)),
  ).rejects.toThrow("Page");
  await expect(
    createPagePdf(input, input.pages[0]!.id, new Uint8Array([1])),
  ).rejects.toThrow();
  const unsupported = fixture("\u{10ffff}");
  await expect(
    createPagePdf(
      unsupported,
      unsupported.pages[0]!.id,
      await readFile(fontPath),
    ),
  ).rejects.toThrow("지원하지 않는 글자");
});
