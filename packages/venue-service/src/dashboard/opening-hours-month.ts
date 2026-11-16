import { LitElement, css, html, nothing, unsafeCSS, type PropertyValues } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { CalendarColour, LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { ClosedRange, ServiceRange } from "../service-day.js";
import { joinPlacedRanges, placeOnDay, zoneOwnHours, type Placed } from "../zone-own-hours.js";
import { addMonths, FIRST_MONTH, LAST_MONTH } from "./calendar-grid.js";
import {
  chosenDepartment,
  dayNameLines,
  monthNames,
  type MonthNames,
} from "./opening-hours-day.js";
import { dateAroundDay, format, formatMonthName, formatWeekday } from "./hours-view.js";
import { DayPicker, type DayPoint } from "./day-picking.js";
import { calendarSelection, calendarSelectionStyles } from "./calendar-selection.js";
import { periodColourStyles } from "./period-colour-styles.js";
import { dayNameWords, dayNameWordStyles } from "./day-name-words.js";
import { fixedTitle, fixedTitleStyles } from "./fixed-title.js";
import { SPECIAL_DAY_LINE, seasonTints, seasonTintStyles } from "./season-tint.js";
import { t, VENUE_SERVICE_STRINGS } from "./strings.js";
import { stationIcon } from "./station-icon.js";
import { showPicker, stationExplanation, type CalendarShow } from "./calendar-show.js";
import type { ShowStation, StationShow } from "./station-show.js";

type Day = OpeningHoursMonth["days"][number];

/** What the month reads of a department: its name, its zones' names and its periods' names and colours. */
export interface MonthDepartment {
  id: string;
  name: string;
  station?: boolean;
  stationHeading?: string;
  stationGroup?: string;
  zones: readonly { id: string; name: string }[];
  periods: readonly { id: string; name: string; colour: CalendarColour }[];
}

/** What `calendar-day-open` carries; `returnTo` finds the date's button while it is drawn. */
export interface CalendarDayOpen {
  date: LocalDate;
  returnTo: () => HTMLElement | null;
  point?: DayPoint;
  /** The clicked row when it differs from the date that takes focus back. */
  anchor?: HTMLElement;
}

/** The trigger date and exact selected dates, sorted without duplicates. */
export interface CalendarDaysOpen {
  date: LocalDate;
  dates: readonly LocalDate[];
}

/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = "2024-01-01";

interface Row {
  station?: boolean;
  stationHeading?: string;
  stationGroup?: string;
  key: string;
  name: string;
  ranges: readonly (ClosedRange & Placed & { periodId?: string })[];
}

@customElement("opening-hours-month")
export class OpeningHoursMonthView extends LitElement {
  static override styles = [
    calendarSelectionStyles,
    baseStyles,
    seasonTintStyles,
    fixedTitleStyles,
    periodColourStyles,
    dayNameWordStyles,
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
      .head wt-combobox {
        min-width: 0;
      }
      .station-heading {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        font-weight: var(--wt-font-weight-bold);
      }
      .row-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .named-track {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      .no-orders {
        color: var(--wt-color-text-muted);
      }
      .year-link {
        display: inline-block;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
      .year-link:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .year-hint,
      .visually-hidden {
        ${visuallyHiddenStyles}
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
      .special-run {
        background: var(--wt-color-surface);
        position: absolute;
        inset-block-start: 0;
        inset-inline: 0;
        border-block-start: var(--wt-space-1) dashed ${unsafeCSS(SPECIAL_DAY_LINE)};
        z-index: 1;
        pointer-events: none;
      }
      .special-run[data-joins-next] {
        inset-inline-end: calc(-1 * var(--wt-space-1));
      }
      td {
        position: relative;
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
      table.picking {
        user-select: none;
        -webkit-touch-callout: none;
        touch-action: manipulation;
      }
      button.day {
        cursor: pointer;
        touch-action: manipulation;
        -webkit-touch-callout: none;
      }
      .day[aria-current="date"] {
        box-shadow: inset 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary);
      }
      .day[aria-pressed="true"] {
        box-shadow: 0 0 0 var(--wt-field-line-width-active) var(--wt-color-text);
      }
      /* Beside today's inner ring a picked ring of the same width reads as one thicker ring. */
      .day[aria-pressed="true"][aria-current="date"] {
        box-shadow:
          inset 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary),
          0 0 0 calc(var(--wt-field-line-width-active) * 2) var(--wt-color-text);
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
      td[data-outside] .empty-track {
        opacity: 1;
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
      }
      .no-orders {
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
      td[data-closed] .name,
      td[data-closed] .no-orders {
        color: inherit;
      }
      .track {
        position: relative;
        display: block;
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-track);
        overflow: hidden;
      }
      .rows wt-icon {
        margin-inline-end: var(--wt-space-1);
        vertical-align: middle;
      }
      .named-track .empty-track {
        overflow-wrap: anywhere;
        height: auto;
        min-height: var(--wt-space-2);
        background: transparent;
        font-size: var(--wt-font-size-sm);
      }
      .segment {
        position: absolute;
        inset-block: 0;
      }
      .segment {
        background: var(--period-fill, var(--wt-color-primary));
      }
      @container month (width < 560px) {
        .special-run[data-joins-next] {
          inset-inline-end: calc(-1 * var(--wt-space-1) / 2);
        }
        table {
          border-spacing: calc(var(--wt-space-1) / 2);
        }
        .day {
          padding: var(--wt-space-1) calc(var(--wt-space-1) / 4);
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
   *  so presses during the wait add up, and only the heading and ‹ › are drawn until `model` is of
   *  this month. "" steps from `model`. */
  @property() month = "";
  /** The chosen department; "" draws every department. */
  @property() departmentId = "";
  /** The departments' names, zones' names and periods' colours. */
  @property({ attribute: false }) departments: readonly MonthDepartment[] = [];
  @property({ type: Boolean }) readOnly = false;
  /** The prep stations Show offers. */
  @property({ attribute: false }) stations: readonly ShowStation[] = [];
  /** The station Show shows, drawn in place of `model`'s departments; its rows read as orders. */
  @property({ attribute: false }) station?: StationShow;
  @property() show: CalendarShow = "";
  /** Draws the title's year as a link sending `month-year-open`, where a Year view exists. */
  @property({ type: Boolean }) linkYear = false;
  #dayPicker = new DayPicker(this, {
    button: (date) => this.#dayButton(date),
    canPick: () => !this.readOnly && !this.station,
    multiple: true,
    choose: (date, _trigger, point) =>
      this.#emit<CalendarDayOpen>("calendar-day-open", {
        date,
        returnTo: () => this.#dayButton(date),
        point: this.station ? point : undefined,
      }),
    open: (date, _run, _trigger, dates) =>
      this.#emit<CalendarDaysOpen>("calendar-days-open", { date, dates }),
  });

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (!changes.has("model")) return;
    const before = changes.get("model") as OpeningHoursMonth | undefined;
    if (before?.month !== this.model?.month) this.#dayPicker.clear();
  }

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] button`);
  }

  #rows(day: Day, chosen: string, names: MonthNames): Row[] {
    const { name } = names;
    const place = placeOnDay(day);
    const placed = (ranges: readonly ServiceRange[], orders = this.#orders) => {
      const pieces = ranges.map((range) => ({ ...range, ...place(range) }));
      return orders ? pieces : joinPlacedRanges(pieces);
    };
    if (!chosen)
      return day.departments.map((d) => ({
        key: d.departmentId,
        name: name(d.departmentId),
        station: names.station(d.departmentId),
        stationHeading: names.stationHeading(d.departmentId),
        stationGroup: names.stationGroup(d.departmentId),
        ranges: placed(d.ranges, this.#orders || names.station(d.departmentId)),
      }));
    const department = day.departments.find((d) => d.departmentId === chosen)!;
    return [
      { key: chosen, name: name(chosen), ranges: placed(department.ranges) },
      ...department.zones.map((zone) => {
        const own = zoneOwnHours(department.ranges, zone.closed, day);
        return {
          key: zone.zoneId,
          name: name(zone.zoneId),
          ranges: joinPlacedRanges(own.ranges),
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

  get #orders(): boolean {
    return this.station !== undefined && !(this.station.state === "ready" && this.station.mixed);
  }

  #noOrders(rows: readonly Row[]): boolean {
    return !this.show && this.#orders && rows.every((row) => !row.ranges.length);
  }

  #title(period: string, row: Row, range: ClosedRange): string {
    const name = this.station
      ? format("month.period_department", { period, department: row.name })
      : period;
    return format("month.range", { name, start: range.startsAt, end: range.endsAt });
  }

  #describe(day: Day, rows: readonly Row[], names: MonthNames): string[] {
    if (day.closedAllDay) return [];
    if (this.#noOrders(rows)) return [t("month.no_orders")];
    return rows.map((row) => {
      const label = `${names.station(row.key) ? t("opening.prep_station") + " " : ""}${row.stationGroup !== undefined ? row.stationGroup + ": " : ""}${row.name}`;
      if ((this.#orders || row.station) && !row.ranges.length)
        return `${label}: ${t("month.no_orders")}`;
      if (!row.ranges.length) return format("month.department_closed", { name: row.name });
      if (!this.#orders && !row.station)
        return `${row.name}: ${row.ranges.map(({ startsAt, endsAt }) => format("day.open_range", { start: startsAt, end: endsAt })).join(", ")}`;
      const parts = row.ranges.map((range) =>
        format("month.range", {
          name: names.period(range.periodId ?? "").name,
          start: range.startsAt,
          end: range.endsAt,
        }),
      );
      return `${label}: ${parts.join(", ")}`;
    });
  }

  #cell(
    day: Day,
    model: OpeningHoursMonth,
    chosen: string,
    tints: Map<string, string>,
    names: MonthNames,
    stop: LocalDate,
  ) {
    const rows = this.#rows(day, chosen, names);
    const none = this.#noOrders(rows);
    const place = this.#placer(day);
    const isToday = day.date === model.today;
    const named = dayNameLines(day);
    const lines = [...named];
    if (day.closedAllDay)
      lines[0] = lines[0]
        ? { ...lines[0], name: format("hours.calendar.special_closed", { name: lines[0].name }) }
        : { name: t("hours.closed"), kind: "" };
    const separator = html`<span class="visually-hidden">, </span>`;
    const unseen = this.#describe(day, rows, names).join(", ");
    const nameLines = lines.map(
      (line, index) =>
        html`${index || isToday ? separator : nothing}<span
            class="name ${line.kind}"
            data-test="name"
            title=${line.name}
            >${dayNameWords(line.name)}</span
          >`,
    );
    const around = dateAroundDay(day.date, {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const more = isToday || lines.length > 0;
    const body = html`<span class="top">
        <span class="visually-hidden">${around.before}</span>
        <span class="date" data-test="date-heading">${Number(day.date.slice(8))}</span>
        <span class="visually-hidden">${around.after}${more || unseen ? ", " : ""}</span>
        ${isToday ? html`<span class="today" data-test="today">${t("hours.today")}</span>` : nothing}
      </span>
      ${nameLines}
      ${
        none && !day.closedAllDay
          ? html`<span class="no-orders" data-test="no-orders">${t("month.no_orders")}</span>`
          : nothing
      }
      ${(none ? [] : rows).map((row) => {
        const track = html`<span
          class="track ${row.station && !row.ranges.length ? "empty-track" : ""}"
          data-row=${row.key}
          aria-hidden="true"
        >
          ${row.station && !row.ranges.length && !day.closedAllDay ? t("month.no_orders") : nothing}
          ${row.ranges.map((range) => {
            const period = names.period(range.periodId ?? "");
            return html`<span
              class="segment"
              data-colour=${period.colour ?? nothing}
              title=${this.#orders || row.station ? this.#title(period.name, row, range) : format("day.open_range", { start: range.startsAt, end: range.endsAt })}
              style=${place(range)}
            ></span>`;
          })}
        </span>`;
        return html`${row.stationHeading ? html`<span class="station-heading" title=${row.stationHeading} aria-hidden="true">${stationIcon()}<span class="row-name">${row.stationHeading}</span></span>` : nothing}
          <span class="named-track" title=${row.name} aria-hidden="true">
            <span class="row-name" data-test="row-name"
              >${row.station && row.stationGroup === undefined ? stationIcon() : nothing}${row.name}</span
            >
            ${track}
          </span>`;
      })}
      ${
        !unseen || none
          ? nothing
          : html`<span class="visually-hidden">${more ? ", " : ""}${unseen}</span>`
      }`;
    const index = model.days.indexOf(day);
    const joins = (other: Day | undefined) =>
      Boolean(day.specialDay && day.specialDay.id === other?.specialDay?.id);
    return html`<td
      data-date=${day.date}
      data-tint=${(day.seasonId && tints.get(day.seasonId)) || nothing}
      ?data-outside=${!day.inMonth}
      ?data-closed=${day.closedAllDay}
    >
      ${day.specialDay ? html`<span class="special-run" data-test="special-run" aria-hidden="true" ?data-joins-previous=${index % 7 !== 0 && joins(model.days[index - 1])} ?data-joins-next=${index % 7 !== 6 && joins(model.days[index + 1])}></span>` : nothing}
      <button
        type="button"
        class="day"
        tabindex=${day.date === stop ? 0 : -1}
        aria-pressed=${this.#dayPicker.isPicked(day.date) ? "true" : "false"}
        aria-current=${isToday ? "date" : nothing}
      >
        ${body}
      </button>
    </td>`;
  }

  override render() {
    const current = this.month || this.model?.month;
    if (!current) return nothing;
    const model = this.model?.month === current ? this.model : undefined;
    const chosen = model ? chosenDepartment(model.days[0]!, this.departmentId) : "";
    const names = monthNames(this.departments);
    const step = (by: number, test: string, label: Parameters<typeof t>[0], glyph: string) => {
      const target = addMonths(current, by);
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
    const shown = Number(current.slice(5, 7));
    // A candidate is shaped as the title is: a plain title one text node, a linked one with its
    // year an inline-block. Shaped otherwise, Chromium measured the title a hair wider.
    const title = (month: number, language?: string) =>
      this.linkYear
        ? html`${formatMonthName(month, language)} <span class="year-link">${year}</span>`
        : `${formatMonthName(month, language)} ${year}`;
    const titles = Object.keys(VENUE_SERVICE_STRINGS).flatMap((language) =>
      Array.from({ length: 12 }, (_, index) => title(index + 1, language)),
    );
    const heading = this.linkYear
      ? html`${formatMonthName(shown)}
          <button
            type="button"
            class="year-link"
            data-test="month-year"
            aria-describedby="year-hint"
            @click=${() => this.#emit("month-year-open", { year })}
          >
            ${year}
          </button>`
      : title(shown);
    return html`<div class="head">
        ${step(-1, "previous-month", "month.previous", "‹")}
        ${fixedTitle(html`<h2 data-test="month" aria-live="polite">${heading}</h2>`, titles)}
        ${step(1, "next-month", "month.next", "›")}
        ${model ? this.#tools(model, chosen, names) : nothing}
      </div>
      ${this.linkYear ? html`<span id="year-hint" class="year-hint">${t("month.year_view_hint")}</span>` : nothing}
      ${this.stations.length ? stationExplanation() : nothing}
      ${model ? this.#body(model, chosen, names) : nothing}
      ${
        model && !this.readOnly && !this.station
          ? calendarSelection({
              dates: this.#dayPicker.dates,
              clear: () => {
                const date = this.#dayPicker.focusDate ?? this.#dayPicker.dates[0]!;
                this.#dayPicker.clear();
                this.#dayButton(date)?.focus();
              },
              open: () =>
                this.#emit<CalendarDaysOpen>("calendar-days-open", {
                  date: this.#dayPicker.dates[0]!,
                  dates: this.#dayPicker.dates,
                }),
            })
          : nothing
      }`;
  }

  #body(model: OpeningHoursMonth, chosen: string, names: MonthNames) {
    const station = this.station;
    if (!station || (station.state === "loading" && this.show === "all"))
      return this.#grid(model, chosen, names);
    if (station.state === "loading") return nothing;
    return html`${
      this.show
        ? html`<p class="rows" data-test="rows">
            ${t("month.rows")}
            ${station.departments.filter((row) => row.stationGroup === undefined || row.stationHeading).map((row, index) => html`${index ? " · " : ""}${row.station ? stationIcon() : nothing}${row.stationHeading || row.name}`)}
          </p>`
        : nothing
    }
    ${this.#grid(station.model, "", monthNames(station.departments))}`;
  }

  #tools(model: OpeningHoursMonth, chosen: string, names: MonthNames) {
    return showPicker({
      model,
      chosen,
      names,
      onDepartment: (departmentId) => this.#emit("month-department-change", { departmentId }),
      stations: this.stations,
      stationId: this.station?.id ?? "",
      show: this.show,
      onShow: (show) => this.#emit("month-show-change", { show }),
      onStation: (stationId) => this.#emit("month-station-change", { stationId }),
    });
  }

  #grid(model: OpeningHoursMonth, chosen: string, names: MonthNames) {
    const tints = seasonTints(model.seasons);
    const stop =
      [this.#dayPicker.focusDate, model.today].find(
        (date): date is LocalDate => date != null && model.days.some((day) => day.date === date),
      ) ?? model.days.find((day) => day.inMonth)!.date;
    const on = this.#dayPicker.handlers;
    const weeks = Array.from({ length: model.days.length / 7 }, (_, row) =>
      model.days.slice(row * 7, row * 7 + 7),
    );
    return html` <table
      class="picking"
      @pointerdown=${on?.pointerdown}
      @click=${on?.click}
      @dblclick=${on?.dblclick}
      @keydown=${on?.keydown}
      @contextmenu=${on?.contextmenu}
    >
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
