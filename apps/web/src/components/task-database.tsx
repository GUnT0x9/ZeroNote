"use client";
import { useMemo, useState } from "react";
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
} from "lucide-react";
import * as Y from "yjs";
import {
  getTaskRows,
  createTaskRow,
  updateTaskField,
  replaceSharedText,
  TaskStatuses,
  TaskPriorities,
  type TaskRow,
  type Identity,
} from "@zeronote/shared";
import type { DocumentSession } from "@/lib/documents";
import type { LocalPage } from "@/lib/database";
import { useDocumentRevision } from "@/lib/hooks";
import { useUiStore } from "@/lib/ui-store";
import { DesignIcon } from "./design-icon";
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
  const [view, setView] = useState<"table" | "board">("table"),
    [query, setQuery] = useState(""),
    [newTitle, setNewTitle] = useState(""),
    [adding, setAdding] = useState(false);
  const rows = getTaskRows(session.document).filter((row) =>
    row.title.toLowerCase().includes(query.toLowerCase()),
  );
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
    if (!newTitle.trim()) return;
    createTaskRow(session.document, newTitle.trim());
    setNewTitle("");
    setAdding(false);
  };
  return (
    <div className="task-database">
      <div className="database-toolbar">
        <div className="view-tabs">
          <button
            className={view === "table" ? "active" : ""}
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
          >
            <DesignIcon name="table" />
            Table
          </button>
          <button
            className={view === "board" ? "active" : ""}
            aria-pressed={view === "board"}
            onClick={() => setView("board")}
          >
            <DesignIcon name="board" />
            Board
          </button>
        </div>
        <div className="database-actions">
          <label className="compact-search">
            <DesignIcon name="task-search" />
            <input
              aria-label="Task 검색"
              placeholder="Task 검색"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {editable && (
            <button
              className="button button-primary button-small"
              onClick={() => setAdding(true)}
            >
              <Plus size={14} />새 Task
            </button>
          )}
        </div>
      </div>
      {adding && (
        <form
          className="task-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <input
            autoFocus
            aria-label="새 Task 제목"
            placeholder="Task 제목"
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
      {view === "table" ? (
        <TaskTable
          rows={rows}
          session={session}
          page={page}
          editable={editable}
          identities={identities}
          update={update}
        />
      ) : (
        <TaskBoard
          rows={rows}
          page={page}
          editable={editable}
          identities={identities}
          update={update}
        />
      )}
      <div className="database-footnote">
        {rows.length}개 Task ·{" "}
        {rows.filter((row) => row.status === "done").length}개 완료
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
  update,
}: {
  rows: TaskRow[];
  session: DocumentSession;
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  update: UpdateTask;
}) {
  const columns = useMemo<ColumnDef<TaskRow>[]>(
    () => [
      {
        accessorKey: "title",
        header: "Task",
        cell: ({ row }) => (
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
            <input
              aria-label="Task 이름"
              value={row.original.title}
              readOnly={!editable}
              className={row.original.status === "done" ? "completed" : ""}
              onChange={(event) => {
                const title = session.document
                  .getMap<Y.Map<unknown>>("tasks")
                  .get(row.original.id)
                  ?.get("title");
                if (title instanceof Y.Text)
                  replaceSharedText(title, event.target.value);
              }}
            />
          </div>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <select
            aria-label={`${row.original.title} Status`}
            className={`status-select ${row.original.status}`}
            value={row.original.status}
            disabled={!editable}
            onChange={(event) =>
              update(row.original.id, "status", event.target.value)
            }
          >
            {TaskStatuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "assigneeId",
        header: "Assignee",
        cell: ({ row }) => (
          <select
            aria-label={`${row.original.title} 담당자`}
            value={row.original.assigneeId ?? ""}
            disabled={!editable}
            onChange={(event) =>
              update(row.original.id, "assigneeId", event.target.value || null)
            }
          >
            <option value="">미지정</option>
            {identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.name}
              </option>
            ))}
          </select>
        ),
      },
      {
        accessorKey: "dueDate",
        header: "Due date",
        cell: ({ row }) => (
          <input
            aria-label={`${row.original.title} 마감일`}
            type="date"
            value={row.original.dueDate ?? ""}
            disabled={!editable}
            onChange={(event) =>
              update(row.original.id, "dueDate", event.target.value || null)
            }
          />
        ),
      },
      {
        accessorKey: "priority",
        header: "Priority",
        cell: ({ row }) => (
          <select
            aria-label={`${row.original.title} 우선순위`}
            value={row.original.priority}
            disabled={!editable}
            onChange={(event) =>
              update(row.original.id, "priority", event.target.value)
            }
          >
            {TaskPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </select>
        ),
      },
    ],
    [page.id, page.workspaceId, session.document, editable, identities, update],
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
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
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
}: {
  rows: TaskRow[];
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  update: UpdateTask;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );
  return (
    <DndContext
      sensors={sensors}
      onDragEnd={({ active, over }) => {
        if (
          editable &&
          over &&
          TaskStatuses.includes(over.id as TaskRow["status"])
        )
          update(String(active.id), "status", String(over.id));
      }}
    >
      <div className="kanban-board">
        {TaskStatuses.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            rows={rows.filter((row) => row.status === status)}
            page={page}
            editable={editable}
            identities={identities}
            update={update}
          />
        ))}
      </div>
    </DndContext>
  );
}
function BoardColumn({
  status,
  rows,
  page,
  editable,
  identities,
  update,
}: {
  status: TaskRow["status"];
  rows: TaskRow[];
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  update: UpdateTask;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: status,
    disabled: !editable,
  });
  return (
    <section
      ref={setNodeRef}
      className={`kanban-column ${isOver ? "drag-over" : ""}`}
      aria-label={STATUS_LABELS[status]}
    >
      <div className="kanban-heading">
        <span className={`status-dot ${status}`} />
        <strong>{STATUS_LABELS[status]}</strong>
        <span>{rows.length}</span>
      </div>
      {rows.map((row) => (
        <BoardCard
          key={row.id}
          row={row}
          page={page}
          editable={editable}
          identities={identities}
          update={update}
        />
      ))}
      {!rows.length && <div className="kanban-empty">아직 작업이 없습니다</div>}
    </section>
  );
}
function BoardCard({
  row,
  page,
  editable,
  identities,
  update,
}: {
  row: TaskRow;
  page: LocalPage;
  editable: boolean;
  identities: Identity[];
  update: UpdateTask;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: row.id, disabled: !editable });
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
        {editable && (
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
        <span className={`priority-tag ${row.priority}`}>
          {PRIORITY_LABELS[row.priority]}
        </span>
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
      {editable && (
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
