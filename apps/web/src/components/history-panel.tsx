"use client";
import { useEffect, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { z } from "zod";
import {
  SnapshotSchema,
  SnapshotDetailSchema,
  PageSchema,
  base64ToBytes,
  getTaskRows,
  getPageTags,
  type DocumentSnapshot,
} from "@zeronote/shared";
import { api, authenticate } from "@/lib/api";
import { useUiStore } from "@/lib/ui-store";
import { database, errorMessage, type LocalPage } from "@/lib/database";
import { flushDocuments } from "@/lib/documents";
import { synchronize } from "@/lib/sync";
import { BlockEditor } from "./block-editor";
import { DatabaseRowProperties } from "./database-property";
import { PageTags } from "./page-tags";
import type { WorkspaceData } from "@/lib/hooks";
export function HistoryPanel({
  page,
  data,
}: {
  page: LocalPage;
  data: WorkspaceData;
}) {
  const ui = useUiStore();
  const [records, setRecords] = useState<DocumentSnapshot[]>([]),
    [detail, setDetail] = useState<z.infer<typeof SnapshotDetailSchema> | null>(
      null,
    );
  const [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [restoreOperation, setRestoreOperation] = useState<string | null>(null),
    [createOperation, setCreateOperation] = useState<string | null>(null);
  const online = ui.syncState === "online";
  const load = async () => {
    await authenticate();
    setRecords(
      z.array(SnapshotSchema).parse(await api(`/pages/${page.id}/snapshots`)),
    );
  };
  useEffect(() => {
    if (online && page.role === "owner")
      void load().catch((problem) => setError(errorMessage(problem)));
  }, [page.id, online]);
  const run = async (action: () => Promise<void>) => {
    if (!navigator.onLine) {
      setError("기록은 Online에서 사용할 수 있습니다.");
      return;
    }
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
  if (page.role !== "owner")
    return (
      <div className="context-content">
        Workspace Owner만 기록을 사용할 수 있습니다.
      </div>
    );
  return (
    <div className="context-content">
      <p className="panel-description">
        서버에 저장된 기록입니다. 복구하면 원본을 유지하고 새 Page를 만듭니다.
      </p>
      {!online && (
        <div className="inline-warning">
          Online에서 기록을 조회하고 복구할 수 있습니다.
        </div>
      )}
      <label className="field-label">
        기록 이름
        <input
          aria-label="기록 이름"
          maxLength={160}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setCreateOperation(null);
          }}
          placeholder="선택 사항"
        />
      </label>
      <button
        className="button full-width"
        disabled={busy || !online || !!page.deletedAt}
        onClick={() =>
          void run(async () => {
            await flushDocuments();
            await synchronize();
            const local = await database.documents.get(page.id);
            if (local && local.generation > local.committedGeneration)
              throw new Error("문서 동기화가 끝난 뒤 기록을 만들어주세요.");
            const operationId = createOperation ?? crypto.randomUUID();
            setCreateOperation(operationId);
            await api(`/pages/${page.id}/snapshots`, "POST", {
              operationId,
              name,
            });
            setCreateOperation(null);
            setName("");
            await load();
          })
        }
      >
        현재 상태 기록하기
      </button>
      {error && (
        <div className="inline-warning" role="alert">
          {error}
        </div>
      )}
      <div className="panel-section">
        <h3>기록 목록</h3>
        {!records.length && (
          <p className="muted small">저장된 기록이 없습니다.</p>
        )}
        {records.map((record) => (
          <div className="snapshot-row" key={record.id}>
            <button
              className="backlink-item"
              disabled={busy || !online}
              onClick={() =>
                void run(async () => {
                  setDetail(
                    SnapshotDetailSchema.parse(
                      await api(`/snapshots/${record.id}`),
                    ),
                  );
                  setRestoreOperation(null);
                })
              }
            >
              {record.name ||
                (record.kind === "automatic" ? "자동 기록" : "수동 기록")}
              <small>
                {new Date(record.createdAt).toLocaleString("ko-KR")}
              </small>
            </button>
            <button
              className="text-button danger-text"
              aria-label={`기록 삭제 ${record.id}`}
              disabled={busy || !online}
              onClick={() =>
                void run(async () => {
                  await api(`/snapshots/${record.id}`, "DELETE");
                  if (detail?.id === record.id) setDetail(null);
                  await load();
                })
              }
            >
              삭제
            </button>
          </div>
        ))}
      </div>
      {detail && (
        <section className="snapshot-preview">
          <h3>미리보기 · 읽기 전용</h3>
          <SnapshotPreview
            key={detail.id}
            detail={detail}
            page={page}
            data={data}
          />
          <button
            className="button button-primary full-width"
            disabled={busy || !online}
            onClick={() =>
              void run(async () => {
                const operationId = restoreOperation ?? crypto.randomUUID();
                setRestoreOperation(operationId);
                const restored = PageSchema.parse(
                  await api(`/snapshots/${detail.id}/restore-copy`, "POST", {
                    operationId,
                  }),
                );
                // Finish metadata refresh before opening the copy; an earlier refresh may omit it.
                await synchronize();
                ui.select(restored.workspaceId, restored.id);
                ui.patch({
                  panel: null,
                  notice: "기록을 새 Page로 복구했습니다.",
                });
              })
            }
          >
            새 Page로 복구
          </button>
        </section>
      )}
      <p className="field-help">
        자동 기록 7일 · 수동 기록 최대 3개. Task 기록은 프로젝트 전체를
        포함합니다.
      </p>
    </div>
  );
}
function SnapshotPreview({
  detail,
  page,
  data,
}: {
  detail: z.infer<typeof SnapshotDetailSchema>;
  page: LocalPage;
  data: WorkspaceData;
}) {
  const [session, setSession] = useState<{
      id: string;
      document: Y.Doc;
      awareness: Awareness;
    } | null>(null),
    [taskId, setTaskId] = useState("");
  useEffect(() => {
    const document = new Y.Doc({ gc: false });
    Y.applyUpdate(document, base64ToBytes(detail.update));
    const awareness = new Awareness(document);
    awareness.setLocalState(null);
    setSession({ id: detail.id, document, awareness });
    return () => {
      awareness.destroy();
      document.destroy();
    };
  }, [detail.id]);
  if (!session) return null;
  const rows = getTaskRows(session.document);
  return (
    <div>
      <strong>{session.document.getText("title").toString()}</strong>
      {getPageTags(session.document).length > 0 && (
        <PageTags document={session.document} editable={false} />
      )}
      <BlockEditor
        session={session}
        attachmentPageId={detail.pageId}
        editable={false}
        pages={[]}
      />
      {!!rows.length && (
        <>
          <label className="field-label">
            Task 미리보기
            <select
              aria-label="기록 Task"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <option value="">Task 선택 ({rows.length})</option>
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title} · {row.status} · {row.priority} ·{" "}
                  {row.dueDate ?? "날짜 없음"}
                </option>
              ))}
            </select>
          </label>
          {taskId && (
            <>
              <DatabaseRowProperties
                page={page}
                data={data}
                historical
                document={session.document}
                row={rows.find((row) => row.id === taskId)!}
                editable={false}
                identities={[]}
              />
              <BlockEditor
                key={taskId}
                session={session}
                fragmentName={`task:${taskId}`}
                editable={false}
                pages={[]}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
