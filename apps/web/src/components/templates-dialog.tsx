"use client";
import { useMemo, useState } from "react";
import * as Y from "yjs";
import {
  BUILT_IN_TEMPLATES,
  applyBuiltInTemplate,
  isPageTemplate,
} from "@zeronote/shared";
import type { WorkspaceData } from "@/lib/hooks";
import { createLocalPage, duplicateLocalPage } from "@/lib/workspace";
import { openDocument, flushDocuments } from "@/lib/documents";
import { errorMessage, type LocalPage } from "@/lib/database";
import { useUiStore } from "@/lib/ui-store";
import { requestSync } from "@/lib/sync";
import { Dialog } from "./primitives";

export function TemplatesDialog({
  data,
  onClose,
}: {
  data: WorkspaceData;
  onClose: () => void;
}) {
  const ui = useUiStore(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const saved = useMemo(
    () =>
      data.pages.filter((page) => {
        if (
          page.workspaceId !== ui.workspaceId ||
          page.accessLost ||
          page.deletedAt ||
          page.role !== "owner"
        )
          return false;
        const record = data.documents.find((item) => item.id === page.id);
        if (!record) return false;
        const document = new Y.Doc();
        try {
          Y.applyUpdate(document, record.update);
          return isPageTemplate(document);
        } finally {
          document.destroy();
        }
      }),
    [data.pages, data.documents, ui.workspaceId],
  );
  const create = async (templateId: string, source?: LocalPage) => {
    if (busy || !ui.workspaceId) return;
    setBusy(true);
    setError("");
    try {
      let page: LocalPage;
      if (source) page = await duplicateLocalPage(source, source.title);
      else {
        const template = BUILT_IN_TEMPLATES.find(
          (item) => item.id === templateId,
        );
        if (!template) throw new Error("Template을 찾을 수 없습니다.");
        page = await createLocalPage(ui.workspaceId, template.name);
        const session = await openDocument(page);
        applyBuiltInTemplate(session.document, template.id);
        await flushDocuments();
      }
      ui.select(page.workspaceId, page.id);
      requestSync();
      onClose();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Templates" onClose={onClose}>
      <div className="templates-list">
        <h3>기본 Template</h3>
        {BUILT_IN_TEMPLATES.map((template) => (
          <button
            className="template-option"
            disabled={busy}
            key={template.id}
            onClick={() => void create(template.id)}
          >
            <strong>{template.name}</strong>
            <small>{template.sections.join(" · ")}</small>
          </button>
        ))}
        <h3>저장한 Template</h3>
        {saved.map((page) => (
          <button
            className="template-option"
            disabled={busy}
            key={page.id}
            onClick={() => void create("saved", page)}
          >
            {page.title}
          </button>
        ))}
        {!saved.length && (
          <p className="field-help">
            Page 메뉴에서 Template으로 지정할 수 있습니다.
          </p>
        )}
        {error && (
          <p role="alert" className="inline-warning">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
