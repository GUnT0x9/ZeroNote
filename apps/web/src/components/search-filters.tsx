"use client";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import {
  DatabasePropertySchema,
  type DatabaseProperty,
  type PropertyValue,
  type DatabaseFilter,
} from "@zeronote/shared";
import { Plus, X } from "lucide-react";
import type { WorkspaceData } from "@/lib/hooks";
import type {
  SearchFilters as FilterState,
  SearchPropertyCondition,
} from "@/lib/advanced-search";
import { EMPTY_SEARCH_FILTERS, localKnowledge } from "@/lib/advanced-search";
import { availablePages } from "@/lib/search";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/database";

const OPERATORS: { value: DatabaseFilter["operator"]; label: string }[] = [
  { value: "contains", label: "포함" },
  { value: "equals", label: "같음" },
  { value: "not_equals", label: "다름" },
  { value: "empty", label: "비어 있음" },
  { value: "not_empty", label: "값 있음" },
  { value: "gt", label: "초과" },
  { value: "gte", label: "이상" },
  { value: "lt", label: "미만" },
  { value: "lte", label: "이하" },
];
export function SearchFilters({
  data,
  value,
  onChange,
}: {
  data: WorkspaceData;
  value: FilterState;
  onChange: (value: FilterState) => void;
}) {
  const pages = availablePages(data.pages).filter(
    (page) =>
      page.kind === "database" &&
      (!value.workspaceId || page.workspaceId === value.workspaceId),
  );
  const selectedAccessible = pages.some((page) => page.id === value.databaseId);
  const record = selectedAccessible
    ? data.documents.find((doc) => doc.id === value.databaseId)
    : undefined;
  const local = useMemo(
    () => (record ? localKnowledge(record).properties : []),
    [record?.id, record?.generation, record?.updatedAt],
  );
  const [remote, setRemote] = useState<{
      id: string;
      properties: DatabaseProperty[];
    }>(),
    [error, setError] = useState("");
  const properties = !selectedAccessible
    ? []
    : record && record.generation > record.committedGeneration
      ? local
      : remote?.id === value.databaseId
        ? remote.properties
        : local;
  useEffect(() => {
    setError("");
    if (!value.databaseId || !navigator.onLine) return;
    const controller = new AbortController();
    void api(
      `/pages/${value.databaseId}/search-properties`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((input) => {
        if (!controller.signal.aborted)
          setRemote({
            id: value.databaseId,
            properties: z.array(DatabasePropertySchema).parse(input),
          });
      })
      .catch((problem) => {
        if (!controller.signal.aborted) setError(errorMessage(problem));
      });
    return () => controller.abort();
  }, [value.databaseId]);
  const patch = (change: Partial<FilterState>) =>
    onChange({ ...value, ...change });
  return (
    <div className="search-filters" aria-label="검색 필터">
      <div className="search-filter-grid">
        <label>
          Workspace
          <select
            aria-label="검색 Workspace"
            value={value.workspaceId}
            onChange={(event) =>
              patch({
                workspaceId: event.target.value,
                databaseId: "",
                properties: [],
              })
            }
          >
            <option value="">전체 Workspace</option>
            {data.workspaces
              .filter((workspace) => !workspace.accessLost)
              .map((workspace) => (
                <option key={workspace.id} value={workspace.id}>
                  {workspace.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          유형
          <select
            aria-label="검색 유형"
            value={value.type}
            onChange={(event) =>
              patch({ type: event.target.value as FilterState["type"] })
            }
          >
            <option value="">전체</option>
            <option value="document">Page</option>
            <option value="database">Database</option>
          </select>
        </label>
        <label>
          Tag
          <input
            aria-label="검색 Tag"
            maxLength={64}
            value={value.tag}
            placeholder="Tag 이름"
            onChange={(event) => patch({ tag: event.target.value })}
          />
        </label>
        <label>
          수정일 이상
          <input
            aria-label="검색 수정일 이상"
            type="date"
            value={value.after}
            onChange={(event) => patch({ after: event.target.value })}
          />
        </label>
        <label>
          수정일 미만
          <input
            aria-label="검색 수정일 미만"
            type="date"
            value={value.before}
            onChange={(event) => patch({ before: event.target.value })}
          />
        </label>
        <label>
          Database
          <select
            aria-label="검색 Database"
            value={value.databaseId}
            onChange={(event) =>
              patch({ databaseId: event.target.value, properties: [] })
            }
          >
            <option value="">전체 Database</option>
            {pages.map((page) => (
              <option key={page.id} value={page.id}>
                {page.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!!value.databaseId && (
        <>
          <PropertySearch
            key={value.databaseId}
            properties={properties}
            onAdd={(condition) =>
              patch({ properties: [...value.properties, condition] })
            }
          />
          {error && (
            <p className="search-scope" role="status">
              {local.length ? "이 기기의 속성을 사용합니다. " : ""}
              {error}
            </p>
          )}
        </>
      )}
      <div className="search-filter-chips">
        {value.properties.map((condition) => (
          <span key={condition.id}>
            {properties.find((property) => property.id === condition.propertyId)
              ?.name ?? "속성"}{" "}
            {
              OPERATORS.find(
                (operator) => operator.value === condition.operator,
              )?.label
            }{" "}
            {String(condition.value ?? "")}
            <button
              className="icon-button"
              aria-label="검색 속성 조건 삭제"
              onClick={() =>
                patch({
                  properties: value.properties.filter(
                    (item) => item.id !== condition.id,
                  ),
                })
              }
            >
              <X size={13} />
            </button>
          </span>
        ))}
        <button
          className="text-button"
          onClick={() => onChange(EMPTY_SEARCH_FILTERS)}
        >
          필터 초기화
        </button>
      </div>
    </div>
  );
}
function PropertySearch({
  properties,
  onAdd,
}: {
  properties: DatabaseProperty[];
  onAdd: (condition: SearchPropertyCondition) => void;
}) {
  const [id, setId] = useState(""),
    [operator, setOperator] = useState<DatabaseFilter["operator"]>("equals"),
    [input, setInput] = useState("");
  const property = properties.find((item) => item.id === id),
    empty = ["empty", "not_empty"].includes(operator);
  const typedValue: PropertyValue = empty
    ? null
    : property?.type === "number"
      ? input.trim()
        ? Number(input)
        : null
      : property?.type === "checkbox"
        ? input === "true"
        : input;
  const ready =
    !!property &&
    (empty || !!input) &&
    (typeof typedValue !== "number" || Number.isFinite(typedValue));
  return (
    <div className="search-property-condition">
      <select
        aria-label="검색 속성"
        value={id}
        onChange={(event) => {
          setId(event.target.value);
          setInput("");
        }}
      >
        <option value="">속성 선택</option>
        {properties.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <select
        aria-label="검색 속성 연산자"
        value={operator}
        onChange={(event) =>
          setOperator(event.target.value as DatabaseFilter["operator"])
        }
      >
        {OPERATORS.map((item) => (
          <option key={item.value} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
      {!empty &&
        (property?.type === "checkbox" ? (
          <select
            aria-label="검색 속성 값"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          >
            <option value="">선택</option>
            <option value="true">체크됨</option>
            <option value="false">체크 안 됨</option>
          </select>
        ) : property &&
          ["select", "status", "multi_select"].includes(property.type) ? (
          <select
            aria-label="검색 속성 값"
            value={input}
            onChange={(event) => setInput(event.target.value)}
          >
            <option value="">선택</option>
            {property.options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="검색 속성 값"
            type={
              property?.type === "number"
                ? "number"
                : property?.type === "date"
                  ? "date"
                  : "text"
            }
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="조건 값"
          />
        ))}
      <button
        className="button button-small"
        disabled={!ready}
        onClick={() => {
          if (property)
            onAdd({
              id: crypto.randomUUID(),
              propertyId: id,
              operator,
              value: typedValue,
            });
        }}
      >
        <Plus size={14} />
        조건 추가
      </button>
    </div>
  );
}
