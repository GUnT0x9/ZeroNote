import { strFromU8 } from "fflate";
import {
  bytesToBase64,
  ExportSchema,
  type WorkspaceExport,
} from "@zeronote/shared";
import { exportWorkspace, importWorkspace, downloadJson } from "./workspace";
import {
  encryptWorkspaceExport,
  decryptWorkspaceExport,
  isEncryptedExport,
} from "./encrypted-export";
import {
  buildPortableArchive,
  extractPortableArchive,
  importPortableFiles,
  renderPageHtml,
  renderPageMarkdown,
  MAX_ARCHIVE_BYTES,
} from "./portable-archive";

export type ExportFormat =
  "json" | "encrypted" | "markdown" | "html" | "pdf" | "zip" | "notion";
const FONT_URL = "/export-assets/v1/Pretendard-Regular.ttf";
export async function loadExportFont(): Promise<Uint8Array> {
  const response = await fetch(FONT_URL, {
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      "Export 글꼴을 내려받지 못했습니다. Online에서 다시 시도해주세요.",
    );
  return new Uint8Array(await response.arrayBuffer());
}
export async function loadExportFontCss(): Promise<string> {
  const [font, response] = await Promise.all([
    loadExportFont(),
    fetch("/export-assets/v1/Pretendard-LICENSE.txt", {
      signal: AbortSignal.timeout(15_000),
    }),
  ]);
  if (!response.ok)
    throw new Error("Export 글꼴의 License를 내려받지 못했습니다.");
  const license = await response.text();
  return `/* ${license.replaceAll("*/", "* / ")} */\n@font-face{font-family:Pretendard;src:url(data:font/ttf;base64,${bytesToBase64(font)})}`;
}
export function downloadBytes(
  bytes: Uint8Array,
  name: string,
  mime: string,
): void {
  const url = URL.createObjectURL(
    new Blob([Uint8Array.from(bytes)], { type: mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadWorkspaceFormat(
  workspaceId: string,
  format: ExportFormat,
  password: string,
  pageId?: string,
): Promise<void> {
  const input = await exportWorkspace(
      workspaceId,
      pageId ? [pageId] : undefined,
    ),
    basename = pageId ? input.pages[0]?.title || "Page" : input.name;
  if (!input.pages.length) throw new Error("Export할 문서가 없습니다.");
  if (format === "json" || format === "encrypted") {
    downloadJson(
      format === "encrypted"
        ? await encryptWorkspaceExport(input, password)
        : input,
      `${basename}${format === "encrypted" ? ".zeronote-encrypted" : "-zeronote"}.json`,
    );
    return;
  }
  if (format === "pdf") {
    if (!pageId)
      throw new Error("PDF는 Page 메뉴에서 Page별로 Export해주세요.");
    const { createPagePdf } = await import("./pdf-export");
    downloadBytes(
      await createPagePdf(input, pageId, await loadExportFont()),
      `${basename}.pdf`,
      "application/pdf",
    );
    return;
  }
  if (format === "html" && pageId) {
    const fontCss = await loadExportFontCss();
    downloadBytes(
      new TextEncoder().encode(renderPageHtml(input, pageId, fontCss)),
      `${basename}.html`,
      "text/html",
    );
    return;
  }
  if (
    format === "markdown" &&
    pageId &&
    !input.attachments?.length &&
    input.pages[0]?.kind !== "database"
  ) {
    downloadBytes(
      new TextEncoder().encode(renderPageMarkdown(input, pageId)),
      `${basename}.md`,
      "text/markdown",
    );
    return;
  }
  const fontCss = format === "html" ? await loadExportFontCss() : "";
  downloadBytes(
    buildPortableArchive(
      input,
      format === "zip"
        ? "backup"
        : format === "notion"
          ? "notion"
          : format === "html"
            ? "html"
            : "markdown",
      fontCss,
    ),
    `${basename}-${format}.zip`,
    "application/zip",
  );
}
export async function readTransferFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  password: string,
): Promise<{ workspace: WorkspaceExport; warnings: string[] }> {
  if (file.size > MAX_ARCHIVE_BYTES || !file.size)
    throw new Error("비어 있지 않은 50MiB 이하 파일을 선택해주세요.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (/\.zip$/i.test(file.name))
    return importPortableFiles(
      extractPortableArchive(bytes),
      file.name.replace(/\.zip$/i, ""),
    );
  if (/\.(md|csv)$/i.test(file.name))
    return importPortableFiles(
      { [file.name]: bytes },
      file.name.replace(/\.(md|csv)$/i, ""),
    );
  const input: unknown = JSON.parse(strFromU8(bytes));
  return {
    workspace: isEncryptedExport(input)
      ? await decryptWorkspaceExport(input, password)
      : ExportSchema.parse(input),
    warnings: [],
  };
}
export async function importTransferFile(
  file: Pick<File, "name" | "size" | "arrayBuffer">,
  password: string,
) {
  const input = await readTransferFile(file, password);
  const result = await importWorkspace(input.workspace);
  return { ...result, warnings: input.warnings };
}
