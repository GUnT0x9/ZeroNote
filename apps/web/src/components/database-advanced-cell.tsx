"use client";
import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { Download, FilePlus2, Link2, X } from "lucide-react";
import {
  getTaskRows,
  readDatabaseValue,
  writeDatabaseValue,
  MAX_DATABASE_LINKS,
  type DatabaseProperty,
  type TaskRow,
} from "@zeronote/shared";
import type { DatabaseEditorContext } from "@/lib/database-context";
import { stageAttachmentFile, loadAttachment } from "@/lib/attachments";
import { errorMessage, type LocalAttachment } from "@/lib/database";
import { useUiStore } from "@/lib/ui-store";
import { requestSync } from "@/lib/sync";
import { Dialog } from "./primitives";
import { PdfPreview } from "./pdf-preview";

export interface DatabaseAdvancedCellProps {
  document: Y.Doc;
  row: TaskRow;
  property: DatabaseProperty;
  editable: boolean;
  context: DatabaseEditorContext;
  label: string;
}
export function DatabaseComputedCell({
  row,
  property,
  context,
  label,
}: DatabaseAdvancedCellProps) {
  const result = context.reader.cell(row, property);
  return (
    <span
      className={`database-computed-value ${result.error ? "danger-text" : ""}`}
      aria-label={label}
      title={result.error?.message}
    >
      {result.error ? (
        <span role="status">{result.error.message}</span>
      ) : (
        context.reader.label(row, property) || "—"
      )}
    </span>
  );
}
export function DatabaseRelationCell({
  document,
  row,
  property,
  editable,
  context,
  label,
}: DatabaseAdvancedCellProps) {
  const targetId = property.relation!.databaseId;
  const target = context.databaseById(targetId);
  const candidates = target ? getTaskRows(target) : [];
  const raw = readDatabaseValue(document, row, property),
    ids = Array.isArray(raw) ? raw : [];
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [error, setError] = useState<string | null>(null);
  const result = context.reader.cell(row, property);
  const commit = (id: string, checked: boolean) => {
    try {
      const current = readDatabaseValue(document, row, property);
      const selected = Array.isArray(current) ? current : [];
      writeDatabaseValue(
        document,
        row.id,
        property.id,
        checked
          ? [...new Set([...selected, id])]
          : selected.filter((value) => value !== id),
      );
      setError(null);
    } catch (issue) {
      setError(errorMessage(issue));
    }
  };
  return (
    <div className="database-linked-cell">
      <div className="database-linked-values">
        {candidates
          .filter((candidate) => ids.includes(candidate.id))
          .map((candidate) => (
            <button
              className="database-relation-link"
              key={candidate.id}
              type="button"
              onClick={() =>
                useUiStore
                  .getState()
                  .select(context.page.workspaceId, targetId, candidate.id)
              }
            >
              <Link2 size={12} />
              {candidate.title || "제목 없음"}
            </button>
          ))}
        {editable && (
          <button
            type="button"
            className="text-button"
            aria-label={`${label} 연결 선택`}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {ids.length ? "변경" : "항목 연결"}
          </button>
        )}
        {!editable && !ids.length && !result.error && (
          <span className="muted">—</span>
        )}
      </div>
      {result.error && (
        <div>
          <small className="danger-text" role="status">
            {result.error.message}
          </small>
          {context.databases.some((database) => database.id === targetId) && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                void context
                  .loadDatabase(targetId)
                  .catch((issue) => setError(errorMessage(issue)));
              }}
            >
              다시 불러오기
            </button>
          )}
        </div>
      )}
      {ids.some((id) => !candidates.some((candidate) => candidate.id === id)) &&
        target && <small className="muted">삭제된 연결 항목이 있습니다.</small>}
      {open && editable && (
        <div
          className="database-relation-picker"
          role="group"
          aria-label={`${label} 연결 항목`}
        >
          <input
            autoFocus
            aria-label={`${label} 연결 검색`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="항목 검색"
          />
          <div className="database-relation-options">
            {candidates
              .filter((candidate) =>
                candidate.title
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
              .map((candidate) => (
                <label className="check-label" key={candidate.id}>
                  <input
                    type="checkbox"
                    checked={ids.includes(candidate.id)}
                    onChange={(event) =>
                      commit(candidate.id, event.target.checked)
                    }
                  />
                  {candidate.title || "제목 없음"}
                </label>
              ))}
            {target && !candidates.length && (
              <small className="muted">대상 Database에 항목이 없습니다.</small>
            )}
          </div>
          {!!ids.length && (
            <button
              className="text-button"
              type="button"
              onClick={() => {
                try {
                  writeDatabaseValue(document, row.id, property.id, []);
                  setError(null);
                } catch (issue) {
                  setError(errorMessage(issue));
                }
              }}
            >
              연결 모두 해제
            </button>
          )}
          <button
            className="text-button"
            type="button"
            onClick={() => setOpen(false)}
          >
            닫기
          </button>
        </div>
      )}
      {error && (
        <small className="danger-text" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function DatabaseFileCell({
  document,
  row,
  property,
  editable,
  context,
  label,
}: DatabaseAdvancedCellProps) {
  const raw = readDatabaseValue(document, row, property),
    ids = Array.isArray(raw) ? raw : [];
  const metadata = new Map(
    (context.filesByDatabase.get(context.page.id) ?? []).map((file) => [
      file.id,
      file,
    ]),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [preview, setPreview] = useState<string | null>(null);
  const addFiles = async (files: File[]) => {
    setBusy(true);
    setError(null);
    try {
      for (const file of files) {
        const current = readDatabaseValue(document, row, property),
          selected = Array.isArray(current) ? current : [];
        if (selected.length >= MAX_DATABASE_LINKS)
          throw new Error(`속성당 파일은 최대 ${MAX_DATABASE_LINKS}개입니다.`);
        const record = await stageAttachmentFile(context.page.id, file);
        const latest = readDatabaseValue(document, row, property),
          remaining = Array.isArray(latest) ? latest : [];
        writeDatabaseValue(document, row.id, property.id, [
          ...new Set([...remaining, record.id]),
        ]);
        requestSync();
      }
    } catch (issue) {
      setError(errorMessage(issue));
    } finally {
      setBusy(false);
    }
  };
  const unlink = (id: string) => {
    try {
      const current = readDatabaseValue(document, row, property);
      writeDatabaseValue(
        document,
        row.id,
        property.id,
        (Array.isArray(current) ? current : []).filter((value) => value !== id),
      );
      setError(null);
    } catch (issue) {
      setError(errorMessage(issue));
    }
  };
  return (
    <div className="database-linked-cell">
      <div className="database-linked-values">
        {ids.map((id) => (
          <span className="database-file-chip" key={id}>
            <button
              type="button"
              className="text-button"
              aria-label={`${metadata.get(id)?.name ?? "파일"} 미리보기`}
              onClick={() => setPreview(id)}
            >
              {metadata.get(id)?.name ?? "파일 정보 불러오기"}
            </button>
            {editable && (
              <button
                className="icon-button"
                type="button"
                aria-label={`${metadata.get(id)?.name ?? "파일"} 연결 해제`}
                onClick={() => unlink(id)}
              >
                <X size={12} />
              </button>
            )}
          </span>
        ))}
        {editable && (
          <label className="database-file-add" title="파일 추가">
            <FilePlus2 size={14} />
            <span>{busy ? "파일 저장 중" : "파일 추가"}</span>
            <input
              className="sr-only"
              type="file"
              multiple
              aria-label={`${label} 파일 추가`}
              disabled={busy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void addFiles(files);
              }}
            />
          </label>
        )}
        {!editable && !ids.length && <span className="muted">—</span>}
      </div>
      {(error ||
        (ids.some((id) => !metadata.has(id)) && context.fileError)) && (
        <small className="danger-text" role="alert">
          {error ?? context.fileError}
        </small>
      )}
      {preview && (
        <DatabaseFilePreview
          pageId={context.page.id}
          id={preview}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
function DatabaseFilePreview({
  pageId,
  id,
  onClose,
}: {
  pageId: string;
  id: string;
  onClose: () => void;
}) {
  const [file, setFile] = useState<LocalAttachment | null>(null),
    [url, setUrl] = useState(""),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false,
      objectUrl = "";
    void loadAttachment(id, pageId)
      .then((record) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(
          new Blob([Uint8Array.from(record.data)], { type: record.mime }),
        );
        setFile(record);
        setUrl(objectUrl);
      })
      .catch((issue) => {
        if (!cancelled) setError(errorMessage(issue));
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [pageId, id]);
  return (
    <Dialog title={file?.name ?? "파일 미리보기"} onClose={onClose}>
      {error && (
        <div className="inline-warning" role="alert">
          {error}
        </div>
      )}
      {!file && !error && (
        <p className="muted" role="status">
          파일 불러오는 중…
        </p>
      )}
      {file && (
        <div className="database-file-preview">
          {file.mime.startsWith("image/") && <img src={url} alt={file.name} />}
          {file.mime.startsWith("video/") && (
            <video
              src={url}
              controls
              preload="metadata"
              aria-label={file.name}
            />
          )}
          {file.mime.startsWith("audio/") && (
            <audio
              src={url}
              controls
              preload="metadata"
              aria-label={file.name}
            />
          )}
          {file.mime === "application/pdf" && <PdfPreview file={file} />}
          {file.mime === "text/plain" && (
            <pre className="source-preview">
              {new TextDecoder().decode(file.data)}
            </pre>
          )}
          <div className="dialog-footer">
            <small className="muted">{Math.ceil(file.size / 1024)} KiB</small>
            <a className="button" href={url} download={file.name}>
              <Download size={14} />
              다운로드
            </a>
          </div>
        </div>
      )}
    </Dialog>
  );
}
