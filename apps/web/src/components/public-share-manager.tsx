"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  OwnedPublicShareSchema,
  PublicShareInputSchema,
  type OwnedPublicShare,
  type PublicShareInput,
} from "@zeronote/shared";
import { api, authenticate } from "@/lib/api";
import { database, errorMessage, type LocalPage } from "@/lib/database";
import { flushDocuments } from "@/lib/documents";
import { synchronize } from "@/lib/sync";
import { useUiStore } from "@/lib/ui-store";
import { Dialog } from "./primitives";

function randomSecret(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function localExpiry(): string {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}
export function PublicShareManager({
  workspaceId,
  pages,
  currentPage,
}: {
  workspaceId: string;
  pages?: LocalPage[];
  currentPage?: LocalPage;
}) {
  const online = useUiStore((state) => state.syncState === "online");
  const [records, setRecords] = useState<OwnedPublicShare[]>([]);
  const [selected, setSelected] = useState<string[]>(
    currentPage ? [currentPage.id] : [],
  );
  const [title, setTitle] = useState(currentPage?.title ?? "공개 Workspace");
  const [mode, setMode] = useState<PublicShareInput["mode"]>("public");
  const [passwordEnabled, setPasswordEnabled] = useState(false),
    [password, setPassword] = useState("");
  const [expiryEnabled, setExpiryEnabled] = useState(false),
    [expiry, setExpiry] = useState(localExpiry);
  const [seo, setSeo] = useState(false),
    [link, setLink] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false),
    [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const attempt = useRef<{ signature: string; input: PublicShareInput } | null>(
    null,
  );
  const protectedLink = passwordEnabled || expiryEnabled || mode !== "public";
  const read = async () => {
    await authenticate();
    setRecords(
      z
        .array(OwnedPublicShareSchema)
        .parse(await api(`/workspaces/${workspaceId}/public-shares`)),
    );
  };
  useEffect(() => {
    if (online) void read().catch((problem) => setError(errorMessage(problem)));
  }, [workspaceId, online]);
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
  const create = async () => {
    await flushDocuments();
    await synchronize();
    const documents = await database.documents.bulkGet(selected);
    if (
      documents.some(
        (document) =>
          document && document.generation > document.committedGeneration,
      )
    )
      throw new Error("선택한 문서의 서버 저장이 끝난 뒤 게시해주세요.");
    const draft = {
      title,
      pageIds: selected,
      mode,
      password: passwordEnabled ? password : null,
      expiresAt:
        expiryEnabled || mode !== "public"
          ? new Date(expiry).toISOString()
          : null,
      seo: seo && !protectedLink,
    };
    const signature = JSON.stringify(draft);
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        input: PublicShareInputSchema.parse({
          ...draft,
          operationId: crypto.randomUUID(),
          secret: protectedLink ? randomSecret() : null,
        }),
      };
    const input = attempt.current.input;
    const record = OwnedPublicShareSchema.parse(
      await api(`/workspaces/${workspaceId}/public-shares`, "POST", input),
    );
    setLink(
      `${window.location.origin}/s/${record.id}${input.secret ? `#${input.secret}` : ""}`,
    );
    setCopied(false);
    setPassword("");
    attempt.current = null;
    await read();
  };
  const visible = currentPage
    ? records.filter((record) => record.pageIds.includes(currentPage.id))
    : records;
  return (
    <div className="public-share-manager">
      <h3>웹에 게시</h3>
      <p className="field-help">
        선택한 Page와 Database의 모든 Row를 읽기 전용으로 공개합니다. Comments와
        하위 Page는 자동으로 포함되지 않습니다.
      </p>
      {!online && (
        <p className="inline-warning">
          공개 공유는 Online에서 관리할 수 있습니다.
        </p>
      )}
      <fieldset disabled={busy || !online}>
        {!currentPage && (
          <div className="public-page-selection" aria-label="게시할 Page 선택">
            {(pages ?? []).map((page) => (
              <label className="check-label" key={page.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(page.id)}
                  onChange={(event) =>
                    setSelected((value) =>
                      event.target.checked
                        ? [...value, page.id]
                        : value.filter((id) => id !== page.id),
                    )
                  }
                />
                {page.title || "제목 없음"}
              </label>
            ))}
          </div>
        )}
        <label className="field-label">
          공유 제목
          <input
            aria-label="공유 제목"
            value={title}
            maxLength={500}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field-label">
          공유 방식
          <select
            aria-label="공유 방식"
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as PublicShareInput["mode"])
            }
          >
            <option value="public">Public · 게시 해제 전까지</option>
            <option value="temporary">Temporary · 정한 시각까지</option>
            <option value="burn">1회 열람 · 처음 연 기기만</option>
          </select>
        </label>
        {mode === "burn" && (
          <p className="field-help">
            열기 버튼을 누른 첫 기기에서 최대 1시간 읽습니다. 최초 내용을
            고정하며, 이미 전달된 사본을 회수하지 않습니다.
          </p>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={passwordEnabled}
            onChange={(event) => setPasswordEnabled(event.target.checked)}
          />
          비밀번호 필요
        </label>
        {passwordEnabled && (
          <label className="field-label">
            공유 비밀번호
            <input
              aria-label="공유 비밀번호"
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            <span className="field-help">
              8–128자. 받는 사람에게 별도로 전달해주세요.
            </span>
          </label>
        )}
        {mode === "public" && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={expiryEnabled}
              onChange={(event) => setExpiryEnabled(event.target.checked)}
            />
            만료 시각 설정
          </label>
        )}
        {(expiryEnabled || mode !== "public") && (
          <label className="field-label">
            링크 만료 시각
            <input
              aria-label="링크 만료 시각"
              type="datetime-local"
              value={expiry}
              onChange={(event) => setExpiry(event.target.value)}
            />
            <span className="field-help">
              이 기기의 시간으로 표시하며 서버에서 만료를 검사합니다. 최대 90일.
            </span>
          </label>
        )}
        <label className="check-label">
          <input
            type="checkbox"
            checked={seo && !protectedLink}
            disabled={protectedLink}
            onChange={(event) => setSeo(event.target.checked)}
          />
          검색 엔진에 등록 허용
        </label>
        <button
          className="button full-width"
          disabled={
            !selected.length ||
            !title.trim() ||
            (passwordEnabled && password.length < 8)
          }
          onClick={() => void run(create)}
        >
          공개 링크 만들기
        </button>
      </fieldset>
      {link && (
        <div className="share-result">
          <label className="field-label">
            공개 링크
            <input aria-label="공개 링크" readOnly value={link} />
          </label>
          <button
            className="button full-width"
            onClick={() =>
              void run(async () => {
                await navigator.clipboard.writeText(link);
                setCopied(true);
              })
            }
          >
            {copied ? "복사됨" : "공개 링크 복사"}
          </button>
          <p className="field-help">
            보호된 링크는 나중에 다시 확인할 수 없습니다. 지금 복사해
            보관해주세요.
          </p>
        </div>
      )}
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
      <div className="panel-section">
        <h3>게시한 링크</h3>
        {!visible.length && (
          <p className="muted small">게시한 링크가 없습니다.</p>
        )}
        {visible.map((record) => {
          const expired =
            !!record.expiresAt && Date.parse(record.expiresAt) <= Date.now();
          return (
            <div className="public-share-record" key={record.id}>
              <strong>{record.title}</strong>
              <small>
                {record.revokedAt
                  ? "게시 해제됨"
                  : expired
                    ? "만료됨"
                    : record.mode === "burn" && record.opened
                      ? "첫 기기에 전달됨"
                      : `${record.pageIds.length}개 Page · ${record.mode}`}
                {record.passwordRequired ? " · 비밀번호" : ""}
                {record.expiresAt
                  ? ` · ${new Date(record.expiresAt).toLocaleString("ko-KR")}`
                  : ""}
              </small>
              {!record.protected && !record.revokedAt && (
                <a
                  className="text-button"
                  href={`/s/${record.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  공개 화면 보기
                </a>
              )}
              {!record.revokedAt &&
                (confirmRevoke === record.id ? (
                  <div className="button-row">
                    <button
                      className="button button-small danger-text"
                      disabled={busy || !online}
                      onClick={() =>
                        void run(async () => {
                          await api(
                            `/workspaces/${workspaceId}/public-shares/${record.id}`,
                            "DELETE",
                          );
                          setConfirmRevoke(null);
                          await read();
                        })
                      }
                    >
                      게시 해제 확인
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirmRevoke(null)}
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    className="text-button danger-text"
                    disabled={busy || !online}
                    onClick={() => setConfirmRevoke(record.id)}
                  >
                    게시 해제
                  </button>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
export function PublicWorkspaceDialog({
  workspaceId,
  pages,
  onClose,
}: {
  workspaceId: string;
  pages: LocalPage[];
  onClose: () => void;
}) {
  return (
    <Dialog title="Workspace 공개 공유" wide onClose={onClose}>
      <div className="settings-content">
        <PublicShareManager workspaceId={workspaceId} pages={pages} />
      </div>
    </Dialog>
  );
}
