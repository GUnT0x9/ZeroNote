"use client";
import { useState, useMemo, memo } from "react";
import {
  ChevronsUpDown,
  Search,
  Inbox,
  Plus,
  FileText,
  Columns3,
  ChevronRight,
  Star,
  Settings,
  Trash2,
  Cloud,
  CloudOff,
  Check,
  PenLine,
  Users,
} from "lucide-react";
import type { LocalPage } from "@/lib/database";
import type { WorkspaceData } from "@/lib/hooks";
import { availablePages } from "@/lib/search";
import { useUiStore } from "@/lib/ui-store";
import { publicEnvironment } from "@/lib/env";
export function Logo() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="2.5"
          width="18"
          height="19"
          rx="4"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <path
          d="M8 8h8l-8 8h8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
export function Sidebar({
  data,
  onNew,
  onCreate,
  onTrash,
  trashOpen,
}: {
  data: WorkspaceData;
  onNew: (kind: "document" | "database", parentId?: string | null) => void;
  onCreate: () => void;
  onTrash: () => void;
  trashOpen: boolean;
}) {
  const ui = useUiStore(),
    [switcher, setSwitcher] = useState(false),
    [newMenu, setNewMenu] = useState(false),
    workspace = data.workspaces.find((item) => item.id === ui.workspaceId),
    pages = useMemo(
      () => [
        ...availablePages(data.pages).filter(
          (page) => page.workspaceId === ui.workspaceId,
        ),
        ...data.pages.filter(
          (page) =>
            page.workspaceId === ui.workspaceId &&
            page.accessLost &&
            !page.deletedAt,
        ),
      ],
      [data.pages, ui.workspaceId],
    ),
    inbox = pages.find((page) => page.isInbox),
    owner = pages.some((page) => page.role === "owner" && !page.accessLost);
  const preservedPages = useMemo(() => {
    const ids = new Set(
      data.documents
        .filter((record) => record.state === "preserved")
        .map((record) => record.id),
    );
    return data.pages.filter(
      (page) =>
        page.workspaceId === ui.workspaceId &&
        (page.accessLost || ids.has(page.id)),
    );
  }, [data.documents, data.pages, ui.workspaceId]);
  return (
    <>
      <div
        className={`sidebar-scrim ${ui.sidebarOpen ? "visible" : ""}`}
        onClick={() => ui.patch({ sidebarOpen: false })}
      />
      <aside
        className={`sidebar ${ui.sidebarOpen ? "mobile-open" : ""}`}
        aria-label="Workspace 탐색"
      >
        <div className="brand">
          <Logo />
          <strong>ZeroNote</strong>
          <span
            className="alpha-badge"
            aria-label={publicEnvironment.betaRequired ? "Beta" : "Alpha"}
          >
            {publicEnvironment.betaRequired ? "β" : "α"}
          </span>
        </div>
        <div className="workspace-switcher">
          <button
            className="workspace-switcher-button"
            onClick={() => setSwitcher(!switcher)}
          >
            <span className="workspace-avatar">
              {workspace?.name.slice(0, 1) ?? "Z"}
            </span>
            <span>{workspace?.name ?? "나의 Workspace"}</span>
            <ChevronsUpDown size={14} />
          </button>
          {switcher && (
            <div className="workspace-menu">
              {data.workspaces.map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    ui.select(
                      item.id,
                      data.pages.find(
                        (page) =>
                          page.workspaceId === item.id &&
                          !page.isInbox &&
                          !page.deletedAt,
                      )?.id ?? null,
                    );
                    setSwitcher(false);
                  }}
                >
                  <span className="workspace-avatar small-avatar">
                    {item.name.slice(0, 1)}
                  </span>
                  {item.name}
                  {item.id === ui.workspaceId && <Check size={13} />}
                </button>
              ))}
              <button
                onClick={() => {
                  setSwitcher(false);
                  onCreate();
                }}
              >
                <Plus size={15} />
                Workspace 만들기
              </button>
            </div>
          )}
        </div>
        <nav className="sidebar-primary">
          <button onClick={() => ui.patch({ searchOpen: true })}>
            <Search size={17} />
            <span>Search</span>
            <kbd>⌘ K</kbd>
          </button>
          <button onClick={() => ui.patch({ captureOpen: true })}>
            <PenLine size={17} />
            <span>Quick Capture</span>
          </button>
          {inbox && (
            <button
              className={ui.pageId === inbox.id ? "active" : ""}
              onClick={() => ui.select(inbox.workspaceId, inbox.id)}
            >
              <Inbox size={17} />
              <span>Inbox</span>
              <span className="nav-count">
                {pages.filter((page) => page.parentId === inbox.id).length ||
                  ""}
              </span>
            </button>
          )}
        </nav>
        <div className="sidebar-scroll">
          {pages.some((page) => page.favorite) && (
            <section className="sidebar-section">
              <div className="section-heading">
                <span>Favorites</span>
              </div>
              {pages
                .filter((page) => page.favorite)
                .map((page) => (
                  <button
                    className={`tree-row ${ui.pageId === page.id ? "active" : ""}`}
                    key={page.id}
                    onClick={() => ui.select(page.workspaceId, page.id)}
                  >
                    <Star size={14} />
                    <span>{page.title}</span>
                  </button>
                ))}
            </section>
          )}
          <section className="sidebar-section">
            <div className="section-heading">
              <span>Pages</span>
              {owner && (
                <div className="relative">
                  <button
                    className="icon-button"
                    aria-label="새 Page 만들기"
                    onClick={() => setNewMenu(!newMenu)}
                  >
                    <Plus size={14} />
                  </button>
                  {newMenu && (
                    <div className="dropdown-menu sidebar-new-menu">
                      <button
                        onClick={() => {
                          onNew("document");
                          setNewMenu(false);
                        }}
                      >
                        <FileText size={14} />새 문서
                      </button>
                      <button
                        onClick={() => {
                          onNew("database");
                          setNewMenu(false);
                        }}
                      >
                        <Columns3 size={14} />새 프로젝트
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
            {pages
              .filter(
                (page) =>
                  (!page.parentId ||
                    !pages.some((parent) => parent.id === page.parentId)) &&
                  !page.isInbox &&
                  !page.accessLost,
              )
              .map((page) => (
                <PageTree
                  key={page.id}
                  page={page}
                  pages={pages}
                  onNew={onNew}
                  level={0}
                />
              ))}
            {!pages.length && (
              <div className="sidebar-empty">
                Workspace를 만들고
                <br />첫 문서를 시작하세요.
              </div>
            )}
          </section>
          {preservedPages.length > 0 && (
            <section className="sidebar-section">
              <div className="section-heading">
                <span>로컬 보존본</span>
              </div>
              {preservedPages.map((page) => (
                <button
                  className="tree-row"
                  key={page.id}
                  onClick={() => ui.select(page.workspaceId, page.id)}
                >
                  <CloudOff size={14} />
                  <span>{page.title}</span>
                </button>
              ))}
            </section>
          )}
          {!owner && pages.length > 0 && (
            <div className="shared-note">
              <Users size={14} />
              <span>공유받은 Workspace</span>
            </div>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className={trashOpen ? "active" : ""} onClick={onTrash}>
            <Trash2 size={16} />
            Trash
          </button>
          <button onClick={() => ui.patch({ settingsOpen: true })}>
            <Settings size={16} />
            Settings
          </button>
          <div className="connection-state">
            {ui.syncState === "offline" ? (
              <CloudOff size={13} />
            ) : (
              <Cloud size={13} />
            )}
            <span
              title={
                ui.offlineReady ? "Offline 준비됨" : "Offline 화면 준비 중"
              }
            >
              {ui.syncState === "online"
                ? "연결됨"
                : ui.syncState === "offline"
                  ? "Offline"
                  : "연결 확인 중"}
            </span>
            <span className={`connection-dot ${ui.syncState}`} />
          </div>
        </div>
      </aside>
    </>
  );
}
const PageTree = memo(function PageTree({
  page,
  pages,
  onNew,
  level,
}: {
  page: LocalPage;
  pages: LocalPage[];
  onNew: (kind: "document" | "database", parentId?: string | null) => void;
  level: number;
}) {
  const active = useUiStore((state) => state.pageId === page.id),
    select = useUiStore((state) => state.select),
    [expanded, setExpanded] = useState(false),
    children = pages.filter(
      (item) => item.parentId === page.id && !item.accessLost,
    ),
    Icon = page.kind === "database" ? Columns3 : FileText;
  if (level > 30) return null;
  return (
    <div>
      <div
        className={`tree-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 10 + level * 14 }}
      >
        <button
          className={`tree-chevron ${expanded ? "expanded" : ""}`}
          aria-label={`${page.title} 하위 Page ${expanded ? "접기" : "펼치기"}`}
          onClick={() => setExpanded(!expanded)}
        >
          {children.length ? <ChevronRight size={13} /> : <span />}
        </button>
        <button
          className="tree-page"
          onClick={() => select(page.workspaceId, page.id)}
        >
          <Icon size={15} />
          <span>{page.title || "제목 없음"}</span>
        </button>
        {page.role === "owner" && (
          <button
            className="tree-add icon-button"
            aria-label={`${page.title} 하위 Page 만들기`}
            onClick={() => {
              setExpanded(true);
              onNew("document", page.id);
            }}
          >
            <Plus size={13} />
          </button>
        )}
      </div>
      {expanded &&
        children.map((child) => (
          <PageTree
            key={child.id}
            page={child}
            pages={pages}
            onNew={onNew}
            level={level + 1}
          />
        ))}
    </div>
  );
});
