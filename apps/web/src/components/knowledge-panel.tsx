"use client";
import { useRef, useState } from "react";
import { Link2, Network } from "lucide-react";
import {
  canEdit,
  knowledgeLinkKey,
  type KnowledgeIssue,
} from "@zeronote/shared";
import { useKnowledge } from "@/lib/use-knowledge";
import { useUiStore } from "@/lib/ui-store";
import type { WorkspaceData } from "@/lib/hooks";
import type { LocalPage } from "@/lib/database";
import { availablePages } from "@/lib/search";
import { KnowledgeGraphDialog } from "./knowledge-graph";
import { LinkReplacementDialog } from "./link-replacement";

const TABS = [
  { key: "incoming", label: "Backlinks" },
  { key: "related", label: "관련 문서" },
  { key: "issues", label: "링크 상태" },
] as const;
const ISSUE_NAMES = {
  trashed: "삭제된 Page",
  missing_row: "삭제되거나 없는 Row",
  unverified: "접근 확인 불가",
};
const LINK_NAMES = {
  mention: "Page Mention",
  task: "Task Link",
  relation: "Relation",
};
export function KnowledgePanel({
  page,
  data,
}: {
  page: LocalPage;
  data: WorkspaceData;
}) {
  const ui = useUiStore(),
    [tab, setTab] = useState<(typeof TABS)[number]["key"]>("incoming"),
    [graph, setGraph] = useState(false),
    [localOnly, setLocalOnly] = useState(false),
    [replacement, setReplacement] = useState<KnowledgeIssue | null>(null),
    tabs = useRef(new Map<string, HTMLButtonElement>()),
    knowledge = useKnowledge(data, page.id, 0, localOnly),
    { view } = knowledge,
    pages = new Map(
      availablePages(data.pages).map((entry) => [entry.id, entry]),
    ),
    editable = canEdit(page.role ?? "viewer") && pages.has(page.id);
  return (
    <div className="context-content knowledge-panel">
      <div className="knowledge-panel-tools">
        <button className="button button-small" onClick={() => setGraph(true)}>
          <Network size={15} />
          Graph 열기
        </button>
        <button className="text-button" onClick={knowledge.reload}>
          새로고침
        </button>
      </div>
      <p className="panel-description" role="status">
        {knowledge.server
          ? "접근 가능한 전체 문서의 연결입니다."
          : knowledge.loading
            ? "서버 연결 확인 중 · 로컬 문서를 표시합니다."
            : knowledge.pendingCreation
              ? "새 Page 등록 대기 · 로컬 문서를 표시합니다."
              : "이 기기에 저장된 문서의 연결입니다."}
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={localOnly}
          onChange={(event) => setLocalOnly(event.target.checked)}
        />
        이 기기만 보기
      </label>
      {knowledge.error && (
        <p className="inline-warning" role="alert">
          {knowledge.error}
        </p>
      )}
      {knowledge.unreadable > 0 && (
        <p className="inline-warning">
          로컬 문서 {knowledge.unreadable}개의 연결을 읽지 못했습니다. 원본
          데이터는 유지됩니다.
        </p>
      )}
      <div className="knowledge-tabs" role="tablist" aria-label="문서 연결">
        {TABS.map((item, index) => (
          <button
            key={item.key}
            ref={(element) => {
              if (element) tabs.current.set(item.key, element);
              else tabs.current.delete(item.key);
            }}
            role="tab"
            aria-selected={tab === item.key}
            aria-controls={`knowledge-${item.key}`}
            id={`knowledge-tab-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => setTab(item.key)}
            onKeyDown={(event) => {
              if (
                !["ArrowRight", "ArrowLeft", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const next =
                event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? TABS.length - 1
                    : (index +
                        (event.key === "ArrowRight" ? 1 : -1) +
                        TABS.length) %
                      TABS.length;
              setTab(TABS[next]!.key);
              tabs.current.get(TABS[next]!.key)?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`knowledge-${tab}`}
        aria-labelledby={`knowledge-tab-${tab}`}
        className="knowledge-results"
      >
        {tab === "incoming" && (
          <>
            {!view.incoming.length ? (
              <div className="panel-empty">
                <Link2 size={25} />
                <p>이 Page를 연결한 문서가 없습니다.</p>
                <small>문서에서 [[ 를 입력해 연결하세요.</small>
              </div>
            ) : (
              view.incoming.map((link) => {
                const source = pages.get(link.sourceId);
                if (!source) return null;
                const label = link.sourceRowTitle
                  ? `${link.sourceTitle} · ${link.sourceRowTitle}`
                  : link.sourceTitle;
                return (
                  <button
                    key={`${link.sourceId}:${link.sourceRowId ?? ""}:${link.targetRowId ?? ""}:${link.kind}`}
                    className="backlink-item"
                    aria-label={label}
                    onClick={() =>
                      ui.select(
                        source.workspaceId,
                        source.id,
                        link.sourceRowId ?? null,
                      )
                    }
                  >
                    <Link2 size={15} />
                    <span>
                      {label}
                      <small>{LINK_NAMES[link.kind]}</small>
                    </span>
                  </button>
                );
              })
            )}
            {view.incomingCount > view.incoming.length && (
              <p className="field-help">
                {view.incomingCount}개 중 {view.incoming.length}개를 표시합니다.
                Graph에서 문서별로 탐색할 수 있습니다.
              </p>
            )}
          </>
        )}
        {tab === "related" && (
          <>
            {!view.related.length ? (
              <p className="panel-description">
                연결·Tag·본문이 겹치는 문서가 없습니다.
              </p>
            ) : (
              view.related.map((entry) => (
                <div key={entry.id} className="knowledge-related">
                  <button
                    className="backlink-item"
                    aria-label={entry.title}
                    onClick={() => ui.select(entry.workspaceId, entry.id)}
                  >
                    {entry.title}
                  </button>
                  <p className="muted small">{entry.reasons.join(" · ")}</p>
                </div>
              ))
            )}
          </>
        )}
        {tab === "issues" && (
          <>
            <p className="field-help">
              확인할 수 없는 대상은 삭제로 단정하지 않습니다. 원래 링크는 교체
              전까지 유지됩니다.
            </p>
            {!view.issues.length ? (
              <p className="panel-description">확인된 끊긴 링크가 없습니다.</p>
            ) : (
              view.issues.map((issue) => (
                <div
                  key={knowledgeLinkKey(issue.link)}
                  className="knowledge-issue"
                >
                  <strong>{ISSUE_NAMES[issue.status]}</strong>
                  <span className="muted small">
                    {LINK_NAMES[issue.link.kind]} ·{" "}
                    {issue.link.sourceRowId
                      ? "Row 본문 또는 속성"
                      : "Page 본문"}
                  </span>
                  <div className="knowledge-issue-actions">
                    <button
                      className="text-button"
                      onClick={() =>
                        ui.select(
                          page.workspaceId,
                          page.id,
                          issue.link.sourceRowId ?? null,
                        )
                      }
                    >
                      원래 위치 열기
                    </button>
                    {editable && (
                      <button
                        className="text-button"
                        onClick={() => setReplacement(issue)}
                      >
                        교체
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
            {view.issueCount > view.issues.length && (
              <p className="field-help">
                {view.issueCount}개 중 {view.issues.length}개를 표시합니다.
                표시된 링크를 정리하면 나머지를 확인할 수 있습니다.
              </p>
            )}
          </>
        )}
      </div>
      {graph && (
        <KnowledgeGraphDialog
          data={data}
          pageId={page.id}
          onClose={() => setGraph(false)}
        />
      )}
      {replacement && (
        <LinkReplacementDialog
          page={page}
          data={data}
          issue={replacement}
          onClose={() => setReplacement(null)}
        />
      )}
    </div>
  );
}
