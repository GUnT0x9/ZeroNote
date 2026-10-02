import * as Y from "yjs";
import { zipSync, strToU8, strFromU8 } from "fflate";
import { expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  getDocumentProjection,
  getTaskRows,
  getDatabaseProperties,
  readDatabaseValue,
  importMarkdownContent,
  type WorkspaceExport,
} from "@zeronote/shared";
import {
  buildPortableArchive,
  extractPortableArchive,
  importPortableFiles,
  safeArchivePath,
  parseCsv,
  csvText,
  renderPageHtml,
  renderPageMarkdown,
  MAX_ARCHIVE_BYTES,
} from "./portable-archive";
function fixture(): WorkspaceExport {
  const firstId = crypto.randomUUID(),
    secondId = crypto.randomUUID(),
    doc = new Y.Doc(),
    child = new Y.Doc();
  importMarkdownContent(doc, "hello **world** and [[Child]]", {
    page: (href) => (href === "Child" ? secondId : undefined),
    file: () => undefined,
  });
  importMarkdownContent(child, "nested", {
    page: () => undefined,
    file: () => undefined,
  });
  const pages: WorkspaceExport["pages"] = [
    {
      id: firstId,
      parentId: null,
      title: "Parent",
      kind: "document",
      isInbox: false,
      document: bytesToBase64(Y.encodeStateAsUpdate(doc)),
    },
    {
      id: secondId,
      parentId: firstId,
      title: "Child",
      kind: "document",
      isInbox: false,
      document: bytesToBase64(Y.encodeStateAsUpdate(child)),
    },
  ];
  doc.destroy();
  child.destroy();
  return { schemaVersion: 1, name: "Portable", exportedAt: "now", pages };
}
it("exports nested Markdown links and an exact ZIP backup without credentials", async () => {
  const input = fixture(),
    files = extractPortableArchive(buildPortableArchive(input, "backup"));
  expect(JSON.parse(strFromU8(files["zeronote.json"]!)).workspace).toEqual(
    input,
  );
  expect(
    Object.keys(files).filter((path) => path.endsWith(".md")),
  ).toHaveLength(2);
  expect(renderPageMarkdown(input, input.pages[0]!.id)).toContain(
    "hello **world**",
  );
  const result = await importPortableFiles(files, "Archive");
  expect(result.workspace).toEqual(input);
  expect(result.warnings).toEqual([]);
  const interop = await importPortableFiles(
    extractPortableArchive(buildPortableArchive(input, "notion")),
    "From Notion",
  );
  const parent = interop.workspace.pages.find(
      (page) => page.title === "Parent",
    )!,
    child = interop.workspace.pages.find((page) => page.title === "Child")!;
  expect(child.parentId).toBe(parent.id);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, base64ToBytes(parent.document));
  expect(getDocumentProjection(doc).references).toContain(child.id);
  doc.destroy();
});
it("exports HTML with escaped titles and script-free content", () => {
  const input = fixture();
  input.pages[0]!.title = '<script>alert("x")</script>';
  const html = renderPageHtml(input, input.pages[0]!.id);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("<strong>world</strong>");
  const fontArchive = extractPortableArchive(
    buildPortableArchive(
      input,
      "html",
      "/* Font License */@font-face{font-family:Pretendard}",
    ),
  );
  expect(strFromU8(fontArchive["zeronote-assets/font.css"]!)).toContain(
    "Font License",
  );
  expect(
    Object.keys(
      extractPortableArchive(buildPortableArchive(input, "html")),
    ).some((path) => path.endsWith(".html")),
  ).toBe(true);
  expect(() => renderPageHtml(input, "missing")).toThrow("Page");
  expect(() => renderPageMarkdown(input, "missing")).toThrow("Page");
});
it("imports Obsidian wiki aliases, Notion UUID names, CSV quoted values and local attachments", async () => {
  const suffix = " " + "a".repeat(32),
    files = {
      [`Home${suffix}.md`]: strToU8(
        `# Home\n\n[[Folder/Note|notes]] and [note](Folder/Note.md)\n\n![image](files/pic.png)`,
      ),
      "Folder/Note.md": strToU8("# Note\n\nKorean 메모"),
      "Database.csv": strToU8(
        'Name,Description,Score\r\n"Entry","a,b\nnext",42',
      ),
      "files/pic.png": Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1]),
    };
  const imported = await importPortableFiles(files, "Vault");
  expect(
    imported.workspace.pages.find((page) => page.title === "Home"),
  ).toBeDefined();
  expect(imported.workspace.attachments).toHaveLength(1);
  expect(imported.workspace.attachments![0]!.mime).toBe("image/png");
  const db = imported.workspace.pages.find((page) => page.kind === "database")!,
    document = new Y.Doc();
  Y.applyUpdate(document, base64ToBytes(db.document));
  const row = getTaskRows(document)[0]!,
    property = getDatabaseProperties(document).find(
      (value) => value.name === "Description",
    )!;
  expect(readDatabaseValue(document, row, property)).toBe("a,b\nnext");
  document.destroy();
  const home = imported.workspace.pages.find((page) => page.title === "Home")!,
    note = imported.workspace.pages.find((page) => page.title === "Note")!,
    homeDoc = new Y.Doc();
  Y.applyUpdate(homeDoc, base64ToBytes(home.document));
  expect(getDocumentProjection(homeDoc).references).toContain(note.id);
  homeDoc.destroy();
});
it("validates CSV boundaries, malformed quotes and ZIP path/size bombs", async () => {
  const values = [
    ["Name", "Text"],
    ["Entry", 'quote " and newline\nnext'],
  ];
  expect(parseCsv(csvText(values))).toEqual(values);
  expect(() => parseCsv('"unterminated')).toThrow("닫히지");
  expect(() => parseCsv('un"quoted')).toThrow("따옴표");
  for (const path of [
    "../escape.md",
    "/absolute",
    "C:/secret",
    "a\\b",
    "a/../b",
    "a\0b",
  ])
    expect(() => safeArchivePath(path)).toThrow("경로");
  expect(safeArchivePath("한글/Note.md")).toBe("한글/Note.md");
  expect(() =>
    extractPortableArchive(zipSync({ "../escape.md": strToU8("bad") })),
  ).toThrow("경로");
  expect(() =>
    extractPortableArchive(new Uint8Array(MAX_ARCHIVE_BYTES + 1)),
  ).toThrow("50MiB");
  await expect(
    importPortableFiles({ "bad.csv": strToU8("Name,Field\nOnly one") }, "Bad"),
  ).rejects.toThrow("열 개수");
  await expect(
    importPortableFiles({ "nothing.txt": strToU8("No documents") }, "Bad"),
  ).rejects.toThrow("문서");
});
it("imports a Notion database Row body inside its database without making a duplicate Page", async () => {
  const imported = await importPortableFiles(
    {
      "Tasks.csv": strToU8("Name,Status\nShip,Done"),
      "Tasks/Ship aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md": strToU8(
        "# Ship\n\nRow body **details**",
      ),
    },
    "Tasks",
  );
  expect(imported.workspace.pages).toHaveLength(1);
  const database = imported.workspace.pages[0]!,
    document = new Y.Doc();
  Y.applyUpdate(document, base64ToBytes(database.document));
  const row = getTaskRows(document)[0]!;
  expect(document.getXmlFragment(`task:${row.id}`).toString()).toContain(
    "Row body",
  );
  document.destroy();
});
it("preserves ambiguous Row bodies as Pages and rejects oversized titles without truncating", async () => {
  const imported = await importPortableFiles(
    {
      "Tasks.csv": strToU8("Name\nShip\nShip"),
      "Tasks/Ship.md": strToU8("Details"),
    },
    "Rows",
  );
  expect(imported.workspace.pages).toHaveLength(2);
  expect(imported.warnings.join(" ")).toContain("구분할 수 없어");
  await expect(
    importPortableFiles(
      { "Tasks.csv": strToU8("Name\n" + "a".repeat(501)) },
      "Rows",
    ),
  ).rejects.toThrow("500자");
});
