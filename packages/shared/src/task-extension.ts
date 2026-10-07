import * as Y from "yjs";
import { z } from "zod";
import {
  createTaskRow,
  getTaskRows,
  TaskRowSchema,
  type TaskRow,
} from "./index";
import { PageTagSchema } from "./page-tags";
import { normalizeSearchText } from "./search-normalize";
import {
  TaskExtensionShape,
  MAX_TASK_LABELS,
  MAX_TASK_DEPENDENCIES,
} from "./task-schema";

export type TaskRelationKind = "parent" | "dependency";
export interface TaskRelationIssue {
  rowId: string;
  targetId: string;
  kind: TaskRelationKind;
  reason: "missing" | "cycle";
}

export function taskEntryMap(
  document: Y.Doc,
  rowId: string,
  key: "labels" | "dependencies",
): Y.Map<unknown> {
  z.uuid().parse(rowId);
  return document.getMap<unknown>(`task-${key}:${rowId}`);
}
export function readTaskExtensions(
  document: Y.Doc,
  rowId: string,
  row: Y.Map<unknown>,
) {
  const labels = taskEntryMap(document, rowId, "labels"),
    dependencies = taskEntryMap(document, rowId, "dependencies");
  return {
    parentTaskId:
      TaskExtensionShape.parentTaskId.safeParse(row.get("parentTaskId")).data ??
      null,
    estimateMinutes:
      TaskExtensionShape.estimateMinutes.safeParse(row.get("estimateMinutes"))
        .data ?? null,
    labels:
      labels instanceof Y.Map
        ? [...labels]
            .flatMap(([key, value]) => {
              const parsed = PageTagSchema.safeParse(value);
              return parsed.success && key === normalizeSearchText(parsed.data)
                ? [parsed.data]
                : [];
            })
            .sort((a, b) => a.localeCompare(b))
        : [],
    dependencyIds:
      dependencies instanceof Y.Map
        ? [...dependencies]
            .flatMap(([key, value]) =>
              value === true && z.uuid().safeParse(key).success ? [key] : [],
            )
            .sort()
        : [],
  };
}
function taskMap(document: Y.Doc, rowId: string): Y.Map<unknown> {
  const row = document
    .getMap<Y.Map<unknown>>("tasks")
    .get(z.uuid().parse(rowId));
  if (!(row instanceof Y.Map) || row.get("deleted") === true)
    throw new Error("Task를 찾을 수 없습니다.");
  return row;
}
function touch(row: Y.Map<unknown>): void {
  row.set("updatedAt", new Date().toISOString());
}

export function setTaskLabel(
  document: Y.Doc,
  rowId: string,
  input: string,
): void {
  const label = PageTagSchema.parse(input),
    key = normalizeSearchText(label),
    row = taskMap(document, rowId);
  const labels = taskEntryMap(document, rowId, "labels");
  if (
    labels instanceof Y.Map &&
    !labels.has(key) &&
    labels.size >= MAX_TASK_LABELS
  )
    throw new Error("Task Label은 최대 30개입니다.");
  document.transact(() => {
    labels.set(key, label);
    touch(row);
  });
}
export function removeTaskLabel(
  document: Y.Doc,
  rowId: string,
  input: string,
): void {
  const row = taskMap(document, rowId),
    labels = taskEntryMap(document, rowId, "labels");
  document.transact(() => {
    if (labels instanceof Y.Map) labels.delete(normalizeSearchText(input));
    touch(row);
  });
}
export function renameTaskLabel(
  document: Y.Doc,
  rowId: string,
  previous: string,
  next: string,
): void {
  const label = PageTagSchema.parse(next),
    row = taskMap(document, rowId),
    labels = taskEntryMap(document, rowId, "labels"),
    old = normalizeSearchText(previous);
  if (!(labels instanceof Y.Map) || !labels.has(old))
    throw new Error("변경할 Label을 찾을 수 없습니다.");
  document.transact(() => {
    labels.delete(old);
    labels.set(normalizeSearchText(label), label);
    touch(row);
  });
}
function targets(row: TaskRow, kind: TaskRelationKind): string[] {
  return kind === "parent"
    ? row.parentTaskId
      ? [row.parentTaskId]
      : []
    : row.dependencyIds;
}
export function assertTaskRelationChange(
  rows: TaskRow[],
  rowId: string,
  targetId: string | null,
  kind: TaskRelationKind,
): void {
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (!byId.has(rowId)) throw new Error("Task를 찾을 수 없습니다.");
  if (targetId === null) return;
  z.uuid().parse(targetId);
  if (!byId.has(targetId))
    throw new Error("같은 Database의 활성 Task를 선택해주세요.");
  const pending = [targetId],
    visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === rowId) throw new Error("Task 관계에 순환을 만들 수 없습니다.");
    if (visited.has(id)) continue;
    visited.add(id);
    const row = byId.get(id);
    if (row) pending.push(...targets(row, kind));
  }
}
export function setTaskParent(
  document: Y.Doc,
  rowId: string,
  parentId: string | null,
): void {
  const row = taskMap(document, rowId);
  assertTaskRelationChange(getTaskRows(document), rowId, parentId, "parent");
  document.transact(() => {
    row.set("parentTaskId", parentId);
    touch(row);
  });
}
export function setTaskDependency(
  document: Y.Doc,
  rowId: string,
  targetId: string,
  enabled: boolean,
): void {
  const row = taskMap(document, rowId);
  z.uuid().parse(targetId);
  if (enabled) {
    assertTaskRelationChange(
      getTaskRows(document),
      rowId,
      targetId,
      "dependency",
    );
    const existing = taskEntryMap(document, rowId, "dependencies");
    if (
      existing instanceof Y.Map &&
      !existing.has(targetId) &&
      existing.size >= MAX_TASK_DEPENDENCIES
    )
      throw new Error("선행 작업은 최대 50개입니다.");
  }
  document.transact(() => {
    const map = taskEntryMap(document, rowId, "dependencies");
    if (enabled) map.set(targetId, true);
    else map.delete(targetId);
    touch(row);
  });
}
/** Reports missing edges and DFS closing edges without dropping the merged data. */
export function getTaskRelationIssues(rows: TaskRow[]): TaskRelationIssue[] {
  const byId = new Map(rows.map((row) => [row.id, row])),
    issues: TaskRelationIssue[] = [];
  for (const kind of ["parent", "dependency"] as const) {
    const done = new Set<string>(),
      visiting = new Set<string>();
    for (const row of rows) {
      if (done.has(row.id)) continue;
      const stack: { id: string; edges: string[]; index: number }[] = [
        { id: row.id, edges: targets(row, kind), index: 0 },
      ];
      visiting.add(row.id);
      while (stack.length) {
        const item = stack[stack.length - 1]!;
        if (item.index >= item.edges.length) {
          done.add(item.id);
          visiting.delete(item.id);
          stack.pop();
          continue;
        }
        const targetId = item.edges[item.index++]!;
        const target = byId.get(targetId);
        if (!target) {
          issues.push({ rowId: item.id, targetId, kind, reason: "missing" });
          continue;
        }
        if (visiting.has(targetId)) {
          issues.push({ rowId: item.id, targetId, kind, reason: "cycle" });
          continue;
        }
        if (done.has(targetId)) continue;
        visiting.add(targetId);
        stack.push({ id: targetId, edges: targets(target, kind), index: 0 });
      }
    }
  }
  return issues;
}
export function assertTaskExtensions(document: Y.Doc): void {
  for (const [id, row] of document.getMap<Y.Map<unknown>>("tasks")) {
    if (!(row instanceof Y.Map))
      throw new Error("Task 형식이 올바르지 않습니다.");
    if (row.get("deleted") === true) continue;
    const title = row.get("title");
    TaskRowSchema.parse({
      ...row.toJSON(),
      id,
      title: title instanceof Y.Text ? title.toString() : "",
      ...readTaskExtensions(document, id, row),
    });
    TaskExtensionShape.parentTaskId.parse(row.get("parentTaskId"));
    TaskExtensionShape.estimateMinutes.parse(row.get("estimateMinutes"));
    for (const key of ["labels", "dependencies"] as const) {
      const map = taskEntryMap(document, id, key);
      if (
        !(map instanceof Y.Map) ||
        map.size > (key === "labels" ? MAX_TASK_LABELS : MAX_TASK_DEPENDENCIES)
      )
        throw new Error("Task Label 또는 선행 작업 한도를 초과했습니다.");
      for (const [entry, value] of map) {
        if (key === "labels") {
          const label = PageTagSchema.parse(value);
          if (value !== label || entry !== normalizeSearchText(label))
            throw new Error("Task Label 형식이 올바르지 않습니다.");
        } else {
          z.uuid().parse(entry);
          if (value !== true)
            throw new Error("선행 작업 형식이 올바르지 않습니다.");
        }
      }
    }
    const relations = readTaskExtensions(document, id, row);
    for (const targetId of [
      ...relations.dependencyIds,
      ...(relations.parentTaskId ? [relations.parentTaskId] : []),
    ])
      if (
        !(
          document.getMap<Y.Map<unknown>>("tasks").get(targetId) instanceof
          Y.Map
        )
      )
        throw new Error(
          "같은 Database의 Task만 연결할 수 있습니다. 표시된 연결을 해제해주세요.",
        );
  }
  if (
    getTaskRelationIssues(getTaskRows(document)).some(
      (issue) => issue.reason === "cycle",
    )
  )
    throw new Error("Task 관계에 순환이 있습니다. 표시된 연결을 해제해주세요.");
}
export function createSubtask(
  document: Y.Doc,
  parentId: string,
  title: string,
): string {
  taskMap(document, parentId);
  z.string().trim().min(1).max(500).parse(title);
  let id = "";
  document.transact(() => {
    id = createTaskRow(document, title.trim());
    taskMap(document, id).set("parentTaskId", parentId);
  });
  return id;
}
export function taskCompletionWarning(
  rows: TaskRow[],
  rowId: string,
  status: unknown,
): string | null {
  if (status !== "done") return null;
  const row = rows.find((item) => item.id === rowId);
  if (!row) throw new Error("Task를 찾을 수 없습니다.");
  const pending = rows.filter(
    (item) => row.dependencyIds.includes(item.id) && item.status !== "done",
  );
  return pending.length
    ? `미완료 선행 작업 ${pending.length}개가 있습니다. 그래도 완료할까요?`
    : null;
}
