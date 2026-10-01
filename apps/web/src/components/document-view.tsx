"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  FileText,
  Columns3,
  Link2,
  MessageSquare,
  SlidersHorizontal,
  Cloud,
  CloudOff,
  Loader2,
  Share2,
  MoreHorizontal,
  History,
  Trash2,
  Star,
} from "lucide-react";
import * as Y from "yjs";
import {
  canEdit,
  createTaskRow,
  replaceSharedText,
  getTaskRows,
  updateTaskField,
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
import { changePageStructure, createLocalPage } from "@/lib/workspace";
import { requestSync } from "@/lib/sync";
import { useUiStore } from "@/lib/ui-store";
import { BlockEditor } from "./block-editor";
import { TaskDatabase } from "./task-database";
import { downloadJson } from "@/lib/workspace";
import { bytesToBase64 } from "@zeronote/shared";
import { EmptyState } from "./primitives";
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
    [providerRevision, setProviderRevision] = useState(0),
    [presence, setPresence] = useState<{ name: string; color: string }[]>([]);
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
      canEdit(page.role) &&
      !page.accessLost &&
      record?.state !== "preserved" &&
      !mobile;
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
      project = await createLocalPage(
        page.workspaceId,
        "나의 프로젝트",
        "database",
      );
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
          <button
            className="icon-button"
            title="Backlinks"
            aria-label="Backlinks"
            onClick={() =>
              ui.patch({ panel: ui.panel === "backlinks" ? null : "backlinks" })
            }
          >
            <Link2 size={16} />
          </button>
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
          {
            <button
              className="icon-button"
              aria-label="Properties"
              onClick={() =>
                ui.patch({
                  panel: ui.panel === "properties" ? null : "properties",
                })
              }
            >
              <SlidersHorizontal size={16} />
            </button>
          }
          {page.role === "owner" && !page.accessLost && (
            <button
              className="icon-button"
              aria-label="기록"
              title="기록"
              onClick={() =>
                ui.patch({ panel: ui.panel === "history" ? null : "history" })
              }
            >
              <History size={16} />
            </button>
          )}
          {page.role === "owner" && !page.accessLost && (
            <button
              className="button button-small"
              onClick={() =>
                ui.patch({ panel: ui.panel === "share" ? null : "share" })
              }
            >
              <Share2 size={14} />
              Share
            </button>
          )}
          <div className="relative">
            <button
              className="icon-button"
              aria-label="Page 메뉴"
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={18} />
            </button>
            {menu && (
              <div className="dropdown-menu">
                <button
                  onClick={() => {
                    void database.pages
                      .update(page.id, { favorite: !page.favorite })
                      .catch((problem) =>
                        ui.patch({ notice: errorMessage(problem) }),
                      );
                    setMenu(false);
                  }}
                >
                  <Star size={14} />
                  {page.favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
                </button>
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
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="document-scroll">
        <main className="page-body">
          <div className="page-eyebrow">
            {row ? (
              <>
                <button onClick={() => ui.select(page.workspaceId, page.id)}>
                  <ArrowLeft size={13} />
                  프로젝트로 돌아가기
                </button>
              </>
            ) : page.kind === "database" ? (
              <>
                <Columns3 size={15} />
                PROJECT
              </>
            ) : (
              <>
                <FileText size={15} />
                PAGE
              </>
            )}
          </div>
          <input
            className="page-title"
            aria-label="Page 제목"
            placeholder="제목 없음"
            value={title}
            maxLength={500}
            disabled={!session}
            readOnly={!editable}
            onChange={(event) => {
              if (titleText instanceof Y.Text)
                replaceSharedText(titleText, event.target.value);
            }}
          />
          <div className="document-meta">
            <span
              className={`save-indicator ${record?.state === "error" ? "save-error" : ""}`}
            >
              {ui.syncState === "offline" ? (
                <CloudOff size={13} />
              ) : record?.generation &&
                record.generation > record.committedGeneration ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <Cloud size={13} />
              )}{" "}
              {session?.localSaveError
                ? "이 기기 저장 실패"
                : session && session.generation > (record?.generation ?? 0)
                  ? "이 기기에 저장 중"
                  : record?.state === "preserved"
                    ? "로컬 보존본"
                    : record?.state === "error"
                      ? "동기화 실패"
                      : !record
                        ? "문서 준비 중"
                        : ui.syncState === "offline"
                          ? "Offline · 이 기기에 저장됨"
                          : record.generation > record.committedGeneration
                            ? "이 기기에 저장됨 · 동기화 중"
                            : "서버 동기화 완료"}
            </span>
            <span className="meta-separator">·</span>
            <span>
              {page.role === "viewer"
                ? "읽기 전용"
                : page.role === "commenter"
                  ? "읽기 및 Comment"
                  : mobile
                    ? "Mobile 읽기 모드"
                    : "개인과 팀을 위한 문서"}
            </span>
          </div>
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
              {!row && (
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
