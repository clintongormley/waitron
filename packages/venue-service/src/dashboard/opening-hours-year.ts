import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { holidayDateName } from "../holiday-naming.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursYear, OpeningHoursYearDay } from "../opening-hours-calendar.js";
import { MONTHS, monthGrid } from "./calendar-grid.js";
import { areaAddress, nationalCoverage } from "./holiday-coverage-text.js";
import { format, formatLongDate, formatMonthName, formatWeekday } from "./hours-view.js";
import type { SeasonWrites } from "./season-chips.js";
import "./season-chips.js";
import { seasonTints, seasonTintStyles } from "./season-tint.js";
import { DayPicker } from "./day-picking.js";
import type { CalendarDayOpen, CalendarDaysOpen } from "./opening-hours-month.js";
import type { SpecialDaysApi } from "./special-days-client.js";
import { t } from "./strings.js";

type Key = Parameters<typeof t>[0];

export type HolidayAreaWrites = Pick<SpecialDaysApi, "saveHolidayArea" | "rereadWatches">;

/** The year as it begins a date: four digits, so year 100 is `0100`. */
const yearKey = (year: number) => String(year).padStart(4, "0");

/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = "2024-01-01";

/** A year of the venue's days in twelve months, tinted by season and marked for public holidays,
 *  special days and closed days, drawn from the server's year read alone. A date sends
 *  `calendar-day-open`, and an editor's opened run `calendar-days-open`; ‹ › send `year-change`
 *  and a month's name `year-month-open`. */
@customElement("opening-hours-year")
export class OpeningHoursYearView extends LitElement {
  static override styles = [
    baseStyles,
    seasonTintStyles,
    css`
      :host {
        display: block;
        min-width: 0;
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
      season-chips {
        margin-block-end: var(--wt-space-2);
      }
      .note {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .notes {
        margin: 0 0 var(--wt-space-2);
        padding: 0;
        list-style: none;
      }
      .warning {
        color: var(--wt-color-text);
      }
      .months {
        display: grid;
        grid-template-columns: repeat(
          auto-fill,
          minmax(calc(var(--wt-modal-compact-width) / 2), 1fr)
        );
        gap: var(--wt-space-3);
      }
      .month {
        min-width: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-md);
        padding: var(--wt-space-2);
        background: var(--wt-color-surface);
      }
      .month-name {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }
      .month-name::first-letter {
        text-transform: uppercase;
      }
      .month-name::after {
        content: " ›" / "";
      }
      .month-name:focus-visible,
      .day:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      table {
        width: 100%;
        border-collapse: separate;
        border-spacing: var(--wt-space-1);
        table-layout: fixed;
        user-select: none;
        -webkit-touch-callout: none;
        touch-action: manipulation;
      }
      th {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
        color: var(--wt-color-text-muted);
        text-align: center;
      }
      td {
        padding: 0;
      }
      .day {
        display: block;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: 0;
        border: var(--wt-field-line-width-active) solid transparent;
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-day-standard);
        color: var(--wt-color-on-day-standard);
        font: inherit;
        font-size: var(--wt-font-size-sm);
        text-align: center;
        cursor: pointer;
        touch-action: manipulation;
        -webkit-touch-callout: none;
      }
      td[data-tint] .day {
        background: var(--season-tint);
        color: var(--season-on-tint);
      }
      td.mark-holiday .day {
        border-color: var(--wt-color-palette-red);
        font-weight: var(--wt-font-weight-bold);
      }
      td.mark-special .day {
        border-color: var(--wt-color-palette-purple);
        font-weight: var(--wt-font-weight-bold);
      }
      td.mark-holiday.mark-special .day {
        position: relative;
      }
      td.mark-holiday.mark-special .day::after {
        content: "";
        position: absolute;
        inset-block-start: var(--wt-space-1);
        inset-inline-end: var(--wt-space-1);
        width: var(--wt-space-2);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-full);
        background: var(--wt-color-palette-red);
      }
      td[data-closed] .day {
        background: var(--wt-color-day-closed);
        color: var(--wt-color-on-day-closed);
        font-weight: var(--wt-font-weight-bold);
      }
      td[data-date] .day[aria-pressed="true"] {
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      [aria-current="date"] {
        text-decoration: underline;
        text-decoration-thickness: var(--wt-field-line-width-active);
      }
    `,
  ];

  /** The year as the server reads it; the host fetches a new one on `year-change`. */
  @property({ attribute: false }) model?: OpeningHoursYear;
  /** The year the host asked for, ahead of `model` while its read is pending; ‹ › step from it so
   *  presses during the wait add up, and with no `model` only the heading naming it, ‹ › and the
   *  switch's slot are drawn. 0 steps from `model`. */
  @property({ type: Number }) year = 0;
  /** The season writes the chips send. */
  @property({ attribute: false }) api?: SeasonWrites;
  @property({ attribute: false }) areaApi?: HolidayAreaWrites;
  /** Every special day the host knows, not only this year's: a season's end-offset refusal can name
   *  a repeating day in a later year. */
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  @property({ type: Boolean }) readOnly = false;
  @state() private areaError = "";
  @state() private areaBusy = false;

  #connection = {};
  #dayPicker = new DayPicker(this, {
    button: (date) => this.#dayButton(date),
    canPick: () => !this.readOnly,
    choose: (date) =>
      this.#emit<CalendarDayOpen>("calendar-day-open", {
        date,
        returnTo: () => this.#dayButton(date),
      }),
    open: (date, { from, to }) =>
      this.#emit<CalendarDaysOpen>("calendar-days-open", { date, from, to }),
  });
  #areaRequest = {};

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#connection = {};
    this.areaBusy = false;
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (!changes.has("model")) return;
    const before = changes.get("model") as OpeningHoursYear | undefined;
    if (before?.year !== this.model?.year) {
      this.#dayPicker.clear();
      this.#dayPicker.forgetFocus();
    }
    if (before?.area.addressKey !== this.model?.area.addressKey) {
      this.#areaRequest = {};
      this.areaBusy = false;
      this.areaError = "";
    }
  }

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] button`);
  }

  #month(
    model: OpeningHoursYear,
    month: string,
    days: Map<LocalDate, OpeningHoursYearDay>,
    tints: Map<string, string>,
    stop: LocalDate,
    header: TemplateResult,
  ) {
    const key = `${yearKey(model.year)}-${month}`;
    const grid = monthGrid(key);
    const headingId = `month-${month}`;
    const handlers = this.#dayPicker.handlers;
    return html`<section class="month" data-month=${key}>
      <button
        type="button"
        class="month-name"
        id=${headingId}
        data-test="month-name"
        @click=${() => this.#emit("year-month-open", { date: `${key}-01` })}
      >
        ${formatMonthName(Number(month))}
      </button>
      <table
        aria-labelledby=${headingId}
        @pointerdown=${handlers.pointerdown}
        @click=${handlers.click}
        @dblclick=${handlers.dblclick}
        @keydown=${handlers.keydown}
        @contextmenu=${handlers.contextmenu}
      >
        <thead>
          ${header}
        </thead>
        <tbody>
          ${Array.from({ length: grid.length / 7 }, (_, row) => {
            const week = grid.slice(row * 7, row * 7 + 7);
            return html`<tr>
              ${week.map((date) => {
                if (!date.startsWith(key)) return html`<td></td>`;
                const day = days.get(date);
                const holidayName = holidayDateName([...(day?.holidays ?? [])], date, "");
                return html`<td
                  class=${
                    [
                      day?.tone === "public_holiday" ? "mark-holiday" : "",
                      day?.specialDay ? "mark-special" : "",
                    ]
                      .filter(Boolean)
                      .join(" ") || nothing
                  }
                  data-date=${date}
                  data-tint=${(day?.seasonId && tints.get(day.seasonId)) || nothing}
                  data-tone=${day?.tone ?? "standard"}
                  ?data-closed=${day?.closed ?? false}
                >
                  <button
                    type="button"
                    class="day"
                    tabindex=${date === stop ? 0 : -1}
                    aria-pressed=${this.#dayPicker.isPicked(date) ? "true" : "false"}
                    aria-label=${[
                      formatLongDate(date),
                      day?.specialDay?.name,
                      holidayName,
                      day?.closed ? t("hours.closed") : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    title=${day?.specialDay?.name || holidayName || nothing}
                    aria-current=${date === model.today ? "date" : nothing}
                  >
                    ${Number(date.slice(8))}
                  </button>
                </td>`;
              })}
            </tr>`;
          })}
        </tbody>
      </table>
    </section>`;
  }

  #area(model: OpeningHoursYear) {
    const explanation =
      model.area.readiness === "ready"
        ? nothing
        : html`<p class="note" data-test="area-address">${areaAddress(model.area.readiness)}</p>`;
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
          chooser.value = this.model?.area.chosen ?? "";
          const value = event.detail.value;
          if (
            !this.isConnected ||
            this.readOnly ||
            this.areaBusy ||
            !this.areaApi ||
            this.model?.area.readiness !== "ready" ||
            chooser !== this.shadowRoot?.querySelector("[name=holidayArea]") ||
            value === this.model.area.chosen ||
            !this.model.area.options.some((item) => item.key === value)
          )
            return;
          void this.#saveArea(this.areaApi, value);
        }}
      ></wt-combobox>`;
  }

  async #saveArea(api: HolidayAreaWrites, value: string) {
    const connection = this.#connection;
    const request = (this.#areaRequest = {});
    const current = () =>
      this.isConnected && connection === this.#connection && request === this.#areaRequest;
    this.areaBusy = true;
    this.areaError = "";
    try {
      await api.saveHolidayArea(value);
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
    if (current()) api.rereadWatches();
  }

  #notes(model: OpeningHoursYear) {
    const year = String(model.year);
    const state =
      model.holidayCoverage.find((item) => item.year === model.year)?.nationalRegional ?? "unknown";
    if (!model.publicHolidaysAvailable || state === "complete") return nothing;
    const national =
      state === "area_required"
        ? format("calendar.area_required", { year })
        : nationalCoverage(model.year, state);
    return html`<ul class="note notes">
      <li data-test="coverage">${national}</li>
    </ul>`;
  }

  #warnings(model: OpeningHoursYear) {
    if (!model.missingHolidays.length) return nothing;
    return html`<ul class="note notes">
      ${model.missingHolidays.map(
        (missing) =>
          html`<li class="warning" data-test="missing-holiday">
            ${format("venue.readiness.holiday_missing", {
              name: missing.holidayName,
              year: String(model.year),
            })}
          </li>`,
      )}
    </ul>`;
  }

  override render() {
    const model = this.model;
    const shown = model?.year ?? this.year;
    if (!shown) return nothing;
    const step = (by: number, test: string, label: Key, glyph: string) =>
      html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        @click=${() => this.#emit("year-change", { year: (this.year || shown) + by })}
        >${glyph}</wt-button
      >`;
    const head = html`<div class="head">
      ${step(-1, "previous-year", "hours.calendar.previous_year", "‹")}
      <h2 data-test="year" aria-live="polite">${shown}</h2>
      ${step(1, "next-year", "hours.calendar.next_year", "›")}
      <slot name="switch"></slot>
    </div>`;
    return html`${head}${model ? this.#body(model) : nothing}`;
  }

  #body(model: OpeningHoursYear) {
    const days = new Map(model.days.map((day) => [day.date, day]));
    const tints = seasonTints(model.seasons);
    const header = html`<tr>
      ${Array.from({ length: 7 }, (_, index) => {
        const date = addDays(A_MONDAY, index);
        return html`<th scope="col" abbr=${formatWeekday(date, "long")}>
          ${formatWeekday(date, "narrow")}
        </th>`;
      })}
    </tr>`;
    const prefix = `${yearKey(model.year)}-`;
    const stop =
      [this.#dayPicker.focusDate, model.today].find(
        (date): date is LocalDate => date != null && date.startsWith(prefix),
      ) ?? `${prefix}01-01`;
    return html`<season-chips
        .seasons=${model.seasons}
        .clockRevision=${model.clockRevision}
        .api=${this.api}
        .specialDays=${this.specialDays}
        .readOnly=${this.readOnly}
      ></season-chips>
      ${
        model.publicHolidaysAvailable
          ? nothing
          : html`<p class="note warning" data-test="holidays-unavailable">
              ${format("year.holidays_unavailable", { year: String(model.year) })}
            </p>`
      }
      ${this.#warnings(model)} ${this.#area(model)} ${this.#notes(model)}
      <div class="months">
        ${MONTHS.map((month) => this.#month(model, month, days, tints, stop, header))}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-year": OpeningHoursYearView;
  }
}
