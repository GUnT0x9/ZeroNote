"use client";
import { useState } from "react";
import { Pencil, X } from "lucide-react";
import type * as Y from "yjs";
import {
  getPageTags,
  setPageTag,
  removePageTag,
  renamePageTag,
  MAX_PAGE_TAGS,
  MAX_PAGE_TAG_LENGTH,
} from "@zeronote/shared";
import { useDocumentRevision } from "@/lib/hooks";
import { flushDocuments } from "@/lib/documents";
import { errorMessage } from "@/lib/database";

export function PageTags({
  document,
  editable,
}: {
  document: Y.Doc;
  editable: boolean;
}) {
  useDocumentRevision(document);
  const tags = getPageTags(document),
    [input, setInput] = useState(""),
    [editing, setEditing] = useState<string | null>(null),
    [name, setName] = useState(""),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  const change = async (action: () => void, saved?: () => void) => {
    if (!editable || pending) return;
    setPending(true);
    setError(null);
    try {
      action();
      await flushDocuments();
      saved?.();
    } catch (problem) {
      setError(errorMessage(problem));
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="page-tags" aria-label="Page Tags" aria-busy={pending}>
      <div className="property-row">
        <span>Tags</span>
        <span>
          {tags.length}/{MAX_PAGE_TAGS}
        </span>
      </div>
      <ul className="page-tag-list">
        {tags.map((tag) => (
          <li key={tag}>
            <span>{tag}</span>
            {editable && (
              <>
                <button
                  className="icon-button"
                  aria-label={`Tag ${tag} 이름 변경`}
                  disabled={pending}
                  onClick={() => {
                    setEditing(tag);
                    setName(tag);
                    setError(null);
                  }}
                >
                  <Pencil size={13} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Tag ${tag} 삭제`}
                  disabled={pending}
                  onClick={() =>
                    void change(
                      () => removePageTag(document, tag),
                      () => {
                        if (editing === tag) setEditing(null);
                      },
                    )
                  }
                >
                  <X size={13} />
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {!tags.length && <p className="panel-description">Tag가 없습니다.</p>}
      {editable &&
        (editing ? (
          <form
            className="page-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              void change(
                () => renamePageTag(document, editing, name),
                () => setEditing(null),
              );
            }}
          >
            <label className="field-label">
              Tag 이름
              <input
                value={name}
                maxLength={MAX_PAGE_TAG_LENGTH}
                disabled={pending}
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <div className="page-tag-actions">
              <button className="button" type="submit" disabled={pending}>
                Tag 이름 저장
              </button>
              <button
                className="text-button"
                type="button"
                disabled={pending}
                onClick={() => setEditing(null)}
              >
                Tag 이름 변경 취소
              </button>
            </div>
          </form>
        ) : (
          <form
            className="page-tag-form"
            onSubmit={(event) => {
              event.preventDefault();
              void change(
                () => setPageTag(document, input),
                () => setInput(""),
              );
            }}
          >
            <label className="field-label">
              Tag 추가
              <input
                value={input}
                maxLength={MAX_PAGE_TAG_LENGTH}
                disabled={pending}
                onChange={(event) => setInput(event.target.value)}
              />
            </label>
            <button
              className="button"
              type="submit"
              disabled={pending || !input.trim()}
            >
              추가
            </button>
          </form>
        ))}
      {error && (
        <p className="inline-warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
