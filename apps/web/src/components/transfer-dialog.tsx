"use client";
import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { Dialog } from "./primitives";
import {
  downloadWorkspaceFormat,
  readTransferFile,
  type ExportFormat,
} from "@/lib/transfer";
import { errorMessage } from "@/lib/database";
import { requestSync } from "@/lib/sync";
import { importWorkspace } from "@/lib/workspace";
export function TransferDialog({
  workspaceId,
  pageId,
  onClose,
  onKey,
}: {
  workspaceId: string;
  pageId?: string;
  onClose: () => void;
  onKey: (key: string) => void;
}) {
  const [format, setFormat] = useState<ExportFormat>("json"),
    [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [importPassword, setImportPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [warnings, setWarnings] = useState<string[]>([]),
    [pending, setPending] = useState<Awaited<
      ReturnType<typeof readTransferFile>
    > | null>(null);
  const run = async (action: () => Promise<void>) => {
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
  return (
    <Dialog title={pageId ? "Page Export" : "데이터 이전"} onClose={onClose}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(async () => {
            if (format === "encrypted" && password !== confirmation)
              throw new Error("확인 암호가 일치하지 않습니다.");
            await downloadWorkspaceFormat(
              workspaceId,
              format,
              password,
              pageId,
            );
            setPassword("");
            setConfirmation("");
          });
        }}
      >
        <label className="field-label">
          Export 형식
          <select
            aria-label="Export 형식"
            value={format}
            disabled={busy}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            <option value="json">ZeroNote JSON</option>
            <option value="encrypted">암호화 백업</option>
            <option value="markdown">Markdown · 첨부/Database는 ZIP</option>
            <option value="html">HTML</option>
            {pageId && <option value="pdf">PDF</option>}
            <option value="zip">ZIP 백업 · Markdown/CSV/원본</option>
            <option value="notion">Notion 호환 · Markdown/CSV</option>
          </select>
        </label>
        {format === "encrypted" && (
          <>
            <label className="field-label">
              백업 암호
              <input
                aria-label="백업 암호"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={1024}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="field-label">
              암호 확인
              <input
                aria-label="백업 암호 확인"
                type="password"
                autoComplete="new-password"
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            <p className="muted-text">
              암호는 저장되지 않습니다. 분실하면 이 백업 파일을 복호화할 수
              없습니다.
            </p>
          </>
        )}
        <p className="muted-text">
          문서와 첨부를 내려받습니다. Recovery Key·초대·접근 권한은 포함하지
          않습니다.
        </p>
        <button className="button button-primary" type="submit" disabled={busy}>
          <Download size={15} />
          {busy ? "처리 중…" : "내려받기"}
        </button>
      </form>
      {!pageId && (
        <section className="transfer-import">
          <h3>가져오기</h3>
          <p className="muted-text">
            ZeroNote JSON/ZIP, Notion Markdown & CSV ZIP, Obsidian Vault ZIP,
            .md/.csv를 새 Workspace로 가져옵니다.
          </p>
          <label className="field-label">
            암호화 파일 암호
            <input
              aria-label="Import 백업 암호"
              type="password"
              autoComplete="off"
              value={importPassword}
              onChange={(event) => setImportPassword(event.target.value)}
            />
          </label>
          <label className="button import-label">
            <Upload size={15} />
            파일 선택
            <input
              aria-label="가져올 데이터 파일"
              type="file"
              accept=".json,.zip,.md,.csv"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file)
                  void run(async () => {
                    setPending(null);
                    const result = await readTransferFile(file, importPassword);
                    setImportPassword("");
                    setWarnings(result.warnings);
                    setPending(result);
                  });
              }}
            />
          </label>
        </section>
      )}
      {pending && (
        <div className="transfer-import">
          <p>
            {pending.workspace.name} · {pending.workspace.pages.length} Pages ·{" "}
            {pending.workspace.attachments?.length ?? 0}개 첨부
          </p>
          <button
            className="button button-primary"
            disabled={busy}
            onClick={() => {
              void run(async () => {
                const result = await importWorkspace(pending.workspace);
                requestSync();
                onKey(result.key);
              });
            }}
          >
            새 Workspace로 가져오기
          </button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="inline-warning" role="status">
          <p>가져온 내용 확인</p>
          <ul>
            {warnings.slice(0, 20).map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
          {warnings.length > 20 && (
            <p>
              그 외 {warnings.length - 20}개 문서에서도 같은 변환을
              적용했습니다.
            </p>
          )}
        </div>
      )}
      {error && (
        <div className="inline-warning" role="alert">
          {error}
        </div>
      )}
    </Dialog>
  );
}
