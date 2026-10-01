"use client";
import { useState, useMemo, useId, memo } from "react";
import {
  Inbox,
  Plus,
  FileText,
  Columns3,
  ChevronRight,
  Star,
  CloudOff,
  Check,
  PenLine,
  Users,
} from "lucide-react";
import type { LocalPage } from "@/lib/database";
import { useMobile, type WorkspaceData } from "@/lib/hooks";
import { availablePages } from "@/lib/search";
import { useUiStore } from "@/lib/ui-store";
import { DesignIcon } from "./design-icon";
import { SyncStatus } from "./sync-status";
export function Logo() {
  return (
    <span className="brand-mark">
      <DesignIcon name="logo" />
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
    mobile = useMobile(),
    [switcher, setSwitcher] = useState(false),
    [pagesExpanded, setPagesExpanded] = useState(true),
    pagesId = useId(),
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
        className={`sidebar ${ui.sidebarOpen ? "mobile-open" : ""} ${ui.sidebarCollapsed ? "desktop-collapsed" : ""}`}
        aria-label="Workspace 탐색"
        aria-hidden={mobile ? !ui.sidebarOpen : ui.sidebarCollapsed}
        inert={mobile ? !ui.sidebarOpen : ui.sidebarCollapsed}
      >
        <div className="brand">
          <Logo />
          <strong>ZeroNote</strong>
          <SyncStatus data={data} />
          <button
            className="icon-button sidebar-toggle"
            aria-label="Sidebar 닫기"
            onClick={() => {
              ui.patch(
                mobile ? { sidebarOpen: false } : { sidebarCollapsed: true },
              );
              requestAnimationFrame(() =>
                document
                  .querySelector<HTMLButtonElement>(
                    '[aria-label="Sidebar 열기"]',
                  )
                  ?.focus(),
              );
            }}
          >
            <DesignIcon name="sidebar-toggle" />
          </button>
        </div>
        <nav className="sidebar-primary" aria-label="검색">
          <button onClick={() => ui.patch({ searchOpen: true })}>
            <DesignIcon name="search" />
            <span>Search</span>
            <kbd>⌘ K</kbd>
          </button>
        </nav>
        <div className="workspace-switcher">
          <button
            className="workspace-switcher-button"
            aria-label="Workspace 전환"
            aria-expanded={switcher}
            onClick={() => setSwitcher(!switcher)}
          >
            <span className="workspace-avatar">
              {workspace?.name.slice(0, 1) ?? "Z"}
            </span>
            <span>{workspace?.name ?? "나의 Workspace"}</span>
            <DesignIcon name="chevron-down" />
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
              <hr />
              <button
                onClick={() => {
                  setSwitcher(false);
                  ui.patch({ captureOpen: true });
                }}
              >
                <PenLine size={15} />
                Quick Capture
              </button>
              {inbox && (
                <button
                  onClick={() => {
                    setSwitcher(false);
                    ui.select(inbox.workspaceId, inbox.id);
                  }}
                >
                  <Inbox size={15} />
                  Inbox
                </button>
              )}
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
            <button
              className="section-heading section-toggle"
              aria-expanded={pagesExpanded}
              aria-controls={pagesId}
              onClick={() => setPagesExpanded(!pagesExpanded)}
            >
              <span>Pages</span>
              <span className={pagesExpanded ? "" : "rotate-closed"}>
                <DesignIcon name="pages-chevron" />
              </span>
            </button>
            <div id={pagesId} hidden={!pagesExpanded}>
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
              {owner && (
                <div className="relative">
                  <button
                    className="tree-row sidebar-new-page"
                    aria-label="새 Page 만들기"
                    aria-expanded={newMenu}
                    onClick={() => setNewMenu(!newMenu)}
                  >
                    <DesignIcon name="plus" />
                    <span>새 페이지</span>
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
                        <Columns3 size={14} />새 To-Do
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
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
            <DesignIcon name="trash" />
            Trash
          </button>
          <button onClick={() => ui.patch({ settingsOpen: true })}>
            <DesignIcon name="settings" />
            Settings
          </button>
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
    );
  if (level > 30) return null;
  return (
    <div>
      <div
        className={`tree-row ${active ? "active" : ""}`}
        style={{ paddingLeft: 20 + level * 14 }}
      >
        {children.length > 0 && (
          <button
            className={`tree-chevron ${expanded ? "expanded" : ""}`}
            aria-label={`${page.title} 하위 Page ${expanded ? "접기" : "펼치기"}`}
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight size={13} />
          </button>
        )}
        <button
          className="tree-page"
          onClick={() => select(page.workspaceId, page.id)}
        >
          <DesignIcon name={page.kind === "database" ? "project" : "page"} />
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
