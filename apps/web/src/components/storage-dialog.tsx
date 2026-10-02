"use client";
import { useEffect, useState } from "react";
import type { AttachmentStorage } from "@zeronote/shared";
import { Dialog } from "./primitives";
import { useUiStore } from "@/lib/ui-store";
import { errorMessage, type LocalWorkspace } from "@/lib/database";
import {
  loadWorkspaceStorage,
  localFileUsage,
  removeUploadedFileCache,
  purgeUnusedAttachment,
} from "@/lib/storage";

export function StorageDialog({
  workspace,
  owner,
  onClose,
}: {
  workspace: LocalWorkspace;
  owner: boolean;
  onClose: () => void;
}) {
  const online = useUiStore((state) => state.syncState === "online");
  const [server, setServer] = useState<AttachmentStorage | null>(null);
  const [local, setLocal] = useState<Awaited<
    ReturnType<typeof localFileUsage>
  > | null>(null);
  const [selected, setSelected] = useState<
    AttachmentStorage["files"][number] | null
  >(null);
  const [confirmation, setConfirmation] = useState("");
  const [clearCache, setClearCache] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = async () => {
    setLocal(await localFileUsage(workspace.id));
    if (owner && online && !workspace.pendingCreation)
      setServer(await loadWorkspaceStorage(workspace.id));
  };
  useEffect(() => {
    void read().catch((problem) => setError(errorMessage(problem)));
  }, [workspace.id, owner, online, workspace.pendingCreation]);
  const run = async (action?: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      if (action) await action();
      await read();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="저장 공간" onClose={onClose} wide>
      <div className="settings-content">
        <section>
          <h3>이 기기의 파일</h3>
          <p className="muted-text" aria-live="polite">
            {local
              ? `${(local.bytes / 1024 / 1024).toFixed(2)} MiB · ${local.count}개 파일 · 미전송/보존 ${local.pending}개`
              : "파일 용량 확인 중"}
          </p>
          {!clearCache ? (
            <button
              className="button button-small"
              disabled={busy || !local || local.count === local.pending}
              onClick={() => setClearCache(true)}
            >
              오프라인 파일 사본 제거
            </button>
          ) : (
            <div className="storage-confirm">
              <p>
                서버에 저장된 파일의 이 기기 사본을 제거합니다. 다시
                내려받으려면 연결이 필요합니다. 문서와 미전송·보존 파일은
                유지합니다.
              </p>
              <div className="button-row">
                <button
                  className="button button-small"
                  disabled={busy}
                  onClick={() => {
                    void run(async () => {
                      await removeUploadedFileCache(workspace.id);
                      setClearCache(false);
                    });
                  }}
                >
                  사본 제거하기
                </button>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => setClearCache(false)}
                >
                  취소
                </button>
              </div>
            </div>
          )}
        </section>
        {owner && (
          <section>
            <h3>서버 파일</h3>
            {!online || workspace.pendingCreation ? (
              <p className="muted-text">
                연결 후 서버 용량과 파일을 확인할 수 있습니다.
              </p>
            ) : !server ? (
              <p className="muted-text">서버 용량 확인 중</p>
            ) : (
              <>
                <p aria-live="polite">
                  {(server.bytes / 1024 / 1024).toFixed(2)} /{" "}
                  {(server.limit / 1024 / 1024).toFixed(0)} MiB · {server.count}
                  개 파일
                </p>
                <progress
                  aria-label="Workspace 서버 파일 사용량"
                  value={server.bytes}
                  max={server.limit}
                />
                <p className="muted-text">
                  문서나 기록에서 사용 중인 파일은 보관합니다. 사용하지 않는
                  파일만 영구 정리할 수 있습니다.
                </p>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    void run();
                  }}
                >
                  용량 새로고침
                </button>
                <div className="storage-file-list">
                  {server.files.map((file) => (
                    <div className="storage-file" key={file.id}>
                      <div>
                        <strong>{file.name}</strong>
                        <small>
                          {file.pageTitle || "제목 없음"}
                          {file.pageDeletedAt ? " · 휴지통" : ""}
                          {file.deletedAt ? " · 삭제 표시됨" : ""} ·{" "}
                          {(file.size / 1024).toFixed(1)} KiB
                        </small>
                      </div>
                      <button
                        className="text-button danger-text"
                        aria-label={`${file.name} 파일 정리`}
                        disabled={busy}
                        onClick={() => {
                          setSelected(file);
                          setConfirmation("");
                          setError(null);
                        }}
                      >
                        정리
                      </button>
                    </div>
                  ))}
                  {!server.files.length && (
                    <p className="muted-text">서버에 저장된 파일이 없습니다.</p>
                  )}
                </div>
              </>
            )}
          </section>
        )}
        {selected && owner && (
          <section className="storage-confirm">
            <h3>{selected.name} 영구 정리</h3>
            <p>
              서버와 이 기기에서 파일을 삭제합니다. 되돌릴 수 없습니다. 문서나
              기록이 참조하면 정리를 거절합니다.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (confirmation === selected.name)
                  void run(async () => {
                    await purgeUnusedAttachment(
                      workspace.id,
                      selected.id,
                      confirmation,
                    );
                    setSelected(null);
                    setConfirmation("");
                  });
              }}
            >
              <label className="field-label">
                정리할 파일 이름
                <input
                  aria-label="정리할 파일 이름"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoFocus
                  maxLength={240}
                />
              </label>
              <div className="button-row">
                <button
                  className="button button-danger"
                  type="submit"
                  disabled={busy || !online || confirmation !== selected.name}
                >
                  영구 정리하기
                </button>
                <button
                  className="text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setSelected(null)}
                >
                  취소
                </button>
              </div>
            </form>
          </section>
        )}
        {error && (
          <p className="danger-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
