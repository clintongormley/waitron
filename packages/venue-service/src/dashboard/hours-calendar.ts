import { currentLocale } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import type { HolidayCoverage, NamedDay, NamedDaysModel } from "../holiday-types.js";
import { holidayDateName } from "../holiday-naming.js";
import type { HolidayFact, LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import { browserToday, format, formatDate, formatLongDate } from "./hours-view.js";
import type { NamedDaysApi } from "./named-days-client.js";
import "@waitron/ui/src/components/wt-icon.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { t } from "./strings.js";

/** A month, `YYYY-MM`. */
export type Month = string;

export interface NamedCalendarAction {
  kind: "add" | "edit" | "own" | "copy" | "delete";
  date: LocalDate;
  day?: NamedDay;
  holidays: readonly HolidayFact[];
  returnTo: () => HTMLElement | null;
}

type Key = Parameters<typeof t>[0];

/** The national and regional sentence for a year's coverage, or the unknown one without it. */
function nationalCoverage(year: number, coverage: HolidayCoverage | undefined): string {
  return format(`hours.calendar.coverage.${coverage?.nationalRegional ?? "unknown"}` as Key, {
    year: String(year),
  });
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

/** A Monday-first month of named days with the chosen date's actions. */
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
      .grid td[data-tone="public_holiday"] {
        background: var(--wt-color-palette-red);
        color: var(--wt-color-on-palette-red);
      }
      .grid td[data-tone="own_holiday"] {
        background: var(--wt-color-palette-purple);
        color: var(--wt-color-on-palette-purple);
      }
      .grid td[data-tone="working_day"] {
        background: var(--wt-color-palette-blue);
        color: var(--wt-color-on-palette-blue);
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
      .named-day {
        color: inherit;
        cursor: default;
      }
      .own-hours wt-icon {
        color: inherit;
      }
      .own-hours {
        display: inline-flex;
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
      .range {
        white-space: nowrap;
      }
      .visually-hidden {
        ${visuallyHiddenStyles}
      }
      .facts,
      .coverage {
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
      }
      .facts li {
        display: flex;
        flex-wrap: wrap;
        column-gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-1);
        overflow-wrap: anywhere;
      }
      .source {
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .source a {
        color: var(--wt-color-primary-text);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];

  @property({ attribute: false }) namedApi?: NamedDaysApi;
  @state() private namedModel?: NamedDaysModel;
  @state() private areaError = "";
  @state() private areaBusy = false;
  @property({ type: Boolean }) readOnly = false;
  /** The venue's date, which opens the calendar on its month; null while it cannot be read. */
  @property({ attribute: false }) today: LocalDate | null = null;
  /** Empty keeps named mode on the venue date; a selected month survives later date reads. */
  @property() month: Month = "";
  @state() private shownMonth: Month = "";
  @state() private readError = "";
  @state() private selected: LocalDate | null = null;
  /** The date that holds the grid's one Tab stop. */
  @state() private focusDate: LocalDate | null = null;

  #detach?: () => void;
  #connection = {};
  #areaRequest = {};
  #watchedMonth = "";
  #venueMonth?: Month;
  /** A date to focus once the month that holds it has drawn. */
  #focusAfterRender?: LocalDate;

  override connectedCallback(): void {
    super.connectedCallback();
    this.shownMonth = this.month || this.#venueMonth || (this.today ?? browserToday()).slice(0, 7);
    this.#watch();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#detach?.();
    this.#detach = undefined;
    this.#connection = {};
    this.areaBusy = false;
  }

  #watch(): void {
    this.#detach?.();
    this.#watchedMonth = this.shownMonth;
    const dates = monthGrid(this.shownMonth);
    if (this.namedApi) {
      this.#detach = this.namedApi.watchNamedDays(
        dates[0]!,
        dates.at(-1)!,
        (model) => {
          if (model.civilDate !== null) this.#venueMonth = model.civilDate.slice(0, 7);
          if (this.month === "" && this.#venueMonth && this.shownMonth !== this.#venueMonth) {
            this.#show(this.#venueMonth, undefined, false);
            return;
          }
          if (this.namedModel?.area.addressKey !== model.area.addressKey) {
            this.#areaRequest = {};
            this.areaBusy = false;
            this.areaError = "";
          }
          this.namedModel = model;
          this.readError = "";
        },
        () => {
          this.readError = t("hours.load_error");
        },
        () => {
          this.readError = "";
        },
      );
      return;
    }
  }

  #show(month: Month, focus?: LocalDate, selected = true): void {
    this.#focusAfterRender = focus;
    if (focus !== undefined) this.focusDate = focus;
    if (selected) this.month = month;
    if (month === this.shownMonth) return;
    this.shownMonth = month;
    this.namedModel = undefined;
    if (this.selected !== null && !monthGrid(month).includes(this.selected)) this.selected = null;
    this.#watch();
    if (this.namedApi && selected)
      this.dispatchEvent(
        new CustomEvent("calendar-month-change", {
          detail: { month },
          bubbles: true,
          composed: true,
        }),
      );
  }

  protected override willUpdate(changes: PropertyValues): void {
    if (this.namedApi && changes.has("month")) {
      this.shownMonth =
        this.month || this.#venueMonth || (this.today ?? browserToday()).slice(0, 7);
      if (this.#watchedMonth !== this.shownMonth) {
        this.namedModel = undefined;
        this.readError = "";
        this.#watch();
      }
    }
  }

  protected override updated(): void {
    const date = this.#focusAfterRender;
    if (date === undefined) return;
    const target = this.#dayButton(date);
    if (!target) return;
    this.#focusAfterRender = undefined;
    target.focus();
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] button`);
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
    if (monthGrid(this.shownMonth).includes(target)) {
      this.focusDate = target;
      this.#dayButton(target)?.focus();
    } else this.#show(target.slice(0, 7), target);
  }

  #namedMonth() {
    const model = this.namedModel;
    const nav = (
      step: number,
      label: "hours.calendar.previous_month" | "hours.calendar.next_month",
      glyph: string,
    ) =>
      html`<wt-button
        variant="secondary"
        data-test=${step < 0 ? "previous-month" : "next-month"}
        aria-label=${t(label)}
        @click=${() => this.#show(addMonths(this.shownMonth, step))}
        >${glyph}</wt-button
      >`;
    const dates = monthGrid(this.shownMonth);
    const stop =
      [this.focusDate, this.selected, model?.civilDate].find(
        (date) => date != null && dates.includes(date),
      ) ?? `${this.shownMonth}-01`;
    const years = [...new Set(dates.map((date) => Number(date.slice(0, 4))))];
    return html`<div class="month">
      <div class="nav">
        ${nav(-1, "hours.calendar.previous_month", "‹")}
        <h2 id="month-heading" data-test="month" aria-live="polite">
          ${formatUtc(`${this.shownMonth}-01`, { month: "long", year: "numeric" })}
        </h2>
        ${nav(1, "hours.calendar.next_month", "›")}
      </div>
      <ul class="legend">
        ${[
          ["red", "calendar.public"],
          ["purple", "calendar.own_holiday"],
          ["blue", "calendar.working"],
          ["closed", "hours.calendar.legend_closed"],
          ["standard", "hours.calendar.legend_standard"],
        ].map(
          ([colour, label]) =>
            html`<li><span class="swatch" data-colour=${colour!}></span>${t(label as Key)}</li>`,
        )}
      </ul>
      ${this.readError ? html`<p role="alert">${this.readError}</p>` : nothing}
      ${
        model === undefined
          ? nothing
          : html` ${model.area.options.length || model.area.readiness !== "ready" ? this.#namedArea(model) : nothing}
              <ul class="note coverage" data-test="month-coverage">
                ${years.map((year) => {
                  const coverage = model.holidayCoverage.find((item) => item.year === year);
                  return html`<li>
                      ${coverage?.nationalRegional === "area_required" ? format("calendar.area_required", { year: String(year) }) : nationalCoverage(year, coverage)}
                    </li>
                    ${coverage ? html`<li>${format(`hours.calendar.local.${coverage.local}` as Key, { year: String(year) })}</li>` : nothing}`;
                })}
              </ul>
              ${model.localHolidaysPerYear > 0 ? html`<p class="note" data-test="local-holiday-hint">${format("calendar.local_hint", { count: String(model.localHolidaysPerYear) })}</p>` : nothing}
              <table class="grid" aria-labelledby="month-heading" @keydown=${this.#keydown}>
                <thead>
                  <tr>
                    ${dates.slice(0, 7).map((date) => html`<th scope="col" abbr=${formatUtc(date, { weekday: "long" })}>${formatUtc(date, { weekday: "short" })}</th>`)}
                  </tr>
                </thead>
                <tbody>
                  ${Array.from(
                    { length: dates.length / 7 },
                    (_, row) =>
                      html`<tr>
                        ${dates.slice(row * 7, row * 7 + 7).map((date) => {
                          const day = model.days.find((item) => item.date === date);
                          return html`<td
                            data-date=${date}
                            data-tone=${day?.tone ?? "standard"}
                            ?data-outside=${!date.startsWith(this.shownMonth)}
                          >
                            <button
                              type="button"
                              class="day named-day"
                              tabindex=${date === stop ? 0 : -1}
                              aria-label=${[formatLongDate(date), day?.namedDay?.name, holidayDateName([...(day?.holidays ?? [])], date, ""), day?.closed ? t("hours.closed") : "", day?.ownHours ? t("calendar.own_hours") : ""].filter(Boolean).join(", ")}
                              aria-pressed=${date === this.selected ? "true" : "false"}
                              aria-current=${date === model.civilDate ? "date" : nothing}
                              @click=${() => this.#open(date)}
                              @focus=${() => {
                                this.focusDate = date;
                              }}
                            >
                              <span class="number"
                                >${formatUtc(date, date.startsWith(this.shownMonth) ? { day: "numeric" } : { day: "numeric", month: "short" })}</span
                              >${day?.namedDay ? html`<span>${day.namedDay.name}</span>` : nothing}${day?.holidays.length ? html`<span>${holidayDateName([...day.holidays], date, "")}</span>` : nothing}${day?.closed ? html`<span>${t("hours.closed")}</span>` : nothing}${day?.ownHours ? html`<span class="own-hours"><wt-icon name="clock" size="sm"></wt-icon><span class="visually-hidden">${t("calendar.own_hours")}</span></span>` : nothing}
                            </button>
                          </td>`;
                        })}
                      </tr>`,
                  )}
                </tbody>
              </table>
              ${this.selected ? html`<section class="panel" data-test="date-panel">${this.#namedPanel(model)}</section>` : nothing}`
      }
    </div>`;
  }
  #namedPanel(model: NamedDaysModel) {
    const date = this.selected;
    if (!date) return html`<p>${t("hours.calendar.pick")}</p>`;
    const entry = model.days.find((day) => day.date === date);
    const day = entry?.namedDay ?? undefined;
    const action = (kind: NamedCalendarAction["kind"], label: Key) =>
      html`<wt-button
        variant="secondary"
        data-test=${`named-${kind}`}
        @click=${(event: Event) => {
          event.stopPropagation();
          if (this.readOnly || !this.isConnected || !this.namedModel) return;
          const trigger = event.currentTarget as HTMLElement;
          this.dispatchEvent(
            new CustomEvent<NamedCalendarAction>("named-calendar-action", {
              detail: {
                kind,
                date,
                day: day ? structuredClone(day) : undefined,
                holidays: structuredClone(entry?.holidays ?? []),
                returnTo: () => (trigger.isConnected ? trigger : this.#dayButton(date)),
              },
              bubbles: true,
              composed: true,
            }),
          );
        }}
        >${t(label)}</wt-button
      >`;
    return html`<h2 tabindex="-1">${formatDate(date)}${day ? ` · ${day.name}` : ""}</h2>
      ${entry?.holidays.map((holiday) => html`<p>${holiday.name}</p>`)}
      ${this.readOnly ? nothing : html`<div class="actions">${day ? html`${action("edit", "hours.edit")}${action("copy", "named.copy")}${action("delete", "hours.delete")}` : action("add", "named.add")}${action("own", "named.give_own")}</div>`}`;
  }
  #areaAddress(readiness: NamedDaysModel["area"]["readiness"]): string {
    switch (readiness) {
      case "missing_city":
        return t("holidays.area_needs_city");
      case "unresolved_province":
        return t("holidays.area_needs_province");
      case "unresolved_address":
        return t("holidays.area_needs_address");
      case "unsupported_country":
        return t("holidays.area_unsupported");
      case "ready":
        return "";
    }
  }
  #namedArea(model: NamedDaysModel) {
    const explanation =
      model.area.readiness === "ready"
        ? nothing
        : html`<p class="note" data-test="area-address">
            ${this.#areaAddress(model.area.readiness)}
          </p>`;
    if (!model.area.options.length) return explanation;
    if (this.readOnly)
      return html`${explanation}
        <p class="note" data-test="area-chosen">
          ${model.area.options.find((item) => item.key === model.area.chosen)?.name ?? t("holidays.area_none")}
        </p>`;
    return html`${explanation}<wt-combobox
        name="holidayArea"
        label=${t("holidays.area")}
        hint=${t("holidays.area_hint")}
        search="never"
        ?required=${model.area.required}
        .value=${model.area.chosen ?? ""}
        .options=${model.area.options.map(({ key, name }) => ({ value: key, label: name }))}
        ?disabled=${this.areaBusy || model.area.readiness !== "ready"}
        error=${this.areaError}
        @wt-change=${(event: CustomEvent<{ value: string }>) => {
          event.stopPropagation();
          const chooser = event.currentTarget as HTMLElementTagNameMap["wt-combobox"];
          chooser.value = this.namedModel?.area.chosen ?? "";
          const value = event.detail.value;
          if (
            !this.isConnected ||
            this.readOnly ||
            this.areaBusy ||
            this.namedModel?.area.readiness !== "ready" ||
            chooser !== this.shadowRoot?.querySelector("[name=holidayArea]") ||
            value === model.area.chosen ||
            !model.area.options.some((item) => item.key === value)
          )
            return;
          void this.#saveNamedArea(value);
        }}
      ></wt-combobox>`;
  }
  async #saveNamedArea(value: string) {
    const connection = this.#connection;
    const request = (this.#areaRequest = {});
    const current = () =>
      this.isConnected && connection === this.#connection && request === this.#areaRequest;
    this.areaBusy = true;
    this.areaError = "";
    try {
      await this.namedApi!.saveHolidayArea(value);
    } catch (error) {
      if (current()) {
        const refusal = error as { code?: string; params?: { field?: string } } | null;
        this.areaError =
          refusal?.code === "holiday.invalid" && refusal.params?.field === "geography"
            ? t("holidays.area_needs_address")
            : refusal?.code === "holiday.invalid" && refusal.params?.field === "areaKey"
              ? t("holidays.area_refused")
              : t("hours.save_error");
      }
      return;
    } finally {
      if (current()) this.areaBusy = false;
    }
    if (current()) this.namedApi!.rereadWatches();
  }

  override render() {
    return this.#namedMonth();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "hours-calendar": HoursCalendar;
  }
}
