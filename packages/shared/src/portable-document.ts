import * as Y from "yjs";
import { Lexer, type Token, type Tokens } from "marked";
import { setXmlAttribute } from "./xml";

export interface PortableMark {
  type: string;
  attrs: Record<string, unknown>;
}
export interface PortableNode {
  type: string;
  attrs: Record<string, unknown>;
  text?: string;
  marks?: PortableMark[];
  children?: PortableNode[];
}
export interface PortableLinks {
  page: (id: string) => { title: string; href: string } | undefined;
  file: (
    id: string,
  ) => { name: string; href: string; mime: string } | undefined;
  task?: (
    databaseId: string,
    rowId: string,
  ) => { title: string; href: string } | undefined;
}
const MAX_NESTING = 64;
const MAX_MARKDOWN_LENGTH = 1024 * 1024;
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}
export function safePortableUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  if (/^(https?:|mailto:|tel:)/i.test(value)) return value;
  if (
    !/^[a-z][a-z\d+.-]*:/i.test(value) &&
    !value.startsWith("//") &&
    !value.includes("\\")
  )
    return value;
  return null;
}
export function readPortableContent(
  fragment: Y.XmlFragment,
  depth = 0,
): PortableNode[] {
  if (depth > MAX_NESTING) throw new Error("문서의 중첩 깊이가 너무 큽니다.");
  return fragment.toArray().flatMap((node): PortableNode[] => {
    if (node instanceof Y.XmlText)
      return node
        .toDelta()
        .flatMap(
          (part: {
            insert?: unknown;
            attributes?: Record<string, unknown>;
          }) => {
            if (typeof part.insert !== "string") return [];
            const marks = Object.entries(part.attributes ?? {}).map(
              ([key, value]): PortableMark => ({
                type: key.replace(/--[a-zA-Z0-9_-]{8}$/, ""),
                attrs:
                  typeof value === "object" && value !== null
                    ? (value as Record<string, unknown>)
                    : {},
              }),
            );
            return [{ type: "text", attrs: {}, text: part.insert, marks }];
          },
        );
    if (node instanceof Y.XmlElement)
      return [
        {
          type: node.nodeName,
          attrs: node.getAttributes(),
          children: readPortableContent(node, depth + 1),
        },
      ];
    return [];
  });
}
function markdownText(value: string): string {
  return value.replace(/[\\`*_[\]<>#|~]/g, "\\$&");
}
function markdownLink(title: string, href: string, image = false): string {
  return `${image ? "!" : ""}[${markdownText(title)}](${href.replace(/\(/g, "%28").replace(/\)/g, "%29")})`;
}
function renderMarkedText(node: PortableNode, html: boolean): string {
  let value = html
    ? escapeHtml(node.text ?? "")
    : markdownText(node.text ?? "");
  for (const mark of node.marks ?? []) {
    const wrappers: Record<string, [string, string]> = html
      ? {
          bold: ["<strong>", "</strong>"],
          italic: ["<em>", "</em>"],
          strike: ["<s>", "</s>"],
          underline: ["<u>", "</u>"],
          code: ["<code>", "</code>"],
        }
      : {
          bold: ["**", "**"],
          italic: ["*", "*"],
          strike: ["~~", "~~"],
          underline: ["<u>", "</u>"],
        };
    if (!html && mark.type === "code") {
      const longest = Math.max(
        0,
        ...((node.text ?? "").match(/`+/g) ?? []).map((run) => run.length),
      );
      const fence = "`".repeat(longest + 1);
      value = `${fence} ${(node.text ?? "").replace(/\n/g, " ")} ${fence}`;
    } else if (wrappers[mark.type]) {
      const [start, end] = wrappers[mark.type]!;
      value = start + value + end;
    } else if (mark.type === "link") {
      const href = safePortableUrl(mark.attrs.href);
      if (href)
        value = html
          ? `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${value}</a>`
          : `[${value}](${href.replace(/[()]/g, (character) => (character === "(" ? "%28" : "%29"))})`;
    }
  }
  return value;
}
function nodeLink(node: PortableNode, links: PortableLinks) {
  if (node.type === "pageMention")
    return links.page(String(node.attrs.pageId ?? ""));
  if (node.type === "taskLink")
    return links.task?.(
      String(node.attrs.databaseId ?? ""),
      String(node.attrs.rowId ?? ""),
    );
  return undefined;
}
export function portableMarkdown(
  nodes: PortableNode[],
  links: PortableLinks,
): string {
  return nodes.map((node) => markdownNode(node, links)).join("");
}
function markdownNode(node: PortableNode, links: PortableLinks): string {
  if (node.type === "text") return renderMarkedText(node, false);
  const children = portableMarkdown(node.children ?? [], links);
  const link = nodeLink(node, links);
  if (node.type === "pageMention")
    return link ? markdownLink(link.title, link.href) : "[접근 제한 Page]";
  if (node.type === "taskLink")
    return `${link ? markdownLink(link.title, link.href) : "[접근 제한 Task]"}\n\n`;
  if (node.type === "attachment") {
    const file = links.file(String(node.attrs.attachmentId ?? ""));
    return `${file ? markdownLink(file.name, file.href, file.mime.startsWith("image/") && file.mime !== "image/svg+xml") : "[첨부 없음]"}\n\n`;
  }
  if (node.type === "heading")
    return `${"#".repeat(Math.max(1, Math.min(6, Number(node.attrs.level) || 1)))} ${children.trim()}\n\n`;
  if (node.type === "paragraph") return `${children}\n\n`;
  if (node.type === "hardBreak") return "  \n";
  if (node.type === "horizontalRule") return "---\n\n";
  if (node.type === "codeBlock") {
    const text = portablePlainText(node.children ?? [], links),
      fence = "`".repeat(
        Math.max(3, ...(text.match(/`+/g) ?? []).map((run) => run.length + 1)),
      );
    return `${fence}${String(node.attrs.language ?? "").replace(/[^\w+-]/g, "")}\n${text}\n${fence}\n\n`;
  }
  if (["bulletList", "orderedList", "taskList"].includes(node.type)) {
    return (
      (node.children ?? [])
        .map((item, index) => {
          const prefix =
            node.type === "orderedList"
              ? `${(Number(node.attrs.start) || 1) + index}. `
              : node.type === "taskList"
                ? `- [${item.attrs.checked === true ? "x" : " "}] `
                : "- ";
          const lines = portableMarkdown(item.children ?? [], links)
            .trim()
            .split("\n");
          return (
            prefix +
            lines
              .map((line, lineIndex) =>
                lineIndex ? " ".repeat(prefix.length) + line : line,
              )
              .join("\n")
          );
        })
        .join("\n") + "\n\n"
    );
  }
  if (node.type === "blockquote" || node.type === "callout")
    return (
      children
        .trim()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n") + "\n\n"
    );
  if (node.type === "details") return `<details>\n${children}</details>\n\n`;
  if (node.type === "detailsSummary")
    return `<summary>${children.trim()}</summary>\n\n`;
  return children;
}
export function portableHtml(
  nodes: PortableNode[],
  links: PortableLinks,
): string {
  return nodes
    .map((node): string => {
      if (node.type === "text") return renderMarkedText(node, true);
      const content = portableHtml(node.children ?? [], links),
        link = nodeLink(node, links);
      if (["pageMention", "taskLink"].includes(node.type))
        return link
          ? `<a href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a>`
          : "<span>접근 제한</span>";
      if (node.type === "attachment") {
        const file = links.file(String(node.attrs.attachmentId ?? ""));
        if (!file) return "<p>첨부 없음</p>";
        const href = escapeHtml(file.href),
          name = escapeHtml(file.name);
        if (file.mime.startsWith("image/") && file.mime !== "image/svg+xml")
          return `<figure><img src="${href}" alt="${name}"><figcaption>${name}</figcaption></figure>`;
        if (/^(audio|video)\//.test(file.mime))
          return `<figure><${file.mime.startsWith("audio/") ? "audio" : "video"} controls src="${href}"></${file.mime.startsWith("audio/") ? "audio" : "video"}><figcaption><a download href="${href}">${name}</a></figcaption></figure>`;
        return `<p><a download href="${href}">${name}</a></p>`;
      }
      if (node.type === "heading") {
        const level = Math.max(1, Math.min(6, Number(node.attrs.level) || 1));
        return `<h${level}>${content}</h${level}>`;
      }
      if (node.type === "hardBreak") return "<br>";
      if (node.type === "horizontalRule") return "<hr>";
      if (node.type === "codeBlock")
        return `<pre><code>${escapeHtml(portablePlainText(node.children ?? [], links))}</code></pre>`;
      if (node.type === "taskItem")
        return `<li>${node.attrs.checked === true ? "☑" : "☐"} ${content}</li>`;
      const tags: Record<string, string> = {
        paragraph: "p",
        bulletList: "ul",
        orderedList: "ol",
        listItem: "li",
        taskList: "ul",
        blockquote: "blockquote",
        callout: "aside",
        details: "details",
        detailsSummary: "summary",
        detailsContent: "div",
      };
      const tag = tags[node.type];
      return tag ? `<${tag}>${content}</${tag}>` : content;
    })
    .join("");
}
export function portablePlainText(
  nodes: PortableNode[],
  links: PortableLinks,
): string {
  return nodes
    .map((node) => {
      if (node.type === "text") return node.text ?? "";
      const link = nodeLink(node, links);
      if (link) return link.title;
      if (node.type === "attachment")
        return (
          links.file(String(node.attrs.attachmentId ?? ""))?.name ?? "첨부 없음"
        );
      if (node.type === "hardBreak") return "\n";
      const value = portablePlainText(node.children ?? [], links);
      return [
        "paragraph",
        "heading",
        "codeBlock",
        "listItem",
        "taskItem",
      ].includes(node.type)
        ? value + "\n"
        : value;
    })
    .join("");
}

export interface MarkdownResolver {
  page: (href: string) => string | undefined;
  file: (href: string) => { id: string; name: string } | undefined;
}
function element(
  type: string,
  children: (Y.XmlElement | Y.XmlText)[] = [],
  attrs: Record<string, unknown> = {},
) {
  const node = new Y.XmlElement(type);
  for (const [key, value] of Object.entries(attrs))
    setXmlAttribute(node, key, value);
  if (children.length) node.insert(0, children);
  return node;
}
function textNode(value: string, marks: Record<string, unknown> = {}) {
  const text = new Y.XmlText();
  text.insert(0, value, marks);
  return text;
}
function decodeEntities(value: string): string {
  return value.replace(
    /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const name = entity.slice(1, -1).toLowerCase(),
        named: Record<string, string> = {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
        };
      if (named[name]) return named[name]!;
      const code = Number.parseInt(
        name.startsWith("#x") ? name.slice(2) : name.slice(1),
        name.startsWith("#x") ? 16 : 10,
      );
      return Number.isInteger(code) &&
        code > 0 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : entity;
    },
  );
}
function inlineTokens(
  tokens: Token[],
  resolver: MarkdownResolver,
  marks: Record<string, unknown> = {},
  depth = 0,
): (Y.XmlElement | Y.XmlText)[] {
  if (depth > MAX_NESTING)
    throw new Error("Markdown의 중첩 깊이가 너무 큽니다.");
  return tokens.flatMap((token): (Y.XmlElement | Y.XmlText)[] => {
    if (
      token.type === "strong" ||
      token.type === "em" ||
      token.type === "del"
    ) {
      const typed = token as Tokens.Strong | Tokens.Em | Tokens.Del;
      return inlineTokens(
        typed.tokens,
        resolver,
        {
          ...marks,
          [token.type === "strong"
            ? "bold"
            : token.type === "em"
              ? "italic"
              : "strike"]: {},
        },
        depth + 1,
      );
    }
    if (token.type === "codespan")
      return [
        textNode((token as Tokens.Codespan).text, { ...marks, code: {} }),
      ];
    if (token.type === "br") return [element("hardBreak")];
    if (token.type === "link") {
      const typed = token as Tokens.Link,
        id = resolver.page(typed.href);
      if (id) return [element("pageMention", [], { pageId: id })];
      const file = resolver.file(typed.href);
      if (file) return [textNode(file.name, marks)];
      const href = safePortableUrl(typed.href);
      return inlineTokens(
        typed.tokens,
        resolver,
        href
          ? {
              ...marks,
              link: {
                href,
                target: "_blank",
                rel: "noopener noreferrer nofollow",
                class: null,
              },
            }
          : marks,
        depth + 1,
      );
    }
    if (token.type === "image")
      return [
        textNode(
          (token as Tokens.Image).text || (token as Tokens.Image).href,
          marks,
        ),
      ];
    if (token.type === "html")
      return [textNode((token as Tokens.HTML).text, marks)];
    if (token.type === "escape" || token.type === "text") {
      const typed = token as Tokens.Text | Tokens.Escape;
      if ("tokens" in typed && typed.tokens)
        return inlineTokens(typed.tokens, resolver, marks, depth + 1);
      return wikiText(decodeEntities(typed.text), resolver, marks);
    }
    return [textNode(token.raw ?? "", marks)];
  });
}
function wikiText(
  value: string,
  resolver: MarkdownResolver,
  marks: Record<string, unknown>,
): (Y.XmlElement | Y.XmlText)[] {
  const nodes: (Y.XmlElement | Y.XmlText)[] = [];
  let offset = 0;
  for (const match of value.matchAll(/(!?)\[\[([^\]\n]+)\]\]/g)) {
    if (match.index > offset)
      nodes.push(textNode(value.slice(offset, match.index), marks));
    const [target, alias] = match[2]!.split("|"),
      id = resolver.page(target!.split("#")[0]!);
    if (id && alias) nodes.push(textNode(`${alias} `, marks));
    nodes.push(
      id
        ? element("pageMention", [], { pageId: id })
        : textNode(alias ?? match[0], marks),
    );
    offset = match.index + match[0].length;
  }
  if (offset < value.length) nodes.push(textNode(value.slice(offset), marks));
  return nodes;
}
function blockTokens(
  tokens: Token[],
  resolver: MarkdownResolver,
  depth = 0,
): Y.XmlElement[] {
  if (depth > MAX_NESTING)
    throw new Error("Markdown의 중첩 깊이가 너무 큽니다.");
  return tokens.flatMap((token): Y.XmlElement[] => {
    if (token.type === "space" || token.type === "checkbox") return [];
    if (token.type === "heading") {
      const typed = token as Tokens.Heading;
      return [
        element("heading", inlineTokens(typed.tokens, resolver), {
          level: Math.min(3, typed.depth),
        }),
      ];
    }
    if (token.type === "code") {
      const typed = token as Tokens.Code;
      return [
        element("codeBlock", [textNode(typed.text)], {
          language: typed.lang?.split(/\s/)[0] ?? "plaintext",
        }),
      ];
    }
    if (token.type === "hr") return [element("horizontalRule")];
    if (token.type === "blockquote")
      return [
        element(
          "blockquote",
          blockTokens((token as Tokens.Blockquote).tokens, resolver, depth + 1),
        ),
      ];
    if (token.type === "list")
      return listBlock(token as Tokens.List, resolver, depth);
    if (token.type === "paragraph" || token.type === "text") {
      const typed = token as Tokens.Paragraph | Tokens.Text;
      const inline = typed.tokens ?? Lexer.lexInline(typed.text);
      const media = inline.flatMap((part): Y.XmlElement[] => {
        if (part.type === "image" || part.type === "link") {
          const file = resolver.file((part as Tokens.Image | Tokens.Link).href);
          return file
            ? [
                element("attachment", [], {
                  attachmentId: file.id,
                  name: file.name,
                }),
              ]
            : [];
        }
        if (part.type === "text")
          return [
            ...(part as Tokens.Text).text.matchAll(/!\[\[([^\]]+)\]\]/g),
          ].flatMap((match) => {
            const file = resolver.file(match[1]!.split("|")[0]!);
            return file
              ? [
                  element("attachment", [], {
                    attachmentId: file.id,
                    name: file.name,
                  }),
                ]
              : [];
          });
        return [];
      });
      return [element("paragraph", inlineTokens(inline, resolver)), ...media];
    }
    if (token.type === "table") {
      const typed = token as Tokens.Table;
      // Preserve every cell until the Table editor is available; never discard imported values.
      return [
        element(
          "codeBlock",
          [
            textNode(
              [typed.header, ...typed.rows]
                .map((row) => row.map((cell) => cell.text).join("\t"))
                .join("\n"),
            ),
          ],
          { language: "plaintext" },
        ),
      ];
    }
    return [element("paragraph", [textNode(token.raw ?? "")])];
  });
}
function listBlock(
  token: Tokens.List,
  resolver: MarkdownResolver,
  depth: number,
): Y.XmlElement[] {
  // Mixed checkbox/bullet lists are split into adjacent valid ProseMirror lists.
  const groups: { type: string; start: number; items: Y.XmlElement[] }[] = [];
  let previous = "";
  for (let index = 0; index < token.items.length; index++) {
    const item = token.items[index]!,
      type = item.task
        ? "taskList"
        : token.ordered
          ? "orderedList"
          : "bulletList";
    if (type !== previous) {
      groups.push({
        type,
        start: (Number(token.start) || 1) + index,
        items: [],
      });
      previous = type;
    }
    const children = blockTokens(item.tokens, resolver, depth + 1);
    groups[groups.length - 1]!.items.push(
      element(
        item.task ? "taskItem" : "listItem",
        children.length ? children : [element("paragraph")],
        item.task ? { checked: item.checked === true } : {},
      ),
    );
  }
  return groups.map((group) =>
    element(
      group.type,
      group.items,
      group.type === "orderedList" ? { start: group.start } : {},
    ),
  );
}
export function importMarkdownContent(
  document: Y.Doc,
  markdown: string,
  resolver: MarkdownResolver,
): void {
  if (markdown.length > MAX_MARKDOWN_LENGTH)
    throw new Error("Markdown 문서는 1MiB 이하로 가져와주세요.");
  if (document.getXmlFragment("content").length)
    throw new Error("빈 문서에만 Markdown을 가져올 수 있습니다.");
  const nodes = blockTokens(Lexer.lex(markdown, { gfm: true }), resolver);
  document.getXmlFragment("content").insert(0, nodes);
}
