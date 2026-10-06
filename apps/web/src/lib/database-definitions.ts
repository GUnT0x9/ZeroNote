import {
  compileFormula,
  formatFormula,
  RollupOperations,
  type DatabaseProperty,
  type DatabasePropertyConfiguration,
  type PropertyType,
} from "@zeronote/shared";
export interface PropertyDefinitionDraft {
  formula: string;
  databaseId: string;
  relationPropertyId: string;
  targetPropertyId: string;
  operation: (typeof RollupOperations)[number];
}
export function initialPropertyDefinition(
  property?: DatabaseProperty,
  properties: DatabaseProperty[] = [],
): PropertyDefinitionDraft {
  return {
    formula: property?.formula
      ? formatFormula(property.formula.ast, properties)
      : "",
    databaseId: property?.relation?.databaseId ?? "",
    relationPropertyId: property?.rollup?.relationPropertyId ?? "",
    targetPropertyId: property?.rollup?.targetPropertyId ?? "",
    operation: property?.rollup?.operation ?? "sum",
  };
}
export function compilePropertyDefinition(
  type: PropertyType,
  draft: PropertyDefinitionDraft,
  properties: DatabaseProperty[],
): DatabasePropertyConfiguration {
  if (type === "formula")
    return {
      formula: {
        source: draft.formula,
        ast: compileFormula(draft.formula, properties),
      },
    };
  if (type === "relation") {
    if (!draft.databaseId) throw new Error("대상 Database를 선택해주세요.");
    return { relation: { databaseId: draft.databaseId } };
  }
  if (type === "rollup") {
    if (!draft.relationPropertyId || !draft.targetPropertyId)
      throw new Error("Relation과 집계할 속성을 선택해주세요.");
    return {
      rollup: {
        relationPropertyId: draft.relationPropertyId,
        targetPropertyId: draft.targetPropertyId,
        operation: draft.operation,
      },
    };
  }
  return {};
}
