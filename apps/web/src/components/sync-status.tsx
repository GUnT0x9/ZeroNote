"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  CircleAlert,
  Cloud,
  CloudOff,
  LoaderCircle,
} from "lucide-react";
import type { WorkspaceData } from "@/lib/hooks";
import { getDocumentSession } from "@/lib/documents";
import { getWorkspaceSyncStatus } from "@/lib/sync-status";
import { requestSync } from "@/lib/sync";
import { useUiStore } from "@/lib/ui-store";

export function SyncStatus({ data }: { data: WorkspaceData }) {
  const ui = useUiStore(),
    [open, setOpen] = useState(false),
    ref = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    id = useId();
  const localError = data.pages
    .filter(
      (page) =>
        page.workspaceId === ui.workspaceId &&
        !page.deletedAt &&
        !page.accessLost,
    )
    .map((page) => getDocumentSession(page.id)?.localSaveError)
    .find(Boolean);
  const status = getWorkspaceSyncStatus(data, ui.workspaceId, {
    connection: ui.syncState,
    error: localError ? `이 기기 저장 실패 · ${localError}` : ui.syncError,
  });
  const busy = status.kind === "connecting" || status.kind === "saving";
  const Icon = busy
    ? LoaderCircle
    : status.kind === "offline"
      ? CloudOff
      : status.kind === "error"
        ? CircleAlert
        : ui.workspaceId
          ? Check
          : Cloud;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target))
        setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);
  return (
    <div className="sync-status" ref={ref}>
      <button
        ref={button}
        className={`icon-button sync-status-button ${status.kind}`}
        data-testid="sync-status"
        data-state={status.kind}
        aria-label={status.label}
        title={status.label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <Icon
          size={16}
          className={busy ? "spin" : undefined}
          aria-hidden="true"
        />
      </button>
      <span className="sr-only" role="status">
        {status.kind === "error"
          ? `${status.label} · ${status.detail}`
          : status.kind === "offline"
            ? "Offline"
            : ""}
      </span>
      {open && (
        <div
          id={id}
          className="sync-status-popover"
          role="region"
          aria-label="동기화 상태"
        >
          <strong>{status.label}</strong>
          <p>{status.detail}</p>
          {status.kind === "error" && (
            <button
              className="button button-small"
              onClick={() => requestSync()}
            >
              다시 시도
            </button>
          )}
          <span
            className="sync-status-offline"
            title={ui.offlineReady ? "Offline 준비됨" : "Offline 화면 준비 중"}
          >
            {ui.offlineReady
              ? "Offline에서 저장된 문서를 열 수 있습니다."
              : "Offline 화면을 준비하고 있습니다."}
          </span>
        </div>
      )}
    </div>
  );
}
