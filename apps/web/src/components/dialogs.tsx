"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import {
  Search,
  FileText,
  Columns3,
  ArrowUpRight,
  Copy,
  Check,
  Download,
  KeyRound,
  Monitor,
  Sun,
  Moon,
  Laptop,
  Upload,
  Trash2,
  Plus,
} from "lucide-react";
import { createRecoveryKey } from "@zeronote/shared";
import { Dialog } from "./primitives";
import { TransferDialog } from "./transfer-dialog";
import { PublicWorkspaceDialog } from "./public-share-manager";
import { StorageDialog } from "./storage-dialog";
import { useUiStore } from "@/lib/ui-store";
import type { WorkspaceData } from "@/lib/hooks";
import { database, errorMessage, type LocalWorkspace } from "@/lib/database";
import {
  createLocalWorkspace,
  captureNote,
  exportWorkspace,
  importWorkspace,
  downloadJson,
  createLocalPage,
} from "@/lib/workspace";
import { availablePages } from "@/lib/search";
import { SearchFilters } from "./search-filters";
import { buildSearchQuery, EMPTY_SEARCH_FILTERS } from "@/lib/advanced-search";
import { useSearch } from "@/lib/use-search";
import { deleteLocalWorkspace } from "@/lib/workspace";
import { api, authenticate, getDevice } from "@/lib/api";
import { requestSync, synchronize } from "@/lib/sync";
import {
  filterWorkspaceCommands,
  recordRecentCommand,
  parseCommandNavigation,
  type WorkspaceCommand,
} from "@/lib/commands";

import {
  clientBetaRequired,
  redeemBetaCode,
  refreshBetaStatus,
} from "@/lib/beta";

export function CreateWorkspaceDialog({
  onClose,
  onKey,
}: {
  onClose: () => void;
  onKey: (key: string) => void;
}) {
  const [code, setCode] = useState(""),
    [name, setName] = useState("내 Workspace"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Workspace 만들기" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          void (async () => {
            if (code.trim()) await redeemBetaCode(code.trim());
            return createLocalWorkspace(name.trim());
          })()
            .then(({ key }) => {
              requestSync();
              onClose();
              onKey(key);
            })
            .catch((problem) => setError(errorMessage(problem)))
            .finally(() => setBusy(false));
        }}
      >
        <p className="dialog-description">
          문서와 프로젝트를 담을 공간의 이름을 정해주세요.
        </p>
        {clientBetaRequired && (
          <label className="field-label">
            Beta 초대코드
            <input
              aria-label="Beta 초대코드"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="ZNB1-… · 기존 참여자는 생략"
            />
          </label>
        )}
        <label className="field-label">
          Workspace 이름
          <input
            aria-label="Workspace 이름"
            value={name}
            maxLength={160}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        {error && <div className="inline-warning">{error}</div>}
        <div className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            취소
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || !name.trim()}
          >
            {busy ? "만드는 중…" : "Workspace 만들기"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function RecoveryKeyDialog({
  value,
  onClose,
}: {
  value: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Recovery Key를 보관해주세요" onClose={onClose}>
      <div className="key-intro">
        <KeyRound size={24} />
        <p>
          다른 기기에서 이 Workspace를 다시 열 때 사용합니다. 이 키를 가진
          사람은 Workspace 전체의 소유권을 복구할 수 있습니다.
        </p>
      </div>
      <div className="recovery-key" data-testid="recovery-key">
        {value}
      </div>
      <p className="field-help">
        안전한 곳에 보관하고, 다른 사람에게는 Page 초대 링크를 보내세요.
      </p>
      <div className="button-row">
        <button
          className="button"
          onClick={() => {
            void navigator.clipboard
              .writeText(value)
              .then(() => setCopied(true))
              .catch((problem) => setError(errorMessage(problem)));
          }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
          {copied ? "복사됨" : "키 복사"}
        </button>
        <button
          className="button"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([value], { type: "text/plain" }),
            );
            const a = document.createElement("a");
            a.href = url;
            a.download = "zeronote-recovery-key.txt";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          <Download size={15} />
          다운로드
        </button>
      </div>
      {error && <div className="inline-warning">{error}</div>}
      <div className="dialog-footer">
        <button className="button button-primary" onClick={onClose}>
          계속하기
        </button>
      </div>
    </Dialog>
  );
}
export function RecoverWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const [key, setKey] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  return (
    <Dialog title="Workspace 복구" onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          void (async () => {
            await authenticate();
            const workspace = await api<{ id: string }>(
              "/workspaces/recover",
              "POST",
              { key },
            );
            await refreshBetaStatus();
            await synchronize();
            const pages = await database.pages
              .where("workspaceId")
              .equals(workspace.id)
              .toArray();
            useUiStore
              .getState()
              .select(
                workspace.id,
                pages
                  .filter(
                    (page) =>
                      !page.isInbox &&
                      page.kind === "document" &&
                      !page.deletedAt,
                  )
                  .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]
                  ?.id ?? null,
              );
            onClose();
          })()
            .catch((problem) => setError(errorMessage(problem)))
            .finally(() => setBusy(false));
        }}
      >
        <p className="dialog-description">
          보관한 Recovery Key로 서버에 동기화된 문서와 프로젝트를 가져옵니다.
        </p>
        <label className="field-label">
          Recovery Key
          <textarea
            aria-label="Recovery Key"
            placeholder="ZN1-…"
            value={key}
            spellCheck={false}
            onChange={(event) => setKey(event.target.value)}
          />
        </label>
        {error && <div className="inline-warning">{error}</div>}
        <div className="dialog-footer">
          <button
            className="button button-primary"
            disabled={busy || !key.trim()}
          >
            {busy ? "복구 중…" : "Workspace 복구"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function SearchDialog({
  data,
  onClose,
}: {
  data: WorkspaceData;
  onClose: () => void;
}) {
  const ui = useUiStore(),
    [query, setQuery] = useState(""),
    [active, setActive] = useState(0),
    [recent, setRecent] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [filters, setFilters] = useState(() => ({
      ...EMPTY_SEARCH_FILTERS,
      workspaceId: ui.workspaceId ?? "",
    })),
    [filtersOpen, setFiltersOpen] = useState(false),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void database.preferences
      .get("recent-commands")
      .then((record) => {
        if (!record) return;
        const value: unknown = JSON.parse(record.value);
        if (Array.isArray(value))
          setRecent(
            value
              .filter((item): item is string => typeof item === "string")
              .slice(0, 8),
          );
      })
      .catch((error) => ui.patch({ notice: errorMessage(error) }));
  }, []);
  const workspacePages = data.pages.filter(
      (page) =>
        page.workspaceId === ui.workspaceId &&
        !page.accessLost &&
        !page.deletedAt,
    ),
    owner = workspacePages.some((page) => page.role === "owner"),
    navigation = parseCommandNavigation(query),
    commandMode = query.startsWith(">") && navigation === null,
    commands = commandMode
      ? filterWorkspaceCommands(
          query,
          {
            canCreate: owner,
            hasWorkspace: !!ui.workspaceId,
            hasInbox: workspacePages.some((page) => page.isInbox),
            online: ui.syncState !== "offline",
          },
          recent,
        )
      : [];
  const parsed = useMemo(() => {
    if (commandMode) return { query: null, error: null };
    try {
      return {
        query: buildSearchQuery(navigation ?? query, filters),
        error: null,
      };
    } catch (problem) {
      return {
        query: null,
        error:
          problem instanceof Error && problem.name === "SearchSyntaxError"
            ? problem.message
            : "검색 조건을 확인해주세요. 최대 32개의 조건을 사용할 수 있습니다.",
      };
    }
  }, [query, commandMode, navigation, filters]);
  const search = useSearch(data, parsed.query),
    results = search.hits;
  const runCommand = async (command: WorkspaceCommand) => {
    if (busy) return;
    setBusy(true);
    try {
      if (command.id === "page:open") {
        const history = recordRecentCommand(recent, command.id);
        await database.preferences.put({
          id: "recent-commands",
          value: JSON.stringify(history),
        });
        setRecent(history);
        setQuery(">open ");
        setActive(0);
        input.current?.focus();
        return;
      }
      if (
        ["page:create", "database:create", "task:create"].includes(command.id)
      ) {
        if (!owner || !ui.workspaceId)
          throw new Error("Workspace Owner 권한이 필요합니다.");
        const kind = command.id === "page:create" ? "document" : "database";
        const created = await createLocalPage(
          ui.workspaceId,
          kind === "document"
            ? "제목 없음"
            : command.id === "task:create"
              ? "새 To-Do"
              : "새 Database",
          kind,
          null,
          false,
          command.id === "database:create" ? "generic" : "task",
        );
        ui.select(created.workspaceId, created.id);
        requestSync();
      } else if (command.id.startsWith("theme:")) {
        const theme =
          command.id === "theme:light"
            ? "light"
            : command.id === "theme:dark"
              ? "dark"
              : "system";
        await database.preferences.put({ id: "theme", value: theme });
        ui.patch({ theme });
      } else if (command.id === "inbox:open") {
        const inbox = workspacePages.find((page) => page.isInbox);
        if (inbox) ui.select(inbox.workspaceId, inbox.id);
      } else if (command.id === "sync:run") requestSync();
      const history = recordRecentCommand(recent, command.id);
      await database.preferences.put({
        id: "recent-commands",
        value: JSON.stringify(history),
      });
      setRecent(history);
      onClose();
      if (command.id === "capture:open") ui.patch({ captureOpen: true });
      if (command.id === "settings:open") ui.patch({ settingsOpen: true });
    } catch (error) {
      ui.patch({ notice: errorMessage(error) });
    } finally {
      setBusy(false);
    }
  };
  const select = (index: number) => {
    if (commandMode) {
      const command = commands[index];
      if (command) void runCommand(command);
      return;
    }
    const result = results[index];
    if (result) {
      const open = () => {
        ui.select(result.workspaceId, result.pageId, result.rowId);
        onClose();
      };
      if (navigation !== null) {
        const history = recordRecentCommand(recent, "page:open");
        void database.preferences
          .put({ id: "recent-commands", value: JSON.stringify(history) })
          .then(open)
          .catch((error) => ui.patch({ notice: errorMessage(error) }));
      } else open();
    }
  };
  return (
    <Dialog title="Search" onClose={onClose} wide>
      <div className="search-input">
        <Search size={20} />
        <input
          ref={input}
          aria-label="Workspace 검색"
          placeholder="Page 검색 또는 > 명령"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) =>
                Math.max(
                  0,
                  Math.min(
                    index + 1,
                    (commandMode ? commands.length : results.length) - 1,
                  ),
                ),
              );
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            }
            if (event.key === "Enter") {
              event.preventDefault();
              select(active);
            }
          }}
        />
      </div>
      {!commandMode && (
        <>
          <div className="search-tools">
            <button
              className="text-button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              필터
            </button>
            <span className="search-scope" role="status">
              {search.server
                ? "접근 가능한 전체 문서"
                : search.loading
                  ? "전체 검색 중 · 이 기기 결과 표시"
                  : `이 기기의 본문 ${search.cachedPages}개와 Page 제목`}
            </span>
          </div>
          {filtersOpen && (
            <SearchFilters
              data={data}
              value={filters}
              onChange={(next) => {
                setFilters(next);
                setActive(0);
              }}
            />
          )}
          {parsed.error && (
            <p className="inline-warning" role="alert">
              {parsed.error}
            </p>
          )}
          {search.error && (
            <p className="search-scope" role="status">
              전체 검색을 완료하지 못했습니다. 이 기기의 결과를 표시합니다.{" "}
              {search.error}
            </p>
          )}
          {!!search.unavailableProperties && (
            <p className="search-scope">
              읽거나 계산할 수 없는 속성은 결과에서 제외했습니다.
            </p>
          )}
        </>
      )}
      <div className="search-results">
        <div className="menu-caption">
          {commandMode
            ? recent.length && query.trim() === ">"
              ? "최근 명령"
              : "명령"
            : query
              ? "검색 결과"
              : "최근 Page"}
        </div>
        {commands.map((command, index) => (
          <button
            key={command.id}
            disabled={busy}
            className={active === index ? "selected" : ""}
            onClick={() => select(index)}
          >
            <ArrowUpRight size={17} />
            <span>
              <strong>{command.label}</strong>
            </span>
          </button>
        ))}
        {results.map((hit, index) => (
          <button
            className={active === index ? "selected" : ""}
            key={`${hit.pageId}:${hit.rowId ?? ""}`}
            onClick={() => select(index)}
          >
            {hit.kind === "database" ? (
              <Columns3 size={17} />
            ) : (
              <FileText size={17} />
            )}
            <span>
              <strong>
                {hit.title}
                {hit.fuzzy && <em className="search-fuzzy">오타 후보</em>}
              </strong>
              <small>
                {hit.rowId ? `${hit.pageTitle} · ` : ""}
                {hit.workspaceName}
              </small>
              {!!query && <small>{hit.snippet}</small>}
            </span>
            <ArrowUpRight size={15} />
          </button>
        ))}
        {!results.length && !commands.length && (
          <div className="panel-empty">
            <p>검색 결과가 없습니다.</p>
          </div>
        )}
      </div>
      <div className="search-footer">
        <button
          className="text-button"
          onClick={() => {
            setQuery(">");
            setActive(0);
            input.current?.focus();
          }}
        >
          명령 보기
        </button>
        <span>↑ ↓ 선택</span>
        <span>Enter 열기</span>
        <span>Esc 닫기</span>
        {!commandMode && (
          <details className="search-operator-help">
            <summary>검색 문법</summary>
            <p>
              "정확한 구문" -제외어 type:page tag:설계 workspace:"이름"
              after:2026-10-01 before:2026-11-01 prop:Points:gte:5
            </p>
            <p>
              날짜는 UTC 수정일 기준입니다. after는 해당 날짜 이상, before는
              해당 날짜 미만입니다. 속성 조건은 Row를 검색합니다.
            </p>
          </details>
        )}
      </div>
    </Dialog>
  );
}
export function CaptureDialog({
  data,
  onClose,
}: {
  data: WorkspaceData;
  onClose: () => void;
}) {
  const ui = useUiStore(),
    workspaceId = data.pages.some(
      (page) =>
        page.workspaceId === ui.workspaceId &&
        page.isInbox &&
        page.role === "owner",
    )
      ? ui.workspaceId
      : data.pages.find((page) => page.isInbox && page.role === "owner")
          ?.workspaceId;
  const pages = data.pages.filter(
    (page) =>
      page.workspaceId === workspaceId &&
      page.kind === "document" &&
      !page.deletedAt &&
      !page.accessLost &&
      page.role === "owner",
  );
  const [destination, setDestination] = useState(
      pages.find((page) => page.isInbox)?.id ?? pages[0]?.id ?? "",
    ),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!workspaceId || !destination || !text.trim()) return;
    setBusy(true);
    try {
      await captureNote(workspaceId, text, destination);
      requestSync();
      onClose();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Quick Capture" onClose={onClose}>
      <textarea
        className="capture-input"
        aria-label="빠른 메모"
        placeholder="메모를 입력하세요"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {!workspaceId && (
        <div className="inline-warning">
          개인 Workspace를 만든 뒤 빠른 메모를 남길 수 있습니다.
        </div>
      )}
      {error && <div className="inline-warning">{error}</div>}
      <div className="capture-footer">
        <label>
          <span>저장 위치</span>
          <select
            aria-label="Capture 저장 위치"
            value={destination}
            onChange={(event) => setDestination(event.target.value)}
          >
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.isInbox ? "Inbox" : page.title}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button-primary"
          disabled={busy || !text.trim() || !workspaceId}
          onClick={() => {
            void submit();
          }}
        >
          저장 <kbd>⌘ ↵</kbd>
        </button>
      </div>
    </Dialog>
  );
}
interface WorkspaceDevice {
  id: string;
  name: string;
  identityId: string;
  revoked: boolean;
}
export function SettingsDialog({
  workspace,
  data,
  onClose,
  onKey,
  onCreate,
  onRecover,
}: {
  workspace: LocalWorkspace | null;
  data: WorkspaceData;
  onClose: () => void;
  onKey: (key: string) => void;
  onCreate: () => void;
  onRecover: () => void;
}) {
  const ui = useUiStore(),
    [devices, setDevices] = useState<WorkspaceDevice[]>([]),
    [deviceId, setDeviceId] = useState(""),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false),
    [transferOpen, setTransferOpen] = useState(false),
    [storageOpen, setStorageOpen] = useState(false),
    [publicOpen, setPublicOpen] = useState(false),
    [deleteName, setDeleteName] = useState("");
  const owner =
    !!workspace &&
    data.pages.some(
      (page) => page.workspaceId === workspace.id && page.role === "owner",
    );
  const loadDevices = async () => {
    try {
      const device = await getDevice();
      setDeviceId(device.id);
      if (owner && workspace && !workspace.pendingCreation && navigator.onLine)
        setDevices(
          await api<WorkspaceDevice[]>(`/workspaces/${workspace.id}/devices`),
        );
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  useEffect(() => {
    void loadDevices();
  }, [workspace?.id]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!workspace) return;
    await api(`/workspaces/${workspace.id}`, "DELETE", { name: deleteName });
    await deleteLocalWorkspace(workspace.id);
    const next = data.workspaces.find((item) => item.id !== workspace.id);
    ui.patch({
      workspaceId: next?.id ?? null,
      pageId: null,
      settingsOpen: false,
    });
  };
  if (publicOpen && workspace)
    return (
      <PublicWorkspaceDialog
        key={workspace.id}
        workspaceId={workspace.id}
        pages={availablePages(data.pages).filter(
          (page) =>
            page.workspaceId === workspace.id &&
            !page.deletedAt &&
            !page.accessLost &&
            page.role === "owner",
        )}
        onClose={() => setPublicOpen(false)}
      />
    );
  if (storageOpen && workspace)
    return (
      <StorageDialog
        key={workspace.id}
        workspace={workspace}
        owner={owner}
        onClose={() => setStorageOpen(false)}
      />
    );
  if (transferOpen && workspace)
    return (
      <TransferDialog
        workspaceId={workspace.id}
        onClose={() => setTransferOpen(false)}
        onKey={onKey}
      />
    );
  return (
    <Dialog title="Settings" onClose={onClose} wide>
      <div className="settings-content">
        <section>
          <h3>화면</h3>
          <div className="theme-options">
            {(
              [
                { value: "light", label: "Light", icon: Sun },
                { value: "dark", label: "Dark", icon: Moon },
                { value: "system", label: "System", icon: Laptop },
              ] as const
            ).map((theme) => (
              <button
                className={ui.theme === theme.value ? "active" : ""}
                key={theme.value}
                onClick={() => {
                  ui.patch({ theme: theme.value });
                  void database.preferences
                    .put({ id: "theme", value: theme.value })
                    .catch((problem) => setError(errorMessage(problem)));
                }}
              >
                <theme.icon size={18} />
                {theme.label}
              </button>
            ))}
          </div>
        </section>
        <section>
          <h3>Workspace</h3>
          <div className="settings-row">
            <span>{workspace?.name ?? "Workspace 없음"}</span>
            <div className="button-row">
              <button className="button button-small" onClick={onCreate}>
                <Plus size={14} />새 Workspace
              </button>
              <button className="button button-small" onClick={onRecover}>
                <KeyRound size={14} />
                복구
              </button>
            </div>
          </div>
          {owner && workspace && (
            <div className="settings-row">
              <div>
                <strong>Workspace 공개 공유</strong>
                <p>게시할 Page를 직접 고르고 링크를 관리합니다.</p>
              </div>
              <button
                className="button button-small"
                disabled={workspace.pendingCreation}
                onClick={() => setPublicOpen(true)}
              >
                공개 공유
              </button>
            </div>
          )}
          {owner && workspace && (
            <div className="settings-row">
              <div>
                <strong>Recovery Key 재발급</strong>
                <p>새 키를 만들면 이전 키는 사용할 수 없습니다.</p>
              </div>
              <button
                className="button button-small"
                disabled={
                  busy || ui.syncState !== "online" || workspace.pendingCreation
                }
                onClick={() => {
                  void run(async () => {
                    const key = createRecoveryKey();
                    await api(`/workspaces/${workspace.id}/recovery`, "POST", {
                      key,
                    });
                    onKey(key);
                  });
                }}
              >
                재발급
              </button>
            </div>
          )}
        </section>
        {workspace && (
          <section>
            <h3>데이터</h3>
            <div className="settings-row">
              <div>
                <strong>파일 저장 공간</strong>
                <p>
                  서버 사용량, 오프라인 사본과 사용하지 않는 파일을 관리합니다.
                </p>
              </div>
              <button
                className="button button-small"
                onClick={() => setStorageOpen(true)}
              >
                저장 공간
              </button>
            </div>
            <div className="settings-row">
              <div>
                <strong>다른 형식으로 이전</strong>
                <p>Markdown·HTML·ZIP·암호화 백업과 Notion·Obsidian 가져오기</p>
              </div>
              <button
                className="button button-small"
                onClick={() => setTransferOpen(true)}
              >
                데이터 이전
              </button>
            </div>
            <div className="settings-row">
              <div>
                <strong>Workspace Export</strong>
                <p>
                  문서와 Task를 파일로 보관합니다. 인증 정보는 포함하지
                  않습니다.
                </p>
              </div>
              <button
                className="button button-small"
                disabled={busy}
                onClick={() => {
                  void run(async () => {
                    downloadJson(
                      await exportWorkspace(workspace.id),
                      `${workspace.name}-zeronote.json`,
                    );
                  });
                }}
              >
                <Download size={14} />
                Export
              </button>
            </div>
            <div className="settings-row">
              <div>
                <strong>Import</strong>
                <p>Export 파일을 새 Workspace로 가져옵니다.</p>
              </div>
              <label className="button button-small import-label">
                <Upload size={14} />
                Import
                <input
                  type="file"
                  accept="application/json,.json"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                      void run(async () => {
                        if (file.size > 50 * 1024 * 1024)
                          throw new Error("50MB 이하 파일을 가져와주세요.");
                        const input: unknown = JSON.parse(await file.text());
                        const result = await importWorkspace(input);
                        requestSync();
                        onKey(result.key);
                      });
                    }
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </section>
        )}
        {owner && workspace && (
          <section>
            <h3>연결된 기기</h3>
            {devices
              .filter((device) => !device.revoked)
              .map((device) => (
                <div className="settings-row" key={device.id}>
                  <span className="device-name">
                    <Monitor size={16} />
                    {device.name}
                    {device.id === deviceId && <small>현재 기기</small>}
                  </span>
                  {device.id !== deviceId && (
                    <button
                      className="text-button danger-text"
                      disabled={busy}
                      onClick={() => {
                        void run(async () => {
                          await api(
                            `/workspaces/${workspace.id}/devices/${device.id}`,
                            "DELETE",
                          );
                          await loadDevices();
                        });
                      }}
                    >
                      철회
                    </button>
                  )}
                </div>
              ))}
          </section>
        )}
        {owner && workspace && (
          <section className="danger-section">
            <h3>Workspace 삭제</h3>
            {!confirmDelete ? (
              <button
                className="button danger-text"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 size={14} />
                Workspace 삭제
              </button>
            ) : (
              <>
                <p>
                  서버의 Workspace와 이 기기의 작업 데이터를 삭제합니다.
                  계속하려면 <strong>{workspace.name}</strong>을 입력해주세요.
                </p>
                <input
                  aria-label="삭제할 Workspace 이름"
                  value={deleteName}
                  onChange={(event) => setDeleteName(event.target.value)}
                />
                <button
                  className="button button-danger"
                  disabled={
                    busy ||
                    deleteName !== workspace.name ||
                    ui.syncState !== "online"
                  }
                  onClick={() => {
                    void run(remove);
                  }}
                >
                  삭제 확인
                </button>
              </>
            )}
          </section>
        )}
        {error && <div className="inline-warning">{error}</div>}
      </div>
    </Dialog>
  );
}
