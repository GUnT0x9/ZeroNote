"use client";
import { Node, mergeAttributes } from "@tiptap/core";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { createLowlight, common } from "lowlight";
import { FileText, CheckSquare, ArrowUpRight } from "lucide-react";
import * as Y from "yjs";
import { getTaskRows } from "@zeronote/shared";
import { database } from "@/lib/database";
import { useLiveValue } from "@/lib/hooks";
import { useUiStore } from "@/lib/ui-store";
import { readLinkedPage } from "@/lib/linked-page";

function PageMentionView({ node }: NodeViewProps) {
  const id = typeof node.attrs.pageId === "string" ? node.attrs.pageId : "";
  const data = useLiveValue(() => readLinkedPage(id), [id], {
    page: undefined,
    visible: false,
  });
  return (
    <NodeViewWrapper as="span" className="page-mention" contentEditable={false}>
      <button
        onClick={() => {
          if (data.page && data.visible)
            useUiStore.getState().select(data.page.workspaceId, data.page.id);
        }}
        disabled={!data.visible}
      >
        <FileText size={13} />
        {data.page && data.visible
          ? data.page.title
          : data.page &&
              !data.page.accessLost &&
              (data.page.deletedAt || data.page.ancestorTrashed)
            ? "삭제된 Page"
            : "접근 제한"}
      </button>
    </NodeViewWrapper>
  );
}
export const PageMention = Node.create({
  name: "pageMention",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { pageId: { default: null } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-page-id]",
        getAttrs: (element) => ({
          pageId: (element as HTMLElement).getAttribute("data-page-id"),
        }),
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return ["span", { "data-page-id": HTMLAttributes.pageId }, "Page"];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PageMentionView);
  },
});
function TaskLinkView({ node }: NodeViewProps) {
  const databaseId = String(node.attrs.databaseId ?? ""),
    rowId = String(node.attrs.rowId ?? "");
  const data = useLiveValue(
    async () => {
      const { page, visible } = await readLinkedPage(databaseId);
      return {
        page,
        visible,
        record: visible ? await database.documents.get(databaseId) : undefined,
      };
    },
    [databaseId],
    { page: undefined, record: undefined, visible: false },
  );
  let title = data.visible ? "Task 열기" : "접근 확인 불가",
    status = "todo",
    unavailable = false;
  if (data.record) {
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, data.record.update);
      const row = getTaskRows(doc).find((item) => item.id === rowId);
      if (row) {
        title = row.title;
        status = row.status;
      } else {
        title = "삭제되거나 없는 Task";
        unavailable = true;
      }
    } catch {
      title = "연결 확인 불가";
      unavailable = true;
    } finally {
      doc.destroy();
    }
  }
  return (
    <NodeViewWrapper className="task-link" contentEditable={false}>
      <button
        onClick={() => {
          if (data.page && data.visible && !unavailable)
            useUiStore
              .getState()
              .select(data.page.workspaceId, databaseId, rowId);
        }}
        disabled={!data.visible || unavailable}
      >
        <CheckSquare size={17} />
        <span className={status === "done" ? "completed" : ""}>{title}</span>
        <ArrowUpRight size={15} />
      </button>
    </NodeViewWrapper>
  );
}
export const TaskLink = Node.create({
  name: "taskLink",
  group: "block",
  atom: true,
  addAttributes() {
    return { databaseId: { default: null }, rowId: { default: null } };
  },
  parseHTML() {
    return [{ tag: "div[data-task-link]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-task-link": "true" }),
      "Task",
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(TaskLinkView);
  },
});
export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "aside[data-callout]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "aside",
      mergeAttributes(HTMLAttributes, {
        "data-callout": "true",
        class: "callout",
      }),
      0,
    ];
  },
});
function CodeBlockView({ node, updateAttributes, editor }: NodeViewProps) {
  return (
    <NodeViewWrapper className="code-block">
      <div className="code-block-header">
        <select
          aria-label="Code 언어"
          value={String(node.attrs.language ?? "plaintext")}
          disabled={!editor.isEditable}
          onChange={(event) =>
            updateAttributes({ language: event.target.value })
          }
        >
          {[
            "plaintext",
            "javascript",
            "typescript",
            "python",
            "bash",
            "json",
            "sql",
            "css",
            "html",
            "rust",
            "go",
          ].map((language) => (
            <option key={language}>{language}</option>
          ))}
        </select>
      </div>
      <pre>
        <code>
          <NodeViewContent />
        </code>
      </pre>
    </NodeViewWrapper>
  );
}
export const HighlightedCode = CodeBlockLowlight.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CodeBlockView);
  },
}).configure({
  lowlight: createLowlight(common),
  defaultLanguage: "plaintext",
});
