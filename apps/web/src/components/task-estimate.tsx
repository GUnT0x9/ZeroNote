"use client";
import { useState, useEffect } from "react";
import type * as Y from "yjs";
import {
  formatTaskEstimate,
  parseTaskEstimate,
  updateTaskField,
  type TaskRow,
} from "@zeronote/shared";
import { errorMessage } from "@/lib/database";

export function TaskEstimateInput({
  document,
  row,
  editable,
  label,
}: {
  document: Y.Doc;
  row: TaskRow;
  editable: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState(
    row.estimateMinutes === null ? "" : formatTaskEstimate(row.estimateMinutes),
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(
      row.estimateMinutes === null
        ? ""
        : formatTaskEstimate(row.estimateMinutes),
    );
    setError(null);
  }, [row.id, row.estimateMinutes]);
  const commit = () => {
    if (!editable) return;
    try {
      updateTaskField(
        document,
        row.id,
        "estimateMinutes",
        parseTaskEstimate(draft),
      );
      setError(null);
    } catch (problem) {
      setError(errorMessage(problem));
    }
  };
  return (
    <div className="database-property-cell">
      <input
        aria-label={label}
        aria-invalid={!!error}
        value={draft}
        maxLength={40}
        readOnly={!editable}
        placeholder="예: 1h 30m"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      {error && (
        <small className="danger-text" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
