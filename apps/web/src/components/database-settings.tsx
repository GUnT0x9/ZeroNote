"use client";
import { useState } from "react";
import type * as Y from "yjs";
import {
  addDatabaseProperty,
  changeDatabaseProperty,
  getDatabaseProperties,
  PropertyTypes,
  type PropertyType,
  type DatabaseView,
  type DatabaseProperty,
  type DatabaseFilter,
} from "@zeronote/shared";
import { Dialog } from "./primitives";
import { PROPERTY_TYPE_LABELS } from "./database-property";
import { errorMessage } from "@/lib/database";
import {
  initialPropertyDefinition,
  compilePropertyDefinition,
} from "@/lib/database-definitions";
import type { DatabaseEditorContext } from "@/lib/database-context";
import {
  PropertyDefinitionFields,
  EditPropertyDefinition,
} from "./database-property-definition";
export function DatabasePropertyDialog({
  document,
  onClose,
  context,
}: {
  document: Y.Doc;
  onClose: () => void;
  context: DatabaseEditorContext;
}) {
  const [name, setName] = useState(""),
    [type, setType] = useState<PropertyType>("text"),
    [options, setOptions] = useState(""),
    [error, setError] = useState<string | null>(null),
    [, refresh] = useState(0);
  const [definition, setDefinition] = useState(() =>
      initialPropertyDefinition(),
    ),
    [editing, setEditing] = useState<string | null>(null);
  const run = (action: () => void) => {
    try {
      action();
      setError(null);
      refresh((value) => value + 1);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  return (
    <Dialog title="Database 속성" onClose={onClose}>
      <div className="database-property-list">
        {getDatabaseProperties(document).map((property) => (
          <div className="database-property-definition" key={property.id}>
            <span>{PROPERTY_TYPE_LABELS[property.type]}</span>
            <input
              aria-label={`${property.name} 속성 이름`}
              defaultValue={property.name}
              key={`${property.id}:${property.name}`}
              maxLength={80}
              readOnly={property.builtin}
              onBlur={(event) => {
                if (event.target.value !== property.name)
                  run(() =>
                    changeDatabaseProperty(document, property.id, {
                      name: event.target.value,
                    }),
                  );
              }}
            />
            {!property.builtin && (
              <>
                {["formula", "relation", "rollup"].includes(property.type) && (
                  <button
                    className="text-button"
                    aria-label={`${property.name} 속성 설정`}
                    onClick={() =>
                      setEditing(editing === property.id ? null : property.id)
                    }
                  >
                    설정
                  </button>
                )}
                <button
                  className="text-button danger-text"
                  aria-label={`${property.name} 속성 삭제`}
                  onClick={() =>
                    run(() =>
                      changeDatabaseProperty(document, property.id, {
                        deleted: true,
                      }),
                    )
                  }
                >
                  삭제
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      {getDatabaseProperties(document)
        .filter((property) => property.id === editing)
        .map((property) => (
          <EditPropertyDefinition
            key={property.id}
            document={document}
            property={property}
            context={context}
            onClose={() => setEditing(null)}
            onSaved={() => refresh((value) => value + 1)}
          />
        ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          run(() => {
            addDatabaseProperty(
              document,
              name,
              type,
              options.split(","),
              crypto.randomUUID(),
              compilePropertyDefinition(
                type,
                definition,
                getDatabaseProperties(document),
              ),
            );
            setName("");
            setOptions("");
            setDefinition(initialPropertyDefinition());
          });
        }}
      >
        <label className="field-label">
          속성 이름
          <input
            aria-label="새 속성 이름"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label className="field-label">
          종류
          <select
            aria-label="새 속성 종류"
            value={type}
            onChange={(event) => setType(event.target.value as PropertyType)}
          >
            {PropertyTypes.map((entry) => (
              <option key={entry} value={entry}>
                {PROPERTY_TYPE_LABELS[entry]}
              </option>
            ))}
          </select>
        </label>
        {["select", "multi_select", "status"].includes(type) && (
          <label className="field-label">
            선택 항목
            <input
              aria-label="속성 선택 항목"
              placeholder="기획, 개발, 검토"
              value={options}
              onChange={(event) => setOptions(event.target.value)}
              required
            />
          </label>
        )}
        <PropertyDefinitionFields
          document={document}
          type={type}
          draft={definition}
          onChange={setDefinition}
          context={context}
        />
        {error && (
          <div className="inline-warning" role="alert">
            {error}
          </div>
        )}
        <div className="dialog-footer">
          <button className="button" type="button" onClick={onClose}>
            닫기
          </button>
          <button
            className="button button-primary"
            type="submit"
            disabled={!name.trim()}
          >
            속성 추가
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export function DatabaseViewSettings({
  view,
  properties,
  onChange,
}: {
  view: DatabaseView;
  properties: DatabaseProperty[];
  onChange: (view: DatabaseView) => void;
}) {
  const [section, setSection] = useState<
    "filter" | "sort" | "group" | "columns" | null
  >(null);
  const patch = (value: Partial<DatabaseView>) =>
    onChange({ ...view, ...value });
  const fields = (
    <>
      {properties.map((property) => (
        <option key={property.id} value={property.id}>
          {property.name}
        </option>
      ))}
    </>
  );
  return (
    <div className="database-view-controls">
      <div className="button-row">
        <button
          className={`button button-small ${section === "filter" ? "selected" : ""}`}
          aria-expanded={section === "filter"}
          onClick={() => setSection(section === "filter" ? null : "filter")}
        >
          Filter{view.filters.length ? ` (${view.filters.length})` : ""}
        </button>
        <button
          className="button button-small"
          aria-expanded={section === "sort"}
          onClick={() => setSection(section === "sort" ? null : "sort")}
        >
          Sort{view.sorts.length ? ` (${view.sorts.length})` : ""}
        </button>
        {!["calendar", "timeline"].includes(view.kind) && (
          <button
            className="button button-small"
            aria-expanded={section === "group"}
            onClick={() => setSection(section === "group" ? null : "group")}
          >
            Group
          </button>
        )}
        {!["calendar", "timeline", "board"].includes(view.kind) && (
          <button
            className="button button-small"
            aria-expanded={section === "columns"}
            onClick={() => setSection(section === "columns" ? null : "columns")}
          >
            표시 속성
          </button>
        )}
      </div>
      {section && (
        <div
          className="database-control-panel"
          role="region"
          aria-label={`${section} 설정`}
        >
          {section === "filter" && (
            <>
              {view.filters.map((filter, index) => (
                <div className="database-filter-row" key={index}>
                  <select
                    aria-label={`필터 ${index + 1} 속성`}
                    value={filter.propertyId}
                    onChange={(event) =>
                      patch({
                        filters: view.filters.map((entry, position) =>
                          position === index
                            ? {
                                ...entry,
                                propertyId: event.target.value,
                                value: null,
                              }
                            : entry,
                        ),
                      })
                    }
                  >
                    {fields}
                  </select>
                  <select
                    aria-label={`필터 ${index + 1} 조건`}
                    value={filter.operator}
                    onChange={(event) =>
                      patch({
                        filters: view.filters.map((entry, position) =>
                          position === index
                            ? {
                                ...entry,
                                operator: event.target
                                  .value as DatabaseFilter["operator"],
                              }
                            : entry,
                        ),
                      })
                    }
                  >
                    <option value="contains">포함</option>
                    <option value="equals">같음</option>
                    <option value="not_equals">다름</option>
                    <option value="empty">비어 있음</option>
                    <option value="not_empty">비어 있지 않음</option>
                    <option value="gt">초과 / 이후</option>
                    <option value="gte">이상</option>
                    <option value="lt">미만 / 이전</option>
                    <option value="lte">이하</option>
                  </select>
                  {!["empty", "not_empty"].includes(filter.operator) && (
                    <FilterValue
                      property={properties.find(
                        (property) => property.id === filter.propertyId,
                      )}
                      filter={filter}
                      label={`필터 ${index + 1} 값`}
                      onChange={(value) =>
                        patch({
                          filters: view.filters.map((entry, position) =>
                            position === index ? { ...entry, value } : entry,
                          ),
                        })
                      }
                    />
                  )}
                  <button
                    className="text-button"
                    aria-label={`필터 ${index + 1} 삭제`}
                    onClick={() =>
                      patch({
                        filters: view.filters.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    삭제
                  </button>
                </div>
              ))}
              <button
                className="text-button"
                disabled={view.filters.length >= 20}
                onClick={() =>
                  patch({
                    filters: [
                      ...view.filters,
                      { propertyId: "title", operator: "contains", value: "" },
                    ],
                  })
                }
              >
                필터 추가
              </button>
              {view.filters.length > 1 && (
                <small className="muted">
                  모든 조건을 만족하는 항목을 표시합니다.
                </small>
              )}
            </>
          )}
          {section === "sort" && (
            <>
              {view.sorts.map((sort, index) => (
                <div className="database-filter-row" key={index}>
                  <select
                    aria-label={`정렬 ${index + 1} 속성`}
                    value={sort.propertyId}
                    onChange={(event) =>
                      patch({
                        sorts: view.sorts.map((entry, position) =>
                          position === index
                            ? { ...entry, propertyId: event.target.value }
                            : entry,
                        ),
                      })
                    }
                  >
                    {fields}
                  </select>
                  <select
                    aria-label={`정렬 ${index + 1} 방향`}
                    value={sort.direction}
                    onChange={(event) =>
                      patch({
                        sorts: view.sorts.map((entry, position) =>
                          position === index
                            ? {
                                ...entry,
                                direction: event.target.value as "asc" | "desc",
                              }
                            : entry,
                        ),
                      })
                    }
                  >
                    <option value="asc">오름차순</option>
                    <option value="desc">내림차순</option>
                  </select>
                  <button
                    className="text-button"
                    aria-label={`정렬 ${index + 1} 삭제`}
                    onClick={() =>
                      patch({
                        sorts: view.sorts.filter(
                          (_, position) => position !== index,
                        ),
                      })
                    }
                  >
                    삭제
                  </button>
                </div>
              ))}
              <button
                className="text-button"
                disabled={view.sorts.length >= 5}
                onClick={() =>
                  patch({
                    sorts: [
                      ...view.sorts,
                      { propertyId: "title", direction: "asc" },
                    ],
                  })
                }
              >
                정렬 추가
              </button>
            </>
          )}
          {section === "group" && (
            <label className="field-label">
              그룹 속성
              <select
                aria-label="그룹 속성"
                value={view.groupBy ?? ""}
                onChange={(event) =>
                  patch({ groupBy: event.target.value || null })
                }
              >
                <option value="">그룹 없음</option>
                {properties
                  .filter(
                    (property) =>
                      ![
                        "multi_select",
                        "created_time",
                        "updated_time",
                      ].includes(property.type),
                  )
                  .map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {section === "columns" &&
            properties
              .filter((property) => property.id !== "title")
              .map((property) => (
                <label className="check-label" key={property.id}>
                  <input
                    type="checkbox"
                    aria-label={`${property.name} 표시`}
                    checked={!view.hiddenPropertyIds.includes(property.id)}
                    onChange={(event) =>
                      patch({
                        hiddenPropertyIds: event.target.checked
                          ? view.hiddenPropertyIds.filter(
                              (id) => id !== property.id,
                            )
                          : [...view.hiddenPropertyIds, property.id],
                      })
                    }
                  />
                  {property.name}
                </label>
              ))}
        </div>
      )}
      {["calendar", "timeline"].includes(view.kind) && (
        <div className="database-date-controls">
          <label>
            날짜 속성
            <select
              aria-label="날짜 속성"
              value={view.datePropertyId ?? ""}
              onChange={(event) =>
                patch({ datePropertyId: event.target.value || null })
              }
            >
              <option value="">선택 안 함</option>
              {properties
                .filter((property) => property.type === "date")
                .map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
            </select>
          </label>
          {view.kind === "timeline" && (
            <label>
              종료 날짜
              <select
                aria-label="종료 날짜 속성"
                value={view.endDatePropertyId ?? ""}
                onChange={(event) =>
                  patch({ endDatePropertyId: event.target.value || null })
                }
              >
                <option value="">시작 날짜와 같음</option>
                {properties
                  .filter((property) => property.type === "date")
                  .map((property) => (
                    <option key={property.id} value={property.id}>
                      {property.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
function FilterValue({
  property,
  filter,
  label,
  onChange,
}: {
  property: DatabaseProperty | undefined;
  filter: DatabaseFilter;
  label: string;
  onChange: (value: DatabaseFilter["value"]) => void;
}) {
  if (property?.type === "checkbox")
    return (
      <select
        aria-label={label}
        value={String(filter.value ?? "")}
        onChange={(event) =>
          onChange(
            event.target.value === "" ? null : event.target.value === "true",
          )
        }
      >
        <option value="">미지정</option>
        <option value="true">체크됨</option>
        <option value="false">미체크</option>
      </select>
    );
  if (property && ["select", "multi_select", "status"].includes(property.type))
    return (
      <select
        aria-label={label}
        value={String(filter.value ?? "")}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <option value="">미지정</option>
        {property.options.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
    );
  return (
    <input
      aria-label={label}
      type={
        property?.type === "number"
          ? "number"
          : property?.type === "date"
            ? "date"
            : "text"
      }
      step="any"
      value={String(filter.value ?? "")}
      onChange={(event) =>
        onChange(
          property?.type === "number" && event.target.value !== ""
            ? Number(event.target.value)
            : event.target.value,
        )
      }
    />
  );
}
