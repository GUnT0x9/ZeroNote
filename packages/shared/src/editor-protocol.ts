import * as Y from "yjs";

export const EDITOR_PROTOCOL = 2;
export const EDITOR_PROTOCOL_HEADER = "X-ZeroNote-Editor-Protocol";
export const EDITOR_UPDATE_MESSAGE =
  "새 Editor 기능이 포함된 문서입니다. 변경은 이 기기에 보관됩니다. 앱을 새로고침한 뒤 다시 동기화해주세요.";
const LEGACY_NODES = new Set([
  "paragraph",
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
  const supported = (node: unknown): boolean => {
    if (node instanceof Y.XmlText)
      return node
        .toDelta()
        .every((part: { attributes?: Record<string, unknown> }) =>
          Object.keys(part.attributes ?? {}).every((mark) =>
            LEGACY_MARKS.has(mark),
          ),
        );
    if (node instanceof Y.XmlElement && !LEGACY_NODES.has(node.nodeName))
      return false;
    if (!(node instanceof Y.XmlFragment)) return false;
    return node.toArray().every(supported);
  };
  for (const name of document.share.keys()) {
    if (
      (name === "content" || name.startsWith("task:")) &&
      !supported(document.getXmlFragment(name))
    )
      return EDITOR_PROTOCOL;
  }
  return 1;
}
