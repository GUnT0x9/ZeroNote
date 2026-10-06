"use client";
import { useState } from "react";
import type * as Y from "yjs";
import {
  compileFormula,
  evaluateFormula,
  getDatabaseProperties,
  getTaskRows,
  RollupOperations,
  changeDatabaseProperty,
  MAX_FORMULA_LENGTH,
  type DatabaseProperty,
  type PropertyType,
} from "@zeronote/shared";
import type { DatabaseEditorContext } from "@/lib/database-context";
import { errorMessage } from "@/lib/database";

import {
  initialPropertyDefinition,
  compilePropertyDefinition,
  type PropertyDefinitionDraft,
} from "@/lib/database-definitions";

const ROLLUP_LABELS = {
  count: "연결 항목 수",
  count_values: "값 개수",
  unique: "고유 값",
  sum: "합계",
  average: "평균",
  min: "최솟값",
  max: "최댓값",
};

export function PropertyDefinitionFields({
  document,
  type,
  draft,
  onChange,
  context,
}: {
  document: Y.Doc;
  type: PropertyType;
  draft: PropertyDefinitionDraft;
  onChange: (draft: PropertyDefinitionDraft) => void;
  context: DatabaseEditorContext;
}) {
  const properties = getDatabaseProperties(document);
  const patch = (change: Partial<PropertyDefinitionDraft>) =>
    onChange({ ...draft, ...change });
  const relation = properties.find(
    (property) =>
      property.id === draft.relationPropertyId && property.type === "relation",
  );
  const target = relation?.relation
    ? context.databaseById(relation.relation.databaseId)
    : undefined;
  let preview: string | null = null,
    error: string | null = null;
  if (type === "formula" && draft.formula.trim()) {
    try {
      const ast = compileFormula(draft.formula, properties),
        row = getTaskRows(document)[0];
      if (row) {
        const result = evaluateFormula(ast, (id) => {
          const property = properties.find((candidate) => candidate.id === id)!;
          const cell = context.reader.formulaInput(row, property);
          if (cell.error) throw new Error(cell.error.message);
          return cell.value;
        });
        if (result.error) error = result.error.message;
        else
          preview = `${row.title || "첫 항목"}: ${Array.isArray(result.value) ? result.value.join(", ") : (result.value ?? "—")}`;
      } else preview = "항목을 추가하면 계산 결과를 볼 수 있습니다.";
    } catch (issue) {
      error = errorMessage(issue);
    }
  }
  if (type === "formula")
    return (
      <div className="database-definition-fields">
        <label className="field-label">
          수식
          <textarea
            aria-label="Formula 수식"
            value={draft.formula}
            maxLength={MAX_FORMULA_LENGTH}
            rows={3}
            placeholder={'prop("점수") * 2'}
            onChange={(event) => patch({ formula: event.target.value })}
          />
        </label>
        <small className="field-help">
          prop("속성 이름") · if · sum · round · length · concat
        </small>
        {preview && (
          <output
            className="database-formula-preview"
            aria-label="Formula 미리보기"
          >
            {preview}
          </output>
        )}
        {error && (
          <small className="danger-text" role="status">
            {error}
          </small>
        )}
      </div>
    );
  if (type === "relation")
    return (
      <label className="field-label">
        대상 Database
        <select
          aria-label="Relation 대상 Database"
          value={draft.databaseId}
          onChange={(event) => patch({ databaseId: event.target.value })}
          required
        >
          <option value="">Database 선택</option>
          {draft.databaseId &&
            !context.databases.some((page) => page.id === draft.databaseId) && (
              <option value={draft.databaseId}>접근할 수 없는 Database</option>
            )}
          {context.databases.map((page) => (
            <option key={page.id} value={page.id}>
              {page.title || "제목 없음"}
            </option>
          ))}
        </select>
      </label>
    );
  if (type === "rollup")
    return (
      <div className="database-definition-fields">
        <label className="field-label">
          Relation
          <select
            aria-label="Rollup Relation"
            value={draft.relationPropertyId}
            onChange={(event) =>
              patch({
                relationPropertyId: event.target.value,
                targetPropertyId: "",
              })
            }
            required
          >
            <option value="">Relation 선택</option>
            {properties
              .filter((property) => property.type === "relation")
              .map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field-label">
          집계 속성
          <select
            aria-label="Rollup 집계 속성"
            value={draft.targetPropertyId}
            onChange={(event) =>
              patch({ targetPropertyId: event.target.value })
            }
            required
            disabled={!target}
          >
            <option value="">속성 선택</option>
            {target &&
              getDatabaseProperties(target).map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
          </select>
        </label>
        {relation && !target && (
          <small className="danger-text" role="status">
            대상 Database에 접근할 수 없거나 이 기기에 저장되지 않았습니다.
          </small>
        )}
        <label className="field-label">
          계산
          <select
            aria-label="Rollup 계산"
            value={draft.operation}
            onChange={(event) =>
              patch({
                operation: event.target
                  .value as PropertyDefinitionDraft["operation"],
              })
            }
          >
            {RollupOperations.map((operation) => (
              <option key={operation} value={operation}>
                {ROLLUP_LABELS[operation]}
              </option>
            ))}
          </select>
        </label>
      </div>
    );
  return null;
}
export function EditPropertyDefinition({
  document,
  property,
  context,
  onSaved,
  onClose,
}: {
  document: Y.Doc;
  property: DatabaseProperty;
  context: DatabaseEditorContext;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    initialPropertyDefinition(property, getDatabaseProperties(document)),
  );
  const [confirmed, confirm] = useState(false),
    [error, setError] = useState<string | null>(null);
  const changedTarget =
    property.type === "relation" &&
    property.relation?.databaseId !== draft.databaseId;
  return (
    <form
      className="database-edit-definition"
      onSubmit={(event) => {
        event.preventDefault();
        try {
          if (changedTarget && !confirmed)
            throw new Error("대상 변경 시 기존 연결 해제를 확인해주세요.");
          changeDatabaseProperty(
            document,
            property.id,
            compilePropertyDefinition(
              property.type,
              draft,
              getDatabaseProperties(document),
            ),
          );
          onSaved();
          onClose();
        } catch (issue) {
          setError(errorMessage(issue));
        }
      }}
    >
      <strong>{property.name} 설정</strong>
      <PropertyDefinitionFields
        document={document}
        type={property.type}
        draft={draft}
        onChange={setDraft}
        context={context}
      />
      {changedTarget && (
        <label className="check-label">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => confirm(event.target.checked)}
          />
          대상을 바꾸고 이 속성의 기존 연결을 해제합니다.
        </label>
      )}
      {error && (
        <div className="inline-warning" role="alert">
          {error}
        </div>
      )}
      <div className="button-row">
        <button className="button button-small" type="button" onClick={onClose}>
          취소
        </button>
        <button
          className="button button-small"
          type="submit"
          disabled={changedTarget && !confirmed}
        >
          설정 저장
        </button>
      </div>
    </form>
  );
}
