import * as Y from "yjs";
import { expect, it } from "vitest";
import {
  importMarkdownContent,
  readPortableContent,
  portableMarkdown,
  portableHtml,
  portablePlainText,
  escapeHtml,
  safePortableUrl,
  type PortableLinks,
} from "./portable-document";
const pageId = crypto.randomUUID(),
  fileId = crypto.randomUUID();
const resolver = {
  page: (href: string) =>
    href === "Other" || href === "other.md" ? pageId : undefined,
  file: (href: string) =>
    href === "photo.png" ? { id: fileId, name: "photo.png" } : undefined,
};
const links: PortableLinks = {
  page: (id) =>
    id === pageId ? { title: "Other", href: "other.md" } : undefined,
  file: (id) =>
    id === fileId
      ? { name: "photo.png", href: "files/photo.png", mime: "image/png" }
      : undefined,
};
it("imports rich Markdown, nested/mixed task lists and stable links without HTML execution", () => {
  const doc = new Y.Doc();
  try {
    importMarkdownContent(
      doc,
      "## Heading\n\n**bold** *italic* ~~strike~~ `code` &amp; [[Other]] and [other](other.md)\n\n- first\n- [x] complete\n- [ ] next\n\n> quote\n\n```ts\nconst a = `x`;\n```\n\n![photo](photo.png)\n\n<script>alert(1)</script>",
      resolver,
    );
    const nodes = readPortableContent(doc.getXmlFragment("content"));
    expect(nodes[0]?.attrs.level).toBe(2);
    const markdown = portableMarkdown(nodes, links),
      html = portableHtml(nodes, links);
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("- [x] complete");
    expect(markdown).toContain("- [ ] next");
    expect(markdown).toContain("[Other](other.md)");
    expect(markdown).toContain("![photo.png](files/photo.png)");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(portablePlainText(nodes, links)).toContain("const a = `x`;");
    const mentions = nodes
      .flatMap((node) => node.children ?? [])
      .filter((node) => node.type === "pageMention");
    expect(mentions).toHaveLength(2);
  } finally {
    doc.destroy();
  }
});
it("keeps code fences intact and hides inaccessible links rather than exporting names", () => {
  const doc = new Y.Doc();
  try {
    importMarkdownContent(
      doc,
      "````text\n``` literal\n````\n\n1. One\n2. Two",
      resolver,
    );
    const content = readPortableContent(doc.getXmlFragment("content")),
      rendered = portableMarkdown(content, links);
    expect(rendered).toContain("````text\n``` literal\n````");
    expect(rendered.indexOf("1. One")).toBeLessThan(rendered.indexOf("2. Two"));
    expect(
      portableHtml(
        [{ type: "pageMention", attrs: { pageId: "private" } }],
        links,
      ),
    ).toBe("<span>접근 제한</span>");
    expect(() => importMarkdownContent(doc, "again", resolver)).toThrow(
      "빈 문서",
    );
  } finally {
    doc.destroy();
  }
});
it("rejects active URL schemes, escapes hostile titles, and bounds imported text", () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//evil.test",
    "https:\n//evil.test",
    "\\evil.test",
  ])
    expect(safePortableUrl(url)).toBeNull();
  for (const url of [
    "https://example.com",
    "mailto:x@example.com",
    "../page.md",
  ])
    expect(safePortableUrl(url)).toBe(url);
  expect(safePortableUrl(null)).toBeNull();
  expect(escapeHtml('<img src=x onerror="x">')).toBe(
    "&lt;img src=x onerror=&quot;x&quot;&gt;",
  );
  const doc = new Y.Doc();
  expect(() =>
    importMarkdownContent(doc, "x".repeat(1024 * 1024 + 1), resolver),
  ).toThrow("1MiB");
  doc.destroy();
});
