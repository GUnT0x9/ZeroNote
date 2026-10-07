"use client";
import { useEffect, useState } from "react";
import type * as Y from "yjs";
import {
  getDatabaseProperties,
  readDatabaseValue,
  writeDatabaseValue,
  databaseValueLabel,
  type DatabaseProperty,
  type TaskRow,
  type Identity,
  taskCompletionWarning,
  getTaskRows,
  getDatabaseMode,
  DEFAULT_HIDDEN_PROPERTIES,
} from "@zeronote/shared";
import { errorMessage } from "@/lib/database";
import type { LocalPage } from "@/lib/database";
import type { WorkspaceData } from "@/lib/hooks";
import {
  useDatabaseEditorContext,
  type DatabaseEditorContext,
} from "@/lib/database-context";
import {
  DatabaseComputedCell,
  DatabaseRelationCell,
  DatabaseFileCell,
} from "./database-advanced-cell";
import { TaskEstimateInput } from "./task-estimate";

export const PROPERTY_TYPE_LABELS = {
  text: "Text",
  number: "Number",
  select: "Select",
  multi_select: "Multi select",
  status: "Status",
  date: "Date",
  checkbox: "Checkbox",
  person: "Person",
  url: "URL",
  email: "Email",
  phone: "Phone",
  created_time: "Created time",
  updated_time: "Updated time",
  file: "File",
  formula: "Formula",
  relation: "Relation",
  rollup: "Rollup",
};
export function DatabasePropertyCell({
  document,
  row,
  property,
  editable,
  identities,
  label,
  context,
}: {
  document: Y.Doc;
  row: TaskRow;
  property: DatabaseProperty;
  editable: boolean;
  identities: Identity[];
  label?: string;
  context?: DatabaseEditorContext | null;
}) {
  const value = readDatabaseValue(document, row, property),
    ariaLabel = label ?? `${row.title} ${property.name}`;
  const [draft, setDraft] = useState(String(value ?? "")),
    [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(String(value ?? ""));
    setError(null);
  }, [value]);
  const commit = (next: unknown) => {
    if (!editable) return;
    try {
      if (property.builtin && property.id === "status") {
        const warning = taskCompletionWarning(
          getTaskRows(document),
          row.id,
          next,
        );
        if (warning && !window.confirm(warning)) return;
      }
      writeDatabaseValue(document, row.id, property.id, next);
      setError(null);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  let control;
  if (property.builtin && property.id === "estimateMinutes") {
    control = (
      <TaskEstimateInput
        document={document}
        row={row}
        editable={editable}
        label={ariaLabel}
      />
    );
  } else if (property.builtin && property.id === "labels") {
    control = (
      <span className="muted small">{row.labels.join(" · ") || "—"}</span>
    );
  } else if (
    ["file", "formula", "relation", "rollup"].includes(property.type)
  ) {
    const props = context
      ? { document, row, property, editable, context, label: ariaLabel }
      : null;
    control = !props ? (
      <span className="muted">정보 불러오는 중…</span>
    ) : property.type === "file" ? (
      <DatabaseFileCell {...props} />
    ) : property.type === "relation" ? (
      <DatabaseRelationCell {...props} />
    ) : (
      <DatabaseComputedCell {...props} />
    );
  } else if (["created_time", "updated_time"].includes(property.type)) {
    const timestamp =
      property.type === "created_time" ? row.createdAt : row.updatedAt;
    control = (
      <span className="muted small">
        {timestamp ? new Date(timestamp).toLocaleString("ko-KR") : "—"}
      </span>
    );
  } else if (property.type === "checkbox") {
    control = (
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={value === true}
        disabled={!editable}
        onChange={(event) => commit(event.target.checked)}
      />
    );
  } else if (property.type === "multi_select") {
    control = (
      <select
        multiple
        aria-label={ariaLabel}
        value={Array.isArray(value) ? value : []}
        disabled={!editable}
        onChange={(event) =>
          commit(
            Array.from(event.target.selectedOptions, (entry) => entry.value),
          )
        }
      >
        {property.options.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
    );
  } else if (["select", "status", "person"].includes(property.type)) {
    const options =
      property.type === "person"
        ? identities.map((identity) => ({
            id: identity.id,
            name: identity.name,
          }))
        : property.options;
    control = (
      <select
        aria-label={ariaLabel}
        className={
          property.id === "status" ? `status-select ${row.status}` : ""
        }
        value={String(value ?? "")}
        disabled={!editable}
        onChange={(event) => commit(event.target.value || null)}
      >
        {!(
          ["status", "priority"].includes(property.id) && property.builtin
        ) && <option value="">미지정</option>}
        {value && !options.some((entry) => entry.id === value) && (
          <option value={String(value)}>
            {databaseValueLabel(property, value, identities)}
          </option>
        )}
        {options.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {entry.name}
          </option>
        ))}
      </select>
    );
  } else {
    const inputType =
      property.type === "date"
        ? "date"
        : property.type === "number"
          ? "number"
          : property.type === "email"
            ? "email"
            : property.type === "url"
              ? "url"
              : property.type === "phone"
                ? "tel"
                : "text";
    control = (
      <input
        aria-label={ariaLabel}
        aria-invalid={!!error}
        type={inputType}
        step={property.type === "number" ? "any" : undefined}
        maxLength={property.id === "title" ? 500 : 10000}
        value={draft}
        readOnly={!editable}
        className={
          property.id === "title" && row.status === "done" ? "completed" : ""
        }
        onChange={(event) => {
          setDraft(event.target.value);
          if (["text", "date", "phone"].includes(property.type))
            commit(event.target.value || (property.id === "title" ? "" : null));
        }}
        onBlur={() => {
          if (!["text", "date", "phone"].includes(property.type))
            commit(
              draft === ""
                ? null
                : property.type === "number"
                  ? Number(draft)
                  : draft,
            );
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    );
  }
  return (
    <div className="database-property-cell">
      {control}
      {error && (
        <small className="danger-text" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
export function DatabaseRowProperties(props: {
  document: Y.Doc;
  row: TaskRow;
  editable: boolean;
  identities: Identity[];
  page: LocalPage;
  data: WorkspaceData;
  historical?: boolean;
}) {
  const context = useDatabaseEditorContext(
    props.document,
    props.page,
    props.data,
    props.historical,
  );
  const properties = getDatabaseProperties(props.document).filter(
      (property) => !["title", "labels"].includes(property.id),
    ),
    task = getDatabaseMode(props.document) === "task";
  const render = (property: DatabaseProperty) => (
    <div className="field-label" key={property.id}>
      <span>{property.name}</span>
      <DatabasePropertyCell {...props} property={property} context={context} />
    </div>
  );
  return (
    <>
      <div className="database-row-properties">
        {properties
          .filter(
            (property) =>
              !task || !DEFAULT_HIDDEN_PROPERTIES.includes(property.id),
          )
          .map(render)}
      </div>
      {task && (
        <details className="task-date-disclosure">
          <summary>날짜 · 생성/수정 기록</summary>
          <div className="database-row-properties">
            {properties
              .filter((property) =>
                DEFAULT_HIDDEN_PROPERTIES.includes(property.id),
              )
              .map(render)}
          </div>
        </details>
      )}
    </>
  );
}
