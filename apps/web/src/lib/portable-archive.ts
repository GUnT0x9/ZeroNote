import * as Y from "yjs";
import { z } from "zod";
import { zipDirectoryChecksums, crc32 } from "./zip-integrity";
import { createExportDatabaseReader } from "./database-export";
import { unzipSync, zipSync, strToU8, strFromU8 } from "fflate";
import {
  base64ToBytes,
  bytesToBase64,
  ExportSchema,
  AttachmentMetadataSchema,
  MAX_DOCUMENT_BYTES,
  MAX_ATTACHMENT_BYTES,
  MAX_WORKSPACE_ATTACHMENTS,
  WORKSPACE_ATTACHMENT_BYTES,
  safeAttachmentName,
  detectAttachmentMime,
  readPortableContent,
  portableMarkdown,
  portableHtml,
  escapeHtml,
  importMarkdownContent,
  getTaskRows,
  getDatabaseProperties,
  createTaskRow,
  initializeGenericDatabase,
  addDatabaseProperty,
  writeDatabaseValue,
  type WorkspaceExport,
  type PortableLinks,
} from "@zeronote/shared";
export const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 3000;
export type ArchiveFormat = "markdown" | "html" | "notion" | "backup";
type ExportPage = WorkspaceExport["pages"][number];
const ZipManifestSchema = z
  .object({
    format: z.literal("zeronote-zip"),
    version: z.literal(1),
    workspace: ExportSchema.omit({ attachments: true }),
    files: z
      .array(AttachmentMetadataSchema.extend({ path: z.string() }).strict())
      .max(MAX_WORKSPACE_ATTACHMENTS),
  })
  .strict();
export const EXPORT_STYLE =
  "body{font-family:Pretendard,system-ui,sans-serif;letter-spacing:-.02em;line-height:1.5;color:#252525;margin:48px auto;padding:0 24px;max-width:760px}img,video{max-width:100%}pre{white-space:pre-wrap;background:#f4f4f4;padding:16px}blockquote,aside{border-left:3px solid #bbb;padding-left:16px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;text-align:left;padding:8px}a{color:#375f9b}figcaption{font-size:12px;color:#666}@media print{body{margin:0;max-width:none}pre,figure{break-inside:avoid}}";
export function safeArchivePath(value: string): string {
  const path = value.normalize("NFC");
  if (
    !path ||
    path.startsWith("/") ||
    path.includes("\\") ||
    [...path].some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /^[a-z]:/i.test(path) ||
    path
      .split("/")
      .some((part) =>
        ["..", ".", "__proto__", "constructor", "prototype"].includes(part),
      )
  )
    throw new Error("안전하지 않은 ZIP 파일 경로입니다.");
  return path;
}
export function extractPortableArchive(
  data: Uint8Array,
): Record<string, Uint8Array> {
  if (data.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error("ZIP은 50MiB 이하로 가져와주세요.");
  const checksums = zipDirectoryChecksums(data);
  let total = 0,
    count = 0;
  const paths = new Set<string>();
  const files = unzipSync(data, {
    filter(file) {
      const path = safeArchivePath(file.name);
      if (++count > MAX_ARCHIVE_FILES || paths.has(path))
        throw new Error("ZIP 파일 개수 또는 중복 경로를 확인해주세요.");
      paths.add(path);
      if (
        path.endsWith("/") ||
        path.startsWith("__MACOSX/") ||
        path.split("/").some((part) => part.startsWith("."))
      )
        return false;
      total += file.originalSize;
      if (
        !Number.isSafeInteger(file.originalSize) ||
        file.originalSize > MAX_ARCHIVE_BYTES ||
        total > MAX_ARCHIVE_BYTES
      )
        throw new Error("압축 해제 크기 제한을 초과했습니다.");
      return true;
    },
  });
  const normalized: Record<string, Uint8Array> = {};
  let actual = 0;
  for (const [path, bytes] of Object.entries(files)) {
    const expected = checksums.get(path.normalize("NFC"));
    if (
      !expected ||
      expected.size !== bytes.byteLength ||
      expected.crc !== crc32(bytes)
    )
      throw new Error("ZIP 파일의 크기 또는 Checksum이 일치하지 않습니다.");
    actual += bytes.byteLength;
    if (actual > MAX_ARCHIVE_BYTES || bytes.byteLength > MAX_ARCHIVE_BYTES)
      throw new Error("압축 해제 크기 제한을 초과했습니다.");
    normalized[safeArchivePath(path)] = bytes;
  }
  return normalized;
}
function relativePath(from: string, to: string): string {
  const parent = from.split("/").slice(0, -1),
    target = to.split("/");
  while (parent[0] && parent[0] === target[0]) {
    parent.shift();
    target.shift();
  }
  return "../".repeat(parent.length) + target.map(encodeURIComponent).join("/");
}
function exportPaths(
  pages: ExportPage[],
  extension: string,
): Map<string, string> {
  const index = new Map(pages.map((page) => [page.id, page])),
    paths = new Map<string, string>();
  const path = (page: ExportPage, seen = new Set<string>()): string => {
    if (seen.has(page.id)) throw new Error("Page 구조가 순환합니다.");
    seen.add(page.id);
    const parent = page.parentId ? index.get(page.parentId) : undefined;
    const prefix = parent ? path(parent, seen) + "/" : "";
    return (
      prefix +
      safeAttachmentName(page.title || "Untitled").slice(0, 64) +
      " " +
      page.id.replaceAll("-", "")
    );
  };
  for (const page of pages) paths.set(page.id, path(page) + extension);
  return paths;
}
function linksFor(
  input: WorkspaceExport,
  paths: Map<string, string>,
  from: string,
  inlineFiles = false,
): PortableLinks {
  return {
    page(id) {
      const page = input.pages.find((value) => value.id === id),
        path = paths.get(id);
      return page && path
        ? { title: page.title, href: relativePath(from, path) }
        : undefined;
    },
    file(id) {
      const file = input.attachments?.find((value) => value.id === id);
      if (!file) return undefined;
      const mime =
        file.mime === "image/svg+xml" || /html/i.test(file.mime)
          ? "application/octet-stream"
          : file.mime;
      return {
        name: file.name,
        mime,
        href: inlineFiles
          ? `data:${mime};base64,${file.data}`
          : relativePath(
              from,
              `files/${file.id}-${safeAttachmentName(file.name)}`,
            ),
      };
    },
    task(databaseId, rowId) {
      const page = input.pages.find((value) => value.id === databaseId),
        path = paths.get(databaseId);
      if (!page || !path) return undefined;
      const document = new Y.Doc();
      try {
        Y.applyUpdate(document, base64ToBytes(page.document));
        const row = getTaskRows(document).find((value) => value.id === rowId);
        return row
          ? {
              title: row.title,
              href: relativePath(from, rowExportPath(path, row.title, row.id)),
            }
          : undefined;
      } finally {
        document.destroy();
      }
    },
  };
}
function rowExportPath(path: string, title: string, id: string): string {
  return (
    path.replace(/\.[^.]+$/, "") +
    "/" +
    safeAttachmentName(title || "Untitled").slice(0, 64) +
    " " +
    id.replaceAll("-", "") +
    ".md"
  );
}
export function csvText(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
    )
    .join("\r\n");
}
export function parseCsv(source: string): string[][] {
  const rows: string[][] = [],
    row: string[] = [];
  let value = "",
    quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index++;
      } else if (quoted || !value) quoted = !quoted;
      else throw new Error("CSV 따옴표가 올바르지 않습니다.");
    } else if (!quoted && (char === "," || char === "\n" || char === "\r")) {
      row.push(value);
      value = "";
      if (char !== ",") {
        rows.push(row.splice(0));
        if (char === "\r" && source[index + 1] === "\n") index++;
      }
    } else value += char;
    if (rows.length > 10_001 || row.length > 65 || value.length > 10000)
      throw new Error("CSV Row·Property 크기 제한을 초과했습니다.");
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
function htmlDocument(title: string, body: string, fontCss = ""): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline' 'self' file:; font-src data:"><title>${escapeHtml(title)}</title><style>${fontCss}${EXPORT_STYLE}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`;
}
function databaseCells(
  input: WorkspaceExport,
  pageId: string,
  document: Y.Doc,
): string[][] {
  const properties = getDatabaseProperties(document);
  const computed = createExportDatabaseReader(input, pageId, document);
  try {
    return [
      properties.map((property) => property.name),
      ...getTaskRows(document).map((row) =>
        properties.map((property) => {
          const result = computed.reader.cell(row, property);
          if (result.error) return `오류: ${result.error.message}`;
          const value = result.value;
          if (value === null) return "";
          if (typeof value === "boolean") return String(value);
          if (property.type === "person") return String(value);
          return computed.reader.label(row, property);
        }),
      ),
    ];
  } finally {
    computed.dispose();
  }
}
export function renderPageHtml(
  input: WorkspaceExport,
  pageId: string,
  fontCss = "",
): string {
  const page = input.pages.find((value) => value.id === pageId);
  if (!page) throw new Error("Export할 Page가 없습니다.");
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, base64ToBytes(page.document));
    const paths = exportPaths(input.pages, ".html"),
      links = linksFor(input, paths, paths.get(pageId)!, true);
    let body = portableHtml(
      readPortableContent(document.getXmlFragment("content")),
      links,
    );
    if (page.kind === "database")
      body +=
        "<table>" +
        databaseCells(input, pageId, document)
          .map(
            (row, index) =>
              `<tr>${row.map((cell) => `<${index ? "td" : "th"}>${escapeHtml(cell)}</${index ? "td" : "th"}>`).join("")}</tr>`,
          )
          .join("") +
        "</table>";
    return htmlDocument(page.title, body, fontCss);
  } finally {
    document.destroy();
  }
}
export function renderPageMarkdown(
  input: WorkspaceExport,
  pageId: string,
): string {
  const page = input.pages.find((value) => value.id === pageId);
  if (!page) throw new Error("Export할 Page가 없습니다.");
  const document = new Y.Doc();
  try {
    Y.applyUpdate(document, base64ToBytes(page.document));
    const paths = exportPaths(input.pages, ".md");
    const body =
      `# ${page.title.replace(/\n/g, " ")}\n\n` +
      portableMarkdown(
        readPortableContent(document.getXmlFragment("content")),
        linksFor(input, paths, paths.get(pageId)!),
      );
    if (page.kind !== "database") return body;
    const cells = databaseCells(input, pageId, document);
    const escapeCell = (cell: string) =>
      cell
        .replaceAll("\\", "\\\\")
        .replaceAll("|", "\\|")
        .replace(/\r?\n/g, "<br>");
    return (
      body +
      "\n\n" +
      [cells[0], cells[0]!.map(() => "---"), ...cells.slice(1)]
        .map((row) => `| ${row!.map(escapeCell).join(" | ")} |`)
        .join("\n") +
      "\n"
    );
  } finally {
    document.destroy();
  }
}
export function portableWorkspaceFiles(
  input: WorkspaceExport,
  format: ArchiveFormat,
  fontCss = "",
): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {},
    paths = exportPaths(input.pages, format === "html" ? ".html" : ".md");
  for (const page of input.pages) {
    const document = new Y.Doc(),
      path = paths.get(page.id)!;
    try {
      Y.applyUpdate(document, base64ToBytes(page.document));
      files[path] = strToU8(
        format === "html"
          ? renderPageHtml(
              input,
              page.id,
              fontCss
                ? `@import url('${relativePath(path, "zeronote-assets/font.css")}');`
                : "",
            )
          : renderPageMarkdown(input, page.id),
      );
      if (page.kind !== "database") continue;
      files[path.replace(/\.[^.]+$/, ".csv")] = strToU8(
        csvText(databaseCells(input, page.id, document)),
      );
      const rows = getTaskRows(document);
      for (const row of rows) {
        const rowPath = rowExportPath(path, row.title, row.id);
        files[rowPath] = strToU8(
          `# ${row.title.replace(/\n/g, " ")}\n\n` +
            portableMarkdown(
              readPortableContent(document.getXmlFragment(`task:${row.id}`)),
              linksFor(input, paths, rowPath),
            ),
        );
      }
    } finally {
      document.destroy();
    }
  }
  if (format === "html" && fontCss)
    files["zeronote-assets/font.css"] = strToU8(fontCss);
  for (const file of input.attachments ?? [])
    files[`files/${file.id}-${safeAttachmentName(file.name)}`] = base64ToBytes(
      file.data,
    );
  if (format === "backup") {
    const { attachments: _attachments, ...workspace } = input;
    files["zeronote.json"] = strToU8(
      JSON.stringify({
        format: "zeronote-zip",
        version: 1,
        workspace,
        files: (input.attachments ?? []).map(
          ({ data: _data, ...metadata }) => ({
            ...metadata,
            path: `files/${metadata.id}-${safeAttachmentName(metadata.name)}`,
          }),
        ),
      }),
    );
  }
  return files;
}
export function buildPortableArchive(
  input: WorkspaceExport,
  format: ArchiveFormat,
  fontCss = "",
): Uint8Array {
  const files = portableWorkspaceFiles(
    ExportSchema.parse(input),
    format,
    fontCss,
  );
  if (
    Object.values(files).reduce((size, data) => size + data.length, 0) >
    MAX_ARCHIVE_BYTES
  )
    throw new Error(
      "Export 크기가 50MiB를 초과했습니다. Page별로 Export해주세요.",
    );
  return zipSync(files, { level: 6 });
}
function cleanTitle(path: string): string {
  return (
    path
      .split("/")
      .at(-1)!
      .replace(/\.(md|csv)$/i, "")
      .replace(/ [a-f\d]{32}$/i, "")
      .slice(0, 500) || "가져온 Page"
  );
}
function resolvePath(from: string, href: string): string | undefined {
  let value: string;
  try {
    value = decodeURIComponent(href.split("#")[0]!.split("?")[0]!).normalize(
      "NFC",
    );
  } catch {
    return undefined;
  }
  if (/^[a-z]+:/i.test(value) || value.startsWith("/") || value.includes("\\"))
    return undefined;
  const parts = from.split("/").slice(0, -1);
  for (const part of value.split("/")) {
    if (part === "..") parts.pop();
    else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
async function hashFile(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(data));
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
export async function importPortableFiles(
  files: Record<string, Uint8Array>,
  name: string,
): Promise<{ workspace: WorkspaceExport; warnings: string[] }> {
  const manifest = files["zeronote.json"];
  if (manifest) {
    const input: unknown = JSON.parse(strFromU8(manifest));
    const parsed = ZipManifestSchema.safeParse(input);
    if (parsed.success) {
      const attachments = parsed.data.files.map(({ path, ...metadata }) => {
        const bytes = files[safeArchivePath(path)];
        if (!bytes) throw new Error("ZIP 백업의 첨부 파일이 없습니다.");
        return { ...metadata, data: bytesToBase64(bytes) };
      });
      return {
        workspace: ExportSchema.parse({
          ...parsed.data.workspace,
          ...(attachments.length ? { attachments } : {}),
        }),
        warnings: [],
      };
    }
    return {
      workspace: ExportSchema.parse(input),
      warnings: [],
    };
  }
  const paths = Object.keys(files).filter((path) => /\.(md|csv)$/i.test(path));
  if (!paths.length || paths.length > 2000)
    throw new Error("Markdown 또는 CSV 문서가 있는 ZIP을 선택해주세요.");
  const warnings: string[] = [],
    documents = new Map<string, Y.Doc>(),
    ids = new Map(paths.map((path) => [path, crypto.randomUUID()]));
  const aliases = new Map<string, string[]>();
  for (const path of paths) {
    for (const alias of [path.replace(/\.(md|csv)$/i, ""), cleanTitle(path)])
      aliases.set(alias, [...(aliases.get(alias) ?? []), path]);
    documents.set(path, new Y.Doc({ gc: false }));
  }
  const attachments: NonNullable<WorkspaceExport["attachments"]> = [],
    attachmentIds = new Map<string, string>();
  const findPage = (from: string, href: string) => {
    const resolved = resolvePath(from, href);
    const exact = [
      resolved,
      resolved ? resolved + ".md" : undefined,
      resolved ? resolved + ".csv" : undefined,
    ].find((path) => path && ids.has(path));
    if (exact) return ids.get(exact);
    const matches = [...new Set(aliases.get(href.split("#")[0]!) ?? [])];
    return matches.length === 1 ? ids.get(matches[0]!) : undefined;
  };
  try {
    const rowSources = new Map<
      string,
      { databasePath: string; rowId: string }
    >();
    for (const path of paths.filter((value) => /\.csv$/i.test(value))) {
      const document = documents.get(path)!;
      document.getText("title").insert(0, cleanTitle(path));
      importDatabaseCsv(document, strFromU8(files[path]!));
      const folder = path.replace(/\.csv$/i, "") + "/";
      const rows = getTaskRows(document);
      for (const row of rows) {
        const matches = paths.filter(
          (candidate) =>
            candidate.startsWith(folder) &&
            !candidate.slice(folder.length).includes("/") &&
            /\.md$/i.test(candidate) &&
            (cleanTitle(candidate) === row.title ||
              cleanTitle(candidate) ===
                safeAttachmentName(row.title).slice(0, 64)),
        );
        const unambiguous =
          rows.filter(
            (candidate) =>
              safeAttachmentName(candidate.title).slice(0, 64) ===
              safeAttachmentName(row.title).slice(0, 64),
          ).length === 1;
        if (
          matches.length === 1 &&
          unambiguous &&
          !rowSources.has(matches[0]!)
        ) {
          rowSources.set(matches[0]!, { databasePath: path, rowId: row.id });
          ids.set(matches[0]!, ids.get(path)!);
        } else if (matches.length) {
          warnings.push(
            `${row.title}: Row 본문을 구분할 수 없어 별도 Page로 보존했습니다.`,
          );
        }
      }
    }
    for (const path of paths) {
      const document = documents.get(path)!,
        title = cleanTitle(path),
        pageId = ids.get(path)!;
      if (/\.csv$/i.test(path)) continue;
      document.getText("title").insert(0, title);
      const fileResolver = (href: string) => {
        const candidates = Object.keys(files).filter(
          (key) => key === href || key.split("/").at(-1) === href,
        );
        const resolved = resolvePath(path, href),
          match =
            resolved && Object.hasOwn(files, resolved)
              ? resolved
              : candidates.length === 1
                ? candidates[0]
                : undefined;
        if (!match || /\.(md|csv)$/i.test(match)) return undefined;
        const data = files[match]!;
        if (!data.length || data.length > MAX_ATTACHMENT_BYTES)
          throw new Error(
            `${safeAttachmentName(match)}: 첨부는 4MiB 이하만 가져올 수 있습니다.`,
          );
        const key = `${pageId}:${match}`,
          id = attachmentIds.get(key) ?? crypto.randomUUID();
        if (!attachmentIds.has(key)) {
          attachmentIds.set(key, id);
          const filename = safeAttachmentName(match);
          attachments.push({
            id,
            pageId,
            name: filename,
            mime: detectAttachmentMime(data, filename),
            size: data.length,
            hash: "",
            data: bytesToBase64(data),
            createdAt: new Date().toISOString(),
          });
        }
        return { id, name: safeAttachmentName(match) };
      };
      const source = strFromU8(files[path]!);
      if (/<\/?[a-z][^>]*>/i.test(source))
        warnings.push(
          `${title}: HTML 구문은 실행하지 않고 원문으로 보존했습니다.`,
        );
      if (/^\s*\|.*\|\s*$/m.test(source))
        warnings.push(
          `${title}: Markdown Table은 셀 값을 텍스트 표로 보존했습니다.`,
        );
      importMarkdownContent(
        document,
        source.replace(
          /^# ([^\n]+)\r?\n(?:\r?\n)?/,
          (whole, heading: string) => (heading.trim() === title ? "" : whole),
        ),
        { page: (href) => findPage(path, href), file: fileResolver },
      );
    }
    for (const [source, target] of rowSources) {
      const fragment = documents.get(source)!.getXmlFragment("content");
      documents
        .get(target.databasePath)!
        .getXmlFragment(`task:${target.rowId}`)
        .insert(
          0,
          fragment
            .toArray()
            .flatMap((node) =>
              node instanceof Y.XmlHook ? [] : [node.clone()],
            ),
        );
    }
    if (
      attachments.length > MAX_WORKSPACE_ATTACHMENTS ||
      attachments.reduce((sum, file) => sum + file.size, 0) >
        WORKSPACE_ATTACHMENT_BYTES
    )
      throw new Error("가져온 첨부가 Workspace 저장 한도를 초과했습니다.");
    for (const file of attachments)
      file.hash = await hashFile(base64ToBytes(file.data));
    const pages = paths
      .filter((path) => !rowSources.has(path))
      .map((path): ExportPage => {
        const parts = path.split("/").slice(0, -1);
        let parentId: string | null = null;
        while (parts.length && !parentId) {
          const stem = parts.join("/");
          parentId = ids.get(stem + ".md") ?? ids.get(stem + ".csv") ?? null;
          parts.pop();
        }
        const document = documents.get(path)!,
          update = Y.encodeStateAsUpdate(document);
        if (update.byteLength > MAX_DOCUMENT_BYTES)
          throw new Error("가져온 문서 크기 제한을 초과했습니다.");
        return {
          id: ids.get(path)!,
          parentId,
          kind: /\.csv$/i.test(path) ? "database" : "document",
          title: document.getText("title").toString(),
          isInbox: false,
          document: bytesToBase64(update),
        };
      });
    return {
      workspace: ExportSchema.parse({
        schemaVersion: attachments.length ? 2 : 1,
        name: name.slice(0, 160) || "가져온 Workspace",
        exportedAt: new Date().toISOString(),
        pages,
        ...(attachments.length ? { attachments } : {}),
      }),
      warnings,
    };
  } finally {
    for (const document of documents.values()) document.destroy();
  }
}
function importDatabaseCsv(document: Y.Doc, source: string): void {
  const [headers, ...rows] = parseCsv(source.replace(/^\uFEFF/, ""));
  if (
    !headers?.length ||
    headers.length > 64 ||
    rows.some((row) => row.length !== headers.length)
  )
    throw new Error("CSV Header·열 개수가 올바르지 않습니다.");
  if (
    headers.some((header) => header.length > 80) ||
    rows.some((row) => (row[0]?.length ?? 0) > 500)
  )
    throw new Error(
      "CSV 속성 이름은 80자, Row 제목은 500자 이하로 가져와주세요.",
    );
  initializeGenericDatabase(document);
  const fields = headers
    .slice(1)
    .map((header, index) =>
      addDatabaseProperty(
        document,
        (header.trim() || `Column ${index + 2}`).slice(0, 80),
        "text",
      ),
    );
  for (const values of rows) {
    const id = createTaskRow(document, values[0]! || "제목 없음");
    fields.forEach((field, index) =>
      writeDatabaseValue(document, id, field, values[index + 1]!),
    );
  }
}
