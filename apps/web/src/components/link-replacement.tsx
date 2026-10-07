"use client";
import { useEffect, useState } from "react";
import {
  canEdit,
  getTaskRows,
  replaceKnowledgeLink,
  replacementRelationProperties,
  type KnowledgeIssue,
  type TaskRow,
} from "@zeronote/shared";
import { database, errorMessage, type LocalPage } from "@/lib/database";
import {
  openDocument,
  flushDocuments,
  type DocumentSession,
} from "@/lib/documents";
import { useDocumentRevision, type WorkspaceData } from "@/lib/hooks";
import { availablePages } from "@/lib/search";
import { requestSync } from "@/lib/sync";
import { Dialog } from "./primitives";

export function LinkReplacementDialog({
  page,
  data,
  issue,
  onClose,
}: {
  page: LocalPage;
  data: WorkspaceData;
  issue: KnowledgeIssue;
  onClose: () => void;
}) {
  const [session, setSession] = useState<DocumentSession | null>(null),
    [pageId, setPageId] = useState(
      issue.link.kind === "relation" ? issue.link.pageId : "",
    ),
    [rowId, setRowId] = useState(""),
    [propertyId, setPropertyId] = useState(""),
    [target, setTarget] = useState<{ id: string; rows: TaskRow[] }>({
      id: "",
      rows: [],
    }),
    [busy, setBusy] = useState(false),
    [applied, setApplied] = useState(false),
    [error, setError] = useState<string | null>(null);
  useDocumentRevision(session?.document ?? null);
  const pages = availablePages(data.pages),
    relation = issue.link.kind === "relation",
    needsRow = issue.link.kind !== "mention",
    candidates = pages.filter(
      (entry) =>
        (!needsRow || entry.kind === "database") &&
        (!relation || entry.id === issue.link.pageId),
    ),
    rows = target.id === pageId ? target.rows : [];
  useEffect(() => {
    let current = true;
    void openDocument(page)
      .then((value) => {
        if (!current) return;
        setSession(value);
        const properties = replacementRelationProperties(
          value.document,
          issue.link,
        );
        if (properties.length === 1) setPropertyId(properties[0]!.id);
      })
      .catch((problem) => {
        if (current) setError(errorMessage(problem));
      });
    return () => {
      current = false;
    };
  }, [page.id]);
  useEffect(() => {
    const selected = candidates.find((entry) => entry.id === pageId);
    if (!selected || !needsRow) return;
    let current = true;
    void openDocument(selected)
      .then((value) => {
        if (current)
          setTarget({ id: selected.id, rows: getTaskRows(value.document) });
      })
      .catch((problem) => {
        if (current) setError(errorMessage(problem));
      });
    return () => {
      current = false;
    };
  }, [pageId, needsRow, data.pages]);
  let properties: ReturnType<typeof replacementRelationProperties> = [];
  try {
    if (session && relation)
      properties = replacementRelationProperties(session.document, issue.link);
  } catch {
    /* A concurrent deletion is checked again before writing. */
  }
  const save = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const latest = new Map(
          availablePages(await database.pages.toArray()).map((entry) => [
            entry.id,
            entry,
          ]),
        ),
        source = latest.get(page.id),
        destination = latest.get(pageId);
      if (!source || !canEdit(source.role ?? "viewer"))
        throw new Error("이 Page의 편집 권한이 변경되었습니다.");
      if (!destination) throw new Error("연결할 Page에 접근할 수 없습니다.");
      if (needsRow) {
        if (destination.kind !== "database")
          throw new Error("Database를 선택해주세요.");
        const targetSession = await openDocument(destination);
        if (
          !getTaskRows(targetSession.document).some((row) => row.id === rowId)
        )
          throw new Error("연결할 Row가 삭제되었거나 변경되었습니다.");
      }
      if (!applied) {
        replaceKnowledgeLink(
          session.document,
          issue.link,
          { pageId, rowId: needsRow ? rowId : undefined },
          relation ? propertyId : undefined,
        );
        setApplied(true);
      }
      await flushDocuments();
      requestSync();
      onClose();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title="링크 교체"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p className="panel-description">
        {relation
          ? "선택한 Relation 속성의 Row 연결 하나를 교체합니다."
          : "이 본문에서 같은 대상을 가리키는 링크를 함께 교체합니다."}{" "}
        적용 전에는 원래 링크를 유지합니다.
      </p>
      {relation && (
        <label className="field-label">
          Relation 속성
          <select
            aria-label="교체할 Relation 속성"
            disabled={applied}
            value={propertyId}
            onChange={(event) => setPropertyId(event.target.value)}
          >
            <option value="">속성 선택</option>
            {properties.map((property) => (
              <option key={property.id} value={property.id}>
                {property.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="field-label">
        연결할 Page
        <select
          aria-label="교체할 Page"
          value={pageId}
          disabled={relation || applied}
          onChange={(event) => {
            setPageId(event.target.value);
            setRowId("");
            setError(null);
          }}
        >
          <option value="">Page 선택</option>
          {candidates.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.title}
            </option>
          ))}
        </select>
      </label>
      {needsRow && (
        <label className="field-label">
          연결할 Row
          <select
            aria-label="교체할 Row"
            value={rowId}
            disabled={!pageId || applied}
            onChange={(event) => setRowId(event.target.value)}
          >
            <option value="">Row 선택</option>
            {rows.map((row) => (
              <option key={row.id} value={row.id}>
                {row.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {relation && !candidates.length && (
        <p className="field-help">
          원래 Database의 접근을 확인할 수 없습니다. Properties에서 Relation
          대상 Database를 확인하거나 삭제된 Database를 복원해주세요.
        </p>
      )}
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button" disabled={busy} onClick={onClose}>
          취소
        </button>
        <button
          className="button button-primary"
          disabled={
            busy ||
            !session ||
            !pageId ||
            (needsRow && !rowId) ||
            (relation && !propertyId)
          }
          onClick={() => {
            void save();
          }}
        >
          {busy ? "저장 중…" : applied ? "저장 재시도" : "링크 교체 적용"}
        </button>
      </div>
    </Dialog>
  );
}
