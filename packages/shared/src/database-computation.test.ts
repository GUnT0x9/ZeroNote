import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  initializeGenericDatabase,
  createTaskRow,
  getTaskRows,
  addDatabaseProperty,
  changeDatabaseProperty,
  getDatabaseProperties,
  writeDatabaseValue,
  DatabasePropertySchema,
  compileFormula,
  createDatabaseValueReader,
  aggregateDatabaseValues,
  formulaPropertyIds,
  defaultDatabaseView,
  queryDatabaseRows,
  groupDatabaseRows,
  assertDatabaseState,
  type DatabaseProperty,
} from "./index";
function fixture() {
  const source = new Y.Doc(),
    target = new Y.Doc(),
    sourceId = crypto.randomUUID(),
    targetId = crypto.randomUUID();
  initializeGenericDatabase(source);
  initializeGenericDatabase(target);
  const sourceRow = createTaskRow(source, "Project"),
    a = createTaskRow(target, "First"),
    b = createTaskRow(target, "Second");
  const points = addDatabaseProperty(target, "Points", "number");
  writeDatabaseValue(target, a, points, 2);
  writeDatabaseValue(target, b, points, 4);
  const relation = addDatabaseProperty(
    source,
    "Linked",
    "relation",
    [],
    crypto.randomUUID(),
    { relation: { databaseId: targetId } },
  );
  writeDatabaseValue(source, sourceRow, relation, [a, b]);
  const property = (document: Y.Doc, id: string): DatabaseProperty =>
    getDatabaseProperties(document).find((entry) => entry.id === id)!;
  const row = () => getTaskRows(source)[0]!;
  const reader = () =>
    createDatabaseValueReader(sourceId, source, {
      database: (id) => (id === targetId ? target : undefined),
    });
  const rollup = (
    operation:
      "count" | "count_values" | "unique" | "sum" | "average" | "min" | "max",
    targetPropertyId = points,
  ) =>
    addDatabaseProperty(source, operation, "rollup", [], crypto.randomUUID(), {
      rollup: { relationPropertyId: relation, targetPropertyId, operation },
    });
  return {
    source,
    target,
    sourceId,
    targetId,
    sourceRow,
    a,
    b,
    points,
    relation,
    property,
    row,
    reader,
    rollup,
  };
}
describe("Database configured Property contracts", () => {
  it("merges independent concurrent numeric and File field edits without changing computed definitions", () => {
    const f = fixture(),
      count = addDatabaseProperty(f.source, "Count", "number"),
      file = addDatabaseProperty(f.source, "File", "file");
    const a = new Y.Doc(),
      b = new Y.Doc(),
      fileId = crypto.randomUUID();
    const state = Y.encodeStateAsUpdate(f.source);
    Y.applyUpdate(a, state);
    Y.applyUpdate(b, state);
    writeDatabaseValue(a, f.sourceRow, count, 4);
    writeDatabaseValue(b, f.sourceRow, file, [fileId]);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const reader = createDatabaseValueReader(f.sourceId, a, {
      fileName: (_id, id) =>
        id === fileId ? "name, with comma.txt" : undefined,
    });
    expect(reader.cell(getTaskRows(a)[0]!, f.property(a, count)).value).toBe(4);
    expect(
      reader.formulaInput(getTaskRows(a)[0]!, f.property(a, file)).value,
    ).toEqual(["name, with comma.txt"]);
    const other = createDatabaseValueReader(f.sourceId, b, {
      fileName: () => "name, with comma.txt",
    });
    expect(other.cell(getTaskRows(b)[0]!, f.property(b, file)).value).toEqual([
      fileId,
    ]);
    a.destroy();
    b.destroy();
    f.source.destroy();
    f.target.destroy();
  });
  it("changes a Relation target by clearing old Row links while preserving its Property ID", () => {
    const f = fixture();
    changeDatabaseProperty(f.source, f.relation, {
      relation: { databaseId: crypto.randomUUID() },
    });
    expect(
      f.source
        .getMap<Y.Map<unknown>>("tasks")
        .get(f.sourceRow)!
        .get(`property:${f.relation}`),
    ).toBeUndefined();
    expect(f.property(f.source, f.relation).type).toBe("relation");
  });
  it("validates active Database definitions and link values before server persistence", () => {
    const f = fixture();
    expect(() => assertDatabaseState(f.source)).not.toThrow();
    const map = f.source
      .getMap<Y.Map<unknown>>("databaseProperties")
      .get(f.relation)!;
    map.set("relation", { databaseId: "invalid" });
    expect(() => assertDatabaseState(f.source)).toThrow("정의");
    map.set("deleted", true);
    expect(() => assertDatabaseState(f.source)).not.toThrow();
    map.set("deleted", false);
    map.set("relation", { databaseId: f.targetId });
    f.source
      .getMap<Y.Map<unknown>>("tasks")
      .get(f.sourceRow)!
      .set(`property:${f.relation}`, ["invalid"]);
    expect(() => assertDatabaseState(f.source)).toThrow();
  });
  it("stores typed definitions, validates reference arrays and prevents manual computed writes", () => {
    const f = fixture(),
      file = addDatabaseProperty(f.source, "Files", "file"),
      id = crypto.randomUUID();
    writeDatabaseValue(f.source, f.sourceRow, file, [id]);
    expect(() =>
      writeDatabaseValue(f.source, f.sourceRow, file, [id, id]),
    ).toThrow();
    expect(() =>
      writeDatabaseValue(f.source, f.sourceRow, f.relation, ["not-a-row-id"]),
    ).toThrow();
    const total = f.rollup("sum");
    expect(() => writeDatabaseValue(f.source, f.sourceRow, total, 5)).toThrow(
      "자동",
    );
    expect(f.reader().cell(f.row(), f.property(f.source, total))).toEqual({
      value: 6,
      error: null,
    });
  });
  it("rejects missing or mismatched definitions and forged ASTs", () => {
    expect(() => addDatabaseProperty(new Y.Doc(), "Bad", "formula")).toThrow();
    expect(() => addDatabaseProperty(new Y.Doc(), "Bad", "relation")).toThrow();
    const base = {
      id: "custom",
      name: "Custom",
      type: "number",
      formula: { source: "1", ast: { type: "literal", value: 1 } },
    };
    expect(DatabasePropertySchema.safeParse(base).success).toBe(false);
    expect(
      DatabasePropertySchema.safeParse({
        ...base,
        type: "formula",
        formula: {
          source: "bad",
          ast: { type: "call", name: "eval", arguments: [] },
        },
      }).success,
    ).toBe(false);
  });
  it("edits formula/rollup definitions without changing Property IDs", () => {
    const f = fixture(),
      total = f.rollup("sum");
    changeDatabaseProperty(f.source, total, {
      rollup: {
        relationPropertyId: f.relation,
        targetPropertyId: f.points,
        operation: "average",
      },
    });
    expect(f.reader().cell(f.row(), f.property(f.source, total))).toEqual({
      value: 3,
      error: null,
    });
    expect(() =>
      changeDatabaseProperty(f.source, total, {
        formula: { source: "1", ast: compileFormula("1", []) },
      }),
    ).toThrow();
  });
});
describe("Database dependency reader", () => {
  it("filters, sorts and groups computed values and searches live Relation titles", () => {
    const f = fixture(),
      total = f.rollup("sum"),
      other = createTaskRow(f.source, "Empty");
    const view = {
      ...defaultDatabaseView("table", f.source),
      filters: [{ propertyId: total, operator: "gte" as const, value: 5 }],
    };
    expect(
      queryDatabaseRows(
        f.source,
        { ...view, filters: [] },
        "First",
        [],
        f.reader(),
      ).map((row) => row.id),
    ).toEqual([f.sourceRow]);
    expect(
      queryDatabaseRows(
        f.source,
        {
          ...view,
          filters: [{ propertyId: total, operator: "gte", value: "5" }],
        },
        "",
        [],
        f.reader(),
      ).map((row) => row.id),
    ).toEqual([f.sourceRow]);
    expect(
      queryDatabaseRows(f.source, view, "", [], f.reader()).map(
        (row) => row.id,
      ),
    ).toEqual([f.sourceRow]);
    expect(
      queryDatabaseRows(
        f.source,
        {
          ...view,
          filters: [],
          sorts: [{ propertyId: total, direction: "asc" }],
        },
        "",
        [],
        f.reader(),
      ).map((row) => row.id),
    ).toEqual([other, f.sourceRow]);
    expect(
      groupDatabaseRows(
        f.source,
        getTaskRows(f.source),
        total,
        [],
        f.reader(),
      ).map((group) => group.label),
    ).toEqual(["6", "0"]);
    expect(
      queryDatabaseRows(
        f.source,
        {
          ...view,
          filters: [
            { propertyId: f.relation, operator: "contains", value: "First" },
          ],
        },
        "",
        [],
        f.reader(),
      ),
    ).toHaveLength(1);
    const unavailable = createDatabaseValueReader(f.sourceId, f.source);
    expect(
      queryDatabaseRows(
        f.source,
        {
          ...view,
          filters: [{ propertyId: total, operator: "empty", value: null }],
        },
        "",
        [],
        unavailable,
      ),
    ).toHaveLength(0);
  });
  it.each([
    ["count", 2],
    ["count_values", 2],
    ["sum", 6],
    ["average", 3],
    ["min", 2],
    ["max", 4],
  ] as const)(
    "calculates %s from the same related rows",
    (operation, expected) => {
      const f = fixture(),
        id = f.rollup(operation);
      expect(f.reader().cell(f.row(), f.property(f.source, id))).toEqual({
        value: expected,
        error: null,
      });
    },
  );
  it("keeps stable Row links after rename and excludes deleted rows", () => {
    const f = fixture();
    expect(f.reader().label(f.row(), f.property(f.source, f.relation))).toBe(
      "First, Second",
    );
    writeDatabaseValue(f.target, f.a, "title", "Renamed");
    f.target.getMap<Y.Map<unknown>>("tasks").get(f.b)!.set("deleted", true);
    expect(f.reader().label(f.row(), f.property(f.source, f.relation))).toBe(
      "Renamed",
    );
    const total = f.rollup("sum");
    expect(f.reader().cell(f.row(), f.property(f.source, total)).value).toBe(2);
  });
  it("evaluates formulas from rollups and stable renamed properties", () => {
    const f = fixture(),
      total = f.rollup("sum");
    const formula = addDatabaseProperty(
      f.source,
      "Double",
      "formula",
      [],
      crypto.randomUUID(),
      {
        formula: {
          source: 'prop("sum") * 2',
          ast: compileFormula(
            'prop("sum") * 2',
            getDatabaseProperties(f.source),
          ),
        },
      },
    );
    changeDatabaseProperty(f.source, total, { name: "Changed" });
    expect(f.reader().cell(f.row(), f.property(f.source, formula))).toEqual({
      value: 12,
      error: null,
    });
    writeDatabaseValue(f.target, f.a, f.points, 6);
    expect(f.reader().cell(f.row(), f.property(f.source, formula)).value).toBe(
      20,
    );
  });
  it("distinguishes unavailable targets from an empty relation", () => {
    const f = fixture(),
      total = f.rollup("sum");
    writeDatabaseValue(f.source, f.sourceRow, f.relation, []);
    expect(f.reader().cell(f.row(), f.property(f.source, total))).toEqual({
      value: 0,
      error: null,
    });
    const blocked = createDatabaseValueReader(f.sourceId, f.source);
    expect(blocked.cell(f.row(), f.property(f.source, total))).toMatchObject({
      value: null,
      error: { code: "reference" },
    });
    expect(blocked.label(f.row(), f.property(f.source, total))).toBe("—");
  });
  it("returns errors for deleted dependencies and wrong aggregation types", () => {
    const f = fixture(),
      total = f.rollup("sum", "title");
    expect(f.reader().cell(f.row(), f.property(f.source, total))).toMatchObject(
      { error: { code: "type" } },
    );
    changeDatabaseProperty(f.target, f.points, { deleted: true });
    const missing = f.rollup("count");
    expect(
      f.reader().cell(f.row(), f.property(f.source, missing)),
    ).toMatchObject({ error: { code: "reference" } });
  });
  it("rejects a cross-property cycle through a self relation", () => {
    const f = fixture(),
      self = addDatabaseProperty(
        f.source,
        "Self",
        "relation",
        [],
        crypto.randomUUID(),
        { relation: { databaseId: f.sourceId } },
      );
    writeDatabaseValue(f.source, f.sourceRow, self, [f.sourceRow]);
    const computedId = crypto.randomUUID(),
      total = addDatabaseProperty(
        f.source,
        "Total",
        "rollup",
        [],
        crypto.randomUUID(),
        {
          rollup: {
            relationPropertyId: self,
            targetPropertyId: computedId,
            operation: "sum",
          },
        },
      );
    addDatabaseProperty(f.source, "Cycle", "formula", [], computedId, {
      formula: {
        source: 'prop("Total") + 1',
        ast: compileFormula(
          'prop("Total") + 1',
          getDatabaseProperties(f.source),
        ),
      },
    });
    expect(f.reader().cell(f.row(), f.property(f.source, total))).toMatchObject(
      { value: null, error: { code: "cycle" } },
    );
  });
  it("converts Select/Multi-select values into names inside formulas", () => {
    const f = fixture(),
      choice = addDatabaseProperty(f.source, "Choice", "select", ["Ready"]),
      tags = addDatabaseProperty(f.source, "Tags", "multi_select", ["A", "B"]);
    writeDatabaseValue(
      f.source,
      f.sourceRow,
      choice,
      f.property(f.source, choice).options[0]!.id,
    );
    writeDatabaseValue(
      f.source,
      f.sourceRow,
      tags,
      f.property(f.source, tags).options.map((entry) => entry.id),
    );
    const formula = addDatabaseProperty(
      f.source,
      "Result",
      "formula",
      [],
      crypto.randomUUID(),
      {
        formula: {
          source: 'prop("Choice") == "Ready" && contains(prop("Tags"), "B")',
          ast: compileFormula(
            'prop("Choice") == "Ready" && contains(prop("Tags"), "B")',
            getDatabaseProperties(f.source),
          ),
        },
      },
    );
    expect(f.reader().cell(f.row(), f.property(f.source, formula))).toEqual({
      value: true,
      error: null,
    });
  });
  it("resolves scoped filenames and rejects missing metadata", () => {
    const f = fixture(),
      propertyId = addDatabaseProperty(f.source, "Files", "file"),
      fileId = crypto.randomUUID();
    writeDatabaseValue(f.source, f.sourceRow, propertyId, [fileId]);
    const reader = createDatabaseValueReader(f.sourceId, f.source, {
      fileName: (databaseId, id) =>
        databaseId === f.sourceId && id === fileId ? "notes.pdf" : undefined,
    });
    expect(reader.label(f.row(), f.property(f.source, propertyId))).toBe(
      "notes.pdf",
    );
    expect(
      f.reader().cell(f.row(), f.property(f.source, propertyId)),
    ).toMatchObject({ error: { code: "reference" } });
  });
  it("suppresses Person and its derived value in public mode, even behind an unused branch", () => {
    const f = fixture(),
      person = addDatabaseProperty(f.source, "Person", "person");
    writeDatabaseValue(f.source, f.sourceRow, person, crypto.randomUUID());
    const formula = addDatabaseProperty(
      f.source,
      "Hidden",
      "formula",
      [],
      crypto.randomUUID(),
      {
        formula: {
          source: 'if(false, prop("Person"), "safe")',
          ast: compileFormula(
            'if(false, prop("Person"), "safe")',
            getDatabaseProperties(f.source),
          ),
        },
      },
    );
    expect(f.reader().cell(f.row(), f.property(f.source, formula))).toEqual({
      value: "safe",
      error: null,
    });
    const publicReader = createDatabaseValueReader(f.sourceId, f.source, {
      publicOnly: true,
    });
    expect(
      publicReader.cell(f.row(), f.property(f.source, formula)),
    ).toMatchObject({ error: { code: "reference" } });
  });
  it("does not expose an unpublished relation through a formula or rollup", () => {
    const f = fixture(),
      total = f.rollup("sum");
    const formula = addDatabaseProperty(
      f.source,
      "Unsafe",
      "formula",
      [],
      crypto.randomUUID(),
      {
        formula: {
          source: 'if(false, prop("Linked"), "safe")',
          ast: compileFormula(
            'if(false, prop("Linked"), "safe")',
            getDatabaseProperties(f.source),
          ),
        },
      },
    );
    const reader = createDatabaseValueReader(f.sourceId, f.source, {
      publicOnly: true,
    });
    expect(reader.cell(f.row(), f.property(f.source, formula))).toMatchObject({
      error: { code: "reference" },
    });
    expect(reader.cell(f.row(), f.property(f.source, total))).toMatchObject({
      error: { code: "reference" },
    });
  });
});
it("aggregates empty, unique and invalid values without inventing numeric results", () => {
  expect(aggregateDatabaseValues("average", [], 0)).toBeNull();
  expect(aggregateDatabaseValues("unique", [["a", "b"], "a", null], 3)).toEqual(
    ["a", "b"],
  );
  expect(() => aggregateDatabaseValues("sum", ["2"], 1)).toThrow();
  expect(() => aggregateDatabaseValues("sum", [1e308, 1e308], 2)).toThrow();
});
it("collects stable references from supported AST branches and rejects forged nodes", () => {
  const ast = compileFormula('if(true, prop("X"), -prop("X"))', [
    { id: "x", name: "X" },
  ]);
  expect(formulaPropertyIds(ast)).toEqual(["x"]);
  expect(() =>
    formulaPropertyIds({ type: "call", name: "eval", arguments: [] }),
  ).toThrow();
});
