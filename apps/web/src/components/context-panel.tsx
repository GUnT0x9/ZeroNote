"use client";
import { useEffect, useState } from "react";
import {
  History,
  X,
  MessageSquare,
  Link2,
  Share2,
  SlidersHorizontal,
  Copy,
  Check,
  Plus,
  CornerDownRight,
} from "lucide-react";
import {
  CommentSchema,
  canComment,
  canEdit,
  getTaskRows,
  wouldCreateCycle,
  type PageComment,
  type Role,
} from "@zeronote/shared";
import { z } from "zod";
import { useUiStore } from "@/lib/ui-store";
import {
  useLiveValue,
  useDocumentRevision,
  useMobile,
  type WorkspaceData,
} from "@/lib/hooks";
import { database, errorMessage, type LocalPage } from "@/lib/database";
import { api, authenticate } from "@/lib/api";
import { openDocument, type DocumentSession } from "@/lib/documents";
import { requestSync } from "@/lib/sync";
import { changePageStructure } from "@/lib/workspace";
import { DatabaseRowProperties } from "./database-property";

import { PublicShareManager } from "./public-share-manager";
import { HistoryPanel } from "./history-panel";
import { PageTags } from "./page-tags";
import { KnowledgePanel } from "./knowledge-panel";

const PANEL_NAMES = {
  history: "기록",
  comments: "Comments",
  properties: "Properties",
  backlinks: "Backlinks",
  share: "Share",
};
export function ContextPanel({
  page,
  data,
}: {
  page: LocalPage;
  data: WorkspaceData;
}) {
  const ui = useUiStore();
  if (!ui.panel) return null;
  const Icon =
    ui.panel === "history"
      ? History
      : ui.panel === "comments"
        ? MessageSquare
        : ui.panel === "backlinks"
          ? Link2
          : ui.panel === "share"
            ? Share2
            : SlidersHorizontal;
  return (
    <aside className="context-panel" aria-label={PANEL_NAMES[ui.panel]}>
      <div className="context-heading">
        <h2>
          <Icon size={16} />
          {PANEL_NAMES[ui.panel]}
        </h2>
        <button
          className="icon-button"
          aria-label="Context Panel 닫기"
          onClick={() => ui.patch({ panel: null })}
        >
          <X size={17} />
        </button>
      </div>
      {ui.panel === "history" ? (
        <HistoryPanel key={page.id} page={page} data={data} />
      ) : ui.panel === "comments" ? (
        <CommentsPanel key={page.id} page={page} />
      ) : ui.panel === "share" ? (
        <SharePanel key={page.id} page={page} />
      ) : ui.panel === "backlinks" ? (
        <KnowledgePanel key={page.id} page={page} data={data} />
      ) : (
        <PropertiesPanel key={page.id} page={page} data={data} />
      )}
    </aside>
  );
}
function CommentsPanel({ page }: { page: LocalPage }) {
  const ui = useUiStore(),
    [body, setBody] = useState(""),
    [replyTo, setReplyTo] = useState<string | null>(null),
    [showResolved, setShowResolved] = useState(false),
    [error, setError] = useState<string | null>(null);
  const comments = useLiveValue(
    () => database.comments.where("pageId").equals(page.id).toArray(),
    [page.id],
    [] as PageComment[],
  );
  const pending = useLiveValue(
    () =>
      database.pendingComments
        .filter((comment) => comment.payload.pageId === page.id)
        .toArray(),
    [page.id],
    [],
  );
  const load = async () => {
    if (!navigator.onLine || page.accessLost) return;
    try {
      const response = z
        .array(CommentSchema)
        .parse(await api<unknown>(`/pages/${page.id}/comments`));
      await database.comments.bulkPut(response);
      setError(null);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  useEffect(() => {
    void load();
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === page.id) void load();
    };
    window.addEventListener("zeronote:comments-changed", changed);
    return () =>
      window.removeEventListener("zeronote:comments-changed", changed);
  }, [page.id, ui.syncState]);
  const submit = async () => {
    if (!body.trim()) return;
    const id = crypto.randomUUID();
    await database.pendingComments.put({
      id,
      payload: { id, pageId: page.id, parentId: replyTo, body: body.trim() },
      createdAt: new Date().toISOString(),
    });
    setBody("");
    setReplyTo(null);
    requestSync();
  };
  const resolve = async (comment: PageComment) => {
    try {
      await api(`/pages/${page.id}/comments/${comment.id}`, "PATCH", {
        resolved: !comment.resolved,
      });
      await load();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  const roots = comments.filter(
    (comment) => !comment.parentId && (showResolved || !comment.resolved),
  );
  return (
    <div className="context-content comments-panel">
      <div className="panel-description">Page에 대한 의견과 답글입니다.</div>
      <button className="text-button" onClick={() => void load()}>
        새로고침
      </button>
      <label className="check-label">
        <input
          type="checkbox"
          checked={showResolved}
          onChange={(event) => setShowResolved(event.target.checked)}
        />
        해결한 Thread 표시
      </label>
      {error && <div className="inline-warning">{error}</div>}
      <div className="comment-list">
        {!roots.length && !pending.length && (
          <div className="panel-empty">
            <MessageSquare size={25} />
            <p>아직 Comment가 없습니다.</p>
          </div>
        )}
        {roots.map((comment) => (
          <article
            className={`comment-thread ${comment.resolved ? "resolved" : ""}`}
            key={comment.id}
          >
            <CommentBody comment={comment} />
            <div className="comment-actions">
              {canComment(page.role) && (
                <button onClick={() => setReplyTo(comment.id)}>답글</button>
              )}
              {canComment(page.role) && ui.syncState === "online" && (
                <button
                  onClick={() => {
                    void resolve(comment);
                  }}
                >
                  {comment.resolved ? "다시 열기" : "해결"}
                </button>
              )}
            </div>
            {comments
              .filter((reply) => reply.parentId === comment.id)
              .map((reply) => (
                <div className="comment-reply" key={reply.id}>
                  <CornerDownRight size={13} />
                  <CommentBody comment={reply} />
                </div>
              ))}
          </article>
        ))}
        {pending.map((comment) => (
          <article className="comment-thread pending" key={comment.id}>
            <div className="comment-author">
              내 기기 <span>{comment.error ? "전송 실패" : "전송 대기"}</span>
            </div>
            <p>{comment.payload.body}</p>
            {comment.error && (
              <small className="danger-text">{comment.error}</small>
            )}
          </article>
        ))}
      </div>
      {canComment(page.role) && !page.accessLost && (
        <form
          className="comment-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void submit().catch((problem) => setError(errorMessage(problem)));
          }}
        >
          {replyTo && (
            <div className="reply-label">
              Thread에 답글 작성
              <button type="button" onClick={() => setReplyTo(null)}>
                <X size={12} />
              </button>
            </div>
          )}
          <textarea
            aria-label="Comment 내용"
            placeholder="의견을 남겨주세요…"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit().catch((problem) =>
                  setError(errorMessage(problem)),
                );
              }
            }}
          />
          <div>
            <span>
              {ui.syncState === "offline"
                ? "Offline · 연결 후 전송"
                : "⌘ / Ctrl + Enter"}
            </span>
            <button
              className="button button-primary button-small"
              type="submit"
              disabled={!body.trim()}
            >
              보내기
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
function CommentBody({ comment }: { comment: PageComment }) {
  return (
    <div className="comment-body">
      <div className="comment-author">
        <span className="avatar-mini">{comment.authorName.slice(0, 1)}</span>
        {comment.authorName}
        <time>
          {new Date(comment.createdAt).toLocaleDateString("ko-KR", {
            month: "numeric",
            day: "numeric",
            timeZone: "Asia/Seoul",
          })}
        </time>
      </div>
      <p>{comment.body}</p>
    </div>
  );
}
interface ShareData {
  grants: { id: string; name: string; role: string }[];
  invites: {
    id: string;
    role: string;
    expiresAt: string;
    redeemed: boolean;
    revoked: boolean;
  }[];
}
function SharePanel({ page }: { page: LocalPage }) {
  const ui = useUiStore(),
    [role, setRole] = useState<Exclude<Role, "owner">>("editor"),
    [descendants, setDescendants] = useState(false),
    [link, setLink] = useState<string | null>(null),
    [copied, setCopied] = useState(false),
    [data, setData] = useState<ShareData>({ grants: [], invites: [] }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const load = async () => {
    if (page.role !== "owner") return;
    try {
      await authenticate();
      setData(await api<ShareData>(`/pages/${page.id}/share`));
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  useEffect(() => {
    void load();
  }, [page.id, ui.syncState]);
  const create = async () => {
    setBusy(true);
    try {
      await authenticate();
      const result = await api<{ id: string; secret: string }>(
        "/invites",
        "POST",
        { pageId: page.id, role, includeDescendants: descendants },
      );
      setLink(
        `${window.location.origin}/?invite=${result.id}#${result.secret}`,
      );
      setCopied(false);
      await load();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (path: string) => {
    try {
      await api(path, "DELETE");
      await load();
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  if (page.role !== "owner")
    return (
      <div className="context-content panel-description">
        Workspace Owner가 이 Page의 초대를 관리합니다.
      </div>
    );
  return (
    <div className="context-content">
      <div className="panel-description">
        이 Page에 함께할 사람을 초대하세요. 계정은 필요하지 않습니다.
      </div>
      <label className="field-label">
        초대 권한
        <select
          value={role}
          onChange={(event) =>
            setRole(event.target.value as Exclude<Role, "owner">)
          }
        >
          <option value="editor">Editor · 공동 편집</option>
          <option value="commenter">Commenter · 읽기와 Comment</option>
          <option value="viewer">Viewer · 읽기</option>
        </select>
      </label>
      <label className="check-label">
        <input
          type="checkbox"
          checked={descendants}
          onChange={(event) => setDescendants(event.target.checked)}
        />
        하위 Page 포함
      </label>
      <p className="field-help">
        7일 이내 한 번 수락할 수 있습니다. 수락한 기기의 접근은 철회 전까지
        유지됩니다.
      </p>
      <button
        className="button button-primary full-width"
        disabled={busy || ui.syncState !== "online"}
        onClick={() => {
          void create();
        }}
      >
        <Plus size={15} />
        {busy ? "만드는 중…" : "초대 링크 만들기"}
      </button>
      {link && (
        <div className="share-result">
          <label className="field-label">
            초대 링크
            <input readOnly aria-label="초대 링크" value={link} />
          </label>
          <button
            className="button full-width"
            onClick={() => {
              void navigator.clipboard
                .writeText(link)
                .then(() => setCopied(true))
                .catch((problem) => setError(errorMessage(problem)));
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
            {copied ? "복사됨" : "링크 복사"}
          </button>
        </div>
      )}
      {error && <div className="inline-warning">{error}</div>}
      <div className="panel-section">
        <h3>접근 권한</h3>
        {!data.grants.length && (
          <p className="muted small">아직 초대를 수락한 사람이 없습니다.</p>
        )}
        {data.grants.map((grant) => (
          <div className="share-member" key={grant.id}>
            <span className="avatar-mini">{grant.name.slice(0, 1)}</span>
            <div>
              <strong>{grant.name}</strong>
              <small>{grant.role}</small>
            </div>
            <button
              className="text-button danger-text"
              onClick={() => {
                void revoke(`/pages/${page.id}/grants/${grant.id}`);
              }}
            >
              철회
            </button>
          </div>
        ))}
      </div>
      <div className="panel-section">
        <h3>발급한 초대</h3>
        {data.invites
          .filter((invite) => !invite.revoked)
          .map((invite) => (
            <div className="invite-row" key={invite.id}>
              <div>
                <strong>{invite.role}</strong>
                <small>
                  {invite.redeemed
                    ? "수락됨"
                    : `${new Date(invite.expiresAt).toLocaleDateString("ko-KR")} 만료`}
                </small>
              </div>
              {!invite.redeemed && (
                <button
                  className="text-button"
                  onClick={() => {
                    void revoke(`/pages/${page.id}/invites/${invite.id}`);
                  }}
                >
                  취소
                </button>
              )}
            </div>
          ))}
      </div>
      <details className="panel-section public-share-disclosure">
        <summary>웹에 게시 · 공개 링크</summary>
        <PublicShareManager workspaceId={page.workspaceId} currentPage={page} />
      </details>
    </div>
  );
}
function PropertiesPanel({
  page,
  data,
}: {
  page: LocalPage;
  data: WorkspaceData;
}) {
  const ui = useUiStore(),
    mobile = useMobile(),
    [session, setSession] = useState<DocumentSession | null>(null);
  useDocumentRevision(session?.document ?? null);
  useEffect(() => {
    void openDocument(page)
      .then(setSession)
      .catch((problem) => ui.patch({ notice: errorMessage(problem) }));
  }, [page.id]);
  const row =
      session && ui.taskId
        ? getTaskRows(session.document).find((item) => item.id === ui.taskId)
        : undefined,
    editable =
      canEdit(page.role) &&
      !mobile &&
      !page.accessLost &&
      !page.deletedAt &&
      !page.ancestorTrashed;
  return (
    <div className="context-content">
      {row && session ? (
        <DatabaseRowProperties
          page={page}
          data={data}
          document={session.document}
          row={row}
          editable={editable}
          identities={data.identities.filter(
            (identity) => identity.workspaceId === page.workspaceId,
          )}
        />
      ) : (
        <>
          <label className="field-label">
            상위 Page
            <select
              value={page.parentId ?? ""}
              disabled={page.role !== "owner" || mobile}
              onChange={(event) => {
                void changePageStructure(
                  page,
                  "move",
                  event.target.value || null,
                )
                  .then(requestSync)
                  .catch((problem) =>
                    ui.patch({ notice: errorMessage(problem) }),
                  );
              }}
            >
              <option value="">Workspace</option>
              {data.pages
                .filter(
                  (item) =>
                    item.workspaceId === page.workspaceId &&
                    !item.deletedAt &&
                    !wouldCreateCycle(page.id, item.id, data.pages),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
            </select>
          </label>
          <div className="property-row">
            <span>종류</span>
            <strong>
              {page.kind === "database" ? "Task Database" : "문서"}
            </strong>
          </div>
        </>
      )}
      {session && !row && (
        <PageTags document={session.document} editable={editable} />
      )}
      <div className="property-row">
        <span>생성일</span>
        <strong>
          {new Date(page.createdAt).toLocaleDateString("ko-KR", {
            timeZone: "Asia/Seoul",
          })}
        </strong>
      </div>
      <div className="property-row">
        <span>접근 권한</span>
        <strong>{page.role ?? "로컬 보존본"}</strong>
      </div>
    </div>
  );
}
