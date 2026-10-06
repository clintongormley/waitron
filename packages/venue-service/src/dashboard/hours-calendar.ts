import { currentLocale } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type {
  CalendarDay,
  DateHoursCell,
  HoursModel,
  LocalDate,
  SpecialDate,
} from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { HoursApi } from "./hours-client.js";
import {
  browserToday,
  dateValue,
  format,
  formatDate,
  formatLongDate,
  storedCells,
} from "./hours-view.js";
import { t } from "./strings.js";

/** A month, `YYYY-MM`. */
export type Month = string;

/**
 * What the operator asked the calendar's panel for. The page opens the editor; `cells` are the
 * date's stored cells as this month's read gave them, and `returnTo` is where focus goes back to.
 */
export interface CalendarAction {
  kind: "edit" | "duplicate" | "delete" | "make_special";
  date: LocalDate;
  special?: SpecialDate;
  cells?: DateHoursCell[];
  returnTo: () => HTMLElement | null;
}

export function addMonths(month: Month, months: number): Month {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, number - 1 + months, 1)).toISOString().slice(0, 7);
}

/** Every date of the weeks that hold `month`, Monday first: the month and its real neighbours. */
export function monthGrid(month: Month): LocalDate[] {
  const first = `${month}-01`;
  const start = addDays(first, -((weekdayOf(first) + 6) % 7));
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const end = addDays(last, (7 - weekdayOf(last)) % 7);
  const dates: LocalDate[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
}

const locale = () => (currentLocale().startsWith("es") ? "es-ES" : "en-GB");
const formatUtc = (date: LocalDate, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(locale(), { ...options, timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );

/** A Monday-first month of Hours dates, read a month at a time, with the chosen date's panel. */
@customElement("hours-calendar")
export class HoursCalendar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      .layout {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        gap: var(--wt-space-4);
      }
      .month {
        flex: 3 1 var(--wt-modal-compact-width);
        min-width: 0;
      }
      .panel {
        flex: 2 1 calc(var(--wt-modal-compact-width) / 2);
        min-width: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-3);
      }
      .nav {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-1);
        margin-block-end: var(--wt-space-2);
      }
      h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .nav h2 {
        flex: 1;
        min-width: 0;
      }
      .legend {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-1) var(--wt-space-3);
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
      }
      .legend li {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
      }
      .swatch {
        display: inline-block;
        flex: none;
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        vertical-align: middle;
      }
      [role="alert"] {
        color: var(--wt-color-danger);
      }
      table.grid {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      .grid th {
        padding: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-medium);
        color: var(--wt-color-text-muted);
        text-align: start;
      }
      .grid td {
        border: 1px solid var(--wt-color-border);
        padding: 0;
        vertical-align: top;
        background: var(--wt-color-surface);
      }
      .grid td[data-tone="standard"] {
        background: var(--wt-color-day-standard);
      }
      .grid td[data-tone="closed"] {
        background: var(--wt-color-day-closed);
      }
      .day {
        display: flex;
        flex-direction: column;
        align-items: stretch;
        gap: var(--wt-space-1);
        width: 100%;
        min-height: calc(var(--wt-tap-min) * 1.5);
        padding: var(--wt-space-1);
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        text-align: start;
        overflow-wrap: anywhere;
        cursor: pointer;
      }
      td[data-tone="standard"] .day {
        color: var(--wt-color-on-day-standard);
      }
      td[data-tone="closed"] .day {
        color: var(--wt-color-on-day-closed);
      }
      .day:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: calc(var(--wt-field-line-width-active) * -1);
      }
      .day[aria-pressed="true"] {
        box-shadow: inset 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary);
      }
      .number {
        font-weight: var(--wt-font-weight-bold);
      }
      td[data-outside] .number {
        font-weight: var(--wt-font-weight-normal);
      }
      [aria-current="date"] .number {
        text-decoration: underline;
        text-decoration-thickness: var(--wt-field-line-width-active);
      }
      .label {
        border-radius: var(--wt-radius-sm);
        padding-inline: var(--wt-space-1);
      }
      .label[data-colour="red"],
      .swatch[data-colour="red"] {
        background: var(--wt-color-palette-red);
        color: var(--wt-color-on-palette-red);
      }
      .label[data-colour="amber"],
      .swatch[data-colour="amber"] {
        background: var(--wt-color-palette-amber);
        color: var(--wt-color-on-palette-amber);
      }
      .label[data-colour="grey"],
      .swatch[data-colour="grey"] {
        background: var(--wt-color-palette-grey);
        color: var(--wt-color-on-palette-grey);
      }
      .label[data-colour="blue"],
      .swatch[data-colour="blue"] {
        background: var(--wt-color-palette-blue);
        color: var(--wt-color-on-palette-blue);
      }
      .label[data-colour="green"],
      .swatch[data-colour="green"] {
        background: var(--wt-color-palette-green);
        color: var(--wt-color-on-palette-green);
      }
      .label[data-colour="purple"],
      .swatch[data-colour="purple"] {
        background: var(--wt-color-palette-purple);
        color: var(--wt-color-on-palette-purple);
      }
      .swatch[data-colour="standard"] {
        background: var(--wt-color-day-standard);
      }
      .swatch[data-colour="closed"] {
        background: var(--wt-color-day-closed);
      }
      .panel h2 {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
      }
      .note {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      table.hours {
        width: 100%;
        border-collapse: collapse;
        margin-block-end: var(--wt-space-3);
      }
      .hours th,
      .hours td {
        padding: var(--wt-space-1) 0;
        border-block-end: 1px solid var(--wt-color-border);
        text-align: start;
        font-weight: var(--wt-font-weight-normal);
        vertical-align: top;
      }
      .hours td {
        padding-inline-start: var(--wt-space-2);
      }
      .inherited {
        color: var(--wt-color-text-muted);
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) api!: HoursApi;
  @property({ type: Boolean }) readOnly = false;
  /** The venue's date, which opens the calendar on its month; null while it cannot be read. */
  @property({ attribute: false }) today: LocalDate | null = null;
  @state() private month: Month = "";
  @state() private model?: HoursModel;
  @state() private readError = "";
  @state() private selected: LocalDate | null = null;
  /** The date that holds the grid's one Tab stop. */
  @state() private focusDate: LocalDate | null = null;

  #detach?: () => void;
  #days = new Map<LocalDate, CalendarDay>();
  /** A date to focus once the month that holds it has drawn. */
  #focusAfterRender?: LocalDate;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.month === "") this.month = (this.today ?? browserToday()).slice(0, 7);
    this.#watch();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detach?.();
    this.#detach = undefined;
  }

  /** Reads the shown month again, after the page has written a change. */
  async reload(): Promise<void> {
    const month = this.month;
    const dates = monthGrid(month);
    try {
      const model = await this.api.load(dates[0]!, dates.at(-1)!);
      if (month === this.month) this.#apply(model);
    } catch {
      if (month === this.month) this.readError = t("hours.load_error");
    }
  }

  #watch(): void {
    this.#detach?.();
    const dates = monthGrid(this.month);
    this.#detach = this.api.watchHours(
      dates[0]!,
      dates.at(-1)!,
      (model) => this.#apply(model),
      () => {
        this.readError = t("hours.load_error");
      },
      () => {
        this.readError = "";
      },
    );
  }

  #apply(model: HoursModel): void {
    const focused = this.shadowRoot?.activeElement ?? null;
    this.model = model;
    this.#days = new Map(model.days.map((day) => [day.date, day]));
    this.readError = "";
    // A panel action the new read takes away, such as Delete once the date is ordinary, would
    // otherwise drop focus to the page.
    const date = this.selected;
    if (focused === null || date === null) return;
    void this.updateComplete.then(() => {
      if (!focused.isConnected) this.#dayButton(date)?.focus();
    });
  }

  #show(month: Month, focus?: LocalDate): void {
    this.#focusAfterRender = focus;
    if (focus !== undefined) this.focusDate = focus;
    if (month === this.month) return;
    this.month = month;
    this.model = undefined;
    this.#days = new Map();
    if (this.selected !== null && !monthGrid(month).includes(this.selected)) this.selected = null;
    this.#watch();
  }

  protected override updated(): void {
    const date = this.#focusAfterRender;
    if (date === undefined) return;
    this.#focusAfterRender = undefined;
    this.#dayButton(date)?.focus();
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] button`);
  }

  #dayOf(date: LocalDate): CalendarDay {
    return (
      this.#days.get(date) ?? {
        date,
        specialDate: null,
        holidays: [],
        tone: "standard",
      }
    );
  }

  #open(date: LocalDate): void {
    this.selected = date;
    this.focusDate = date;
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>('[data-test="date-panel"] h2')?.focus(),
    );
  }

  #keydown(event: KeyboardEvent): void {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
    const date = (event.composedPath()[0] as HTMLElement).closest("td")?.dataset.date;
    if (step === undefined || date === undefined) return;
    event.preventDefault();
    const target = addDays(date, step);
    if (monthGrid(this.month).includes(target)) {
      this.focusDate = target;
      this.#dayButton(target)?.focus();
    } else this.#show(target.slice(0, 7), target);
  }

  #action(kind: CalendarAction["kind"], date: LocalDate, event: Event): void {
    const trigger = event.currentTarget as HTMLElement;
    const special = this.#dayOf(date).specialDate ?? undefined;
    const detail: CalendarAction = {
      kind,
      date,
      ...(special === undefined
        ? {}
        : { special, cells: structuredClone(storedCells(this.model!, special.id)) }),
      returnTo: () => (trigger.isConnected ? trigger : this.#dayButton(date)),
    };
    this.dispatchEvent(
      new CustomEvent<CalendarAction>("hours-calendar-action", {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  /** What a day says in words, so nothing rests on its colour alone. */
  #dayWords(day: CalendarDay): string[] {
    const words: string[] = [];
    const special = day.specialDate;
    if (special !== null)
      words.push(
        day.tone === "closed"
          ? format("hours.calendar.special_closed", { name: special.name })
          : special.name,
      );
    else if (day.tone === "closed") words.push(t("hours.closed"));
    for (const holiday of day.holidays)
      words.push(
        special === null && day.tone !== "closed"
          ? format("hours.calendar.holiday_standard", { name: holiday.name })
          : holiday.name,
      );
    return words;
  }

  #day(date: LocalDate, stop: LocalDate) {
    const day = this.#dayOf(date);
    const outside = !date.startsWith(this.month);
    const today = date === (this.model?.civilDate ?? null);
    const words = this.#dayWords(day);
    const special = day.specialDate;
    const coloured = special !== null && day.tone !== "closed";
    const number = formatUtc(
      date,
      outside ? { day: "numeric", month: "short" } : { day: "numeric" },
    );
    return html`<td data-date=${date} data-tone=${day.tone} ?data-outside=${outside}>
      <button
        type="button"
        class="day"
        tabindex=${date === stop ? 0 : -1}
        aria-pressed=${date === this.selected ? "true" : "false"}
        aria-current=${today ? "date" : nothing}
        aria-label=${[formatLongDate(date), ...words, ...(today ? [t("hours.today")] : [])].join(
          ", ",
        )}
        @click=${() => this.#open(date)}
        @focus=${() => {
          this.focusDate = date;
        }}
      >
        <span class="number">${number}</span>
        ${words.map((word, index) =>
          index === 0 && coloured
            ? html`<span class="label" data-test="special-name" data-colour=${special.colour}
                >${word}</span
              > `
            : html`<span>${word}</span> `,
        )}
      </button>
    </td>`;
  }

  #grid() {
    const dates = monthGrid(this.month);
    const today = this.model?.civilDate ?? null;
    const stop =
      [this.focusDate, this.selected, today].find(
        (date) => date !== null && dates.includes(date),
      ) ?? dates.find((date) => date.startsWith(this.month))!;
    const weeks = Array.from({ length: dates.length / 7 }, (_, row) =>
      dates.slice(row * 7, row * 7 + 7),
    );
    return html`<table class="grid" aria-labelledby="month-heading" @keydown=${this.#keydown}>
      <thead>
        <tr>
          ${dates
            .slice(0, 7)
            .map(
              (date) =>
                html`<th scope="col" abbr=${formatUtc(date, { weekday: "long" })}>
                  ${formatUtc(date, { weekday: "short" })}
                </th>`,
            )}
        </tr>
      </thead>
      <tbody>
        ${weeks.map(
          (row) =>
            html`<tr>
              ${row.map((date) => this.#day(date, stop))}
            </tr>`,
        )}
      </tbody>
    </table>`;
  }

  #panel() {
    const date = this.selected;
    if (date === null || this.model === undefined)
      return html`<p class="note">${t("hours.calendar.pick")}</p>`;
    const model = this.model;
    const day = this.#dayOf(date);
    const special = day.specialDate;
    const cells = special === null ? [] : storedCells(model, special.id);
    const subjects = model.subjects.filter((subject) => subject.active);
    const action = (
      kind: CalendarAction["kind"],
      label: Parameters<typeof t>[0],
      primary = false,
    ) =>
      html`<wt-button
        variant=${primary ? "primary" : "secondary"}
        data-test=${`calendar-${kind}`}
        @click=${(event: Event) => this.#action(kind, date, event)}
        >${t(label)}</wt-button
      >`;
    return html`<h2 tabindex="-1">
        ${
          special === null
            ? nothing
            : html`<span
                class="swatch"
                data-colour=${day.tone === "closed" ? "closed" : special.colour}
              ></span>`
        }<span
          >${special === null ? formatDate(date) : `${formatDate(date)} · ${special.name}`}</span
        >
      </h2>
      ${
        day.holidays.length === 0
          ? nothing
          : html`<p class="note" data-test="holidays">
              ${day.holidays
                .map((holiday) => format("hours.calendar.holiday", { name: holiday.name }))
                .join(" ")}
            </p>`
      }
      <table class="hours">
        <thead class="visually-hidden">
          <tr>
            <th scope="col">${t("hours.calendar.subject")}</th>
            <th scope="col">${t("hours.calendar.hours")}</th>
          </tr>
        </thead>
        <tbody>
          ${subjects.map((subject) => {
            const value = dateValue(model, subject, date, special, cells);
            return html`<tr>
              <th scope="row">${subject.name}</th>
              <td>
                ${
                  value.inherited
                    ? html`<span class="inherited"
                        ><span class="visually-hidden">${t("hours.inherited_prefix")}</span
                        >${value.text}</span
                      >`
                    : value.text
                }
              </td>
            </tr>`;
          })}
        </tbody>
      </table>
      ${
        this.readOnly
          ? nothing
          : html`<div class="actions">
              ${
                special === null
                  ? action("make_special", "hours.make_special", true)
                  : html`${action("edit", "hours.edit")}${action("duplicate", "hours.duplicate")}${action(
                      "delete",
                      "hours.delete",
                    )}`
              }
            </div>`
      }`;
  }

  override render() {
    const nav = (test: string, label: Parameters<typeof t>[0], glyph: string, months: number) =>
      html`<wt-button
        variant="ghost"
        data-test=${test}
        aria-label=${t(label)}
        @click=${() => this.#show(addMonths(this.month, months))}
        >${glyph}</wt-button
      >`;
    const legend = (colour: string, label: Parameters<typeof t>[0]) =>
      html`<li><span class="swatch" data-colour=${colour}></span>${t(label)}</li>`;
    return html`<div class="layout">
      <div class="month">
        <div class="nav">
          ${nav("previous-year", "hours.calendar.previous_year", "«", -12)}
          ${nav("previous-month", "hours.calendar.previous_month", "‹", -1)}
          <h2 id="month-heading" data-test="month" aria-live="polite">
            ${formatUtc(`${this.month}-01`, { month: "long", year: "numeric" })}
          </h2>
          ${nav("next-month", "hours.calendar.next_month", "›", 1)}
          ${nav("next-year", "hours.calendar.next_year", "»", 12)}
          <wt-button
            variant="secondary"
            data-test="this-month"
            @click=${() => this.#show((this.today ?? browserToday()).slice(0, 7))}
            >${t("hours.calendar.this_month")}</wt-button
          >
        </div>
        <ul class="legend">
          ${legend("standard", "hours.calendar.legend_standard")}
          ${legend("closed", "hours.calendar.legend_closed")}
          <li>
            <span class="swatch" data-colour="red"></span
            ><span class="swatch" data-colour="amber"></span>${t("hours.calendar.legend_special")}
          </li>
        </ul>
        ${this.readError ? html`<p role="alert">${this.readError}</p>` : nothing} ${this.#grid()}
      </div>
      <section class="panel" data-test="date-panel">${this.#panel()}</section>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hours-calendar": HoursCalendar;
  }
  interface HTMLElementEventMap {
    "hours-calendar-action": CustomEvent<CalendarAction>;
  }
}
