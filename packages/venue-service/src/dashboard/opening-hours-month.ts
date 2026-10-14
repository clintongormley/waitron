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
import { format, formatLongDate, formatMonthName, formatWeekday } from "./hours-view.js";
import type { SeasonWrites } from "./season-chips.js";
import "./season-chips.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import type { SpecialDayAction } from "./special-day-action.js";
import { t } from "./strings.js";

type Day = OpeningHoursMonth["days"][number];

/** What the month reads of a department: its name, its zones' names and its periods' names and colours. */
export interface MonthDepartment {
  id: string;
  name: string;
  zones: readonly { id: string; name: string }[];
  periods: readonly { id: string; name: string; colour: CalendarColour }[];
}

/** What `ordinary-date-open` carries: a date no special day or public holiday holds. */
export interface OrdinaryDateOpen {
  date: LocalDate;
  seasonId: string | null;
  returnTo: () => HTMLElement | null;
}

/** The months the month read serves: its first week must start in year 0100 or later. */
const FIRST_MONTH = "0100-02";
const LAST_MONTH = "9998-12";
const DAY = 1440;
/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = "2024-01-01";
const ALL = "all";

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

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
  ranges: readonly ServiceRange[];
  /** A zone's closed times, drawn as cuts across its department's ranges. */
  gaps: readonly ClosedRange[];
}

/** One month of the venue's days in whole Monday-to-Sunday weeks, each date drawing its hours as a bar
 *  per department (or one department and its zones), from the server's month read alone. A date sends
 *  `special-day-action` on a special day or public holiday and `ordinary-date-open` otherwise; ‹ ›
 *  send `month-change`, "‹ year" `month-year-open` and the picker `month-department-change`. */
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
      .year-back {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        cursor: pointer;
        min-height: var(--wt-tap-min);
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
      .head .add {
        margin-inline-start: auto;
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
      button.day:focus-visible,
      .year-back:focus-visible {
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
      .closed-row {
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
      .closed-row {
        color: inherit;
      }
      /* A phone's width: too narrow for the word "Today" in a date, so the number is marked and the
         word kept for a screen reader; a date closed all day says so in its name alone. */
      @container month (width < 560px) {
        table {
          border-spacing: calc(var(--wt-space-1) / 2);
        }
        .day {
          padding: var(--wt-space-1) calc(var(--wt-space-1) / 4);
        }
        .closed-row[data-all-day] {
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
        .closed-row {
          -webkit-line-clamp: 6;
        }
      }
    `,
  ];

  /** The month as the server reads it; the host fetches a new one on `month-change`. */
  @property({ attribute: false }) model?: OpeningHoursMonth;
  /** The `YYYY-MM` the host asked for, ahead of `model` while its read is pending; ‹ › step from it
   *  so presses during the wait add up, and only the year link, its heading and ‹ › are drawn until
   *  `model` is of this month. "" steps from `model`. */
  @property() month = "";
  /** The chosen department; "" draws every department. */
  @property() departmentId = "";
  /** The departments' names, zones' names and periods' colours. */
  @property({ attribute: false }) departments: readonly MonthDepartment[] = [];
  /** The season writes the chips send. */
  @property({ attribute: false }) api?: SeasonWrites;
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  @property({ type: Boolean }) readOnly = false;
  /** One prep station's month, its one row the station: no year, no department picker, no special
   *  day to add, the season chips a key only, and a date it gets nothing reads "No orders". */
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

  #action(date: LocalDate, day: Day | undefined, trigger: HTMLElement): void {
    const model = this.model!;
    this.#emit<SpecialDayAction>("special-day-action", {
      kind: "open",
      date,
      specialDay: day?.specialDay ? { ...day.specialDay } : null,
      holidays: structuredClone(day?.holidays ?? []),
      visibleHolidays: structuredClone(model.days.flatMap((other) => other.holidays)),
      returnTo: () => (trigger.isConnected ? trigger : this.#dayButton(date)),
    });
  }

  #open(day: Day, trigger: HTMLElement): void {
    if (day.specialDay || day.holidays.length) {
      this.#action(day.date, day, trigger);
      return;
    }
    const date = day.date;
    this.#emit<OrdinaryDateOpen>("ordinary-date-open", {
      date,
      seasonId: day.seasonId,
      returnTo: () => (trigger.isConnected ? trigger : this.#dayButton(date)),
    });
  }

  /** The chosen department's id when the read carries it, else "" for every department. */
  #chosen(model: OpeningHoursMonth): string {
    return model.days[0]!.departments.some((d) => d.departmentId === this.departmentId)
      ? this.departmentId
      : "";
  }

  #rows(day: Day, chosen: string, { name }: Names): Row[] {
    if (!chosen)
      return day.departments.map((d) => ({
        key: d.departmentId,
        name: name(d.departmentId),
        ranges: d.ranges,
        gaps: [],
      }));
    const department = day.departments.find((d) => d.departmentId === chosen)!;
    return [
      { key: chosen, name: name(chosen), ranges: department.ranges, gaps: [] },
      ...department.zones.map((zone) => ({
        key: zone.zoneId,
        name: name(zone.zoneId),
        ranges: department.ranges,
        gaps: zone.closed,
      })),
    ];
  }

  /** Places a range on the business day's track, which runs from the day's changeover to the next
   *  day's; a time at or before the start is on the clock's next day. */
  #placer({ dayCutover, endMinute }: Day) {
    const cutover = minutes(dayCutover);
    const minute = (time: string) => (minutes(time) - cutover + DAY) % DAY;
    return ({ startsAt, endsAt }: ClosedRange) => {
      const start = minute(startsAt);
      const end = minute(endsAt) + (minute(endsAt) <= start ? DAY : 0);
      return styleMap({
        left: `${(start / endMinute) * 100}%`,
        width: `${((end - start) / endMinute) * 100}%`,
      });
    };
  }

  #emptyRow(row: Row): string {
    return this.stationMode
      ? t("month.no_orders")
      : format("month.department_closed", { name: row.name });
  }

  #describe(day: Day, rows: readonly Row[], names: Names): string[] {
    if (day.closedAllDay) return [];
    return rows.map((row) => {
      if (!row.ranges.length) return this.#emptyRow(row);
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
      ${rows.map((row) =>
        !row.ranges.length
          ? html`<span
              class="closed-row"
              ?data-all-day=${day.closedAllDay}
              data-test=${this.stationMode ? "no-orders" : "department-closed"}
              >${this.#emptyRow(row)}</span
            >`
          : html`<span class="track" data-row=${row.key}>
              ${row.ranges.map((range) => {
                const period = names.period(range.periodId);
                return html`<span
                  class="segment"
                  data-colour=${period.colour ?? nothing}
                  title=${format("month.range", {
                    name: period.name,
                    start: range.startsAt,
                    end: range.endsAt,
                  })}
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
        this.readOnly
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
              @click=${(event: Event) => this.#open(day, event.currentTarget as HTMLElement)}
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
    return html`${
        this.stationMode
          ? nothing
          : html`<button
              type="button"
              class="year-back"
              data-test="year-back"
              aria-label=${format("month.year_back", { year: String(year) })}
              @click=${() => this.#emit("month-year-open", { year })}
            >
              ‹ ${year}
            </button>`
      }
      <div class="head">
        ${step(-1, "previous-month", "month.previous", "‹")}
        <h2 data-test="month" aria-live="polite">
          ${formatMonthName(Number(current.slice(5, 7)))} ${year}
        </h2>
        ${step(1, "next-month", "month.next", "›")} ${model ? this.#tools(model) : nothing}
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
    return html`${this.#picker(model, this.#chosen(model), this.#names())}
    ${
      this.readOnly
        ? nothing
        : html`<wt-button
            class="add"
            variant="secondary"
            data-test="add-special-day"
            @click=${(event: Event) =>
              this.#action("", undefined, event.currentTarget as HTMLElement)}
            >${t("year.add_special")}</wt-button
          >`
    }`;
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
    return html`<div class="sub">
        <season-chips
          .seasons=${model.seasons}
          .clockRevision=${model.clockRevision}
          .api=${this.api}
          .specialDays=${this.specialDays}
          .readOnly=${this.readOnly}
          .keyOnly=${this.stationMode}
        ></season-chips>
        ${
          this.stationMode
            ? nothing
            : html`<p class="rows" data-test="rows">
                ${t("month.rows")}
                ${legend.map((name, index) => html`${index ? " · " : ""}<strong>${name}</strong>`)}
              </p>`
        }
      </div>
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
