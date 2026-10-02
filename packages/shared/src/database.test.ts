import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  initializeGenericDatabase,
  getDatabaseMode,
  getDatabaseProperties,
  addDatabaseProperty,
  changeDatabaseProperty,
  writeDatabaseValue,
  readDatabaseValue,
  validateDatabaseValue,
  databaseValueLabel,
  defaultDatabaseView,
  getDatabaseViews,
  saveDatabaseView,
  deleteDatabaseView,
  queryDatabaseRows,
  matchesDatabaseFilter,
  groupDatabaseRows,
  calendarMonthDays,
  shiftCalendarMonth,
  databaseRowDateRange,
  createTaskRow,
  getTaskRows,
  updateTaskField,
  cloneDocumentContent,
  DatabasePropertySchema,
} from "./index";
const setup = () => {
  const doc = new Y.Doc();
  const a = createTaskRow(doc, "Alpha"),
    b = createTaskRow(doc, "Beta");
  return { doc, a, b };
};
const property = (doc: Y.Doc, id: string) =>
  getDatabaseProperties(doc).find((entry) => entry.id === id)!;
const row = (doc: Y.Doc, id: string) =>
  getTaskRows(doc).find((entry) => entry.id === id)!;
describe("Backward-compatible database schema", () => {
  it("uses Task defaults for old documents and nullable date/timestamp fields", () => {
    const { doc, a } = setup();
    const map = doc.getMap<Y.Map<unknown>>("tasks").get(a)!;
    for (const field of ["startDate", "endDate", "createdAt", "updatedAt"])
      map.delete(field);
    expect(getDatabaseMode(doc)).toBe("task");
    expect(row(doc, a)).toMatchObject({
      startDate: null,
      endDate: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(getDatabaseProperties(doc).map((entry) => entry.id)).toContain(
      "dueDate",
    );
  });
  it("initializes an empty generic database without Task-specific columns", () => {
    const doc = new Y.Doc();
    initializeGenericDatabase(doc);
    expect(getDatabaseMode(doc)).toBe("generic");
    expect(getDatabaseProperties(doc).map((entry) => entry.id)).toEqual([
      "title",
      "createdAt",
      "updatedAt",
    ]);
  });
  it("does not convert populated Task databases", () => {
    expect(() => initializeGenericDatabase(setup().doc)).toThrow();
  });
});
describe("Custom properties and validation", () => {
  it("adds, renames and soft-deletes a property while retaining data", () => {
    const { doc, a } = setup();
    const id = addDatabaseProperty(doc, "Points", "number");
    writeDatabaseValue(doc, a, id, 10);
    changeDatabaseProperty(doc, id, { name: "Estimate" });
    expect(property(doc, id).name).toBe("Estimate");
    changeDatabaseProperty(doc, id, { deleted: true });
    expect(property(doc, id)).toBeUndefined();
    expect(
      doc.getMap<Y.Map<unknown>>("tasks").get(a)?.get(`property:${id}`),
    ).toBe(10);
  });
  it("rejects empty names, duplicate IDs, missing choices and builtin deletion", () => {
    const { doc } = setup();
    expect(() => addDatabaseProperty(doc, "", "text")).toThrow();
    const id = addDatabaseProperty(doc, "Text", "text");
    expect(() => addDatabaseProperty(doc, "Other", "text", [], id)).toThrow();
    expect(() => addDatabaseProperty(doc, "Stage", "select")).toThrow();
    expect(() =>
      changeDatabaseProperty(doc, "title", { deleted: true }),
    ).toThrow();
    expect(() =>
      changeDatabaseProperty(doc, "missing", { name: "x" }),
    ).toThrow();
  });
  it("enforces the custom property quota without touching existing fields", () => {
    const { doc } = setup();
    for (let i = 0; i < 64; i++) addDatabaseProperty(doc, `Field ${i}`, "text");
    expect(() => addDatabaseProperty(doc, "Extra", "text")).toThrow();
    expect(
      getDatabaseProperties(doc).filter((entry) => !entry.builtin),
    ).toHaveLength(64);
  });
  it("validates every supported writable type", () => {
    const { doc, a } = setup();
    const values = {
      text: "Notes",
      number: 2.5,
      date: "2028-02-29",
      checkbox: true,
      person: crypto.randomUUID(),
      url: "https://example.com",
      email: "dev@example.com",
      phone: "+82 10 1234 5678",
    } as const;
    for (const [type, value] of Object.entries(values)) {
      const id = addDatabaseProperty(doc, type, type as keyof typeof values);
      writeDatabaseValue(doc, a, id, value);
      expect(readDatabaseValue(doc, row(doc, a), property(doc, id))).toBe(
        value,
      );
    }
    for (const type of ["select", "status", "multi_select"] as const) {
      const id = addDatabaseProperty(doc, type, type, ["Ready", "Done"]),
        p = property(doc, id),
        value =
          type === "multi_select"
            ? p.options.map((entry) => entry.id)
            : p.options[0]!.id;
      writeDatabaseValue(doc, a, id, value);
      expect(readDatabaseValue(doc, row(doc, a), p)).toEqual(value);
    }
  });
  it("rejects invalid values, script URLs, absent/deleted rows and readonly time fields", () => {
    const { doc, a } = setup();
    for (const [type, value] of [
      ["number", Infinity],
      ["date", "2025-02-29"],
      ["checkbox", "true"],
      ["person", "bad"],
      ["url", "javascript:alert(1)"],
      ["email", "bad"],
    ] as const) {
      const id = addDatabaseProperty(doc, type, type);
      expect(() => writeDatabaseValue(doc, a, id, value)).toThrow();
      expect(readDatabaseValue(doc, row(doc, a), property(doc, id))).toBe(
        type === "checkbox" ? false : null,
      );
    }
    const choice = addDatabaseProperty(doc, "Choice", "select", ["A"]);
    expect(() => writeDatabaseValue(doc, a, choice, "unknown")).toThrow();
    expect(() =>
      writeDatabaseValue(doc, a, "createdAt", "2026-10-02T00:00:00Z"),
    ).toThrow();
    expect(() => writeDatabaseValue(doc, "missing", "title", "x")).toThrow();
    updateTaskField(doc, a, "deleted", true);
    expect(() => writeDatabaseValue(doc, a, choice, null)).toThrow();
  });
  it("clears optional values and updates the shared title and Task fields", () => {
    const { doc, a } = setup();
    writeDatabaseValue(doc, a, "title", "Renamed");
    writeDatabaseValue(doc, a, "dueDate", "2026-10-02");
    writeDatabaseValue(doc, a, "dueDate", null);
    expect(row(doc, a)).toMatchObject({ title: "Renamed", dueDate: null });
    expect(validateDatabaseValue(property(doc, "dueDate"), "")).toBeNull();
  });
  it("ignores malformed definitions and cell values", () => {
    const { doc, a } = setup();
    doc.getMap("databaseProperties").set("broken", "bad");
    const id = addDatabaseProperty(doc, "Text", "text");
    doc
      .getMap<Y.Map<unknown>>("tasks")
      .get(a)!
      .set(`property:${id}`, { bad: true });
    expect(
      getDatabaseProperties(doc).some((entry) => entry.id === "broken"),
    ).toBe(false);
    expect(readDatabaseValue(doc, row(doc, a), property(doc, id))).toBeNull();
    expect(
      DatabasePropertySchema.safeParse({
        id: "x",
        name: "x",
        type: "select",
        options: [
          { id: "a", name: "a" },
          { id: "a", name: "b" },
        ],
      }).success,
    ).toBe(false);
  });
  it("formats choices, multi-select, booleans, people and empty values", () => {
    const { doc } = setup(),
      id = addDatabaseProperty(doc, "Tags", "multi_select", ["A", "B"]),
      p = property(doc, id);
    expect(
      databaseValueLabel(
        p,
        p.options.map((entry) => entry.id),
      ),
    ).toBe("A, B");
    expect(databaseValueLabel(p, null)).toBe("미지정");
    expect(databaseValueLabel(p, true)).toBe("체크됨");
    expect(databaseValueLabel(property(doc, "status"), "done")).toBe("Done");
    const identity = { id: crypto.randomUUID(), name: "Owner", role: "owner" };
    expect(
      databaseValueLabel(property(doc, "assigneeId"), identity.id, [identity]),
    ).toBe("Owner");
    expect(databaseValueLabel(property(doc, "assigneeId"), "missing")).toBe(
      "알 수 없는 기기",
    );
  });
});
describe("Saved views and queries", () => {
  it("saves, updates, reads and deletes a view", () => {
    const { doc } = setup(),
      view = {
        ...defaultDatabaseView("board", doc),
        id: crypto.randomUUID(),
        name: "Work",
      };
    saveDatabaseView(doc, view);
    saveDatabaseView(doc, { ...view, name: "Updated" });
    expect(getDatabaseViews(doc)[0]?.name).toBe("Updated");
    deleteDatabaseView(doc, view.id);
    deleteDatabaseView(doc, "missing");
    expect(getDatabaseViews(doc)).toEqual([]);
  });
  it("rejects missing property references and invalid names; ignores corrupt views", () => {
    const { doc } = setup(),
      view = defaultDatabaseView("table", doc);
    expect(() => saveDatabaseView(doc, { ...view, name: "" })).toThrow();
    expect(() =>
      saveDatabaseView(doc, { ...view, groupBy: "missing" }),
    ).toThrow();
    doc.getMap("databaseViews").set("bad", "corrupt");
    expect(getDatabaseViews(doc)).toEqual([]);
  });
  it("limits view count but permits updating an existing view", () => {
    const { doc } = setup(),
      view = defaultDatabaseView("table", doc);
    for (let i = 0; i < 20; i++)
      saveDatabaseView(doc, { ...view, id: `view-${i}` });
    expect(() => saveDatabaseView(doc, { ...view, id: "extra" })).toThrow();
    expect(() =>
      saveDatabaseView(doc, { ...view, id: "view-0", name: "Changed" }),
    ).not.toThrow();
  });
  it("uses generic select/date fields for Board and Calendar defaults", () => {
    const doc = new Y.Doc();
    initializeGenericDatabase(doc);
    expect(defaultDatabaseView("calendar", doc).datePropertyId).toBeNull();
    const select = addDatabaseProperty(doc, "Stage", "select", ["A"]),
      date = addDatabaseProperty(doc, "Date", "date");
    expect(defaultDatabaseView("board", doc).groupBy).toBe(select);
    expect(defaultDatabaseView("calendar", doc).datePropertyId).toBe(date);
  });
  it("filters, sorts numerically, keeps empty last and preserves insertion order without sorting", () => {
    const { doc, a, b } = setup(),
      id = addDatabaseProperty(doc, "Points", "number"),
      c = createTaskRow(doc, "Empty");
    writeDatabaseValue(doc, a, id, 2);
    writeDatabaseValue(doc, b, id, 10);
    const view = defaultDatabaseView("table", doc);
    expect(queryDatabaseRows(doc, view).map((entry) => entry.id)).toEqual([
      a,
      b,
      c,
    ]);
    expect(
      queryDatabaseRows(doc, {
        ...view,
        sorts: [{ propertyId: id, direction: "desc" }],
      }).map((entry) => entry.id),
    ).toEqual([b, a, c]);
    expect(
      queryDatabaseRows(doc, {
        ...view,
        filters: [{ propertyId: id, operator: "gte", value: 5 }],
      }).map((entry) => entry.id),
    ).toEqual([b]);
    expect(queryDatabaseRows(doc, view, "ALPHA")).toHaveLength(1);
    expect(queryDatabaseRows(doc, view, "absent")).toEqual([]);
    writeDatabaseValue(doc, a, "priority", "high");
    writeDatabaseValue(doc, b, "priority", "low");
    expect(
      queryDatabaseRows(doc, {
        ...view,
        sorts: [{ propertyId: "priority", direction: "asc" }],
      }).map((entry) => entry.id),
    ).toEqual([b, c, a]);
  });
  it("implements filter operators including null, date and multi-select edges", () => {
    const f = (
      operator: Parameters<typeof matchesDatabaseFilter>[1]["operator"],
      value: Parameters<typeof matchesDatabaseFilter>[1]["value"],
    ) => ({ propertyId: "x", operator, value });
    expect(matchesDatabaseFilter("Alpha", f("contains", "PH"))).toBe(true);
    expect(matchesDatabaseFilter("Alpha", f("contains", "z"))).toBe(false);
    expect(matchesDatabaseFilter(["a", "b"], f("equals", "b"))).toBe(true);
    expect(matchesDatabaseFilter(false, f("equals", false))).toBe(true);
    expect(matchesDatabaseFilter("a", f("not_equals", "a"))).toBe(false);
    expect(matchesDatabaseFilter([], f("empty", null))).toBe(true);
    expect(matchesDatabaseFilter(null, f("not_empty", null))).toBe(false);
    expect(matchesDatabaseFilter(null, f("gt", 0))).toBe(false);
    expect(matchesDatabaseFilter(10, f("gt", 2))).toBe(true);
    expect(matchesDatabaseFilter(2, f("gte", 2))).toBe(true);
    expect(matchesDatabaseFilter("2026-10-01", f("lt", "2026-10-02"))).toBe(
      true,
    );
    expect(matchesDatabaseFilter(2, f("lte", 2))).toBe(true);
  });
  it("groups choices including empty columns and unassigned rows without dropping data", () => {
    const { doc, a, b } = setup();
    updateTaskField(doc, a, "status", "done");
    const groups = groupDatabaseRows(doc, getTaskRows(doc), "status");
    expect(groups.map((group) => group.label)).toEqual([
      "Todo",
      "In progress",
      "Done",
    ]);
    expect(groups.find((group) => group.label === "Done")?.rows[0]?.id).toBe(a);
    expect(groups.find((group) => group.label === "Todo")?.rows[0]?.id).toBe(b);
    expect(
      groupDatabaseRows(doc, getTaskRows(doc), "assigneeId")[0]?.label,
    ).toBe("미지정");
    expect(
      groupDatabaseRows(doc, getTaskRows(doc), "missing")[0]?.rows,
    ).toHaveLength(2);
    const checkbox = addDatabaseProperty(doc, "Checked", "checkbox");
    expect(
      groupDatabaseRows(doc, getTaskRows(doc), checkbox).map(
        (group) => group.value,
      ),
    ).toEqual([false, true]);
    const identity = { id: crypto.randomUUID(), name: "Owner", role: "owner" };
    expect(
      groupDatabaseRows(doc, getTaskRows(doc), "assigneeId", [identity]).some(
        (group) => group.value === identity.id,
      ),
    ).toBe(true);
  });
});
describe("Calendar and Timeline dates", () => {
  it("creates a Monday-start six-week calendar including leap days", () => {
    const days = calendarMonthDays("2028-02");
    expect(days).toHaveLength(42);
    expect(days).toContain("2028-02-29");
    expect(new Date(`${days[0]}T00:00:00Z`).getUTCDay()).toBe(1);
  });
  it("rejects invalid months and moves across year boundaries", () => {
    expect(() => calendarMonthDays("2026-13")).toThrow();
    expect(() => calendarMonthDays("bad")).toThrow();
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
  });
  it("returns date-only ranges and handles missing/reversed end dates", () => {
    const { doc, a } = setup(),
      view = {
        ...defaultDatabaseView("timeline", doc),
        datePropertyId: "startDate",
        endDatePropertyId: "endDate",
      };
    expect(databaseRowDateRange(doc, row(doc, a), view)).toBeNull();
    writeDatabaseValue(doc, a, "startDate", "2026-10-02");
    writeDatabaseValue(doc, a, "endDate", "2026-10-10");
    expect(databaseRowDateRange(doc, row(doc, a), view)).toEqual({
      start: "2026-10-02",
      end: "2026-10-10",
    });
    writeDatabaseValue(doc, a, "endDate", "2026-10-01");
    expect(databaseRowDateRange(doc, row(doc, a), view)?.end).toBe(
      "2026-10-02",
    );
    expect(
      databaseRowDateRange(doc, row(doc, a), {
        ...view,
        datePropertyId: "title",
      }),
    ).toBeNull();
  });
});
describe("Offline convergence and recovery", () => {
  it("merges distinct custom cells and concurrent view fields", () => {
    const { doc, a } = setup(),
      first = addDatabaseProperty(doc, "Points", "number"),
      second = addDatabaseProperty(doc, "Notes", "text"),
      view = defaultDatabaseView("table", doc);
    saveDatabaseView(doc, view);
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
    writeDatabaseValue(doc, a, first, 10);
    writeDatabaseValue(remote, a, second, "Offline note");
    saveDatabaseView(doc, { ...view, name: "Renamed" });
    saveDatabaseView(remote, {
      ...view,
      sorts: [{ propertyId: first, direction: "desc" }],
    });
    const left = Y.encodeStateAsUpdate(doc),
      right = Y.encodeStateAsUpdate(remote);
    Y.applyUpdate(doc, right);
    Y.applyUpdate(remote, left);
    expect(readDatabaseValue(doc, row(doc, a), property(doc, first))).toBe(10);
    expect(readDatabaseValue(doc, row(doc, a), property(doc, second))).toBe(
      "Offline note",
    );
    expect(getDatabaseViews(doc)).toEqual(getDatabaseViews(remote));
    expect(getDatabaseViews(doc)[0]).toMatchObject({
      name: "Renamed",
      sorts: [{ propertyId: first, direction: "desc" }],
    });
  });
  it("clones generic schema, saved views, custom values and row bodies into fresh CRDT state", () => {
    const doc = new Y.Doc();
    initializeGenericDatabase(doc);
    const id = createTaskRow(doc, "Entry"),
      field = addDatabaseProperty(doc, "Points", "number");
    writeDatabaseValue(doc, id, field, 42);
    saveDatabaseView(doc, defaultDatabaseView("gallery", doc));
    const body = new Y.XmlElement("paragraph");
    body.insert(0, [new Y.XmlText("Body")]);
    doc.getXmlFragment(`task:${id}`).insert(0, [body]);
    const copy = cloneDocumentContent(doc, "old", "new");
    expect(getDatabaseMode(copy)).toBe("generic");
    expect(getDatabaseProperties(copy)).toEqual(getDatabaseProperties(doc));
    expect(getDatabaseViews(copy)).toEqual(getDatabaseViews(doc));
    expect(readDatabaseValue(copy, row(copy, id), property(copy, field))).toBe(
      42,
    );
    expect(copy.getXmlFragment(`task:${id}`).toString()).toContain("Body");
    writeDatabaseValue(copy, id, field, 7);
    expect(readDatabaseValue(doc, row(doc, id), property(doc, field))).toBe(42);
    expect(
      getDatabaseProperties(cloneDocumentContent(new Y.Doc(), "old", "new"))
        .length,
    ).toBeGreaterThan(0);
  });
});
