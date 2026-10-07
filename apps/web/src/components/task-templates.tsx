"use client";
import { useState, useRef, useEffect } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  getTaskTemplates,
  saveTaskTemplate,
  changeTaskTemplate,
  createTaskFromTemplate,
  formatTaskEstimate,
  cloneXmlContent,
  changedTaskTemplateProperties,
  type TaskRow,
} from "@zeronote/shared";
import { flushDocuments, type DocumentSession } from "@/lib/documents";
import { useDocumentRevision, type WorkspaceData } from "@/lib/hooks";
import { errorMessage, type LocalPage } from "@/lib/database";
import { useUiStore } from "@/lib/ui-store";
import { Dialog } from "./primitives";
import { BlockEditor } from "./block-editor";

export function TaskTemplatesDialog({
  session,
  page,
  data,
  editable,
  sourceRow,
  onClose,
}: {
  session: DocumentSession;
  page: LocalPage;
  data: WorkspaceData;
  editable: boolean;
  sourceRow?: TaskRow;
  onClose: () => void;
}) {
  const revision = useDocumentRevision(session.document);
  const createdRef = useRef<string | null>(null);
  const templates = getTaskTemplates(session.document),
    [selectedId, setSelectedId] = useState(templates[0]?.id ?? ""),
    [name, setName] = useState(sourceRow?.title.slice(0, 160) ?? ""),
    [rename, setRename] = useState<string | null>(null),
    [newName, setNewName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [createdId, setCreatedId] = useState<string | null>(null),
    [savedId, setSavedId] = useState<string | null>(null);
  const selected = templates.find((item) => item.id === selectedId);
  const changedProperties = selected
    ? changedTaskTemplateProperties(session.document, selected)
    : [];
  const change = async (action: () => void, after?: () => void) => {
    if (!editable || busy) return;
    setBusy(true);
    setError(null);
    try {
      action();
      await flushDocuments();
      after?.();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Task Templates" onClose={onClose} wide>
      {sourceRow && editable && (
        <form
          className="task-template-save"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              () => {
                if (!savedId) {
                  const id = saveTaskTemplate(
                    session.document,
                    sourceRow.id,
                    name,
                  );
                  setSavedId(id);
                  setSelectedId(id);
                }
              },
              () => {
                setSavedId(null);
                setName("");
              },
            );
          }}
        >
          <label className="field-label">
            현재 Task를 Template으로 저장
            <input
              aria-label="Task Template 이름"
              autoFocus
              value={name}
              maxLength={160}
              disabled={busy}
              onChange={(event) => {
                setName(event.target.value);
                setSavedId(null);
              }}
            />
          </label>
          <button
            className="button"
            disabled={busy || (!savedId && !name.trim())}
          >
            {savedId ? "이 기기 저장 다시 시도" : "Task Template 저장"}
          </button>
        </form>
      )}
      <p className="panel-description">
        Task 속성과 본문을 복사합니다. 새 Task는 Todo로 시작하며 기본 날짜·상위
        Task·선행 작업은 미지정입니다. Formula·Rollup·자동 시간은 새 Task에서
        계산합니다.
      </p>
      <div className="task-template-layout">
        <div className="task-template-list" aria-label="Task Template 목록">
          {templates.map((template) => (
            <button
              key={template.id}
              disabled={busy || !!createdId}
              className={selectedId === template.id ? "active" : ""}
              aria-pressed={selectedId === template.id}
              onClick={() => {
                setSelectedId(template.id);
                setRename(null);
              }}
            >
              {template.name}
            </button>
          ))}
          {!templates.length && (
            <p className="muted">저장한 Template이 없습니다.</p>
          )}
        </div>
        <div className="task-template-preview">
          {selected ? (
            <>
              <div className="task-template-heading">
                <h3>{selected.name}</h3>
                <span className="muted small">
                  {formatTaskEstimate(selected.estimateMinutes)} ·{" "}
                  {selected.labels.join(" · ") || "Label 없음"}
                </span>
              </div>
              {!!selected.properties.length && (
                <details className="task-extra-properties">
                  <summary>
                    사용자 정의 속성 {selected.properties.length}개
                  </summary>
                  <ul>
                    {selected.properties.map((property) => (
                      <li key={property.id}>{property.name}</li>
                    ))}
                  </ul>
                </details>
              )}
              {!!changedProperties.length && (
                <p className="danger-text" role="status">
                  변경된 속성: {changedProperties.join(" · ")}. 생성 전에 제외
                  여부를 확인합니다.
                </p>
              )}
              <TaskTemplatePreview
                key={selected.id}
                source={session.document}
                templateId={selected.id}
                pageId={page.id}
                revision={revision}
                data={data}
              />
              {editable && (
                <div className="button-row">
                  <button
                    className="button button-primary"
                    disabled={busy}
                    onClick={() =>
                      void change(
                        () => {
                          if (!createdRef.current) {
                            if (
                              changedProperties.length &&
                              !window.confirm(
                                `변경된 속성 ${changedProperties.join(", ")}을 제외하고 새 Task를 만들까요? Template은 유지됩니다.`,
                              )
                            )
                              return;
                            createdRef.current = createTaskFromTemplate(
                              session.document,
                              page.id,
                              selected.id,
                              undefined,
                              changedProperties.length > 0,
                            );
                            setCreatedId(createdRef.current);
                          }
                        },
                        () => {
                          const id = createdRef.current;
                          if (id) {
                            useUiStore
                              .getState()
                              .select(page.workspaceId, page.id, id);
                            onClose();
                          }
                        },
                      )
                    }
                  >
                    {createdId
                      ? "이 기기 저장 다시 시도"
                      : "Template으로 Task 생성"}
                  </button>
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      setRename(selected.id);
                      setNewName(selected.name);
                    }}
                  >
                    Template 이름 변경
                  </button>
                  <button
                    className="text-button danger-text"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `“${selected.name}” Template을 삭제할까요? 생성한 Task는 유지됩니다.`,
                        )
                      )
                        void change(() =>
                          changeTaskTemplate(session.document, selected.id, {
                            deleted: true,
                          }),
                        );
                    }}
                  >
                    Template 삭제
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="muted">Template을 선택해주세요.</p>
          )}
        </div>
      </div>
      {rename && editable && (
        <form
          className="page-tag-form"
          onSubmit={(event) => {
            event.preventDefault();
            void change(
              () =>
                changeTaskTemplate(session.document, rename, { name: newName }),
              () => setRename(null),
            );
          }}
        >
          <input
            aria-label="Task Template 새 이름"
            maxLength={160}
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={busy}
          />
          <button className="button" disabled={busy || !newName.trim()}>
            Template 이름 저장
          </button>
        </form>
      )}
      {error && (
        <p className="danger-text" role="alert">
          {error}
        </p>
      )}
    </Dialog>
  );
}
function TaskTemplatePreview({
  source,
  templateId,
  pageId,
  revision,
  data,
}: {
  source: Y.Doc;
  templateId: string;
  pageId: string;
  revision: number;
  data: WorkspaceData;
}) {
  const [preview, setPreview] = useState<{
    id: string;
    document: Y.Doc;
    awareness: Awareness;
  } | null>(null);
  useEffect(() => {
    const document = new Y.Doc(),
      awareness = new Awareness(document);
    document
      .getXmlFragment("content")
      .insert(
        0,
        cloneXmlContent(source.getXmlFragment(`task-template:${templateId}`)),
      );
    awareness.setLocalState(null);
    setPreview({
      id: `${pageId}:template:${templateId}:${revision}`,
      document,
      awareness,
    });
    return () => {
      awareness.destroy();
      document.destroy();
    };
  }, [source, templateId, revision]);
  return preview ? (
    <BlockEditor
      key={preview.id}
      session={preview}
      attachmentPageId={pageId}
      editable={false}
      pages={data.pages}
    />
  ) : null;
}
