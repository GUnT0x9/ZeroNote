import * as Y from "yjs";

export const EDITOR_PROTOCOL = 4;
export const EDITOR_PROTOCOL_HEADER = "X-ZeroNote-Editor-Protocol";
export const EDITOR_UPDATE_MESSAGE =
  "새 Editor 기능이 포함된 문서입니다. 변경은 이 기기에 보관됩니다. 앱을 새로고침한 뒤 다시 동기화해주세요.";
const LEGACY_NODES = new Set([
  "paragraph",
  "hardBreak",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "details",
  "detailsSummary",
  "detailsContent",
  "blockquote",
  "codeBlock",
  "horizontalRule",
  "callout",
  "pageMention",
  "taskLink",
]);
const LEGACY_MARKS = new Set([
  "bold",
  "italic",
  "code",
  "strike",
  "underline",
  "link",
]);

/** Older ProseMirror schemas delete unknown Yjs nodes and marks while rendering. */
export function getDocumentEditorProtocol(document: Y.Doc): number {
  let required =
    document.getMap("pageTags").size ||
    document.getMap("pageSettings").get("tagProtocol") === 4
      ? 4
      : 1;
  for (const property of document
    .getMap<Y.Map<unknown>>("databaseProperties")
    .values())
    if (
      property instanceof Y.Map &&
      ["file", "formula", "relation", "rollup"].includes(
        String(property.get("type")),
      )
    )
      required = Math.max(required, 3);
  const inspect = (node: unknown): void => {
    if (node instanceof Y.XmlText)
      for (const part of node.toDelta())
        for (const mark of Object.keys(part.attributes ?? {}))
          if (!LEGACY_MARKS.has(mark.replace(/--[a-zA-Z0-9+/=]{8}$/, "")))
            required = EDITOR_PROTOCOL;
    if (node instanceof Y.XmlElement && !LEGACY_NODES.has(node.nodeName))
      required = Math.max(
        required,
        node.nodeName === "attachment" ? 2 : EDITOR_PROTOCOL,
      );
    if (node instanceof Y.XmlFragment)
      for (const child of node.toArray()) inspect(child);
  };
  for (const name of document.share.keys()) {
    if (name === "content" || name.startsWith("task:"))
      inspect(document.getXmlFragment(name));
  }
  return required;
}
