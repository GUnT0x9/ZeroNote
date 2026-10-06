import * as Y from "yjs";
import {
  getDatabaseProperties,
  readDatabaseValue,
  validateDatabaseValue,
  databaseValueLabel,
  type DatabaseProperty,
  type PropertyValue,
  type RollupDefinition,
} from "./database";
import { getTaskRows, type TaskRow } from "./index";
import {
  assertFormulaNode,
  evaluateFormula,
  FormulaError,
  type FormulaNode,
  type FormulaResult,
} from "./formula";

const MAX_DATABASE_DEPENDENCY_DEPTH = 32;
const MAX_DATABASE_COMPUTATION_STEPS = 4096;
export interface DatabaseComputationScope {
  database?: (id: string) => Y.Doc | undefined;
  fileName?: (databaseId: string, fileId: string) => string | undefined;
  personName?: (identityId: string) => string | undefined;
  publicOnly?: boolean;
}
export interface DatabaseValueReader {
  cell: (row: TaskRow, property: DatabaseProperty) => FormulaResult;
  formulaInput: (row: TaskRow, property: DatabaseProperty) => FormulaResult;
  label: (row: TaskRow, property: DatabaseProperty) => string;
}
interface DatabaseModel {
  id: string;
  document: Y.Doc;
  properties: Map<string, DatabaseProperty>;
  rows: Map<string, TaskRow>;
}
export function formulaPropertyIds(node: unknown): string[] {
  assertFormulaNode(node);
  const ids = new Set<string>(),
    stack: FormulaNode[] = [node];
  while (stack.length) {
    const current = stack.pop()!;
    if (current.type === "property") ids.add(current.propertyId);
    else if (current.type === "unary") stack.push(current.operand);
    else if (current.type === "binary") stack.push(current.left, current.right);
    else if (current.type === "call") stack.push(...current.arguments);
  }
  return [...ids];
}
export function aggregateDatabaseValues(
  operation: RollupDefinition["operation"],
  values: PropertyValue[],
  rowCount: number,
): PropertyValue {
  const flattened = values.flatMap((value) =>
    value === null || value === ""
      ? []
      : Array.isArray(value)
        ? value
        : [value],
  );
  if (operation === "count") return rowCount;
  if (operation === "count_values") return flattened.length;
  if (operation === "unique") return [...new Set(flattened.map(String))];
  const numbers = flattened.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new FormulaError("type", "숫자 속성을 선택해주세요.");
    return value;
  });
  if (!numbers.length) return operation === "sum" ? 0 : null;
  const value =
    operation === "min"
      ? Math.min(...numbers)
      : operation === "max"
        ? Math.max(...numbers)
        : numbers.reduce((sum, number) => sum + number, 0) /
          (operation === "average" ? numbers.length : 1);
  if (!Number.isFinite(value))
    throw new FormulaError("type", "계산 결과가 유한한 숫자가 아닙니다.");
  return value;
}
/** A reader is a short-lived snapshot cache: recreate it after document/scope changes. */
export function createDatabaseValueReader(
  databaseId: string,
  document: Y.Doc,
  scope: DatabaseComputationScope = {},
): DatabaseValueReader {
  const models = new Map<string, DatabaseModel>(),
    cells = new Map<string, FormulaResult>(),
    evaluating = new Set<string>();
  let steps = 0;
  const createModel = (id: string, state: Y.Doc): DatabaseModel => ({
    id,
    document: state,
    properties: new Map(
      getDatabaseProperties(state).map((property) => [property.id, property]),
    ),
    rows: new Map(getTaskRows(state).map((row) => [row.id, row])),
  });
  models.set(databaseId, createModel(databaseId, document));
  const modelFor = (id: string): DatabaseModel => {
    const cached = models.get(id);
    if (cached) return cached;
    const target = scope.database?.(id);
    if (!target)
      throw new FormulaError(
        "reference",
        "대상 Database에 접근할 수 없거나 이 기기에 저장되지 않았습니다.",
      );
    const model = createModel(id, target);
    models.set(id, model);
    return model;
  };
  const propertyFor = (model: DatabaseModel, id: string): DatabaseProperty => {
    const property = model.properties.get(id);
    if (!property)
      throw new FormulaError(
        "reference",
        "필요한 속성이 삭제되었거나 없습니다.",
      );
    return property;
  };
  const relationTarget = (relation: DatabaseProperty): DatabaseModel => {
    if (relation.type !== "relation" || !relation.relation)
      throw new FormulaError("reference", "Relation 속성을 선택해주세요.");
    return modelFor(relation.relation.databaseId);
  };
  const labelsFor = (
    model: DatabaseModel,
    property: DatabaseProperty,
    value: PropertyValue,
  ): string[] => {
    if (property.type === "relation") {
      const target = relationTarget(property);
      return (Array.isArray(value) ? value : []).flatMap((id) => {
        const row = target.rows.get(id);
        return row ? [row.title || "제목 없음"] : [];
      });
    }
    if (property.type === "file")
      return (Array.isArray(value) ? value : []).map((id) => {
        const name = scope.fileName?.(model.id, id);
        if (name === undefined)
          throw new FormulaError("reference", "파일 정보를 읽을 수 없습니다.");
        return name;
      });
    return Array.isArray(value)
      ? value.map(
          (id) =>
            property.options.find((option) => option.id === id)?.name ??
            "미지정",
        )
      : [];
  };
  const formulaValue = (
    model: DatabaseModel,
    property: DatabaseProperty,
    value: PropertyValue,
  ): PropertyValue => {
    if (["relation", "file", "multi_select"].includes(property.type))
      return labelsFor(model, property, value);
    if (["select", "status"].includes(property.type) && value !== null)
      return databaseValueLabel(property, value);
    if (property.type === "person" && value !== null) {
      if (scope.publicOnly)
        throw new FormulaError("reference", "이 속성은 공개할 수 없습니다.");
      return scope.personName?.(String(value)) ?? "알 수 없는 기기";
    }
    return value;
  };
  const assertPublicDependencies = (
    model: DatabaseModel,
    property: DatabaseProperty,
    seen: Set<string>,
    depth: number,
  ): void => {
    if (!scope.publicOnly) return;
    if (depth > MAX_DATABASE_DEPENDENCY_DEPTH)
      throw new FormulaError("limit", "속성 의존이 너무 깊습니다.");
    const key = `${model.id}:${property.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (property.type === "person")
      throw new FormulaError("reference", "이 속성은 공개할 수 없습니다.");
    if (property.formula)
      for (const id of formulaPropertyIds(property.formula.ast))
        assertPublicDependencies(
          model,
          propertyFor(model, id),
          seen,
          depth + 1,
        );
    if (property.relation) relationTarget(property);
    if (property.rollup) {
      const target = relationTarget(
        propertyFor(model, property.rollup.relationPropertyId),
      );
      assertPublicDependencies(
        target,
        propertyFor(target, property.rollup.targetPropertyId),
        seen,
        depth + 1,
      );
    }
  };
  const relatedRows = (
    model: DatabaseModel,
    row: TaskRow,
    relation: DatabaseProperty,
  ): { target: DatabaseModel; rows: TaskRow[] } => {
    const target = relationTarget(relation);
    const ids =
      validateDatabaseValue(
        relation,
        readDatabaseValue(model.document, row, relation),
      ) ?? [];
    if (!Array.isArray(ids))
      throw new FormulaError("type", "Relation 값이 올바르지 않습니다.");
    return {
      target,
      rows: ids.flatMap((id) => {
        const item = target.rows.get(id);
        return item ? [item] : [];
      }),
    };
  };
  const evaluateProperty = (
    model: DatabaseModel,
    row: TaskRow,
    property: DatabaseProperty,
    depth: number,
  ): PropertyValue => {
    assertPublicDependencies(model, property, new Set(), 0);
    if (property.formula) {
      const result = evaluateFormula(property.formula.ast, (id) => {
        const dependency = propertyFor(model, id),
          value = readCell(model, row, dependency, depth + 1);
        if (value.error)
          throw new FormulaError(value.error.code, value.error.message);
        return formulaValue(model, dependency, value.value);
      });
      if (result.error)
        throw new FormulaError(result.error.code, result.error.message);
      return result.value;
    }
    if (property.rollup) {
      const relation = propertyFor(model, property.rollup.relationPropertyId);
      const { target, rows } = relatedRows(model, row, relation);
      const dependency = propertyFor(target, property.rollup.targetPropertyId);
      assertPublicDependencies(target, dependency, new Set(), 0);
      const values = rows.map((related) => {
        const result = readCell(target, related, dependency, depth + 1);
        if (result.error)
          throw new FormulaError(result.error.code, result.error.message);
        return formulaValue(target, dependency, result.value);
      });
      return aggregateDatabaseValues(
        property.rollup.operation,
        values,
        rows.length,
      );
    }
    if (property.type === "relation")
      return relatedRows(model, row, property).rows.map(
        (related) => related.id,
      );
    const value = readDatabaseValue(model.document, row, property);
    if (property.type === "file") {
      const ids = validateDatabaseValue(property, value);
      labelsFor(model, property, ids);
      return ids;
    }
    return property.builtin ||
      ["created_time", "updated_time"].includes(property.type)
      ? value
      : validateDatabaseValue(property, value);
  };
  const readCell = (
    model: DatabaseModel,
    row: TaskRow,
    property: DatabaseProperty,
    depth: number,
  ): FormulaResult => {
    const key = `${model.id}:${row.id}:${property.id}`;
    if (
      ++steps > MAX_DATABASE_COMPUTATION_STEPS ||
      depth > MAX_DATABASE_DEPENDENCY_DEPTH
    )
      throw new FormulaError("limit", "속성 계산 제한을 초과했습니다.");
    if (evaluating.has(key))
      throw new FormulaError("cycle", "속성에 순환 의존이 있습니다.");
    const cached = cells.get(key);
    if (cached) return cached;
    evaluating.add(key);
    let result: FormulaResult;
    try {
      result = {
        value: evaluateProperty(model, row, property, depth),
        error: null,
      };
    } catch (error) {
      const issue =
        error instanceof FormulaError
          ? error
          : new FormulaError("type", "속성 값이 올바르지 않습니다.");
      result = {
        value: null,
        error: { code: issue.code, message: issue.message },
      };
    } finally {
      evaluating.delete(key);
    }
    cells.set(key, result);
    return result;
  };
  const cell = (row: TaskRow, property: DatabaseProperty): FormulaResult => {
    steps = 0;
    return readCell(modelFor(databaseId), row, property, 0);
  };
  return {
    cell,
    formulaInput: (row, property) => {
      const result = cell(row, property);
      if (result.error) return result;
      try {
        return {
          value: formulaValue(modelFor(databaseId), property, result.value),
          error: null,
        };
      } catch (error) {
        const issue =
          error instanceof FormulaError
            ? error
            : new FormulaError("type", "속성 값이 올바르지 않습니다.");
        return {
          value: null,
          error: { code: issue.code, message: issue.message },
        };
      }
    },
    label: (row, property) => {
      const result = cell(row, property);
      if (result.error) return "—";
      if (["file", "relation"].includes(property.type))
        return labelsFor(modelFor(databaseId), property, result.value).join(
          ", ",
        );
      if (["formula", "rollup"].includes(property.type))
        return Array.isArray(result.value)
          ? result.value.join(", ")
          : result.value === null
            ? ""
            : String(result.value);
      if (property.type === "person")
        return result.value === null
          ? "미지정"
          : (scope.personName?.(String(result.value)) ?? "알 수 없는 기기");
      return databaseValueLabel(property, result.value);
    },
  };
}
