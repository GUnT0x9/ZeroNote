"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownRight, MessageSquare, X } from "lucide-react";
import {
  canComment,
  getTaskRows,
  MAX_COMMENT_BODY_LENGTH,
  sameCommentScope,
  type PageComment,
} from "@zeronote/shared";
import { api, ApiError } from "@/lib/api";
import {
  database,
  errorMessage,
  type LocalPage,
  type PendingComment,
} from "@/lib/database";
import { openDocument, type DocumentSession } from "@/lib/documents";
import { useDocumentRevision, useLiveValue } from "@/lib/hooks";
import { useUiStore } from "@/lib/ui-store";
import { requestSync } from "@/lib/sync";
import {
  fetchComments,
  loadCommentDraft,
  queueComment,
  removeQueuedComment,
  retryComment,
  saveCommentDraft,
  type CommentDraft,
  type CommentScope,
} from "@/lib/comments";

export function CommentsPanel({
  page,
  rowId,
}: {
  page: LocalPage;
  rowId: string | null;
}) {
  const ui = useUiStore(),
    scope: CommentScope = { pageId: page.id, rowId };
  const [session, setSession] = useState<DocumentSession | null>(null),
    [draft, setDraft] = useState<CommentDraft>({ body: "", parentId: null }),
    [ready, setReady] = useState(false),
    [showResolved, setShowResolved] = useState(false),
    [error, setError] = useState<string | null>(null),
    [unavailable, setUnavailable] = useState(false),
    [sending, setSending] = useState(false);
  const draftRef = useRef(draft),
    busy = useRef(false),
    focusAfterSave = useRef(false),
    textarea = useRef<HTMLTextAreaElement>(null),
    request = useRef<AbortController | null>(null),
    mounted = useRef(true);
  useDocumentRevision(session?.document ?? null);
  useEffect(() => {
    if (!sending && focusAfterSave.current) {
      focusAfterSave.current = false;
      textarea.current?.focus();
    }
  }, [sending]);
  const rows = session ? getTaskRows(session.document) : [],
    row = rows.find((item) => item.id === rowId),
    validRow = rowId === null || !!row;
  const comments = useLiveValue(
    () =>
      database.comments
        .where("pageId")
        .equals(page.id)
        .filter((comment) => sameCommentScope(comment, scope))
        .toArray(),
    [page.id, rowId],
    [] as PageComment[],
  );
  const allPending = useLiveValue(
    () =>
      database.pendingComments
        .filter((comment) => comment.payload.pageId === page.id)
        .toArray(),
    [page.id],
    [] as PendingComment[],
  );
  const pending = allPending.filter((comment) =>
    sameCommentScope(comment.payload, scope),
  );
  const orphaned =
    rowId === null && session
      ? allPending.filter(
          (comment) =>
            comment.payload.rowId &&
            !rows.some((row) => row.id === comment.payload.rowId),
        )
      : [];
  const canWrite =
    canComment(page.role) && !page.accessLost && !unavailable && validRow;

  useEffect(() => {
    mounted.current = true;
    void openDocument(page)
      .then((value) => {
        if (mounted.current) setSession(value);
      })
      .catch((problem) => {
        if (mounted.current) setError(errorMessage(problem));
      });
    void loadCommentDraft(scope)
      .then((value) => {
        if (mounted.current) {
          draftRef.current = value;
          setDraft(value);
          setReady(true);
        }
      })
      .catch((problem) => {
        if (mounted.current) setError(errorMessage(problem));
      });
    return () => {
      mounted.current = false;
      request.current?.abort();
    };
  }, [page.id, rowId]);
  const load = useCallback(async () => {
    request.current?.abort();
    if (!mounted.current || !navigator.onLine || page.accessLost) return;
    const controller = new AbortController();
    request.current = controller;
    try {
      await fetchComments({ pageId: page.id, rowId }, controller.signal);
      if (!controller.signal.aborted) {
        setError(null);
        setUnavailable(false);
      }
    } catch (problem) {
      if (!controller.signal.aborted && mounted.current) {
        setError(errorMessage(problem));
        if (problem instanceof ApiError && [403, 410].includes(problem.status))
          setUnavailable(true);
      }
    }
  }, [page.id, page.accessLost, rowId]);
  useEffect(() => {
    if (ui.syncState !== "connecting") void load();
    const changed = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === page.id) void load();
    };
    window.addEventListener("zeronote:comments-changed", changed);
    return () => {
      window.removeEventListener("zeronote:comments-changed", changed);
      request.current?.abort();
    };
  }, [load, page.id, ui.syncState]);
  const changeDraft = (next: CommentDraft) => {
    draftRef.current = next;
    setDraft(next);
    void saveCommentDraft(scope, next).catch((problem) => {
      if (mounted.current) setError(errorMessage(problem));
    });
  };
  const submit = async () => {
    if (busy.current || !ready || !canWrite || !draftRef.current.body.trim())
      return;
    busy.current = true;
    setSending(true);
    try {
      await queueComment(scope, draftRef.current);
      if (mounted.current) {
        draftRef.current = { body: "", parentId: null };
        setDraft(draftRef.current);
        setError(null);
        focusAfterSave.current = true;
      }
      requestSync();
    } catch (problem) {
      if (mounted.current) setError(errorMessage(problem));
    } finally {
      busy.current = false;
      if (mounted.current) setSending(false);
    }
  };
  const action = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      if (mounted.current) setError(null);
    } catch (problem) {
      if (mounted.current) setError(errorMessage(problem));
    }
  };
  const reply = (id: string) => {
    changeDraft({ ...draftRef.current, parentId: id });
    textarea.current?.focus();
  };
  const resolve = async (comment: PageComment) => {
    await api(`/pages/${page.id}/comments/${comment.id}`, "PATCH", {
      resolved: !comment.resolved,
      ...(rowId ? { rowId } : {}),
    });
    await load();
  };
  const roots = (
    !page.accessLost && !unavailable && validRow ? comments : []
  ).filter(
    (comment) => !comment.parentId && (showResolved || !comment.resolved),
  );
  const pendingRoots = pending.filter((comment) => !comment.payload.parentId);
  const renderPending = (comment: PendingComment) => (
    <PendingCommentBody
      key={comment.id}
      comment={comment}
      canReply={canWrite && !comment.payload.parentId}
      onReply={() => reply(comment.id)}
      onAction={(operation) => void action(operation)}
      dependent={allPending.some(
        (item) => item.payload.parentId === comment.id,
      )}
    />
  );
  const replies = (id: string) => (
    <>
      {comments
        .filter((comment) => comment.parentId === id)
        .map((comment) => (
          <div className="comment-reply" key={comment.id}>
            <CornerDownRight size={13} />
            <CommentBody comment={comment} />
          </div>
        ))}
      {pending
        .filter((comment) => comment.payload.parentId === id)
        .map((comment) => (
          <div className="comment-reply" key={comment.id}>
            <CornerDownRight size={13} />
            {renderPending(comment)}
          </div>
        ))}
    </>
  );
  const missingParent = pending.filter(
    (comment) =>
      comment.payload.parentId &&
      !roots.some((root) => root.id === comment.payload.parentId) &&
      !pendingRoots.some((root) => root.id === comment.payload.parentId),
  );

  return (
    <div className="context-content comments-panel">
      <div className="comment-scope">
        <span>{rowId ? "Task 댓글" : "Page 댓글"}</span>
        <strong>
          {rowId
            ? row?.title ||
              (session ? "삭제되었거나 찾을 수 없는 Task" : "Task 불러오는 중")
            : page.title}
        </strong>
      </div>
      <button
        className="text-button"
        disabled={ui.syncState === "offline" || !!page.accessLost}
        onClick={() => void load()}
      >
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
      {(page.accessLost || (!!session && !validRow)) && (
        <div className="inline-warning">
          접근할 수 없는 {rowId ? "Task" : "Page"}입니다. 전송하지 못한 댓글은
          이 기기에 보관됩니다.
        </div>
      )}
      {error && (
        <div className="inline-warning" role="status">
          {error}
        </div>
      )}
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
            data-comment-id={comment.id}
          >
            <CommentBody comment={comment} />
            <div className="comment-actions">
              {canWrite && (
                <button onClick={() => reply(comment.id)}>답글</button>
              )}
              {canWrite && ui.syncState === "online" && (
                <button onClick={() => void action(() => resolve(comment))}>
                  {comment.resolved ? "다시 열기" : "해결"}
                </button>
              )}
            </div>
            {replies(comment.id)}
          </article>
        ))}
        {pendingRoots.map((comment) => (
          <article className="comment-thread pending" key={comment.id}>
            {renderPending(comment)}
            {replies(comment.id)}
          </article>
        ))}
        {missingParent.map((comment) => (
          <article className="comment-thread pending" key={comment.id}>
            <small>답글 · 원본 Thread 확인 대기</small>
            {renderPending(comment)}
          </article>
        ))}
        {!!orphaned.length && (
          <section aria-label="삭제된 Task의 전송 대기 댓글">
            <h3>전송하지 못한 Task 댓글</h3>
            {orphaned.map((comment) => (
              <article className="comment-thread pending" key={comment.id}>
                <small>삭제되었거나 찾을 수 없는 Task</small>
                <PendingCommentBody
                  comment={comment}
                  canReply={false}
                  onReply={() => {}}
                  onAction={(operation) => void action(operation)}
                  dependent={allPending.some(
                    (item) => item.payload.parentId === comment.id,
                  )}
                />
              </article>
            ))}
          </section>
        )}
      </div>
      {canWrite && (
        <form
          className="comment-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {draft.parentId && (
            <div className="reply-label">
              Thread에 답글 작성
              <button
                type="button"
                aria-label="답글 취소"
                disabled={sending}
                onClick={() =>
                  changeDraft({ ...draftRef.current, parentId: null })
                }
              >
                <X size={12} />
              </button>
            </div>
          )}
          <textarea
            ref={textarea}
            aria-label="Comment 내용"
            placeholder="의견을 남겨주세요…"
            value={draft.body}
            disabled={!ready || sending}
            maxLength={MAX_COMMENT_BODY_LENGTH}
            onChange={(event) =>
              changeDraft({ ...draftRef.current, body: event.target.value })
            }
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                void submit();
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
              disabled={!ready || sending || !draft.body.trim()}
            >
              {sending ? "기기에 저장 중" : "보내기"}
            </button>
          </div>
        </form>
      )}
      {!canWrite && ready && draft.body && (
        <div className="comment-thread pending">
          <small>이 기기의 입력 초안</small>
          <p>{draft.body}</p>
          <button
            className="text-button"
            onClick={() =>
              void action(() => navigator.clipboard.writeText(draft.body))
            }
          >
            초안 복사
          </button>
        </div>
      )}
    </div>
  );
}
function PendingCommentBody({
  comment,
  canReply,
  onReply,
  onAction,
  dependent,
}: {
  comment: PendingComment;
  canReply: boolean;
  onReply: () => void;
  onAction: (operation: () => Promise<unknown>) => void;
  dependent: boolean;
}) {
  return (
    <div className="pending-comment" data-pending-comment-id={comment.id}>
      <div className="comment-author">
        내 기기{" "}
        <span>
          {comment.error
            ? "전송 실패"
            : comment.acknowledged
              ? "서버 저장됨 · 확인 대기"
              : "전송 대기"}
        </span>
      </div>
      <p>{comment.payload.body}</p>
      {comment.error && <small className="danger-text">{comment.error}</small>}
      <div className="comment-actions">
        {canReply && <button onClick={onReply}>답글</button>}
        <button
          onClick={() =>
            onAction(() => navigator.clipboard.writeText(comment.payload.body))
          }
        >
          내용 복사
        </button>
        {comment.error && (
          <button
            onClick={() =>
              onAction(async () => {
                await retryComment(comment.id);
                requestSync();
              })
            }
          >
            재시도
          </button>
        )}
        <button
          disabled={dependent}
          title={dependent ? "전송 대기 답글을 먼저 제거해주세요." : undefined}
          onClick={() => onAction(() => removeQueuedComment(comment.id))}
        >
          기기에서 제거
        </button>
      </div>
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
