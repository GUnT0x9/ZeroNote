import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import {
  createTaskRow,
  getTaskRows,
  updateTaskField,
  createSubtask,
  setTaskParent,
  setTaskDependency,
  getTaskRelationIssues,
  assertTaskExtensions,
  setTaskLabel,
  removeTaskLabel,
  renameTaskLabel,
  taskEntryMap,
  parseTaskEstimate,
  formatTaskEstimate,
  saveTaskTemplate,
  getTaskTemplates,
  changeTaskTemplate,
  createTaskFromTemplate,
  assertTaskTemplates,
  cloneDocumentContent,
  getKnowledgeProjection,
  createKnowledgeDatabase,
  getAttachmentIds,
  remapAttachmentIds,
  MAX_TASK_LABELS,
  MAX_TASK_TEMPLATES,
  MAX_TASK_DEPENDENCIES,
  addDatabaseProperty,
  writeDatabaseValue,
  changeDatabaseProperty,
  changedTaskTemplateProperties,
  getLiveAttachmentIds,
} from "./index";
import { setXmlAttribute, cloneXmlContent } from "./xml";
import { taskCompletionWarning } from "./index";
import { getDatabaseProperties, readDatabaseValue } from "./index";

function fork(document: Y.Doc): Y.Doc {
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(document));
  return copy;
}
function body(document: Y.Doc, id: string, text: string): void {
  const node = new Y.XmlElement("paragraph"),
    value = new Y.XmlText();
  node.insert(0, [value]);
  value.insert(0, text);
  document.getXmlFragment(`task:${id}`).insert(0, [node]);
}
function merge(first: Y.Doc, second: Y.Doc): void {
  const a = Y.encodeStateAsUpdate(first),
    b = Y.encodeStateAsUpdate(second);
  Y.applyUpdate(first, b);
  Y.applyUpdate(second, a);
}

describe("Task relationships and preserved conflicts", () => {
  it("creates Subtasks, preserves them after parent deletion and rejects invalid parents before mutation", () => {
    const doc = new Y.Doc(),
      parent = createTaskRow(doc, "Parent"),
      child = createSubtask(doc, parent, "Child");
    expect(getTaskRows(doc).find((row) => row.id === child)?.parentTaskId).toBe(
      parent,
    );
    const state = Y.encodeStateAsUpdate(doc);
    expect(() => setTaskParent(doc, parent, child)).toThrow("순환");
    expect(() => setTaskParent(doc, child, crypto.randomUUID())).toThrow();
    expect(() => createSubtask(doc, parent, " ")).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    updateTaskField(doc, parent, "deleted", true);
    expect(getTaskRows(doc).map((row) => row.id)).toEqual([child]);
    expect(getTaskRelationIssues(getTaskRows(doc))).toEqual([
      { rowId: child, targetId: parent, kind: "parent", reason: "missing" },
    ]);
    expect(() => assertTaskExtensions(doc)).not.toThrow();
    setTaskParent(doc, child, null);
    expect(getTaskRelationIssues(getTaskRows(doc))).toEqual([]);
  });
  it("uses independent Dependency entries including the first concurrent additions on a legacy Row", () => {
    const a = new Y.Doc(),
      root = createTaskRow(a, "Root"),
      one = createTaskRow(a, "One"),
      two = createTaskRow(a, "Two"),
      b = fork(a);
    setTaskDependency(a, root, one, true);
    setTaskDependency(b, root, two, true);
    merge(a, b);
    expect(
      getTaskRows(a).find((row) => row.id === root)?.dependencyIds,
    ).toEqual([one, two].sort());
    expect(getTaskRows(a)).toEqual(getTaskRows(b));
    const state = Y.encodeStateAsUpdate(a);
    expect(() => setTaskDependency(a, one, root, true)).toThrow("순환");
    expect(() => setTaskDependency(a, root, root, true)).toThrow();
    expect(Y.encodeStateAsUpdate(a)).toEqual(state);
    updateTaskField(a, one, "deleted", true);
    setTaskDependency(a, root, one, false);
    expect(
      getTaskRows(a).find((row) => row.id === root)?.dependencyIds,
    ).toEqual([two]);
  });
  it.each(["parent", "dependency"] as const)(
    "detects a merged %s cycle and allows its removal without dropping Rows",
    (kind) => {
      const a = new Y.Doc(),
        one = createTaskRow(a, "One"),
        two = createTaskRow(a, "Two"),
        b = fork(a);
      if (kind === "parent") {
        setTaskParent(a, one, two);
        setTaskParent(b, two, one);
      } else {
        setTaskDependency(a, one, two, true);
        setTaskDependency(b, two, one, true);
      }
      merge(a, b);
      expect(getTaskRows(a)).toHaveLength(2);
      const issue = getTaskRelationIssues(getTaskRows(a)).find(
        (issue) => issue.reason === "cycle",
      )!;
      expect(issue.kind).toBe(kind);
      expect(() => assertTaskExtensions(a)).toThrow("순환");
      if (kind === "parent") setTaskParent(a, issue.rowId, null);
      else setTaskDependency(a, issue.rowId, issue.targetId, false);
      expect(() => assertTaskExtensions(a)).not.toThrow();
      expect(getTaskRows(a)).toHaveLength(2);
    },
  );
  it("keeps over-limit Dependency merges editable and validates legacy/invalid data", () => {
    const a = new Y.Doc(),
      root = createTaskRow(a, "Root"),
      ids = Array.from({ length: MAX_TASK_DEPENDENCIES + 1 }, () =>
        createTaskRow(a, "Item"),
      );
    for (const id of ids.slice(0, -2)) setTaskDependency(a, root, id, true);
    const b = fork(a);
    setTaskDependency(a, root, ids.at(-2)!, true);
    setTaskDependency(b, root, ids.at(-1)!, true);
    merge(a, b);
    expect(
      getTaskRows(a).find((row) => row.id === root)?.dependencyIds,
    ).toHaveLength(MAX_TASK_DEPENDENCIES + 1);
    expect(() => assertTaskExtensions(a)).toThrow("한도");
    setTaskDependency(a, root, ids.at(-1)!, false);
    taskEntryMap(a, root, "dependencies").set(ids[0]!, "bad");
    expect(() => assertTaskExtensions(a)).toThrow();
    taskEntryMap(a, root, "dependencies").set(ids[0]!, true);
    taskEntryMap(a, root, "dependencies").set(crypto.randomUUID(), true);
    expect(
      getTaskRows(a).find((row) => row.id === root)?.dependencyIds,
    ).toHaveLength(MAX_TASK_DEPENDENCIES + 1);
    expect(() => assertTaskExtensions(a)).toThrow("한도");
    setTaskDependency(a, root, ids[0]!, false);
    expect(() => assertTaskExtensions(a)).not.toThrow();
    expect(() => taskEntryMap(a, "invalid", "labels")).toThrow();
  });
});
describe("Task Labels and Estimate", () => {
  it("exposes Label cells as text for Formula/filter/export and retains the canonical list", () => {
    const doc = new Y.Doc(),
      id = createTaskRow(doc, "Task"),
      property = getDatabaseProperties(doc).find(
        (property) => property.id === "labels",
      )!;
    expect(readDatabaseValue(doc, getTaskRows(doc)[0]!, property)).toBe("");
    setTaskLabel(doc, id, "Beta");
    expect(readDatabaseValue(doc, getTaskRows(doc)[0]!, property)).toBe("Beta");
    expect(getTaskRows(doc)[0]?.labels).toEqual(["Beta"]);
  });
  it("warns only when completing a Task with active unfinished dependencies", () => {
    const doc = new Y.Doc(),
      root = createTaskRow(doc, "Root"),
      dependency = createTaskRow(doc, "Wait");
    setTaskDependency(doc, root, dependency, true);
    expect(taskCompletionWarning(getTaskRows(doc), root, "done")).toContain(
      "1개",
    );
    expect(taskCompletionWarning(getTaskRows(doc), root, "todo")).toBeNull();
    updateTaskField(doc, dependency, "status", "done");
    expect(taskCompletionWarning(getTaskRows(doc), root, "done")).toBeNull();
    expect(() =>
      taskCompletionWarning(getTaskRows(doc), crypto.randomUUID(), "done"),
    ).toThrow();
  });
  it("normalizes and independently merges the first Labels, renames/removes and preserves Row fields", () => {
    const a = new Y.Doc(),
      id = createTaskRow(a, "Task"),
      b = fork(a);
    setTaskLabel(a, id, "  Beta  ");
    setTaskLabel(b, id, "리뷰");
    updateTaskField(b, id, "priority", "high");
    merge(a, b);
    expect(getTaskRows(a)[0]).toMatchObject({
      labels: ["Beta", "리뷰"].sort((a, b) => a.localeCompare(b)),
      priority: "high",
    });
    setTaskLabel(a, id, "Ｂｅｔａ");
    expect(getTaskRows(a)[0]?.labels).toHaveLength(2);
    renameTaskLabel(a, id, "beta", "Release");
    removeTaskLabel(a, id, "리뷰");
    expect(getTaskRows(a)[0]?.labels).toEqual(["Release"]);
    const state = Y.encodeStateAsUpdate(a);
    expect(() => setTaskLabel(a, id, " ")).toThrow();
    expect(() => renameTaskLabel(a, id, "missing", "Next")).toThrow();
    expect(Y.encodeStateAsUpdate(a)).toEqual(state);
    updateTaskField(a, id, "deleted", true);
    expect(() => setTaskLabel(a, id, "x")).toThrow();
  });
  it("reads over-limit Labels for conflict resolution and rejects malformed values on Commit", () => {
    const a = new Y.Doc(),
      id = createTaskRow(a, "Task");
    for (let i = 0; i < MAX_TASK_LABELS - 1; i++)
      setTaskLabel(a, id, `tag${i}`);
    const b = fork(a);
    setTaskLabel(a, id, "one");
    setTaskLabel(b, id, "two");
    merge(a, b);
    expect(getTaskRows(a)[0]?.labels).toHaveLength(MAX_TASK_LABELS + 1);
    expect(() => assertTaskExtensions(a)).toThrow();
    expect(() => setTaskLabel(a, id, "new")).toThrow();
    removeTaskLabel(a, id, "one");
    expect(() => assertTaskExtensions(a)).not.toThrow();
    taskEntryMap(a, id, "labels").set("broken", "  broken ");
    expect(() => assertTaskExtensions(a)).toThrow();
    taskEntryMap(a, id, "labels").delete("broken");
    a.getMap<Y.Map<unknown>>("tasks").get(id)!.set("estimateMinutes", 1.5);
    expect(getTaskRows(a)).toHaveLength(1);
    expect(() => assertTaskExtensions(a)).toThrow();
    updateTaskField(a, id, "estimateMinutes", 90);
    expect(() => assertTaskExtensions(a)).not.toThrow();
  });
  it("parses hours exactly into integer minutes and distinguishes unset/zero", () => {
    for (const value of ["1h 30m", "1.5h", "1시간 30분", "90"])
      expect(parseTaskEstimate(value)).toBe(90);
    expect(parseTaskEstimate("0.1h")).toBe(6);
    expect(parseTaskEstimate("")).toBeNull();
    expect(parseTaskEstimate("0")).toBe(0);
    expect(formatTaskEstimate(null)).toBe("미지정");
    expect(formatTaskEstimate(0)).toBe("0분");
    expect(formatTaskEstimate(90)).toBe("1시간 30분");
    expect(formatTaskEstimate(60)).toBe("1시간");
    for (const value of ["-1", "1.5", "0.01h", "1e3", "999999999h", "x"])
      expect(() => parseTaskEstimate(value)).toThrow();
    expect(() => formatTaskEstimate(-1)).toThrow();
  });
  it("preserves Labels/Estimate/relations in projections, clones and a binary roundtrip", () => {
    const doc = new Y.Doc(),
      db = crypto.randomUUID(),
      child = createTaskRow(doc, "Child"),
      parent = createTaskRow(doc, "Parent");
    setTaskParent(doc, child, parent);
    setTaskDependency(doc, child, parent, true);
    setTaskLabel(doc, child, "Beta");
    updateTaskField(doc, child, "estimateMinutes", 90);
    const copy = cloneDocumentContent(doc, db, crypto.randomUUID()),
      projection = getKnowledgeProjection(doc),
      model = createKnowledgeDatabase(projection);
    expect(getTaskRows(copy)).toEqual(getTaskRows(doc));
    expect(getTaskRows(fork(doc))).toEqual(getTaskRows(doc));
    expect(getTaskRows(model)).toEqual(getTaskRows(doc));
    expect(
      projection.rows.find((item) => item.row.id === child)?.row.labels,
    ).toEqual(["Beta"]);
    expect(() => updateTaskField(doc, child, "dependencyIds", [])).toThrow();
    expect(() => updateTaskField(doc, parent, "parentTaskId", child)).toThrow();
    expect(() => createTaskRow(doc, "Overwrite", child)).toThrow();
    expect(() => createTaskRow(doc, "x".repeat(501))).toThrow();
  });
});
describe("Task Templates and cloned body identity", () => {
  it("copies the captured body/base values and self link into a fresh independent Task", () => {
    const doc = new Y.Doc(),
      db = crypto.randomUUID(),
      id = createTaskRow(doc, "Ship"),
      parent = createTaskRow(doc, "Parent");
    setTaskParent(doc, id, parent);
    setTaskDependency(doc, id, parent, true);
    setTaskLabel(doc, id, "Beta");
    updateTaskField(doc, id, "estimateMinutes", 90);
    updateTaskField(doc, id, "priority", "high");
    updateTaskField(doc, id, "status", "done");
    updateTaskField(doc, id, "dueDate", "2026-10-10");
    body(doc, id, "Original");
    const link = new Y.XmlElement("taskLink");
    setXmlAttribute(link, "databaseId", db);
    setXmlAttribute(link, "rowId", id);
    doc.getXmlFragment(`task:${id}`).insert(1, [link]);
    const template = saveTaskTemplate(doc, id, "Shipping"),
      copy = createTaskFromTemplate(doc, db, template);
    expect(copy).not.toBe(id);
    expect(getTaskRows(doc).find((row) => row.id === copy)).toMatchObject({
      title: "Ship",
      priority: "high",
      estimateMinutes: 90,
      labels: ["Beta"],
      status: "todo",
      dueDate: null,
      parentTaskId: null,
      dependencyIds: [],
    });
    const clonedLink = doc
      .getXmlFragment(`task:${copy}`)
      .get(1) as Y.XmlElement;
    expect(clonedLink.getAttribute("rowId")).toBe(copy);
    (doc.getXmlFragment(`task:${id}`).get(0) as Y.XmlElement).delete(0, 1);
    expect(doc.getXmlFragment(`task:${copy}`).toString()).toContain("Original");
    expect(
      doc.getXmlFragment(`task-template:${template}`).toString(),
    ).toContain("Original");
    changeTaskTemplate(doc, template, { name: "Release" });
    expect(getTaskTemplates(doc)[0]?.name).toBe("Release");
    changeTaskTemplate(doc, template, { deleted: true });
    expect(getTaskTemplates(doc)).toEqual([]);
    expect(() => createTaskFromTemplate(doc, db, template)).toThrow();
    expect(getTaskRows(doc)).toHaveLength(3);
  });
  it("keeps template files and links through Snapshot-style clone/remapping and binary Import", () => {
    const doc = new Y.Doc(),
      db = crypto.randomUUID(),
      newDb = crypto.randomUUID(),
      id = createTaskRow(doc, "Media"),
      file = crypto.randomUUID(),
      newFile = crypto.randomUUID();
    const attachment = new Y.XmlElement("attachment"),
      mention = new Y.XmlElement("pageMention");
    setXmlAttribute(attachment, "attachmentId", file);
    setXmlAttribute(mention, "pageId", db);
    doc.getXmlFragment(`task:${id}`).insert(0, [attachment, mention]);
    const template = saveTaskTemplate(doc, id, "Media");
    const fragment = doc.getXmlFragment(`task:${id}`);
    fragment.delete(0, fragment.length);
    expect(getAttachmentIds(doc)).toEqual([file]);
    const copy = cloneDocumentContent(doc, db, newDb);
    remapAttachmentIds(copy, new Map([[file, newFile]]));
    expect(getAttachmentIds(copy)).toEqual([newFile]);
    expect(getTaskTemplates(fork(copy))).toEqual(getTaskTemplates(doc));
    const row = createTaskFromTemplate(copy, newDb, template);
    expect(copy.getXmlFragment(`task:${row}`).toString()).toContain(newDb);
    expect(getAttachmentIds(doc)).toEqual([file]);
  });
  it("checks names/count/deletion before changing data and validates merged Template limits", () => {
    const doc = new Y.Doc(),
      id = createTaskRow(doc, "Task");
    const state = Y.encodeStateAsUpdate(doc);
    expect(() => saveTaskTemplate(doc, id, " ")).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(state);
    for (let i = 0; i < MAX_TASK_TEMPLATES - 1; i++)
      saveTaskTemplate(doc, id, `T${i}`);
    const b = fork(doc);
    saveTaskTemplate(doc, id, "One");
    saveTaskTemplate(b, id, "Two");
    merge(doc, b);
    expect(getTaskTemplates(doc)).toHaveLength(MAX_TASK_TEMPLATES + 1);
    expect(() => assertTaskTemplates(doc)).toThrow();
    expect(() => saveTaskTemplate(doc, id, "Next")).toThrow();
    const template = getTaskTemplates(doc)[0]!;
    changeTaskTemplate(doc, template.id, { deleted: true });
    expect(() => assertTaskTemplates(doc)).not.toThrow();
    const next = getTaskTemplates(doc)[0]!,
      before = Y.encodeStateAsUpdate(doc);
    expect(() => changeTaskTemplate(doc, next.id, { name: "" })).toThrow();
    expect(() => createTaskFromTemplate(doc, "bad", next.id)).toThrow();
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    updateTaskField(doc, id, "deleted", true);
    expect(() => saveTaskTemplate(doc, id, "Gone")).toThrow();
  });
  it("captures mutable custom properties, retains private files, and remaps self Relations on restore and creation", () => {
    const doc = new Y.Doc(),
      db = crypto.randomUUID(),
      newDb = crypto.randomUUID(),
      rowId = createTaskRow(doc, "Source"),
      otherId = createTaskRow(doc, "Other"),
      fileId = crypto.randomUUID(),
      newFileId = crypto.randomUUID(),
      textId = addDatabaseProperty(doc, "Instructions", "text"),
      numberId = addDatabaseProperty(doc, "Points", "number"),
      filePropertyId = addDatabaseProperty(doc, "Files", "file"),
      relationId = addDatabaseProperty(
        doc,
        "Related",
        "relation",
        [],
        undefined,
        { relation: { databaseId: db } },
      );
    addDatabaseProperty(doc, "Recorded", "created_time");
    writeDatabaseValue(doc, rowId, textId, "Captured");
    writeDatabaseValue(doc, rowId, numberId, 0);
    writeDatabaseValue(doc, rowId, filePropertyId, [fileId]);
    writeDatabaseValue(doc, rowId, relationId, [rowId, otherId]);
    const templateId = saveTaskTemplate(doc, rowId, "Custom");
    expect(
      getTaskTemplates(doc)[0]!.properties.map((property) => property.id),
    ).toEqual([textId, numberId, filePropertyId, relationId]);
    writeDatabaseValue(doc, rowId, textId, "Changed");
    writeDatabaseValue(doc, rowId, filePropertyId, []);
    expect(getAttachmentIds(doc)).toEqual([fileId]);
    expect(getLiveAttachmentIds(doc)).toEqual([]);
    const restored = cloneDocumentContent(doc, db, newDb);
    remapAttachmentIds(restored, new Map([[fileId, newFileId]]));
    const template = getTaskTemplates(restored)[0]!;
    expect(template.values[filePropertyId]).toEqual([newFileId]);
    expect(
      template.properties.find((property) => property.id === relationId)
        ?.relation?.databaseId,
    ).toBe(newDb);
    expect(getTaskTemplates(doc)[0]!.values[filePropertyId]).toEqual([fileId]);
    expect(
      getTaskTemplates(doc)[0]!.properties.find(
        (property) => property.id === relationId,
      )?.relation?.databaseId,
    ).toBe(db);
    expect(() => assertTaskTemplates(restored)).not.toThrow();
    const created = createTaskFromTemplate(restored, newDb, templateId),
      row = getTaskRows(restored).find((row) => row.id === created)!,
      properties = getDatabaseProperties(restored),
      read = (id: string) =>
        readDatabaseValue(
          restored,
          row,
          properties.find((property) => property.id === id)!,
        );
    expect(read(textId)).toBe("Captured");
    expect(read(numberId)).toBe(0);
    expect(read(filePropertyId)).toEqual([newFileId]);
    expect(read(relationId)).toEqual([created, otherId]);
    expect(getLiveAttachmentIds(restored)).toEqual([newFileId]);
    updateTaskField(restored, created, "deleted", true);
    changeTaskTemplate(restored, templateId, { deleted: true });
    expect(getAttachmentIds(restored)).toEqual([]);
    expect(getTaskTemplates(fork(doc))[0]!.values[textId]).toBe("Captured");
  });
  it("requires explicit omission after deleted definitions, Relation target changes, or removed options without partially creating a Task", () => {
    const doc = new Y.Doc(),
      db = crypto.randomUUID(),
      rowId = createTaskRow(doc, "Source"),
      textId = addDatabaseProperty(doc, "Notes", "text"),
      selectId = addDatabaseProperty(doc, "Choice", "select", ["Yes", "No"]),
      relationId = addDatabaseProperty(
        doc,
        "Related",
        "relation",
        [],
        undefined,
        { relation: { databaseId: db } },
      ),
      choice = getDatabaseProperties(doc).find(
        (property) => property.id === selectId,
      )!;
    writeDatabaseValue(doc, rowId, selectId, choice.options[0]!.id);
    writeDatabaseValue(doc, rowId, relationId, [rowId]);
    const templateId = saveTaskTemplate(doc, rowId, "Guarded");
    changeDatabaseProperty(doc, textId, { deleted: true });
    changeDatabaseProperty(doc, relationId, {
      relation: { databaseId: crypto.randomUUID() },
    });
    doc
      .getMap<Y.Map<unknown>>("databaseProperties")
      .get(selectId)!
      .set("options", choice.options.slice(1));
    const template = getTaskTemplates(doc)[0]!,
      before = Y.encodeStateAsUpdate(doc);
    expect(changedTaskTemplateProperties(doc, template)).toEqual([
      "Notes",
      "Choice",
      "Related",
    ]);
    expect(() => createTaskFromTemplate(doc, db, templateId)).toThrow("제외");
    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    const created = createTaskFromTemplate(
      doc,
      db,
      templateId,
      undefined,
      true,
    );
    expect(
      doc
        .getMap<Y.Map<unknown>>("tasks")
        .get(created)!
        .get(`property:${selectId}`),
    ).toBeUndefined();
    expect(getTaskTemplates(doc)).toHaveLength(1);
    expect(() => assertTaskTemplates(doc)).not.toThrow();
    doc
      .getMap<Y.Map<unknown>>("taskTemplates")
      .get(templateId)!
      .set("values", { [relationId]: ["invalid"] });
    expect(() => assertTaskTemplates(doc)).toThrow();
  });
  it("clones formatting and empty XML without retaining mutable text identities", () => {
    const doc = new Y.Doc(),
      content = doc.getXmlFragment("content"),
      paragraph = new Y.XmlElement("paragraph"),
      text = new Y.XmlText();
    paragraph.insert(0, [text]);
    text.insert(0, "Bold", { bold: {} });
    content.insert(0, [paragraph]);
    const target = new Y.Doc();
    target.getXmlFragment("content").insert(0, cloneXmlContent(content));
    text.insert(0, "Source ");
    expect(target.getXmlFragment("content").toString()).toContain(
      "<bold>Bold</bold>",
    );
    expect(target.getXmlFragment("content").toString()).not.toContain("Source");
    expect(cloneXmlContent(new Y.Doc().getXmlFragment("content"))).toEqual([]);
  });
});
