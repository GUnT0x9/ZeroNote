"use client";
import { useEffect, useRef, useState } from "react";
import {
  PublicSecretSchema,
  type PublicContent,
  type PublicShare,
} from "@zeronote/shared";
import { ApiError, requestJson, WAKE_TIMEOUT_MS } from "@/lib/http";
import {
  publicReaderSecret,
  publicReadingError,
  readPublicContent,
  readPublicDescriptor,
} from "@/lib/public-reading";

export function PublicArticle({ content }: { content: PublicContent }) {
  return (
    <>
      <nav className="public-navigation" aria-label="공개 Page">
        {content.pages.length > 1 &&
          content.pages.map((page) => (
            <a
              key={page.key}
              aria-current={page.key === content.page.key ? "page" : undefined}
              href={`/s/${content.share.id}/${page.key}`}
            >
              {page.title || "제목 없음"}
            </a>
          ))}
      </nav>
      <article className="public-article">
        <h1>{content.page.title || "제목 없음"}</h1>
        <div
          className="public-document"
          dangerouslySetInnerHTML={{ __html: content.page.html }}
        />
      </article>
    </>
  );
}
export function PublicReader({
  id,
  pageKey,
  initialContent,
  initialShare,
  initialError,
}: {
  id: string;
  pageKey?: string;
  initialContent: PublicContent | null;
  initialShare: PublicShare | null;
  initialError?: string;
}) {
  const [content, setContent] = useState(initialContent),
    [share, setShare] = useState(initialShare);
  const [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const secret = useRef<string | null>(null),
    attempt = useRef<{ operationId: string; readerSecret: string } | null>(
      null,
    );
  useEffect(() => {
    const parsed = PublicSecretSchema.safeParse(window.location.hash.slice(1));
    secret.current = parsed.success ? parsed.data : null;
    if (initialContent || !initialShare?.protected) return;
    let active = true;
    void readPublicContent(id, pageKey)
      .then((value) => {
        if (active) setContent(value);
      })
      .catch((problem) => {
        if (active && !(problem instanceof ApiError && problem.status === 401))
          setError(publicReadingError(problem));
      });
    return () => {
      active = false;
    };
  }, [id, pageKey, initialContent, initialShare]);
  useEffect(() => {
    if (content)
      document.title = `${content.page.title || "제목 없음"} | ZeroNote`;
  }, [content]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (problem) {
      setContent(null);
      setError(publicReadingError(problem));
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    if (!secret.current)
      throw new Error("접근 정보가 포함된 원래 링크 전체를 다시 열어주세요.");
    attempt.current ??= {
      operationId: crypto.randomUUID(),
      readerSecret: publicReaderSecret(),
    };
    await requestJson(
      `/public/${id}/open`,
      "POST",
      {
        ...attempt.current,
        secret: secret.current,
        password: share?.passwordRequired ? password : null,
      },
      WAKE_TIMEOUT_MS,
    );
    setPassword("");
    const next = await readPublicContent(id, pageKey);
    setContent(next);
    window.history.replaceState(null, "", window.location.pathname);
  };
  return (
    <main className="public-shell">
      <header className="public-header">
        <a href="/" aria-label="ZeroNote 홈">
          ZeroNote
        </a>
        <span>읽기 전용</span>
        <button
          className="text-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const descriptor = await readPublicDescriptor(id);
              setShare(descriptor);
              setContent(null);
              setContent(await readPublicContent(id, pageKey));
            })
          }
        >
          새로고침
        </button>
      </header>
      {content ? (
        <PublicArticle content={content} />
      ) : (
        <section className="public-gate">
          <h1>
            {share?.mode === "burn"
              ? "1회 열람 문서"
              : share?.protected
                ? "보호된 문서"
                : "공유 문서"}
          </h1>
          {share?.protected && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(open);
              }}
            >
              <p>
                {share.mode === "burn"
                  ? "열기 버튼을 누른 첫 기기에서 최대 1시간 읽을 수 있습니다."
                  : "링크의 접근 정보를 확인한 뒤 문서를 엽니다."}
              </p>
              {share.passwordRequired && (
                <label className="field-label">
                  비밀번호
                  <input
                    aria-label="문서 비밀번호"
                    type="password"
                    maxLength={128}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoFocus
                  />
                </label>
              )}
              <button
                className="button button-primary"
                disabled={busy || (share.passwordRequired && !password)}
                type="submit"
              >
                {busy ? "연결 중…" : "문서 열기"}
              </button>
            </form>
          )}
          {!share && <p>연결 상태를 확인하고 새로고침해주세요.</p>}
        </section>
      )}
      {error && (
        <p className="public-error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
