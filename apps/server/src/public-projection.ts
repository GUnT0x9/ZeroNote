import * as Y from "yjs";
import {
  escapeHtml,
  getDatabaseProperties,
  getTaskRows,
  createDatabaseValueReader,
  type DatabaseValueReader,
  portableHtml,
  portablePlainText,
  readPortableContent,
  safePortableUrl,
  MAX_PUBLIC_BYTES,
  type PortableNode,
  type PortableLinks,
  type PublicPage,
} from "@zeronote/shared";
import { DomainError } from "./errors";

const NODE_TYPES = new Set([
  "text",
  "paragraph",
  "heading",
  "hardBreak",
  "horizontalRule",
  "codeBlock",
  "bulletList",
  "orderedList",
  "taskList",
  "listItem",
  "taskItem",
  "blockquote",
  "callout",
  "details",
  "detailsSummary",
  "detailsContent",
  "pageMention",
  "taskLink",
  "attachment",
]);
const TEXT_MARKS = new Set(["bold", "italic", "strike", "underline", "code"]);
export interface PublicProjectionLinks extends PortableLinks {
  internalPage: (href: string) => { title: string; href: string } | undefined;
}
export function sanitizePublicNodes(
  nodes: PortableNode[],
  links: PublicProjectionLinks,
): PortableNode[] {
  return nodes.flatMap((node): PortableNode[] => {
    if (!NODE_TYPES.has(node.type))
      return sanitizePublicNodes(node.children ?? [], links);
    const attrs: Record<string, unknown> = {};
    if (node.type === "heading")
      attrs.level = Math.max(1, Math.min(6, Number(node.attrs.level) || 1));
    if (node.type === "taskItem") attrs.checked = node.attrs.checked === true;
    if (node.type === "orderedList")
      attrs.start = Number(node.attrs.start) || 1;
    if (node.type === "pageMention" && links.page(String(node.attrs.pageId)))
      attrs.pageId = node.attrs.pageId;
    if (
      node.type === "taskLink" &&
      links.task?.(String(node.attrs.databaseId), String(node.attrs.rowId))
    ) {
      attrs.databaseId = node.attrs.databaseId;
      attrs.rowId = node.attrs.rowId;
    }
    if (
      node.type === "attachment" &&
      links.file(String(node.attrs.attachmentId))
    )
      attrs.attachmentId = node.attrs.attachmentId;
    const marks = (node.marks ?? []).flatMap((mark) => {
      if (TEXT_MARKS.has(mark.type)) return [{ type: mark.type, attrs: {} }];
      if (mark.type !== "link") return [];
      const source = typeof mark.attrs.href === "string" ? mark.attrs.href : "";
      const internal = links.internalPage(source);
      if (internal) return [{ type: "link", attrs: { href: internal.href } }];
      const href = safePortableUrl(source);
      return href &&
        /^(https?:|mailto:|tel:)/i.test(href) &&
        !isPrivateAppUrl(href)
        ? [{ type: "link", attrs: { href } }]
        : [];
    });
    return [
      {
        type: node.type,
        attrs,
        ...(node.type === "text" ? { text: node.text ?? "", marks } : {}),
        children: sanitizePublicNodes(node.children ?? [], links),
      },
    ];
  });
}
function isPrivateAppUrl(href: string): boolean {
  try {
    const url = new URL(href);
    return (
      url.searchParams.has("page") ||
      url.searchParams.has("invite") ||
      url.pathname.startsWith("/v1/")
    );
  } catch {
    return false;
  }
}
export function createPublicPage(
  document: Y.Doc,
  key: string,
  title: string,
  kind: PublicPage["kind"],
  links: PublicProjectionLinks,
  reader?: DatabaseValueReader,
): PublicPage {
  const nodes = sanitizePublicNodes(
    readPortableContent(document.getXmlFragment("content")),
    links,
  );
  let html = portableHtml(nodes, links);
  if (kind === "database")
    html += databaseHtml(
      document,
      links,
      reader ?? createDatabaseValueReader(key, document, { publicOnly: true }),
    );
  const result = {
    key,
    title: document.getText("title").toString() || title,
    kind,
    html,
    description: portablePlainText(nodes, links)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180),
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_PUBLIC_BYTES)
    throw new DomainError(413, "공개 문서 크기 제한을 초과했습니다.");
  return result;
}
function databaseHtml(
  document: Y.Doc,
  links: PublicProjectionLinks,
  reader: DatabaseValueReader,
): string {
  const properties = getDatabaseProperties(document).filter(
    (property) => property.type !== "person",
  );
  const rows = getTaskRows(document);
  const tableRows = rows
    .map(
      (row) =>
        `<tr>${properties
          .map((property) => {
            const result = reader.cell(row, property);
            if (result.error) return "<td>—</td>";
            if (property.type === "file" && Array.isArray(result.value))
              return `<td>${result.value
                .flatMap((id) => {
                  const file = links.file(id);
                  return file
                    ? [
                        `<a href="${escapeHtml(file.href)}" download>${escapeHtml(file.name)}</a>`,
                      ]
                    : [];
                })
                .join(", ")}</td>`;
            if (
              property.type === "relation" &&
              property.relation &&
              Array.isArray(result.value)
            )
              return `<td>${result.value
                .flatMap((id) => {
                  const link = links.task?.(property.relation!.databaseId, id);
                  return link
                    ? [
                        `<a href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a>`,
                      ]
                    : [];
                })
                .join(", ")}</td>`;
            const text =
              result.value === null
                ? ""
                : typeof result.value === "boolean"
                  ? String(result.value)
                  : reader.label(row, property);
            return `<td>${escapeHtml(text)}</td>`;
          })
          .join("")}</tr>`,
    )
    .join("");
  const bodies = rows
    .map((row) => {
      const nodes = sanitizePublicNodes(
        readPortableContent(document.getXmlFragment(`task:${row.id}`)),
        links,
      );
      return `<details id="row-${escapeHtml(row.id)}"><summary>${escapeHtml(row.title || "제목 없음")}</summary>${portableHtml(nodes, links)}</details>`;
    })
    .join("");
  return `<div class="public-table"><table><thead><tr>${properties.map((property) => `<th>${escapeHtml(property.name)}</th>`).join("")}</tr></thead><tbody>${tableRows}</tbody></table></div>${bodies}`;
}
