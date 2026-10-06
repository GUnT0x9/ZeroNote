import { it, expect } from "vitest";
import * as Y from "yjs";
import {
  createTaskRow,
  addDatabaseProperty,
  writeDatabaseValue,
  getTaskRows,
  getDatabaseProperties,
} from "@zeronote/shared";
import {
  createPublicPage,
  sanitizePublicNodes,
  type PublicProjectionLinks,
} from "./public-projection";
import { hashPublicPassword, verifyPublicPassword } from "./public-password";
const links: PublicProjectionLinks = {
  page: (id) =>
    id === "published"
      ? { title: "Allowed", href: "/s/share/allowed" }
      : undefined,
  file: () => undefined,
  task: () => undefined,
  internalPage: (href) =>
    href === "/?page=published"
      ? { title: "Allowed", href: "/s/share/allowed" }
      : undefined,
};
it("publishes live whitelisted content without deleted history, unsafe URLs, private IDs or attrs", () => {
  const doc = new Y.Doc({ gc: false });
  doc.getText("title").insert(0, "Visible");
  const paragraph = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  paragraph.insert(0, [text]);
  doc.getXmlFragment("content").insert(0, [paragraph]);
  text.insert(0, "deleted-secret");
  text.delete(0, text.length);
  text.insert(0, "<script>plain</script>", {
    link: { href: "javascript:alert(1)" },
    comment: { secret: "private-comment" },
  });
  for (const id of ["published", "private-id"]) {
    const node = new Y.XmlElement("pageMention");
    node.setAttribute("pageId", id);
    node.setAttribute("title", "private-title");
    doc
      .getXmlFragment("content")
      .insert(doc.getXmlFragment("content").length, [node]);
  }
  const page = createPublicPage(
      doc,
      crypto.randomUUID(),
      "fallback",
      "document",
      links,
    ),
    json = JSON.stringify(page);
  expect(page.html).toContain("&lt;script&gt;");
  expect(page.html).toContain('href="/s/share/allowed"');
  for (const value of [
    "deleted-secret",
    "private-id",
    "private-title",
    "private-comment",
    "javascript:",
  ])
    expect(json).not.toContain(value);
  const sanitized = sanitizePublicNodes(
    [
      {
        type: "text",
        attrs: { secret: "hidden" },
        text: "Safe",
        marks: [
          { type: "link", attrs: { href: "/?page=published" } },
          {
            type: "link",
            attrs: { href: "https://site.test/?invite=private" },
          },
          { type: "link", attrs: { href: "https://example.org" } },
        ],
      },
    ],
    links,
  );
  expect(sanitized[0]?.marks).toEqual([
    { type: "link", attrs: { href: "/s/share/allowed" } },
    { type: "link", attrs: { href: "https://example.org" } },
  ]);
  doc.destroy();
});
it("renders Database custom properties and row bodies without person identities or deleted rows", () => {
  const doc = new Y.Doc(),
    rowId = createTaskRow(doc, "Task <one>");
  const propertyId = addDatabaseProperty(doc, "Budget", "number");
  const row = getTaskRows(doc)[0]!,
    property = getDatabaseProperties(doc).find(
      (entry) => entry.id === propertyId,
    )!;
  writeDatabaseValue(doc, row.id, property.id, 25);
  doc
    .getMap<Y.Map<unknown>>("tasks")
    .get(rowId)!
    .set("assigneeId", crypto.randomUUID());
  const body = new Y.XmlElement("paragraph"),
    text = new Y.XmlText();
  text.insert(0, "Row body");
  body.insert(0, [text]);
  doc.getXmlFragment(`task:${rowId}`).insert(0, [body]);
  const removed = createTaskRow(doc, "deleted-row");
  doc.getMap<Y.Map<unknown>>("tasks").get(removed)!.set("deleted", true);
  body.setAttribute("secret", "hidden-attrs");
  const html = createPublicPage(
    doc,
    crypto.randomUUID(),
    "Tasks",
    "database",
    links,
  ).html;
  expect(html).toContain("Budget");
  expect(html).toContain("25");
  expect(html).toContain("Row body");
  expect(html).toContain("Task &lt;one&gt;");
  expect(html).not.toContain("Assignee");
  expect(html).not.toContain("deleted-row");
  expect(html).not.toContain("hidden-attrs");
  doc.destroy();
});
it("salts password hashes and rejects wrong passwords and damaged stored hashes", async () => {
  const hash = await hashPublicPassword("long password");
  expect(hash).not.toContain("long password");
  expect(await hashPublicPassword("long password")).not.toBe(hash);
  expect(await verifyPublicPassword("long password", hash)).toBe(true);
  expect(await verifyPublicPassword("wrong", hash)).toBe(false);
  expect(await verifyPublicPassword("long password", "bad")).toBe(false);
});
