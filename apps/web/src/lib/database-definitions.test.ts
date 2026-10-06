import { expect, it } from "vitest";
import { DatabasePropertySchema } from "@zeronote/shared";
import {
  compilePropertyDefinition,
  initialPropertyDefinition,
} from "./database-definitions";
it("compiles typed definitions and rewrites renamed Formula names for editing", () => {
  const properties = [
    DatabasePropertySchema.parse({
      id: "points",
      name: "점수",
      type: "number",
    }),
  ];
  const draft = { ...initialPropertyDefinition(), formula: 'prop("점수") * 2' };
  const config = compilePropertyDefinition("formula", draft, properties);
  const property = DatabasePropertySchema.parse({
    id: "computed",
    name: "배수",
    type: "formula",
    ...config,
  });
  const edited = initialPropertyDefinition(property, [
    { ...properties[0]!, name: "새 점수" },
  ]);
  expect(edited.formula).toContain("새 점수");
  expect(
    compilePropertyDefinition("formula", edited, [
      { ...properties[0]!, name: "새 점수" },
    ]).formula?.ast,
  ).toEqual(config.formula?.ast);
  expect(
    compilePropertyDefinition(
      "relation",
      { ...draft, databaseId: crypto.randomUUID() },
      [],
    ),
  ).toHaveProperty("relation.databaseId");
  expect(
    compilePropertyDefinition(
      "rollup",
      { ...draft, relationPropertyId: "relation", targetPropertyId: "points" },
      [],
    ),
  ).toEqual({
    rollup: {
      relationPropertyId: "relation",
      targetPropertyId: "points",
      operation: "sum",
    },
  });
  expect(compilePropertyDefinition("text", draft, [])).toEqual({});
});
it("refuses unknown formulas and incomplete Relation/Rollup choices", () => {
  const empty = initialPropertyDefinition();
  expect(() =>
    compilePropertyDefinition("formula", { ...empty, formula: "eval(1)" }, []),
  ).toThrow();
  expect(() => compilePropertyDefinition("relation", empty, [])).toThrow(
    "Database",
  );
  expect(() => compilePropertyDefinition("rollup", empty, [])).toThrow(
    "Relation",
  );
});
