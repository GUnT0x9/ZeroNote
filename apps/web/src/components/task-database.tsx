"use client";
import { Fragment, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  DndContext,
  useDraggable,
  useDroppable,
  useSensors,
  useSensor,
  PointerSensor,
  KeyboardSensor,
} from "@dnd-kit/core";
import {
  Plus,
  GripVertical,
  ChevronLeft,
  ChevronRight,
  Calendar,
  SlidersHorizontal,
  Save,
  List,
  LayoutGrid,
  GanttChartSquare,
} from "lucide-react";
import {
  createTaskRow,
  updateTaskField,
  TaskStatuses,
  type TaskRow,
  type Identity,
  getDatabaseMode,
  getDatabaseProperties,
  defaultDatabaseView,
  getDatabaseViews,
  saveDatabaseView,
  deleteDatabaseView,
  queryDatabaseRows,
  groupDatabaseRows,
  writeDatabaseValue,
  type DatabaseView,
  type DatabaseViewKind,
  type DatabaseProperty,
  type PropertyValue,
} from "@zeronote/shared";
import type { DocumentSession } from "@/lib/documents";
import type { LocalPage } from "@/lib/database";
import { useDocumentRevision } from "@/lib/hooks";
import { useUiStore } from "@/lib/ui-store";
import { DesignIcon } from "./design-icon";
import { Dialog } from "./primitives";
import { DatabasePropertyCell } from "./database-property";
import {
  DatabasePropertyDialog,
  DatabaseViewSettings,
} from "./database-settings";
import { DatabaseDateView, DatabaseCards } from "./database-date-views";
import { errorMessage } from "@/lib/database";
export const STATUS_LABELS = {
  todo: "Todo",
  in_progress: "In progress",
  done: "Done",
};
export const PRIORITY_LABELS = { low: "Low", medium: "Medium", high: "High" };
export function TaskDatabase({
  session,
  page,
  editable,
  identities,
}: {
  session: DocumentSession;
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
}) {
  useDocumentRevision(session.document);
  const [viewId, setViewId] = useState("default-table"),
    [drafts, setDrafts] = useState<Record<string, DatabaseView>>({}),
    [query, setQuery] = useState(""),
    [newTitle, setNewTitle] = useState(""),
    [adding, setAdding] = useState(false),
    [propertyDialog, setPropertyDialog] = useState(false),
    [savingView, setSavingView] = useState(false),
    [viewName, setViewName] = useState(""),
    [viewError, setViewError] = useState<string | null>(null);
  const generic = getDatabaseMode(session.document) === "generic",
    properties = getDatabaseProperties(session.document),
    savedViews = getDatabaseViews(session.document);
  const stored = savedViews.find((entry) => entry.id === viewId);
  const baseView =
    drafts[viewId] ??
    stored ??
    defaultDatabaseView(
      (viewId.startsWith("default-")
        ? viewId.replace("default-", "")
        : "table") as DatabaseViewKind,
      session.document,
    );
  const propertyIds = new Set(properties.map((property) => property.id));
  const view: DatabaseView = {
    ...baseView,
    filters: baseView.filters.filter((filter) =>
      propertyIds.has(filter.propertyId),
    ),
    sorts: baseView.sorts.filter((sort) => propertyIds.has(sort.propertyId)),
    groupBy:
      baseView.groupBy && propertyIds.has(baseView.groupBy)
        ? baseView.groupBy
        : null,
    datePropertyId:
      baseView.datePropertyId && propertyIds.has(baseView.datePropertyId)
        ? baseView.datePropertyId
        : null,
    endDatePropertyId:
      baseView.endDatePropertyId && propertyIds.has(baseView.endDatePropertyId)
        ? baseView.endDatePropertyId
        : null,
  };
  const rows = queryDatabaseRows(session.document, view, query, identities);
  const openRow = (id: string) =>
    useUiStore.getState().select(page.workspaceId, page.id, id);
  const changeView = (next: DatabaseView) =>
    setDrafts((previous) => ({ ...previous, [viewId]: next }));
  const update = (
    id: string,
    field: Exclude<keyof TaskRow, "id" | "title">,
    value: unknown,
  ) => {
    try {
      updateTaskField(session.document, id, field, value);
    } catch (error) {
      useUiStore.getState().patch({
        notice: error instanceof Error ? error.message : "Task 변경 실패",
      });
    }
  };
  const add = () => {
    if (!editable || !newTitle.trim()) return;
    createTaskRow(session.document, newTitle.trim());
    setNewTitle("");
    setAdding(false);
  };
  return (
    <div className="task-database">
      <div className="database-toolbar">
        <div className="view-tabs">
          <button
            className={view.kind === "table" ? "active" : ""}
            aria-pressed={view.kind === "table"}
            onClick={() => setViewId("default-table")}
          >
            <DesignIcon name="table" />
            Table
          </button>
          <button
            className={view.kind === "board" ? "active" : ""}
            aria-pressed={view.kind === "board"}
            onClick={() => setViewId("default-board")}
          >
            <DesignIcon name="board" />
            Board
          </button>
          {(["calendar", "timeline", "gallery", "list"] as const).map(
            (kind) => {
              const Icon =
                kind === "calendar"
                  ? Calendar
                  : kind === "timeline"
                    ? GanttChartSquare
                    : kind === "gallery"
                      ? LayoutGrid
                      : List;
              return (
                <button
                  key={kind}
                  className={view.kind === kind ? "active" : ""}
                  aria-pressed={view.kind === kind}
                  onClick={() => setViewId(`default-${kind}`)}
                >
                  <Icon size={15} />
                  {kind[0]!.toUpperCase() + kind.slice(1)}
                </button>
              );
            },
          )}
        </div>
        <div className="database-actions">
          <label className="compact-search">
            <DesignIcon name="task-search" />
            <input
              aria-label={generic ? "항목 검색" : "Task 검색"}
              placeholder={generic ? "항목 검색" : "Task 검색"}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {editable && (
            <button
              className="button button-primary button-small"
              onClick={() => setAdding(true)}
            >
              <Plus size={14} />
              {generic ? "새 항목" : "새 Task"}
            </button>
          )}
        </div>
      </div>
      <div className="database-settings-toolbar">
        <DatabaseViewSettings
          key={view.kind}
          view={view}
          properties={properties}
          onChange={changeView}
        />
        <div className="button-row database-save-controls">
          {!!savedViews.length && (
            <select
              aria-label="저장된 보기"
              value={stored?.id ?? ""}
              onChange={(event) =>
                setViewId(event.target.value || "default-table")
              }
            >
              <option value="">저장된 보기</option>
              {savedViews.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
          {editable && (
            <>
              <button
                className="button button-small"
                onClick={() => setPropertyDialog(true)}
              >
                <SlidersHorizontal size={14} />
                속성
              </button>
              <button
                className="button button-small"
                onClick={() => {
                  setViewName(stored?.name ?? view.name);
                  setViewError(null);
                  setSavingView(true);
                }}
              >
                <Save size={14} />
                보기 저장
              </button>
            </>
          )}
        </div>
      </div>
      {propertyDialog && editable && (
        <DatabasePropertyDialog
          document={session.document}
          onClose={() => setPropertyDialog(false)}
        />
      )}
      {savingView && editable && (
        <Dialog title="보기 저장" onClose={() => setSavingView(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const next = {
                  ...view,
                  id: stored?.id ?? crypto.randomUUID(),
                  name: viewName.trim(),
                };
                saveDatabaseView(session.document, next);
                setViewId(next.id);
                setDrafts((previous) => {
                  const copy = { ...previous };
                  delete copy[next.id];
                  return copy;
                });
                setSavingView(false);
              } catch (problem) {
                setViewError(errorMessage(problem));
              }
            }}
          >
            <label className="field-label">
              보기 이름
              <input
                aria-label="보기 이름"
                value={viewName}
                maxLength={80}
                onChange={(event) => setViewName(event.target.value)}
                required
              />
            </label>
            {viewError && (
              <div className="inline-warning" role="alert">
                {viewError}
              </div>
            )}
            <div className="dialog-footer">
              {stored && (
                <button
                  className="button danger-text"
                  type="button"
                  onClick={() => {
                    deleteDatabaseView(session.document, stored.id);
                    setViewId("default-table");
                    setSavingView(false);
                  }}
                >
                  보기 삭제
                </button>
              )}
              <button
                className="button"
                type="button"
                onClick={() => setSavingView(false)}
              >
                취소
              </button>
              <button
                className="button button-primary"
                type="submit"
                disabled={!viewName.trim()}
              >
                저장
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {adding && editable && (
        <form
          className="task-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            autoFocus
            aria-label={generic ? "새 항목 제목" : "새 Task 제목"}
            maxLength={500}
            placeholder={generic ? "항목 이름" : "Task 제목"}
            value={newTitle}
            onChange={(event) => setNewTitle(event.target.value)}
          />
          <button className="button button-primary button-small" type="submit">
            추가
          </button>
          <button
            className="button button-small"
            type="button"
            onClick={() => setAdding(false)}
          >
            취소
          </button>
        </form>
      )}
      {view.kind === "table" ? (
        <TaskTable
          rows={rows}
          session={session}
          page={page}
          editable={editable}
          identities={identities}
          properties={properties.filter(
            (property) =>
              !view.hiddenPropertyIds.includes(property.id) ||
              property.id === "title",
          )}
          groupBy={view.groupBy}
          generic={generic}
        />
      ) : view.kind === "board" ? (
        <TaskBoard
          rows={rows}
          page={page}
          editable={editable}
          identities={identities}
          update={update}
          session={session}
          view={view}
        />
      ) : ["calendar", "timeline"].includes(view.kind) ? (
        <DatabaseDateView
          key={page.id}
          document={session.document}
          rows={rows}
          view={view}
          openRow={openRow}
        />
      ) : (
        <DatabaseCards
          document={session.document}
          rows={rows}
          view={view}
          identities={identities}
          openRow={openRow}
        />
      )}
      <div className="database-footnote">
        {generic
          ? `${rows.length}개 항목`
          : `${rows.length}개 Task · ${rows.filter((row) => row.status === "done").length}개 완료`}
        {!rows.length && query && <span> · 검색 결과 없음</span>}
      </div>
    </div>
  );
}
type UpdateTask = (
  id: string,
  field: Exclude<keyof TaskRow, "id" | "title">,
  value: unknown,
) => void;
function TaskTable({
  rows,
  session,
  page,
  editable,
  identities,
  properties,
  groupBy,
  generic,
}: {
  rows: TaskRow[];
  session: DocumentSession;
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  properties: DatabaseProperty[];
  groupBy: string | null;
  generic: boolean;
}) {
  const columns = useMemo<ColumnDef<TaskRow>[]>(
    () =>
      properties.map((property) => ({
        id: property.id,
        header: property.name,
        cell: ({ row }) =>
          property.id === "title" ? (
            <div className="task-name-cell">
              <button
                className="task-open icon-button"
                aria-label={`${row.original.title} 열기`}
                onClick={() =>
                  useUiStore
                    .getState()
                    .select(page.workspaceId, page.id, row.original.id)
                }
              >
                <DesignIcon name="task-open" />
              </button>
              <DatabasePropertyCell
                document={session.document}
                row={row.original}
                property={property}
                editable={editable}
                identities={identities}
                label={generic ? "항목 이름" : "Task 이름"}
              />
            </div>
          ) : (
            <DatabasePropertyCell
              document={session.document}
              row={row.original}
              property={property}
              editable={editable}
              identities={identities}
              label={
                property.id === "dueDate"
                  ? `${row.original.title} 마감일`
                  : property.id === "assigneeId"
                    ? `${row.original.title} 담당자`
                    : property.id === "priority"
                      ? `${row.original.title} 우선순위`
                      : undefined
              }
            />
          ),
      })),
    [
      properties,
      session.document,
      page.id,
      page.workspaceId,
      editable,
      identities,
      generic,
    ],
  );
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });
  return (
    <>
      <div className="table-scroll">
        <table className="task-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id}>
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {groupDatabaseRows(
              session.document,
              table.getRowModel().rows.map((row) => row.original),
              groupBy,
              identities,
            ).map((group) => (
              <Fragment key={group.key}>
                {groupBy && (
                  <tr className="database-table-group">
                    <th colSpan={properties.length}>
                      {group.label} · {group.rows.length}
                    </th>
                  </tr>
                )}
                {group.rows.map((entry) => {
                  const row = table
                    .getRowModel()
                    .rows.find((item) => item.original.id === entry.id)!;
                  return (
                    <tr key={row.id}>
                      {row.getVisibleCells().map((cell) => (
                        <td key={cell.id}>
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="table-empty">
            <Checkmark />
            아직 Task가 없습니다. 첫 작업을 추가해보세요.
          </div>
        )}
      </div>
      {table.getPageCount() > 1 && (
        <div className="pagination">
          <span>
            {table.getState().pagination.pageIndex + 1} / {table.getPageCount()}
          </span>
          <button
            className="icon-button"
            aria-label="이전 Task 페이지"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="다음 Task 페이지"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}
function Checkmark() {
  return <span className="empty-check">✓</span>;
}
function TaskBoard({
  rows,
  page,
  editable,
  identities,
  update,
  session,
  view,
}: {
  rows: TaskRow[];
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  update: UpdateTask;
  session: DocumentSession;
  view: DatabaseView;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  const generic = getDatabaseMode(session.document) === "generic";
  const groups = groupDatabaseRows(
      session.document,
      rows,
      view.groupBy,
      identities,
    ),
    property = getDatabaseProperties(session.document).find(
      (entry) => entry.id === view.groupBy,
    );
  const movable =
    editable &&
    !!property &&
    ["select", "status", "person", "checkbox"].includes(property.type);
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        const group = groups.find((entry) => entry.key === over?.id);
        if (movable && group && property) {
          try {
            writeDatabaseValue(
              session.document,
              String(active.id),
              property.id,
              group.value,
            );
          } catch (problem) {
            useUiStore.getState().patch({ notice: errorMessage(problem) });
          }
        }
      }}
    >
      <div className="kanban-board">
        {groups.map((group) => (
          <BoardColumn
            key={group.key}
            group={group}
            generic={generic}
            page={page}
            editable={editable}
            draggable={movable}
            identities={identities}
            update={update}
          />
        ))}
      </div>
    </DndContext>
  );
}
function BoardColumn({
  group,
  generic,
  page,
  editable,
  draggable,
  identities,
  update,
}: {
  group: { key: string; label: string; value: PropertyValue; rows: TaskRow[] };
  generic: boolean;
  page: LocalPage;
  editable: boolean;
  draggable: boolean;
  identities: Identity[];
  update: UpdateTask;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: group.key,
    disabled: !draggable,
  });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${isOver ? "drag-over" : ""}`}
      aria-label={group.label}
    >
      <div className="kanban-heading">
        <strong>{group.label}</strong>
        <span>{group.rows.length}</span>
      </div>
      {group.rows.map((row) => (
        <BoardCard
          key={row.id}
          row={row}
          generic={generic}
          page={page}
          editable={editable}
          draggable={draggable}
          identities={identities}
          update={update}
        />
      ))}
      {!group.rows.length && (
        <div className="kanban-empty">아직 항목이 없습니다</div>
      )}
    </section>
  );
}
function BoardCard({
  row,
  page,
  editable,
  identities,
  update,
  draggable,
  generic,
}: {
  row: TaskRow;
  generic: boolean;
  draggable: boolean;
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  update: UpdateTask;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: row.id, disabled: !draggable });
  const identity = identities.find((person) => person.id === row.assigneeId);
  return (
    <article
      ref={setNodeRef}
      className={`kanban-card ${isDragging ? "dragging" : ""}`}
      style={{
        transform: transform
          ? `translate(${transform.x}px,${transform.y}px)`
          : undefined,
      }}
    >
      <div className="kanban-card-title">
        <button
          onClick={() =>
            useUiStore.getState().select(page.workspaceId, page.id, row.id)
          }
          className={row.status === "done" ? "completed" : ""}
        >
          {row.title || "제목 없음"}
        </button>
        {draggable && (
          <button
            className="drag-handle"
            {...listeners}
            {...attributes}
            aria-label={`${row.title} 이동`}
          >
            <GripVertical size={15} />
          </button>
        )}
      </div>
      <div className="kanban-card-meta">
        {!generic && (
          <span className={`priority-tag ${row.priority}`}>
            {PRIORITY_LABELS[row.priority]}
          </span>
        )}
        {row.dueDate && (
          <span>
            <Calendar size={12} />
            {row.dueDate.slice(5)}
          </span>
        )}
        {identity && (
          <span className="avatar-mini" title={identity.name}>
            {identity.name.slice(0, 1)}
          </span>
        )}
      </div>
      {editable && !generic && (
        <select
          className="board-status"
          aria-label={`${row.title} Status`}
          value={row.status}
          onChange={(event) => update(row.id, "status", event.target.value)}
        >
          {TaskStatuses.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      )}
    </article>
  );
}
