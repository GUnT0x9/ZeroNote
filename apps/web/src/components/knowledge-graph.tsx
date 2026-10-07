"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Minus, Plus, RotateCcw } from "lucide-react";
import {
  KNOWLEDGE_NODE_LIMIT,
  type KnowledgeResponse,
  type KnowledgeNode,
} from "@zeronote/shared";
import type { WorkspaceData } from "@/lib/hooks";
import { useKnowledge } from "@/lib/use-knowledge";
import { useUiStore } from "@/lib/ui-store";
import { graphPositions } from "@/lib/graph-layout";
import { Dialog } from "./primitives";

const MIN_ZOOM = 0.08,
  MAX_ZOOM = 2.4,
  ZOOM_STEP = 1.3,
  PAN_STEP = 80;
export function KnowledgeGraphDialog({
  data,
  pageId,
  onClose,
}: {
  data: WorkspaceData;
  pageId: string;
  onClose: () => void;
}) {
  const ui = useUiStore(),
    [rootId, setRootId] = useState(pageId),
    [offset, setOffset] = useState(0),
    [history, setHistory] = useState<string[]>([]),
    [list, setList] = useState(false),
    [localOnly, setLocalOnly] = useState(false),
    knowledge = useKnowledge(data, rootId, offset, localOnly),
    { view } = knowledge;
  const explore = (id: string) => {
    if (id === rootId) return;
    setHistory((previous) => [...previous, rootId].slice(-40));
    setRootId(id);
    setOffset(0);
  };
  const open = (node: KnowledgeNode) => {
    ui.select(node.workspaceId, node.id);
    onClose();
  };
  return (
    <Dialog title="Knowledge Graph" wide onClose={onClose}>
      <div className="knowledge-graph-heading">
        <button
          className="icon-button"
          aria-label="이전 연결"
          disabled={!history.length}
          onClick={() => {
            setRootId(history.at(-1)!);
            setHistory((previous) => previous.slice(0, -1));
            setOffset(0);
          }}
        >
          <ArrowLeft size={16} />
        </button>
        <strong>{view.root?.title ?? "접근할 수 없는 Page"}</strong>
        {view.root && (
          <button className="text-button" onClick={() => open(view.root!)}>
            문서 열기
          </button>
        )}
      </div>
      <div className="knowledge-graph-controls">
        <button
          className="button button-small"
          aria-pressed={list}
          onClick={() => setList((previous) => !previous)}
        >
          {list ? "Graph로 보기" : "목록으로 보기"}
        </button>
        <label className="check-label">
          <input
            type="checkbox"
            checked={localOnly}
            onChange={(event) => setLocalOnly(event.target.checked)}
          />
          이 기기만 보기
        </label>
        <span className="muted small" role="status">
          {knowledge.server
            ? "접근 가능한 전체 연결"
            : knowledge.loading
              ? "서버 연결 확인 중 · 로컬 문서"
              : "이 기기에 저장된 문서"}
        </span>
        <button className="text-button" onClick={knowledge.reload}>
          새로고침
        </button>
      </div>
      {knowledge.error && (
        <p className="inline-warning" role="alert">
          {knowledge.error}
        </p>
      )}
      {view.root ? (
        <>
          {list ? (
            <div className="knowledge-graph-list" aria-label="Graph 문서 목록">
              {view.nodes.map((node) => (
                <div key={node.id} className="knowledge-graph-list-row">
                  <button
                    className="backlink-item"
                    aria-label={`연결 탐색: ${node.title}`}
                    onClick={() => explore(node.id)}
                  >
                    {node.title}
                  </button>
                  <button
                    className="text-button"
                    aria-label={`${node.title} 문서 열기`}
                    onClick={() => open(node)}
                  >
                    열기
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <GraphViewport
              key={`${rootId}:${offset}`}
              view={view}
              explore={explore}
            />
          )}
          <div className="knowledge-graph-footer">
            <span className="muted small">
              연결된 문서 {view.neighborCount}개 · 언급: 실선 / Task: 파선 /
              Relation: 점선
            </span>
            {view.neighborCount > KNOWLEDGE_NODE_LIMIT - 1 && (
              <div className="knowledge-graph-pagination">
                <button
                  className="button button-small"
                  disabled={offset === 0}
                  onClick={() =>
                    setOffset((value) =>
                      Math.max(0, value - KNOWLEDGE_NODE_LIMIT + 1),
                    )
                  }
                >
                  이전 문서
                </button>
                <span>
                  {offset + 1}–
                  {Math.min(
                    offset + KNOWLEDGE_NODE_LIMIT - 1,
                    view.neighborCount,
                  )}
                </span>
                <button
                  className="button button-small"
                  disabled={
                    offset + KNOWLEDGE_NODE_LIMIT - 1 >= view.neighborCount
                  }
                  onClick={() =>
                    setOffset((value) => value + KNOWLEDGE_NODE_LIMIT - 1)
                  }
                >
                  다음 문서
                </button>
              </div>
            )}
            {view.edgeCount > view.edges.length && (
              <p className="muted small">
                연결선 {view.edgeCount}개 중 {view.edges.length}개를 표시합니다.
                문서를 선택해 범위를 좁힐 수 있습니다.
              </p>
            )}
            <p className="field-help">
              문서를 선택하면 연결을 탐색합니다. 방향키로 문서를 선택하고
              Enter로 이동하세요. 빈 공간을 드래그하거나 이동 버튼을 사용할 수
              있습니다.
            </p>
          </div>
        </>
      ) : (
        <p className="panel-description">
          삭제되었거나 접근 권한이 변경되었습니다.
        </p>
      )}
    </Dialog>
  );
}
function GraphViewport({
  view,
  explore,
}: {
  view: KnowledgeResponse;
  explore: (id: string) => void;
}) {
  const positions = useMemo(() => graphPositions(view.nodes), [view.nodes]),
    canvas = useRef<HTMLDivElement>(null),
    buttons = useRef(new Map<string, HTMLButtonElement>()),
    drag = useRef<{
      pointerId: number;
      x: number;
      y: number;
      panX: number;
      panY: number;
    } | null>(null),
    [zoom, setZoom] = useState(
      view.nodes.length > 40 ? 0.25 : view.nodes.length > 13 ? 0.4 : 0.6,
    ),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [focused, setFocused] = useState(view.nodes[0]?.id);
  const focusId = view.nodes.some((node) => node.id === focused)
    ? focused
    : view.nodes[0]?.id;
  const changeZoom = (value: number) =>
    setZoom((previous) =>
      Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous * value)),
    );
  const fit = () => {
    const radius = Math.max(
        0,
        ...[...positions.values()].map((point) => Math.hypot(point.x, point.y)),
      ),
      size = canvas.current?.getBoundingClientRect();
    setZoom(
      Math.max(
        MIN_ZOOM,
        Math.min(
          MAX_ZOOM,
          radius
            ? (Math.min(size?.width ?? 500, size?.height ?? 360) - 100) /
                (radius * 2)
            : 1,
        ),
      ),
    );
    setPan({ x: 0, y: 0 });
  };
  const layoutKey = view.nodes.map((node) => node.id).join("|");
  useEffect(() => {
    fit();
  }, [layoutKey]);
  return (
    <>
      <div className="knowledge-graph-toolbar" aria-label="Graph 보기 조절">
        <button
          className="icon-button"
          aria-label="Graph 축소"
          onClick={() => changeZoom(1 / ZOOM_STEP)}
        >
          <Minus size={15} />
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          className="icon-button"
          aria-label="Graph 확대"
          onClick={() => changeZoom(ZOOM_STEP)}
        >
          <Plus size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Graph 전체 맞추기"
          onClick={fit}
        >
          <RotateCcw size={15} />
        </button>
        {[
          { x: PAN_STEP, y: 0, label: "왼쪽" },
          { x: -PAN_STEP, y: 0, label: "오른쪽" },
          { x: 0, y: PAN_STEP, label: "위" },
          { x: 0, y: -PAN_STEP, label: "아래" },
        ].map((direction) => (
          <button
            className="text-button"
            key={direction.label}
            aria-label={`Graph ${direction.label} 이동`}
            onClick={() =>
              setPan((previous) => ({
                x: previous.x + direction.x,
                y: previous.y + direction.y,
              }))
            }
          >
            {direction.label}
          </button>
        ))}
      </div>
      <div
        ref={canvas}
        className="knowledge-graph-canvas"
        aria-label="문서 연결 Graph"
        onPointerDown={(event) => {
          if (event.target instanceof Element && event.target.closest("button"))
            return;
          drag.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            panX: pan.x,
            panY: pan.y,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (current?.pointerId === event.pointerId)
            setPan({
              x: current.panX + event.clientX - current.x,
              y: current.panY + event.clientY - current.y,
            });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="knowledge-graph-world"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          }}
        >
          <svg
            className="knowledge-graph-edges"
            viewBox="-1800 -1800 3600 3600"
            aria-hidden="true"
          >
            <defs>
              <marker
                id="knowledge-direction"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
              </marker>
            </defs>
            {view.edges
              .filter((edge) => edge.sourceId !== edge.targetId)
              .map((edge) => {
                const source = positions.get(edge.sourceId)!,
                  target = positions.get(edge.targetId)!,
                  distance = Math.hypot(
                    target.x - source.x,
                    target.y - source.y,
                  ),
                  compact = zoom < 0.25 && edge.targetId !== view.root?.id,
                  dx = Math.abs(target.x - source.x) / distance,
                  dy = Math.abs(target.y - source.y) / distance,
                  margin =
                    Math.min(
                      dx ? (compact ? 16 : 64) / dx : Infinity,
                      dy ? (compact ? 16 : 22) / dy : Infinity,
                    ) + 8,
                  inset = Math.min(margin / zoom, distance / 2);
                return (
                  <line
                    key={`${edge.sourceId}:${edge.targetId}`}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x - ((target.x - source.x) * inset) / distance}
                    y2={target.y - ((target.y - source.y) * inset) / distance}
                    markerEnd="url(#knowledge-direction)"
                    vectorEffect="non-scaling-stroke"
                    strokeDasharray={
                      edge.kinds.includes("mention")
                        ? undefined
                        : edge.kinds.includes("task")
                          ? "10 6"
                          : "3 6"
                    }
                  />
                );
              })}
          </svg>
          {view.nodes.map((node, index) => {
            const point = positions.get(node.id)!;
            return (
              <button
                key={node.id}
                ref={(element) => {
                  if (element) buttons.current.set(node.id, element);
                  else buttons.current.delete(node.id);
                }}
                className={`knowledge-graph-node ${index === 0 ? "root" : ""} ${zoom < 0.25 && index > 0 ? "compact" : ""}`}
                style={{
                  left: point.x,
                  top: point.y,
                  transform: `translate(-50%, -50%) scale(${1 / zoom})`,
                }}
                tabIndex={focusId === node.id ? 0 : -1}
                title={node.title}
                aria-label={`연결 탐색: ${node.title}`}
                onFocus={() => setFocused(node.id)}
                onClick={() => explore(node.id)}
                onKeyDown={(event) => {
                  if (
                    ![
                      "ArrowRight",
                      "ArrowDown",
                      "ArrowLeft",
                      "ArrowUp",
                      "Home",
                      "End",
                    ].includes(event.key)
                  )
                    return;
                  event.preventDefault();
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? view.nodes.length - 1
                        : (index +
                            (["ArrowRight", "ArrowDown"].includes(event.key)
                              ? 1
                              : -1) +
                            view.nodes.length) %
                          view.nodes.length;
                  const nextNode = view.nodes[next]!,
                    point = positions.get(nextNode.id)!;
                  buttons.current
                    .get(nextNode.id)
                    ?.focus({ preventScroll: true });
                  setPan({ x: -point.x * zoom, y: -point.y * zoom });
                }}
              >
                {node.title || "제목 없음"}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
