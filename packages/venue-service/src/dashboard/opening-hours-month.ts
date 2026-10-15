import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { holidayDateName } from "../holiday-naming.js";
import type { CalendarColour, LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { ClosedRange, ServiceRange } from "../service-day.js";
import { placeOnDay, zoneOwnHours, type Placed } from "../zone-own-hours.js";
import { format, formatLongDate, formatMonthName, formatWeekday } from "./hours-view.js";
import "./season-chips.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { t } from "./strings.js";

type Day = OpeningHoursMonth["days"][number];

/** What the month reads of a department: its name, its zones' names and its periods' names and colours. */
export interface MonthDepartment {
  id: string;
  name: string;
  zones: readonly { id: string; name: string }[];
  periods: readonly { id: string; name: string; colour: CalendarColour }[];
}

/** What `calendar-day-open` carries; `returnTo` finds the date's button while it is drawn. */
export interface CalendarDayOpen {
  date: LocalDate;
  returnTo: () => HTMLElement | null;
}

/** The months the month read serves: its first week must start in year 0100 or later. */
const FIRST_MONTH = "0100-02";
const LAST_MONTH = "9998-12";
/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = "2024-01-01";
const ALL = "all";

function stepMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Names for the read's ids, from the host's department list; an id the list lacks reads "". */
interface Names {
  name(id: string): string;
  period(id: string): { name: string; colour?: string };
}

interface Row {
  key: string;
  name: string;
  ranges: readonly (ServiceRange & Placed)[];
  /** A zone's closed times, cut to where its department is open; none when they cover all of it,
   *  so the bar is empty. */
  gaps: readonly (ClosedRange & Placed)[];
}

/** One month of the venue's days in whole Monday-to-Sunday weeks, each date drawing its hours as a bar
 *  per department (or one department and its zones), from the server's month read alone. A date sends
 *  `calendar-day-open`, except in station mode, where dates are plain; ‹ › send `month-change` and
 *  the picker `month-department-change`. */
@customElement("opening-hours-month")
export class OpeningHoursMonthView extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container: month / inline-size;
      }
      .head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
      }
      .head h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .head h2::first-letter {
        text-transform: uppercase;
      }
      .sub {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-4);
        margin-block-end: var(--wt-space-2);
      }
      .rows {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .rows strong {
        color: var(--wt-color-text);
      }
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: var(--wt-space-1);
        table-layout: fixed;
      }
      th {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
        color: var(--wt-color-text-muted);
        text-align: start;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      td {
        /* Without a set height the card's 100% resolves to nothing and stops short of the row. */
        height: 1px;
        padding: 0;
        vertical-align: top;
      }
      .day {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        width: 100%;
        position: relative;
        height: 100%;
        min-width: 0;
        min-height: calc(var(--wt-tap-min) * 2);
        padding: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-block-start: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        text-align: start;
        overflow: hidden;
      }
      button.day {
        cursor: pointer;
      }
      .day[aria-current="date"] {
        box-shadow: inset 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary);
      }
      button.day:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      td[data-tint] .day {
        border-block-start-color: var(--season-tint-line);
      }
      td[data-outside] .day {
        background: var(--wt-color-bg);
        color: var(--wt-color-text-muted);
      }
      td[data-outside] .track {
        opacity: 0.4;
      }
      td[data-closed] .day {
        background: var(--wt-color-day-closed);
        color: var(--wt-color-on-day-closed);
      }
      .top {
        display: flex;
        align-items: baseline;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      .date {
        font-weight: var(--wt-font-weight-bold);
      }
      .today {
        padding: 0 var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
        white-space: nowrap;
      }
      .name,
      .no-orders {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 4;
        overflow: hidden;
        overflow-wrap: anywhere;
        hyphens: auto;
      }
      .name {
        font-weight: var(--wt-font-weight-bold);
      }
      .name.special {
        color: var(--wt-color-palette-purple);
      }
      .name.holiday {
        color: var(--wt-color-palette-red);
      }
      td[data-closed] .name {
        color: inherit;
      }
      .track {
        position: relative;
        display: block;
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-border);
        overflow: hidden;
      }
      .segment,
      .gap {
        position: absolute;
        inset-block: 0;
      }
      .gap {
        background: var(--wt-color-border);
      }
      .segment[data-colour="red"] {
        background: var(--wt-color-palette-red);
      }
      .segment[data-colour="amber"] {
        background: var(--wt-color-palette-amber);
      }
      .segment[data-colour="grey"] {
        background: var(--wt-color-palette-grey);
      }
      .segment[data-colour="blue"] {
        background: var(--wt-color-palette-blue);
      }
      .segment[data-colour="green"] {
        background: var(--wt-color-palette-green);
      }
      .segment[data-colour="purple"] {
        background: var(--wt-color-palette-purple);
      }
      /* A phone's width: too narrow for the word "Today" in a date, so the number is marked and the
         word kept for a screen reader; a station's date closed all day drops "No orders" there, its
         name saying Closed. */
      @container month (width < 560px) {
        table {
          border-spacing: calc(var(--wt-space-1) / 2);
        }
        .day {
          padding: var(--wt-space-1) calc(var(--wt-space-1) / 4);
        }
        .no-orders[data-all-day] {
          display: none;
        }
        .top {
          flex-wrap: wrap;
        }
        .day[aria-current="date"] .date {
          padding: 0 calc(var(--wt-space-1) / 2);
          border-radius: var(--wt-radius-sm);
          background: var(--wt-color-primary);
          color: var(--wt-color-on-primary);
        }
        .today {
          ${visuallyHiddenStyles}
        }
        .name,
        .no-orders {
          -webkit-line-clamp: 6;
        }
      }
    `,
  ];

  /** The month as the server reads it; the host fetches a new one on `month-change`. */
  @property({ attribute: false }) model?: OpeningHoursMonth;
  /** The `YYYY-MM` the host asked for, ahead of `model` while its read is pending; ‹ › step from it
   *  so presses during the wait add up, and only the heading, ‹ › and the switch's slot are drawn
   *  until `model` is of this month. "" steps from `model`. */
  @property() month = "";
  /** The chosen department; "" draws every department. */
  @property() departmentId = "";
  /** The departments' names, zones' names and periods' colours. */
  @property({ attribute: false }) departments: readonly MonthDepartment[] = [];
  @property({ type: Boolean }) readOnly = false;
  /** One prep station's month: its rows the station, or one per department when several feed it. */
  @property({ type: Boolean }) stationMode = false;
  /** The date that holds the month's one Tab stop. */
  @state() private focusDate: LocalDate | null = null;

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] button`);
  }

  #keydown(event: KeyboardEvent): void {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const date = (event.composedPath()[0] as HTMLElement).closest("td")?.dataset.date;
    if (step === undefined || date === undefined) return;
    event.preventDefault();
    const target = this.#dayButton(addDays(date, step));
    if (!target) return;
    this.focusDate = target.closest("td")!.dataset.date!;
    target.focus();
  }

  #open(date: LocalDate): void {
    this.#emit<CalendarDayOpen>("calendar-day-open", {
      date,
      returnTo: () => this.#dayButton(date),
    });
  }

  /** The chosen department's id when the read carries it, else "" for every department. */
  #chosen(model: OpeningHoursMonth): string {
    return model.days[0]!.departments.some((d) => d.departmentId === this.departmentId)
      ? this.departmentId
      : "";
  }

  #rows(day: Day, chosen: string, { name }: Names): Row[] {
    const place = placeOnDay(day);
    const placed = (ranges: readonly ServiceRange[]) =>
      ranges.map((range) => ({ ...range, ...place(range) }));
    if (!chosen)
      return day.departments.map((d) => ({
        key: d.departmentId,
        name: name(d.departmentId),
        ranges: placed(d.ranges),
        gaps: [],
      }));
    const department = day.departments.find((d) => d.departmentId === chosen)!;
    return [
      { key: chosen, name: name(chosen), ranges: placed(department.ranges), gaps: [] },
      ...department.zones.map((zone) => {
        const own = zoneOwnHours(department.ranges, zone.closed, day);
        return {
          key: zone.zoneId,
          name: name(zone.zoneId),
          ranges: own.ranges,
          gaps: own.ranges.length ? own.closed : [],
        };
      }),
    ];
  }

  #placer({ endMinute }: Day) {
    return ({ start, end }: Placed) =>
      styleMap({
        left: `${(start / endMinute) * 100}%`,
        width: `${((end - start) / endMinute) * 100}%`,
      });
  }

  #noOrders(rows: readonly Row[]): boolean {
    return this.stationMode && rows.every((row) => !row.ranges.length);
  }

  #title(period: string, row: Row, rows: readonly Row[], range: ClosedRange): string {
    const name =
      this.stationMode && rows.length > 1
        ? format("month.period_department", { period, department: row.name })
        : period;
    return format("month.range", { name, start: range.startsAt, end: range.endsAt });
  }

  #describe(day: Day, rows: readonly Row[], names: Names): string[] {
    if (day.closedAllDay) return [];
    if (this.#noOrders(rows)) return [t("month.no_orders")];
    return rows.map((row) => {
      if (this.stationMode && !row.ranges.length) return `${row.name}: ${t("month.no_orders")}`;
      if (!row.ranges.length) return format("month.department_closed", { name: row.name });
      const parts = row.ranges.map((range) =>
        format("month.range", {
          name: names.period(range.periodId).name,
          start: range.startsAt,
          end: range.endsAt,
        }),
      );
      const gaps = row.gaps.map((gap) =>
        format("month.zone_closed", { name: row.name, start: gap.startsAt, end: gap.endsAt }),
      );
      return `${row.name}: ${[...parts, ...gaps].join(", ")}`;
    });
  }

  #cell(
    day: Day,
    model: OpeningHoursMonth,
    chosen: string,
    tints: Map<string, string>,
    names: Names,
    stop: LocalDate,
  ) {
    const rows = this.#rows(day, chosen, names);
    const none = this.#noOrders(rows);
    const place = this.#placer(day);
    const holidayName = holidayDateName(day.holidays, day.date, "");
    const special = day.specialDay?.name ?? "";
    const isToday = day.date === model.today;
    const lines = [
      ...(special && special !== holidayName ? [{ name: special, kind: "special" }] : []),
      ...(holidayName ? [{ name: holidayName, kind: "holiday" }] : []),
    ];
    if (day.closedAllDay)
      lines[0] = lines[0]
        ? { ...lines[0], name: format("hours.calendar.special_closed", { name: lines[0].name }) }
        : { name: t("hours.closed"), kind: "" };
    const nameLines = lines.map(
      (line) => html`<span class="name ${line.kind}" data-test="name">${line.name}</span>`,
    );
    const label = [
      formatLongDate(day.date),
      special !== holidayName ? special : "",
      holidayName,
      day.closedAllDay ? t("hours.closed") : "",
      isToday ? t("hours.today") : "",
      ...this.#describe(day, rows, names),
    ]
      .filter(Boolean)
      .join(", ");
    const body = html`<span class="top">
        <span class="date" data-test="date-heading">${Number(day.date.slice(8))}</span>
        ${isToday ? html`<span class="today" data-test="today">${t("hours.today")}</span>` : nothing}
      </span>
      ${nameLines}
      ${(none ? rows.slice(0, 1) : rows).map((row) =>
        none
          ? html`<span class="no-orders" ?data-all-day=${day.closedAllDay} data-test="no-orders"
              >${t("month.no_orders")}</span
            >`
          : html`<span class="track" data-row=${row.key}>
              ${row.ranges.map((range) => {
                const period = names.period(range.periodId);
                return html`<span
                  class="segment"
                  data-colour=${period.colour ?? nothing}
                  title=${this.#title(period.name, row, rows, range)}
                  style=${place(range)}
                ></span>`;
              })}
              ${row.gaps.map(
                (gap) =>
                  html`<span
                    class="gap"
                    data-test="gap"
                    title=${format("month.zone_closed", {
                      name: row.name,
                      start: gap.startsAt,
                      end: gap.endsAt,
                    })}
                    style=${place(gap)}
                  ></span>`,
              )}
            </span>`,
      )}`;
    return html`<td
      data-date=${day.date}
      data-tint=${(day.seasonId && tints.get(day.seasonId)) || nothing}
      ?data-outside=${!day.inMonth}
      ?data-closed=${day.closedAllDay}
    >
      ${
        this.stationMode
          ? html`<div
              class="day"
              role="group"
              aria-label=${label}
              aria-current=${isToday ? "date" : nothing}
            >
              ${body}
            </div>`
          : html`<button
              type="button"
              class="day"
              tabindex=${day.date === stop ? 0 : -1}
              aria-label=${label}
              aria-current=${isToday ? "date" : nothing}
              @click=${() => this.#open(day.date)}
              @focus=${() => {
                this.focusDate = day.date;
              }}
            >
              ${body}
            </button>`
      }
    </td>`;
  }

  #picker(model: OpeningHoursMonth, chosen: string, names: Names) {
    const value = chosen || ALL;
    const options = [
      { value: ALL, label: t("opening.all_departments") },
      ...model.days[0]!.departments.map((d) => ({
        value: d.departmentId,
        label: names.name(d.departmentId),
      })),
    ];
    return html`<wt-combobox
      name="departmentId"
      label=${t("opening.show")}
      search="never"
      .options=${options}
      .value=${value}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        const chooser = event.currentTarget as HTMLElementTagNameMap["wt-combobox"];
        chooser.value = value;
        const next = event.detail.value === ALL ? "" : event.detail.value;
        if (next !== chosen) this.#emit("month-department-change", { departmentId: next });
      }}
    ></wt-combobox>`;
  }

  override render() {
    const current = this.month || this.model?.month;
    if (!current) return nothing;
    const model = this.model?.month === current ? this.model : undefined;
    const step = (by: number, test: string, label: Parameters<typeof t>[0], glyph: string) => {
      const target = stepMonth(current, by);
      const blocked = target < FIRST_MONTH || target > LAST_MONTH;
      return html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        ?disabled=${blocked}
        @click=${() => {
          if (!blocked) this.#emit("month-change", { month: target });
        }}
        >${glyph}</wt-button
      >`;
    };
    const year = Number(current.slice(0, 4));
    return html`<div class="head">
        ${step(-1, "previous-month", "month.previous", "‹")}
        <h2 data-test="month" aria-live="polite">
          ${formatMonthName(Number(current.slice(5, 7)))} ${year}
        </h2>
        ${step(1, "next-month", "month.next", "›")}
        <slot name="switch"></slot>
        ${model ? this.#tools(model) : nothing}
      </div>
      ${model ? this.#grid(model) : nothing}`;
  }

  #names(): Names {
    const named = new Map<string, string>(
      this.departments.flatMap((d) => [
        [d.id, d.name] as const,
        ...d.zones.map((z) => [z.id, z.name] as const),
      ]),
    );
    const periods = new Map(
      this.departments.flatMap((d) => d.periods.map((p) => [p.id, p] as const)),
    );
    return {
      name: (id) => named.get(id) ?? "",
      period: (id) => periods.get(id) ?? { name: "" },
    };
  }

  #tools(model: OpeningHoursMonth) {
    if (this.stationMode) return nothing;
    return this.#picker(model, this.#chosen(model), this.#names());
  }

  #grid(model: OpeningHoursMonth) {
    const chosen = this.#chosen(model);
    const tints = seasonTints(model.seasons);
    const names = this.#names();
    const stop =
      [this.focusDate, model.today].find(
        (date): date is LocalDate => date != null && model.days.some((day) => day.date === date),
      ) ?? model.days.find((day) => day.inMonth)!.date;
    const legend = this.#rows(model.days[0]!, chosen, names).map((row) => row.name);
    const weeks = Array.from({ length: model.days.length / 7 }, (_, row) =>
      model.days.slice(row * 7, row * 7 + 7),
    );
    return html`${
        this.stationMode
          ? html`<div class="sub">
              <season-chips
                .seasons=${model.seasons}
                .clockRevision=${model.clockRevision}
                .readOnly=${this.readOnly}
                .keyOnly=${true}
              ></season-chips>
              ${
                legend.length < 2
                  ? nothing
                  : html`<p class="rows" data-test="rows">
                      ${t("month.rows")}
                      ${legend.map((name, index) => html`${index ? " · " : ""}<strong>${name}</strong>`)}
                    </p>`
              }
            </div>`
          : nothing
      }
      <table @keydown=${this.#keydown}>
        <thead>
          <tr>
            ${Array.from({ length: 7 }, (_, index) => {
              const date = addDays(A_MONDAY, index);
              return html`<th scope="col" data-test="weekday" abbr=${formatWeekday(date, "long")}>
                ${formatWeekday(date, "short")}
              </th>`;
            })}
          </tr>
        </thead>
        <tbody>
          ${weeks.map(
            (week) =>
              html`<tr>
                ${week.map((day) => this.#cell(day, model, chosen, tints, names, stop))}
              </tr>`,
          )}
        </tbody>
      </table>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-month": OpeningHoursMonthView;
  }
}
