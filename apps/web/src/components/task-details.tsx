"use client";
import { useState } from "react";
import { Plus, X, Pencil } from "lucide-react";
import type * as Y from "yjs";
import {
  getTaskRows,
  getTaskRelationIssues,
  setTaskParent,
  setTaskDependency,
  createSubtask,
  setTaskLabel,
  renameTaskLabel,
  removeTaskLabel,
  formatTaskEstimate,
  getDatabaseMode,
  type TaskRow,
  MAX_TASK_LABELS,
  MAX_PAGE_TAG_LENGTH,
} from "@zeronote/shared";
import { flushDocuments } from "@/lib/documents";
import { errorMessage, type LocalPage } from "@/lib/database";
import { useUiStore } from "@/lib/ui-store";
import { useDocumentRevision } from "@/lib/hooks";

export function TaskSummary({
  row,
  byId,
  compact = false,
}: {
  row: TaskRow;
  byId: ReadonlyMap<string, TaskRow>;
  compact?: boolean;
}) {
  const parent = row.parentTaskId ? byId.get(row.parentTaskId) : undefined,
    pending = row.dependencyIds.filter((id) => {
      const target = byId.get(id);
      return target && target.status !== "done";
    });
  return (
    <div className="task-extra-summary">
      {row.parentTaskId && <span>↳ {parent?.title || "삭제된 상위 Task"}</span>}
      {!compact &&
        row.labels.map((label) => (
          <span className="task-label" key={label}>
            {label}
          </span>
        ))}
      {!compact && row.estimateMinutes !== null && (
        <span>{formatTaskEstimate(row.estimateMinutes)}</span>
      )}
      {!!pending.length && <span>선행 {pending.length}개 대기</span>}
    </div>
  );
}
export function TaskDetails({
  document,
  row,
  page,
  editable,
  onTemplates,
}: {
  document: Y.Doc;
  row: TaskRow;
  page: LocalPage;
  editable: boolean;
  onTemplates: () => void;
}) {
  useDocumentRevision(document);
  const rows = getTaskRows(document),
    children = rows.filter((item) => item.parentTaskId === row.id),
    issues = getTaskRelationIssues(rows).filter(
      (issue) => issue.rowId === row.id,
    );
  const [childTitle, setChildTitle] = useState(""),
    [label, setLabel] = useState(""),
    [renaming, setRenaming] = useState<string | null>(null),
    [dependency, setDependency] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const open = (id: string) =>
    useUiStore.getState().select(page.workspaceId, page.id, id);
  const change = async (action: () => void) => {
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    try {
      action();
      await flushDocuments();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  if (getDatabaseMode(document) !== "task") return null;
  return (
    <section
      className="task-details"
      aria-label="Task 관계와 Label"
      aria-busy={busy}
    >
      <div className="task-details-row">
        <label className="field-label">
          상위 Task
          <select
            aria-label="상위 Task"
            value={row.parentTaskId ?? ""}
            disabled={!editable || busy}
            onChange={(event) =>
              void change(() =>
                setTaskParent(document, row.id, event.target.value || null),
              )
            }
          >
            <option value="">없음</option>
            {row.parentTaskId &&
              !rows.some((item) => item.id === row.parentTaskId) && (
                <option value={row.parentTaskId}>삭제된 상위 Task</option>
              )}
            {rows
              .filter((item) => item.id !== row.id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || "제목 없음"}
                </option>
              ))}
          </select>
        </label>
        {row.parentTaskId &&
          rows.some((item) => item.id === row.parentTaskId) && (
            <button
              className="text-button"
              onClick={() => open(row.parentTaskId!)}
            >
              상위 Task 열기
            </button>
          )}
        <button className="button button-small" onClick={onTemplates}>
          Task Template
        </button>
      </div>
      <div className="task-label-editor">
        <span className="field-caption">
          Labels · {row.labels.length}/{MAX_TASK_LABELS}
        </span>
        <ul className="page-tag-list">
          {row.labels.map((item) => (
            <li key={item}>
              <span>{item}</span>
              {editable && (
                <>
                  <button
                    className="icon-button"
                    aria-label={`Label ${item} 이름 변경`}
                    disabled={busy}
                    onClick={() => {
                      setRenaming(item);
                      setLabel(item);
                    }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Label ${item} 삭제`}
                    disabled={busy}
                    onClick={() =>
                      void change(() => removeTaskLabel(document, row.id, item))
                    }
                  >
                    <X size={13} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
        {editable && (
          <form
            className="page-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              void change(() => {
                if (renaming)
                  renameTaskLabel(document, row.id, renaming, label);
                else setTaskLabel(document, row.id, label);
                setLabel("");
                setRenaming(null);
              });
            }}
          >
            <input
              aria-label={renaming ? "Task Label 이름" : "Task Label 추가"}
              value={label}
              maxLength={MAX_PAGE_TAG_LENGTH}
              disabled={busy}
              placeholder="Label"
              onChange={(event) => setLabel(event.target.value)}
            />
            <button
              className="button button-small"
              disabled={busy || !label.trim()}
            >
              {renaming ? "이름 변경" : "Label 추가"}
            </button>
            {renaming && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setRenaming(null);
                  setLabel("");
                }}
              >
                취소
              </button>
            )}
          </form>
        )}
      </div>
      <div className="task-relation-section">
        <h3>선행 작업</h3>
        <ul className="task-relation-list">
          {row.dependencyIds.map((id) => {
            const target = rows.find((item) => item.id === id);
            return (
              <li key={id}>
                <button
                  className="text-button"
                  disabled={!target}
                  onClick={() => open(id)}
                >
                  {target?.title || "삭제된 선행 Task"}
                </button>
                <span className="muted small">
                  {target
                    ? target.status === "done"
                      ? "완료"
                      : "대기"
                    : "연결 확인 필요"}
                </span>
                {editable && (
                  <button
                    className="icon-button"
                    aria-label={`선행 ${target?.title || "삭제된 Task"} 해제`}
                    disabled={busy}
                    onClick={() =>
                      void change(() =>
                        setTaskDependency(document, row.id, id, false),
                      )
                    }
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {!row.dependencyIds.length && (
          <p className="muted small">선행 작업 없음</p>
        )}
        {editable && (
          <form
            className="page-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              void change(() => {
                setTaskDependency(document, row.id, dependency, true);
                setDependency("");
              });
            }}
          >
            <select
              aria-label="선행 Task 선택"
              value={dependency}
              disabled={busy}
              onChange={(event) => setDependency(event.target.value)}
            >
              <option value="">Task 선택</option>
              {rows
                .filter(
                  (item) =>
                    item.id !== row.id && !row.dependencyIds.includes(item.id),
                )
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title || "제목 없음"}
                  </option>
                ))}
            </select>
            <button
              className="button button-small"
              disabled={busy || !dependency}
            >
              선행 작업 추가
            </button>
          </form>
        )}
      </div>
      <div className="task-relation-section">
        <h3>하위 작업 · {children.length}</h3>
        <ul className="task-relation-list">
          {children.map((child) => (
            <li key={child.id}>
              <button className="text-button" onClick={() => open(child.id)}>
                {child.title || "제목 없음"}
              </button>
              <span className="muted small">
                {child.status === "done" ? "완료" : "진행 전/중"}
              </span>
            </li>
          ))}
        </ul>
        {editable && (
          <form
            className="page-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              void change(() => {
                createSubtask(document, row.id, childTitle);
                setChildTitle("");
              });
            }}
          >
            <input
              aria-label="하위 Task 제목"
              value={childTitle}
              maxLength={500}
              disabled={busy}
              placeholder="하위 작업 제목"
              onChange={(event) => setChildTitle(event.target.value)}
            />
            <button
              className="button button-small"
              disabled={busy || !childTitle.trim()}
            >
              <Plus size={13} />
              하위 작업 추가
            </button>
          </form>
        )}
      </div>
      {issues.map((issue) => (
        <p
          key={`${issue.kind}:${issue.targetId}`}
          className={issue.reason === "cycle" ? "danger-text" : "muted small"}
          role={issue.reason === "cycle" ? "alert" : undefined}
        >
          {issue.reason === "cycle"
            ? "동시 변경으로 순환 관계가 생겼습니다. 상위 Task 또는 표시된 선행 연결을 해제해주세요."
            : "삭제된 Task의 연결입니다. 필요하면 상위 Task를 변경하거나 선행 연결을 해제해주세요."}
        </p>
      ))}
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
