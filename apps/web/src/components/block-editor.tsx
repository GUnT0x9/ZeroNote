"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import {
  Details,
  DetailsContent,
  DetailsSummary,
} from "@tiptap/extension-details";
import UniqueID from "@tiptap/extension-unique-id";
import { Fragment } from "@tiptap/pm/model";
import {
  GripVertical,
  Plus,
  Heading1,
  Heading2,
  Heading3,
  Type,
  List,
  ListOrdered,
  CheckSquare,
  ChevronRight,
  Quote,
  Code,
  Minus,
  Info,
  FileText,
  ArrowUp,
  ArrowDown,
  Trash2,
  Copy,
} from "lucide-react";
import { safeLinkHref } from "@zeronote/shared";
import {
  PageMention,
  TaskLink,
  Callout,
  HighlightedCode,
} from "./editor-nodes";
import type { DocumentSession } from "@/lib/documents";
import type { LocalPage } from "@/lib/database";

interface Popup {
  kind: "slash" | "mention";
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
}
interface Command {
  id: string;
  label: string;
  description: string;
  icon: typeof Type;
  run: (editor: Editor) => void;
}
const COMMANDS: Command[] = [
  {
    id: "text",
    label: "텍스트",
    description: "자유롭게 생각을 적으세요",
    icon: Type,
    run: (editor) => {
      editor.chain().focus().setParagraph().run();
    },
  },
  ...([1, 2, 3] as const).map((level) => ({
    id: `h${level}`,
    label: `Heading ${level}`,
    description: "문서의 구조를 나누세요",
    icon: level === 1 ? Heading1 : level === 2 ? Heading2 : Heading3,
    run: (editor: Editor) => {
      editor.chain().focus().setHeading({ level }).run();
    },
  })),
  {
    id: "bullet",
    label: "Bullet List",
    description: "순서 없는 목록",
    icon: List,
    run: (editor) => {
      editor.chain().focus().toggleBulletList().run();
    },
  },
  {
    id: "number",
    label: "Numbered List",
    description: "순서가 있는 목록",
    icon: ListOrdered,
    run: (editor) => {
      editor.chain().focus().toggleOrderedList().run();
    },
  },
  {
    id: "todo",
    label: "Todo",
    description: "가벼운 체크리스트",
    icon: CheckSquare,
    run: (editor) => {
      editor.chain().focus().toggleTaskList().run();
    },
  },
  {
    id: "toggle",
    label: "Toggle",
    description: "내용을 접고 펼치세요",
    icon: ChevronRight,
    run: (editor) => {
      editor.chain().focus().setDetails().run();
    },
  },
  {
    id: "quote",
    label: "Quote",
    description: "인용문",
    icon: Quote,
    run: (editor) => {
      editor.chain().focus().toggleBlockquote().run();
    },
  },
  {
    id: "callout",
    label: "Callout",
    description: "기억할 내용을 강조하세요",
    icon: Info,
    run: (editor) => {
      editor
        .chain()
        .focus()
        .insertContent({ type: "callout", content: [{ type: "paragraph" }] })
        .run();
    },
  },
  {
    id: "code",
    label: "Code Block",
    description: "언어별 Syntax Highlighting",
    icon: Code,
    run: (editor) => {
      editor.chain().focus().toggleCodeBlock().run();
    },
  },
  {
    id: "divider",
    label: "Divider",
    description: "구분선",
    icon: Minus,
    run: (editor) => {
      editor.chain().focus().setHorizontalRule().run();
    },
  },
];
export function BlockEditor({
  session,
  fragmentName = "content",
  editable,
  pages,
  onConvertTask,
}: {
  session: Pick<DocumentSession, "id" | "document" | "awareness">;
  fragmentName?: string;
  editable: boolean;
  pages: LocalPage[];
  onConvertTask?: (
    title: string,
  ) => Promise<{ databaseId: string; rowId: string }>;
}) {
  const container = useRef<HTMLDivElement>(null),
    popupRef = useRef<Popup | null>(null),
    pagesRef = useRef(pages),
    activeRef = useRef(0),
    dismissed = useRef("");
  pagesRef.current = pages;
  const [popup, setPopup] = useState<Popup | null>(null),
    [active, setActive] = useState(0),
    [menu, setMenu] = useState(false),
    [blockTop, setBlockTop] = useState(0);
  const items =
    popup?.kind === "mention"
      ? pages
          .filter(
            (page) =>
              !page.deletedAt &&
              !page.accessLost &&
              page.title.toLowerCase().includes(popup.query.toLowerCase()),
          )
          .slice(0, 10)
      : COMMANDS.filter((command) =>
          `${command.id} ${command.label}`
            .toLowerCase()
            .includes(popup?.query.toLowerCase() ?? ""),
        );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const executeRef = useRef<(index: number) => void>(() => {});
  const editor = useEditor(
    {
      immediatelyRender: false,
      editable,
      extensions: [
        StarterKit.configure({
          undoRedo: false,
          codeBlock: false,
          link: {
            openOnClick: false,
            isAllowedUri: (url) => safeLinkHref(url) !== null,
          },
        }),
        HighlightedCode,
        TaskList,
        TaskItem.configure({ nested: true }),
        Details.configure({ persist: true }),
        DetailsSummary,
        DetailsContent,
        Callout,
        PageMention,
        TaskLink,
        UniqueID.configure({
          types: [
            "paragraph",
            "heading",
            "taskItem",
            "blockquote",
            "codeBlock",
            "callout",
            "details",
          ],
          attributeName: "blockId",
        }),
        Collaboration.configure({
          document: session.document,
          field: fragmentName,
        }),
        CollaborationCaret.configure({
          provider: { awareness: session.awareness },
          user: { name: "내 기기", color: "#5277cc" },
        }),
      ],
      editorProps: {
        attributes: {
          class: "document-editor",
          "aria-label": "문서 본문",
          role: "textbox",
          "aria-multiline": "true",
        },
        handleKeyDown(_view, event) {
          if (!popupRef.current) return false;
          if (event.key === "Escape") {
            dismissed.current = `${popupRef.current.from}:${popupRef.current.query}`;
            popupRef.current = null;
            setPopup(null);
            return true;
          }
          if (["ArrowUp", "ArrowDown"].includes(event.key)) {
            const length = itemsRef.current.length;
            if (length) {
              activeRef.current =
                (activeRef.current +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  length) %
                length;
              setActive(activeRef.current);
            }
            return true;
          }
          if (event.key === "Enter") {
            executeRef.current(activeRef.current);
            return true;
          }
          return false;
        },
      },
      onTransaction({ editor: current }) {
        const selection = current.state.selection,
          position = selection.$from;
        if (position.depth && container.current) {
          const coordinates = current.view.coordsAtPos(position.before(1) + 1);
          setBlockTop(
            coordinates.top - container.current.getBoundingClientRect().top - 3,
          );
        }
        const before = position.parent.textBetween(
          0,
          position.parentOffset,
          "\n",
          "\ufffc",
        );
        const match = before.match(/^(\/)([^\n]*)$|\[\[([^\]\n]*)$/);
        if (!editable || !match) {
          popupRef.current = null;
          setPopup(null);
          return;
        }
        const query = match[2] ?? match[3] ?? "",
          from = selection.from - match[0].length;
        if (dismissed.current === `${from}:${query}`) return;
        const coordinates = current.view.coordsAtPos(selection.from),
          rect = container.current?.getBoundingClientRect();
        const next: Popup = {
          kind: match[1] ? "slash" : "mention",
          from,
          to: selection.from,
          query,
          left: Math.max(0, coordinates.left - (rect?.left ?? 0)),
          top: coordinates.bottom - (rect?.top ?? 0) + 8,
        };
        popupRef.current = next;
        setPopup(next);
        activeRef.current = 0;
        setActive(0);
      },
    },
    [session.id, fragmentName],
  );
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  executeRef.current = (index) => {
    const current = popupRef.current,
      item = itemsRef.current[index];
    if (!editor || !current || !item) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: current.from, to: current.to })
      .run();
    if (current.kind === "mention" && "workspaceId" in item)
      editor
        .chain()
        .focus()
        .insertContent([
          { type: "pageMention", attrs: { pageId: item.id } },
          { type: "text", text: " " },
        ])
        .run();
    else if ("run" in item) item.run(editor);
    popupRef.current = null;
    setPopup(null);
  };
  const changeBlock = (action: "delete" | "duplicate" | "up" | "down") => {
    if (!editor) return;
    const position = editor.state.selection.$from;
    if (!position.depth) return;
    const node = position.node(1),
      from = position.before(1),
      index = position.index(0),
      document = editor.state.doc;
    editor.commands.command(({ tr, dispatch }) => {
      if (action === "delete") tr.delete(from, from + node.nodeSize);
      if (action === "duplicate")
        tr.insert(from + node.nodeSize, node.copy(node.content));
      if (action === "up" && index > 0) {
        const previous = document.child(index - 1);
        tr.delete(from, from + node.nodeSize).insert(
          from - previous.nodeSize,
          node,
        );
      }
      if (action === "down" && index < document.childCount - 1) {
        const next = document.child(index + 1);
        tr.delete(from, from + node.nodeSize).insert(
          from + next.nodeSize,
          node,
        );
      }
      if (dispatch) dispatch(tr);
      return true;
    });
    setMenu(false);
  };
  const convertTask = async () => {
    if (!editor || !onConvertTask) return;
    const position = editor.state.selection.$from;
    let depth = position.depth;
    while (depth > 0 && position.node(depth).type.name !== "taskItem") depth--;
    if (!depth) return;
    const item = position.node(depth),
      list = position.node(depth - 1),
      index = position.index(depth - 1),
      listFrom = position.before(depth - 1),
      target = await onConvertTask(item.textContent);
    const link = editor.schema.nodes.taskLink?.create(target);
    if (!link) return;
    const before = [],
      after = [];
    for (let i = 0; i < list.childCount; i++) {
      if (i < index) before.push(list.child(i));
      if (i > index) after.push(list.child(i));
    }
    const replacements = [
      ...(before.length ? [list.copy(Fragment.fromArray(before))] : []),
      link,
      ...(after.length ? [list.copy(Fragment.fromArray(after))] : []),
    ];
    editor.commands.command(({ tr, dispatch }) => {
      if (dispatch)
        dispatch(
          tr.replaceWith(listFrom, listFrom + list.nodeSize, replacements),
        );
      return true;
    });
    setMenu(false);
  };
  if (!editor) return <div className="editor-skeleton" />;
  return (
    <div className="editor-stage" ref={container}>
      <EditorContent editor={editor} />
      {editable && (
        <div className="block-controls" style={{ top: blockTop }}>
          <button
            className="icon-button"
            aria-label="Block 추가"
            onClick={() => {
              editor.chain().focus().insertContent("/").run();
            }}
          >
            <Plus size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Block 메뉴"
            onClick={() => setMenu(!menu)}
          >
            <GripVertical size={16} />
          </button>
          {menu && (
            <div className="block-menu">
              <button onClick={() => changeBlock("up")}>
                <ArrowUp size={14} />
                위로 이동
              </button>
              <button onClick={() => changeBlock("down")}>
                <ArrowDown size={14} />
                아래로 이동
              </button>
              <button onClick={() => changeBlock("duplicate")}>
                <Copy size={14} />
                복제
              </button>
              {editor.isActive("taskItem") && onConvertTask && (
                <button
                  onClick={() => {
                    void convertTask().catch((error) =>
                      useUiStore.getState().patch({
                        notice:
                          error instanceof Error
                            ? error.message
                            : "Task 변환에 실패했습니다.",
                      }),
                    );
                  }}
                >
                  <CheckSquare size={14} />
                  Task로 변환
                </button>
              )}
              <button
                className="danger-text"
                onClick={() => changeBlock("delete")}
              >
                <Trash2 size={14} />
                삭제
              </button>
            </div>
          )}
        </div>
      )}
      {popup && items.length > 0 && (
        <div
          className="slash-menu"
          role="listbox"
          aria-label={popup.kind === "slash" ? "Block 선택" : "Page 연결"}
          style={{ top: popup.top, left: Math.min(popup.left, 300) }}
        >
          <div className="menu-caption">
            {popup.kind === "slash" ? "BLOCKS" : "PAGE 연결"}
          </div>
          {items.map((item, index) => {
            const Icon = "icon" in item ? item.icon : FileText;
            return (
              <button
                key={item.id}
                role="option"
                aria-selected={index === active}
                className={index === active ? "selected" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  executeRef.current(index);
                }}
              >
                <Icon size={17} />
                <span>
                  <strong>{"label" in item ? item.label : item.title}</strong>
                  {"description" in item && <small>{item.description}</small>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
import { useUiStore } from "@/lib/ui-store";
