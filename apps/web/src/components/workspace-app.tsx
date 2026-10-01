"use client";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Menu,
  Plus,
  FileText,
  KeyRound,
  Loader2,
  Trash2,
  RotateCcw,
  X,
} from "lucide-react";
import { clientBetaRequired } from "@/lib/beta";
import { useWorkspaceData, useMobile } from "@/lib/hooks";
import { prepareOfflineShell } from "@/lib/offline-shell";
import { availablePages } from "@/lib/search";
import { useUiStore } from "@/lib/ui-store";
import { getDevice, authenticate, api } from "@/lib/api";
import { database, errorMessage, type LocalPage } from "@/lib/database";
import {
  startSync,
  synchronize,
  requestSync,
  reapplyOperation,
} from "@/lib/sync";
import { createLocalPage, changePageStructure } from "@/lib/workspace";
import { DocumentView } from "./document-view";
import { ContextPanel } from "./context-panel";
import { Sidebar } from "./sidebar";
import { SyncStatus } from "./sync-status";
import { EmptyState } from "./primitives";
import {
  CreateWorkspaceDialog,
  RecoverWorkspaceDialog,
  RecoveryKeyDialog,
  SearchDialog,
  CaptureDialog,
  SettingsDialog,
} from "./dialogs";

export default function WorkspaceApp() {
  const data = useWorkspaceData(),
    mobile = useMobile(),
    ui = useUiStore(),
    [createOpen, setCreateOpen] = useState(false),
    [recoverOpen, setRecoverOpen] = useState(false),
    [recoveryKey, setRecoveryKey] = useState<string | null>(null),
    [trashOpen, setTrashOpen] = useState(false),
    [historyPage, setHistoryPage] = useState<LocalPage | null>(null),
    [openingInvite, setOpeningInvite] = useState(false);
  const preservedPageIds = useMemo(
    () =>
      new Set(
        data.documents
          .filter((record) => record.state === "preserved")
          .map((record) => record.id),
      ),
    [data.documents],
  );
  const visiblePages = useMemo(
    () => [
      ...availablePages(data.pages),
      ...data.pages.filter(
        (item) =>
          (item.accessLost && !item.deletedAt) || preservedPageIds.has(item.id),
      ),
    ],
    [data.pages, preservedPageIds],
  );
  const workspace =
      data.workspaces.find((item) => item.id === ui.workspaceId) ?? null,
    page = visiblePages.find((item) => item.id === ui.pageId) ?? null;
  useEffect(() => {
    const stop = startSync(),
      params = new URLSearchParams(window.location.search);
    ui.patch({
      workspaceId: params.get("workspace"),
      pageId: params.get("page"),
      taskId: params.get("task"),
    });
    void getDevice().catch((error) =>
      ui.patch({ notice: errorMessage(error) }),
    );
    void database.preferences
      .get("theme")
      .then((preference) => {
        if (
          preference &&
          ["light", "dark", "system"].includes(preference.value)
        )
          ui.patch({ theme: preference.value as "light" | "dark" | "system" });
      })
      .catch((error) => ui.patch({ notice: errorMessage(error) }));
    const invitation = params.get("invite"),
      secret = window.location.hash.slice(1);
    if (invitation && secret) {
      setOpeningInvite(true);
      window.history.replaceState(null, "", `/?invite=${invitation}`);
      void (async () => {
        await authenticate();
        const result = await api<{ workspaceId: string; pageId: string }>(
          `/invites/${invitation}/redeem`,
          "POST",
          { secret },
        );
        await synchronize();
        ui.select(result.workspaceId, result.pageId);
      })()
        .catch((error) => ui.patch({ notice: errorMessage(error) }))
        .finally(() => setOpeningInvite(false));
    }
    void prepareOfflineShell()
      .then(() => ui.patch({ offlineReady: true }))
      .catch((error) =>
        ui.patch({
          notice: `Offline 화면을 준비하지 못했습니다: ${errorMessage(error)}`,
        }),
      );
    if (navigator.storage?.persist)
      void navigator.storage.persist().catch(() => {});
    return stop;
  }, []);
  useEffect(() => {
    if (!data.loaded || openingInvite || ui.workspaceId) return;
    const first = data.workspaces[0];
    if (first)
      ui.select(
        first.id,
        data.pages.find(
          (item) =>
            item.workspaceId === first.id && !item.isInbox && !item.deletedAt,
        )?.id ?? null,
      );
  }, [
    data.loaded,
    data.workspaces.length,
    data.pages.length,
    openingInvite,
    ui.workspaceId,
  ]);
  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)"),
      update = () => {
        document.documentElement.dataset.theme =
          ui.theme === "system" ? (query.matches ? "dark" : "light") : ui.theme;
      };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [ui.theme]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        ui.patch({ searchOpen: true });
      }
      if (event.shiftKey && event.code === "Space") {
        event.preventDefault();
        ui.patch({ captureOpen: true });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!ui.notice) return;
    const timeout = setTimeout(() => ui.patch({ notice: null }), 8000);
    return () => clearTimeout(timeout);
  }, [ui.notice]);
  useEffect(() => {
    if (ui.pageId) {
      setTrashOpen(false);
      setHistoryPage(null);
    }
  }, [ui.pageId]);
  const newPage = useCallback(
    async (kind: "document" | "database", parentId: string | null = null) => {
      const selection = useUiStore.getState();
      if (!selection.workspaceId) {
        setCreateOpen(true);
        return;
      }
      const created = await createLocalPage(
        selection.workspaceId,
        kind === "database" ? "새 To-Do" : "제목 없음",
        kind,
        parentId,
      );
      ui.select(created.workspaceId, created.id);
      requestSync();
    },
    [],
  );
  const handleNewPage = useCallback(
    (kind: "document" | "database", parent?: string | null) => {
      void newPage(kind, parent ?? null).catch((error) =>
        useUiStore.getState().patch({ notice: errorMessage(error) }),
      );
    },
    [newPage],
  );
  const trash = data.pages.filter(
    (item) => item.workspaceId === ui.workspaceId && item.deletedAt,
  );
  const conflicts = data.operations.filter(
    (operation) => operation.status === "conflict",
  );
  return (
    <div className="workspace-app">
      <Sidebar
        data={data}
        onNew={handleNewPage}
        onCreate={() => setCreateOpen(true)}
        onTrash={() => {
          ui.patch({ pageId: null, panel: null, sidebarOpen: false });
          setTrashOpen(true);
        }}
        trashOpen={trashOpen}
      />
      <div
        className={`workspace-main ${ui.sidebarCollapsed ? "sidebar-hidden" : ""}`}
      >
        <div className="mobile-topbar">
          <button
            className="icon-button"
            aria-label="Sidebar 열기"
            onClick={() =>
              ui.patch(
                mobile ? { sidebarOpen: true } : { sidebarCollapsed: false },
              )
            }
          >
            <Menu size={20} />
          </button>
          <SyncStatus data={data} />
          <span>{workspace?.name ?? "ZeroNote"}</span>
          <button
            className="icon-button"
            aria-label="Quick Capture 열기"
            onClick={() => ui.patch({ captureOpen: true })}
          >
            <Plus size={19} />
          </button>
        </div>
        {ui.storageWarning && (
          <div className="sync-banner warning" role="status">
            서버 저장 공간이 부족해지고 있습니다. Workspace Export를
            보관해주세요.
          </div>
        )}
        {workspace?.creationError && (
          <div className="sync-banner warning" role="status">
            {workspace.creationError} · Settings에서 Export할 수 있습니다.
          </div>
        )}
        {conflicts.length > 0 && (
          <div className="sync-banner warning">
            <span>다른 기기에서 Page 구조가 변경되었습니다.</span>
            <button
              onClick={() => {
                void Promise.all(
                  conflicts.map((operation) => reapplyOperation(operation.id)),
                ).catch((error) => ui.patch({ notice: errorMessage(error) }));
              }}
            >
              내 변경 다시 적용
            </button>
          </div>
        )}
        <div className="content-panels">
          {!data.loaded || openingInvite ? (
            <div className="loading-state">
              <Loader2 className="spin" size={24} />
              <span>
                {openingInvite
                  ? "초대된 Page를 열고 있습니다"
                  : "작업 공간을 준비하고 있습니다"}
              </span>
            </div>
          ) : !data.workspaces.length ? (
            <div className="onboarding">
              <h1>새 Workspace</h1>
              <p>
                {clientBetaRequired
                  ? "초대코드를 입력해 문서와 Task를 관리할 공간을 만드세요."
                  : "문서와 Task를 관리할 공간을 만드세요. 회원가입은 필요하지 않습니다."}
              </p>
              <button
                className="button button-primary button-large"
                onClick={() => setCreateOpen(true)}
              >
                <Plus size={16} />
                Workspace 만들기
              </button>
              <button
                className="text-button"
                onClick={() => setRecoverOpen(true)}
              >
                <KeyRound size={14} />
                기존 Workspace 복구
              </button>
            </div>
          ) : trashOpen ? (
            <div className="trash-view">
              <h1>
                <Trash2 size={25} />
                Trash
              </h1>
              <p>삭제한 Page를 복원할 수 있습니다.</p>
              {!trash.length ? (
                <EmptyState
                  icon={<Trash2 size={28} />}
                  title="Trash가 비어 있습니다"
                  description="삭제한 Page는 여기에 표시됩니다."
                />
              ) : (
                trash.map((item) => (
                  <div className="trash-row" key={item.id}>
                    <FileText size={17} />
                    <span>{item.title}</span>
                    {item.role === "owner" && (
                      <button
                        className="button button-small"
                        onClick={() => {
                          setHistoryPage(item);
                          ui.patch({ panel: "history" });
                        }}
                      >
                        기록
                      </button>
                    )}
                    <button
                      className="button button-small"
                      onClick={() => {
                        void changePageStructure(item, "restore")
                          .then(requestSync)
                          .catch((error) =>
                            ui.patch({ notice: errorMessage(error) }),
                          );
                      }}
                    >
                      <RotateCcw size={13} />
                      복원
                    </button>
                  </div>
                ))
              )}
            </div>
          ) : page ? (
            <DocumentView key={page.id} page={page} data={data} />
          ) : (
            <EmptyState
              icon={<FileText size={30} />}
              title="문서를 선택하세요"
              description="왼쪽에서 Page를 열거나 새로운 문서를 만들어보세요."
            >
              <button
                className="button"
                onClick={() => {
                  void newPage("document").catch((error) =>
                    ui.patch({ notice: errorMessage(error) }),
                  );
                }}
              >
                <Plus size={15} />새 문서
              </button>
            </EmptyState>
          )}
          {ui.panel && (trashOpen ? historyPage : page) && (
            <ContextPanel
              page={(trashOpen ? historyPage : page)!}
              data={data}
            />
          )}
        </div>
      </div>
      {ui.notice && (
        <div className="toast" role="status">
          <span>{ui.notice}</span>
          <button
            className="icon-button"
            aria-label="알림 닫기"
            onClick={() => ui.patch({ notice: null })}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {createOpen && (
        <CreateWorkspaceDialog
          onClose={() => setCreateOpen(false)}
          onKey={setRecoveryKey}
        />
      )}{" "}
      {recoverOpen && (
        <RecoverWorkspaceDialog onClose={() => setRecoverOpen(false)} />
      )}{" "}
      {recoveryKey && (
        <RecoveryKeyDialog
          value={recoveryKey}
          onClose={() => setRecoveryKey(null)}
        />
      )}{" "}
      {ui.searchOpen && (
        <SearchDialog
          data={data}
          onClose={() => ui.patch({ searchOpen: false })}
        />
      )}{" "}
      {ui.captureOpen && (
        <CaptureDialog
          data={data}
          onClose={() => ui.patch({ captureOpen: false })}
        />
      )}{" "}
      {ui.settingsOpen && (
        <SettingsDialog
          workspace={workspace}
          data={data}
          onClose={() => ui.patch({ settingsOpen: false })}
          onKey={(key) => {
            ui.patch({ settingsOpen: false });
            setRecoveryKey(key);
          }}
          onCreate={() => {
            ui.patch({ settingsOpen: false });
            setCreateOpen(true);
          }}
          onRecover={() => {
            ui.patch({ settingsOpen: false });
            setRecoverOpen(true);
          }}
        />
      )}
    </div>
  );
}
