"use client";
import { useState } from "react";
import type * as Y from "yjs";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  calendarMonthDays,
  shiftCalendarMonth,
  databaseRowDateRange,
  groupDatabaseRows,
  getDatabaseProperties,
  type DatabaseView,
  type TaskRow,
  type Identity,
  type DatabaseValueReader,
} from "@zeronote/shared";
export function DatabaseDateView({
  document,
  rows,
  view,
  openRow,
}: {
  document: Y.Doc;
  rows: TaskRow[];
  view: DatabaseView;
  openRow: (id: string) => void;
}) {
  const [month, setMonth] = useState(() =>
    new Date().toLocaleDateString("en-CA").slice(0, 7),
  );
  // Date-only strings are placed using UTC calendar arithmetic, never timezone conversion.
  const days = calendarMonthDays(month),
    ranges = rows.map((row) => ({
      row,
      range: databaseRowDateRange(document, row, view),
    })),
    monthDays = days.filter((day) => day.startsWith(month));
  const visible = ranges.filter(
    (entry) =>
      entry.range &&
      entry.range.end >= `${month}-01` &&
      entry.range.start <= monthDays.at(-1)!,
  );
  const undated = ranges.filter((entry) => !entry.range);
  return (
    <div className="database-date-view">
      <div className="calendar-heading">
        <div className="button-row">
          <button
            className="icon-button"
            aria-label="이전 달"
            onClick={() => setMonth(shiftCalendarMonth(month, -1))}
          >
            <ChevronLeft size={16} />
          </button>
          <strong>{month}</strong>
          <button
            className="icon-button"
            aria-label="다음 달"
            onClick={() => setMonth(shiftCalendarMonth(month, 1))}
          >
            <ChevronRight size={16} />
          </button>
        </div>
        <button
          className="text-button"
          onClick={() =>
            setMonth(new Date().toLocaleDateString("en-CA").slice(0, 7))
          }
        >
          이번 달
        </button>
      </div>
      {!view.datePropertyId && (
        <p className="inline-warning">
          Date 속성을 추가한 뒤 날짜 속성을 선택해주세요.
        </p>
      )}
      {view.kind === "calendar" ? (
        <div className="calendar-scroll">
          <div
            className="database-calendar"
            role="region"
            aria-label="Calendar 날짜"
          >
            {["월", "화", "수", "목", "금", "토", "일"].map((day) => (
              <div key={day} className="calendar-weekday">
                {day}
              </div>
            ))}
            {days.map((day) => (
              <section
                className={`calendar-day ${day.startsWith(month) ? "" : "outside-month"}`}
                key={day}
                aria-label={day}
              >
                <time dateTime={day}>{Number(day.slice(8))}</time>
                {ranges
                  .filter((entry) => entry.range?.start === day)
                  .map(({ row }) => (
                    <button
                      className="calendar-item"
                      key={row.id}
                      onClick={() => openRow(row.id)}
                    >
                      {row.title || "제목 없음"}
                    </button>
                  ))}
              </section>
            ))}
          </div>
        </div>
      ) : (
        <div className="timeline-scroll">
          <div
            className="database-timeline"
            role="region"
            aria-label="Timeline 날짜"
            style={{
              gridTemplateColumns: `180px repeat(${monthDays.length}, minmax(24px, 1fr))`,
            }}
          >
            <div className="timeline-title">항목</div>
            {monthDays.map((day) => (
              <time key={day} dateTime={day}>
                {Number(day.slice(8))}
              </time>
            ))}
            {visible.map(({ row, range }, index) => {
              if (!range) return null;
              const start = Math.max(
                  0,
                  monthDays.findIndex((day) => day >= range.start),
                ),
                last =
                  range.end >= monthDays.at(-1)!
                    ? monthDays.length - 1
                    : monthDays.filter((day) => day <= range.end).length - 1;
              return (
                <div
                  className="timeline-row"
                  key={row.id}
                  style={{ gridRow: index + 2 }}
                >
                  <button
                    className="timeline-row-name"
                    style={{ gridRow: index + 2 }}
                    onClick={() => openRow(row.id)}
                  >
                    {row.title}
                  </button>
                  <button
                    className="timeline-bar"
                    aria-label={`${row.title} ${range.start}부터 ${range.end}`}
                    style={{
                      gridRow: index + 2,
                      gridColumn: `${start + 2} / ${last + 3}`,
                    }}
                    onClick={() => openRow(row.id)}
                  >
                    {row.title}
                  </button>
                </div>
              );
            })}
            {!visible.length && (
              <p className="timeline-empty">이 달에 표시할 항목이 없습니다.</p>
            )}
          </div>
        </div>
      )}
      {!!undated.length && (
        <section className="database-undated">
          <h3>날짜 없음 ({undated.length})</h3>
          {undated.map(({ row }) => (
            <button
              className="backlink-item"
              key={row.id}
              onClick={() => openRow(row.id)}
            >
              {row.title}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
export function DatabaseCards({
  document,
  rows,
  view,
  identities,
  openRow,
  reader,
}: {
  document: Y.Doc;
  rows: TaskRow[];
  view: DatabaseView;
  identities: Identity[];
  openRow: (id: string) => void;
  reader: DatabaseValueReader;
}) {
  const properties = getDatabaseProperties(document).filter(
    (property) =>
      property.id !== "title" && !view.hiddenPropertyIds.includes(property.id),
  );
  return (
    <div>
      {groupDatabaseRows(document, rows, view.groupBy, identities, reader).map(
        (group) => (
          <section className="database-card-group" key={group.key}>
            {view.groupBy && (
              <h3>
                {group.label} <span className="muted">{group.rows.length}</span>
              </h3>
            )}
            <div
              className={
                view.kind === "gallery" ? "database-gallery" : "database-list"
              }
            >
              {group.rows.map((row) => (
                <button
                  className="database-preview-card"
                  key={row.id}
                  onClick={() => openRow(row.id)}
                >
                  <strong>{row.title || "제목 없음"}</strong>
                  <dl>
                    {properties.map((property) => (
                      <div key={property.id}>
                        <dt>{property.name}</dt>
                        <dd title={reader.cell(row, property).error?.message}>
                          {reader.label(row, property) || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </button>
              ))}
            </div>
          </section>
        ),
      )}
    </div>
  );
}
