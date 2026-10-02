"use client";
import { useEffect, useState, useRef } from "react";
import {
  ArrowLeft,
  FileText,
  Link2,
  MessageSquare,
  SlidersHorizontal,
  CloudOff,
  History,
  Trash2,
  Download,
} from "lucide-react";
import * as Y from "yjs";
import {
  canEdit,
  writeDatabaseValue,
  createTaskRow,
  replaceSharedText,
  getTaskRows,
  updateTaskField,
  isPageTemplate,
  setPageTemplate,
} from "@zeronote/shared";
import {
  openDocument,
  connectDocument,
  disconnectDocument,
  type DocumentSession,
} from "@/lib/documents";
import {
  useDocumentRevision,
  useMobile,
  type WorkspaceData,
} from "@/lib/hooks";
import { database, errorMessage, type LocalPage } from "@/lib/database";
import {
  changePageStructure,
  createLocalPage,
  duplicateLocalPage,
} from "@/lib/workspace";
import { requestSync } from "@/lib/sync";
import { useUiStore } from "@/lib/ui-store";
import { BlockEditor } from "./block-editor";
import { TaskDatabase } from "./task-database";
import { DatabaseRowProperties } from "./database-property";
import { downloadJson } from "@/lib/workspace";
import { bytesToBase64 } from "@zeronote/shared";
import { EmptyState } from "./primitives";
import { DesignIcon } from "./design-icon";
import { TemplatesDialog } from "./templates-dialog";
import { TransferDialog } from "./transfer-dialog";
export function DocumentView({
  page,
  data,
}: {
  page: LocalPage;
  data: WorkspaceData;
}) {
  const ui = useUiStore(),
    mobile = useMobile();
  const [session, setSession] = useState<DocumentSession | null>(null),
    [error, setError] = useState<string | null>(null),
    [menu, setMenu] = useState(false),
    [templatesOpen, setTemplatesOpen] = useState(false),
    [exportOpen, setExportOpen] = useState(false),
    menuRef = useRef<HTMLDivElement>(null),
    menuButton = useRef<HTMLButtonElement>(null),
    [providerRevision, setProviderRevision] = useState(0),
    [presence, setPresence] = useState<{ name: string; color: string }[]>([]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        setMenu(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menu]);
  useDocumentRevision(session?.document ?? null);
  useEffect(() => {
    let cancelled = false;
    setSession(null);
    setError(null);
    void (async () => {
      try {
        const next = await openDocument(page);
        if (cancelled) return;
        setSession(next);
        await connectDocument(next, page);
        if (!cancelled) setProviderRevision((value) => value + 1);
        else disconnectDocument(next);
      } catch (problem) {
        if (!cancelled) setError(errorMessage(problem));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page.id]);
  useEffect(() => {
    if (!session) return;
    const awareness = session.provider?.awareness;
    if (!awareness) return;
    const update = () => {
      setPresence(
        Array.from(awareness.getStates().values()).flatMap((value: unknown) => {
          if (
            typeof value !== "object" ||
            !value ||
            !("user" in value) ||
            typeof value.user !== "object" ||
            !value.user
          )
            return [];
          const user = value.user;
          return "name" in user && typeof user.name === "string"
            ? [
                {
                  name: user.name,
                  color:
                    "color" in user && typeof user.color === "string"
                      ? user.color
                      : "#5277cc",
                },
              ]
            : [];
        }),
      );
    };
    awareness.on("change", update);
    update();
    return () => awareness.off("change", update);
  }, [session, providerRevision]);
  useEffect(() => {
    if (!session) return;
    if (page.accessLost || page.deletedAt) {
      disconnectDocument(session);
      return;
    }
    if (ui.syncState === "offline") {
      session.provider?.disconnect();
    } else if (ui.syncState === "online") {
      if (session.provider && document.visibilityState === "visible") {
        session.awareness.setLocalStateField("user", {
          name: "내 기기",
          color: "#5277cc",
        });
        session.provider.connect();
      } else
        void connectDocument(session, page)
          .then(() => setProviderRevision((value) => value + 1))
          .catch((problem) => ui.patch({ notice: errorMessage(problem) }));
    }
    return () => {};
  }, [ui.syncState, session?.id, page.accessLost, page.deletedAt]);
  useEffect(
    () => () => {
      if (session) disconnectDocument(session);
    },
    [session?.id],
  );
  const record = data.documents.find((document) => document.id === page.id),
    editable =
      canEdit(page.role) && !page.accessLost && record?.state !== "preserved";
  const row =
    session && ui.taskId
      ? getTaskRows(session.document).find((task) => task.id === ui.taskId)
      : undefined;
  const titleText = session
    ? row
      ? session.document
          .getMap<Y.Map<unknown>>("tasks")
          .get(row.id)
          ?.get("title")
      : session.document.getText("title")
    : null;
  const title = titleText instanceof Y.Text ? titleText.toString() : page.title;
  const parents: LocalPage[] = [];
  let parent = data.pages.find((item) => item.id === page.parentId);
  const visited = new Set<string>();
  while (parent && !visited.has(parent.id)) {
    parents.unshift(parent);
    visited.add(parent.id);
    parent = data.pages.find((item) => item.id === parent?.parentId);
  }
  const trash = async () => {
    if (row && session) {
      updateTaskField(session.document, row.id, "deleted", true);
      ui.select(page.workspaceId, page.id);
    } else {
      await changePageStructure(page, "trash");
      ui.select(page.workspaceId, null);
      requestSync();
    }
  };
  const convertTask = async (text: string) => {
    let project = data.pages.find(
      (item) =>
        item.workspaceId === page.workspaceId &&
        item.kind === "database" &&
        !item.deletedAt &&
        canEdit(item.role),
    );
    if (!project && page.role !== "owner")
      throw new Error(
        "Task로 변환하려면 Owner에게 프로젝트 초대를 요청해주세요.",
      );
    if (!project)
      project = await createLocalPage(page.workspaceId, "To-Do", "database");
    const target = await openDocument(project);
    const rowId = createTaskRow(
      target.document,
      text.trim().slice(0, 500) || "제목 없음",
    );
    return { databaseId: project.id, rowId };
  };
  if (error)
    return (
      <EmptyState
        icon={<CloudOff size={30} />}
        title="Page를 열 수 없습니다"
        description={error}
      >
        <button className="button" onClick={() => window.location.reload()}>
          다시 시도
        </button>
      </EmptyState>
    );
  return (
    <div
      className={`document-view ${page.kind === "database" && !row ? "database-view" : ""}`}
    >
      <header className="page-toolbar">
        <div className="breadcrumbs">
          {parents.map((item) => (
            <button
              key={item.id}
              onClick={() => ui.select(item.workspaceId, item.id)}
            >
              {item.title}
              <span>/</span>
            </button>
          ))}
          {row && (
            <button onClick={() => ui.select(page.workspaceId, page.id)}>
              {page.title}
              <span>/</span>
            </button>
          )}
          <span className="breadcrumb-current">{row?.title || page.title}</span>
        </div>
        <div className="page-toolbar-actions">
          <div className="presence">
            {presence.slice(0, 4).map((person, index) => (
              <span
                key={`${person.name}-${index}`}
                className="presence-avatar"
                style={{ background: person.color }}
                title={person.name}
              >
                {person.name.slice(0, 1)}
              </span>
            ))}
          </div>
          {mobile && (
            <button
              className="icon-button"
              title="Comments"
              aria-label="Comments"
              onClick={() =>
                ui.patch({ panel: ui.panel === "comments" ? null : "comments" })
              }
            >
              <MessageSquare size={16} />
            </button>
          )}
          {page.role === "owner" && !page.accessLost && (
            <button
              className="button button-small"
              onClick={() =>
                ui.patch({ panel: ui.panel === "share" ? null : "share" })
              }
            >
              <DesignIcon name="share" />
              Share
            </button>
          )}
          <button
            className={`icon-button favorite-button ${page.favorite ? "active" : ""}`}
            aria-label={page.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            title={page.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
            aria-pressed={!!page.favorite}
            onClick={() => {
              void database.pages
                .update(page.id, { favorite: !page.favorite })
                .catch((problem) =>
                  ui.patch({ notice: errorMessage(problem) }),
                );
            }}
          >
            <DesignIcon name="star" />
          </button>
          <div
            className="relative"
            ref={menuRef}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setMenu(false);
                menuButton.current?.focus();
              }
            }}
          >
            <button
              ref={menuButton}
              className="icon-button"
              aria-label="Page 메뉴"
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <DesignIcon name="more" />
            </button>
            {menu && (
              <div
                className="dropdown-menu"
                role="region"
                aria-label="Page 도구"
              >
                {!mobile && (
                  <button
                    onClick={() => {
                      ui.patch({
                        panel: ui.panel === "comments" ? null : "comments",
                      });
                      setMenu(false);
                    }}
                  >
                    <MessageSquare size={14} />
                    Comments
                  </button>
                )}
                <button
                  onClick={() => {
                    ui.patch({
                      panel: ui.panel === "properties" ? null : "properties",
                    });
                    setMenu(false);
                  }}
                >
                  <SlidersHorizontal size={14} />
                  Properties
                </button>
                <button
                  onClick={() => {
                    ui.patch({
                      panel: ui.panel === "backlinks" ? null : "backlinks",
                    });
                    setMenu(false);
                  }}
                >
                  <Link2 size={14} />
                  Backlinks
                </button>
                {page.role === "owner" && !page.accessLost && (
                  <button
                    onClick={() => {
                      ui.patch({
                        panel: ui.panel === "history" ? null : "history",
                      });
                      setMenu(false);
                    }}
                  >
                    <History size={14} />
                    기록
                  </button>
                )}
                {editable && (
                  <button
                    className="danger-text"
                    onClick={() => {
                      void trash().catch((problem) =>
                        ui.patch({ notice: errorMessage(problem) }),
                      );
                      setMenu(false);
                    }}
                  >
                    <Trash2 size={14} />
                    Trash로 이동
                  </button>
                )}
                {!page.accessLost && !row && (
                  <button
                    onClick={() => {
                      setExportOpen(true);
                      setMenu(false);
                    }}
                  >
                    <Download size={14} />
                    Export
                  </button>
                )}
                {editable && page.role === "owner" && !row && session && (
                  <>
                    <button
                      onClick={() => {
                        setTemplatesOpen(true);
                        setMenu(false);
                      }}
                    >
                      Template으로 새 Page
                    </button>
                    <button
                      onClick={() => {
                        setPageTemplate(
                          session.document,
                          !isPageTemplate(session.document),
                        );
                        requestSync();
                        setMenu(false);
                      }}
                    >
                      {isPageTemplate(session.document)
                        ? "Template 지정 해제"
                        : "Template으로 지정"}
                    </button>
                    <button
                      onClick={() => {
                        setMenu(false);
                        void duplicateLocalPage(page)
                          .then((copy) => {
                            ui.select(copy.workspaceId, copy.id);
                            requestSync();
                          })
                          .catch((problem) =>
                            ui.patch({ notice: errorMessage(problem) }),
                          );
                      }}
                    >
                      Page 복제
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="document-scroll">
        {exportOpen && (
          <TransferDialog
            workspaceId={page.workspaceId}
            pageId={page.id}
            onClose={() => setExportOpen(false)}
            onKey={() => {}}
          />
        )}
        {templatesOpen && (
          <TemplatesDialog
            data={data}
            onClose={() => setTemplatesOpen(false)}
          />
        )}
        <main className="page-body">
          {row && (
            <div className="page-return">
              <button onClick={() => ui.select(page.workspaceId, page.id)}>
                <ArrowLeft size={13} />
                프로젝트로 돌아가기
              </button>
            </div>
          )}
          <input
            className="page-title"
            aria-label="Page 제목"
            placeholder="제목 없음"
            value={title}
            maxLength={500}
            disabled={!session}
            readOnly={!editable}
            onChange={(event) => {
              if (row && session)
                writeDatabaseValue(
                  session.document,
                  row.id,
                  "title",
                  event.target.value,
                );
              else if (titleText instanceof Y.Text)
                replaceSharedText(titleText, event.target.value);
            }}
          />
          {(session?.localSaveError ||
            page.role === "viewer" ||
            page.role === "commenter") && (
            <div className="document-meta">
              {session?.localSaveError && (
                <span className="save-error" role="alert">
                  이 기기 저장 실패 · {session.localSaveError}
                </span>
              )}
              <span>
                {page.role === "viewer"
                  ? "읽기 전용"
                  : page.role === "commenter"
                    ? "읽기 및 Comment"
                    : ""}
              </span>
            </div>
          )}
          {(page.accessLost || record?.state === "preserved") && record && (
            <div className="inline-warning">
              {record.error ?? "이 Page의 접근 권한이 변경되었습니다."} 저장된
              내용은 이 기기에 남아 있습니다.
              <button
                className="button button-small"
                onClick={() =>
                  downloadJson(
                    {
                      schemaVersion: 1,
                      exportedAt: new Date().toISOString(),
                      name: page.title.slice(0, 160) || "로컬 보존본",
                      pages: [
                        {
                          id: page.id,
                          parentId: null,
                          kind: page.kind,
                          title: record.title,
                          isInbox: false,
                          document: bytesToBase64(record.update),
                        },
                      ],
                    },
                    `${page.title}-local-copy.json`,
                  )
                }
              >
                로컬 복사본 Export
              </button>
            </div>
          )}
          {session ? (
            <>
              {row && (
                <DatabaseRowProperties
                  document={session.document}
                  row={row}
                  editable={editable}
                  identities={data.identities.filter(
                    (identity) => identity.workspaceId === page.workspaceId,
                  )}
                />
              )}
              {page.kind === "database" && !row ? (
                <TaskDatabase
                  session={session}
                  page={page}
                  editable={editable}
                  identities={data.identities.filter(
                    (identity) => identity.workspaceId === page.workspaceId,
                  )}
                />
              ) : (
                <BlockEditor
                  session={session}
                  fragmentName={row ? `task:${row.id}` : "content"}
                  editable={editable}
                  pages={data.pages}
                  onConvertTask={editable ? convertTask : undefined}
                />
              )}
              {!row &&
                (page.isInbox ||
                  data.pages.some(
                    (item) =>
                      item.parentId === page.id &&
                      !item.deletedAt &&
                      !item.accessLost,
                  )) && (
                  <div className="child-pages">
                    {data.pages
                      .filter(
                        (item) =>
                          item.parentId === page.id &&
                          !item.deletedAt &&
                          !item.accessLost,
                      )
                      .map((item) => (
                        <button
                          key={item.id}
                          onClick={() => ui.select(item.workspaceId, item.id)}
                        >
                          <FileText size={16} />
                          <span>{item.title}</span>
                        </button>
                      ))}
                    {page.isInbox &&
                      !data.pages.some(
                        (item) =>
                          item.parentId === page.id &&
                          !item.deletedAt &&
                          !item.accessLost,
                      ) && (
                        <p className="muted">
                          Quick Capture로 첫 메모를 남겨보세요.
                        </p>
                      )}
                  </div>
                )}
            </>
          ) : (
            <div className="editor-skeleton" />
          )}
        </main>
      </div>
    </div>
  );
}
