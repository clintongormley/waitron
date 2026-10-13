import { currentLocale } from "@waitron/dashboard-kit";
import { LitElement, css, html, nothing, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { holidayDateName } from "../holiday-naming.js";
import type { HolidayCoverage } from "../holiday-types.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursYear, OpeningHoursYearDay } from "../opening-hours-calendar.js";
import { monthGrid } from "./calendar-grid.js";
import { areaAddress, nationalCoverage } from "./holiday-coverage-text.js";
import { format, formatDate, formatLongDate, formatMonthName } from "./hours-view.js";
import type { SeasonWrites } from "./season-chips.js";
import "./season-chips.js";
import { seasonTints } from "./season-tint.js";
import type { SpecialDayAction } from "./special-day-action.js";
import type { SpecialDaysApi } from "./special-days-client.js";
import { t } from "./strings.js";

type Key = Parameters<typeof t>[0];

/** Whether a year's official list leaves local holidays out; no `local` state says it carries them. */
function listLacksLocalHolidays(local: HolidayCoverage["local"]): boolean {
  switch (local) {
    case "address_unresolved":
    case "unsupported_country":
    case "none_entered":
      return true;
  }
}
export type HolidayAreaWrites = Pick<SpecialDaysApi, "saveHolidayArea" | "rereadWatches">;

const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, "0"));
/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = "2024-01-01";
const weekday = (date: LocalDate, style: "narrow" | "long") =>
  new Intl.DateTimeFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    weekday: style,
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));

/** A year of the venue's days in twelve months, tinted by season and marked for public holidays,
 *  special days and closed days, drawn from the server's year read alone. A date opens a panel whose
 *  actions send `special-day-action`; ‹ › send `year-change` and a month's name `year-month-open`. */
@customElement("opening-hours-year")
export class OpeningHoursYearView extends LitElement {
  static override styles = [
    baseStyles,
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
      .head .add {
        margin-inline-start: auto;
      }
      season-chips {
        margin-block-end: var(--wt-space-2);
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
        width: var(--wt-space-3);
        height: var(--wt-space-3);
        border-radius: var(--wt-radius-full);
      }
      .swatch[data-mark="public_holiday"] {
        background: var(--wt-color-palette-red);
      }
      .swatch[data-mark="special_day"] {
        background: var(--wt-color-palette-purple);
      }
      .swatch[data-mark="closed"] {
        background: var(--wt-color-day-closed);
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
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }
      .month-name::first-letter {
        text-transform: uppercase;
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
      }
      td[data-tint="1"] .day {
        background: var(--wt-color-season-1);
        color: var(--wt-color-on-season-1);
      }
      td[data-tint="2"] .day {
        background: var(--wt-color-season-2);
        color: var(--wt-color-on-season-2);
      }
      td[data-tint="3"] .day {
        background: var(--wt-color-season-3);
        color: var(--wt-color-on-season-3);
      }
      td[data-tint="4"] .day {
        background: var(--wt-color-season-4);
        color: var(--wt-color-on-season-4);
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
      .day[aria-pressed="true"] {
        box-shadow: 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary);
      }
      [aria-current="date"] {
        text-decoration: underline;
        text-decoration-thickness: var(--wt-field-line-width-active);
      }
      .panel {
        margin-block-start: var(--wt-space-2);
        border-block-start: 1px solid var(--wt-color-border);
        padding-block-start: var(--wt-space-2);
      }
      .panel h3 {
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-md);
      }
      .panel p {
        margin: 0 0 var(--wt-space-1);
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: var(--wt-space-2);
      }
    `,
  ];

  /** The year as the server reads it; the host fetches a new one on `year-change`. */
  @property({ attribute: false }) model?: OpeningHoursYear;
  /** The season writes the chips send. */
  @property({ attribute: false }) api?: SeasonWrites;
  @property({ attribute: false }) areaApi?: HolidayAreaWrites;
  /** Every special day the host knows, not only this year's: a season's end-offset refusal can name
   *  a repeating day in a later year. */
  @property({ attribute: false }) specialDays: readonly { id: string; name: string }[] = [];
  @property({ type: Boolean }) readOnly = false;
  @state() private selected: LocalDate | null = null;
  /** The date that holds the year's one Tab stop. */
  @state() private focusDate: LocalDate | null = null;
  @state() private areaError = "";
  @state() private areaBusy = false;

  #connection = {};
  #areaRequest = {};

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#connection = {};
    this.areaBusy = false;
  }

  protected override willUpdate(changes: PropertyValues<this>): void {
    if (!changes.has("model")) return;
    const year = String(this.model?.year ?? "");
    if (this.selected !== null && !this.selected.startsWith(year)) this.selected = null;
    if (this.focusDate !== null && !this.focusDate.startsWith(year)) this.focusDate = null;
    const before = changes.get("model") as OpeningHoursYear | undefined;
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

  #choose(date: LocalDate): void {
    this.focusDate = date;
    if (this.selected === date) {
      this.selected = null;
      return;
    }
    this.selected = date;
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLElement>('[data-test="date-panel"] h3')?.focus(),
    );
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

  #action(
    kind: SpecialDayAction["kind"],
    date: LocalDate,
    day: OpeningHoursYearDay | undefined,
    trigger: HTMLElement,
  ): void {
    const model = this.model;
    if (this.readOnly || !this.isConnected || !model) return;
    this.#emit<SpecialDayAction>("special-day-action", {
      kind,
      date,
      specialDay: day?.specialDay ? { ...day.specialDay } : null,
      holidays: structuredClone(day?.holidays ?? []),
      visibleHolidays: structuredClone(model.days.flatMap((other) => other.holidays)),
      returnTo: () => (trigger.isConnected ? trigger : date === "" ? null : this.#dayButton(date)),
    });
  }

  #panel(date: LocalDate, day: OpeningHoursYearDay | undefined) {
    const button = (kind: SpecialDayAction["kind"], test: string, label: Key) =>
      html`<wt-button
        variant="secondary"
        data-test=${test}
        @click=${(event: Event) => {
          event.stopPropagation();
          this.#action(kind, date, day, event.currentTarget as HTMLElement);
        }}
        >${t(label)}</wt-button
      >`;
    return html`<section class="panel" data-test="date-panel">
      <h3 tabindex="-1">
        ${formatDate(date)}${day?.specialDay ? ` · ${day.specialDay.name}` : ""}
      </h3>
      ${day?.holidays.map((holiday) => html`<p>${holiday.name}</p>`)}
      ${day?.closed ? html`<p>${t("hours.closed")}</p>` : nothing}
      ${
        this.readOnly
          ? nothing
          : html`<div class="actions">
              ${
                day?.specialDay
                  ? html`${button("open", "special-edit", "hours.edit")}${button("delete", "special-delete", "hours.delete")}`
                  : button("open", "special-add", "special.make")
              }
            </div>`
      }
    </section>`;
  }

  #month(
    model: OpeningHoursYear,
    month: string,
    days: Map<LocalDate, OpeningHoursYearDay>,
    tints: Map<string, string>,
    stop: LocalDate,
  ) {
    const key = `${model.year}-${month}`;
    const grid = monthGrid(key);
    const headingId = `month-${month}`;
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
      <table aria-labelledby=${headingId} @keydown=${this.#keydown}>
        <thead>
          <tr>
            ${Array.from({ length: 7 }, (_, index) => {
              const date = addDays(A_MONDAY, index);
              return html`<th scope="col" abbr=${weekday(date, "long")}>
                ${weekday(date, "narrow")}
              </th>`;
            })}
          </tr>
        </thead>
        <tbody>
          ${Array.from({ length: grid.length / 7 }, (_, row) => {
            const week = grid.slice(row * 7, row * 7 + 7);
            return html`<tr>
              ${week.map((date) => {
                if (!date.startsWith(key)) return html`<td></td>`;
                const day = days.get(date);
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
                    aria-label=${[
                      formatLongDate(date),
                      day?.specialDay?.name,
                      holidayDateName([...(day?.holidays ?? [])], date, ""),
                      day?.closed ? t("hours.closed") : "",
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    aria-pressed=${date === this.selected ? "true" : "false"}
                    aria-current=${date === model.today ? "date" : nothing}
                    @click=${() => this.#choose(date)}
                    @focus=${() => {
                      this.focusDate = date;
                    }}
                  >
                    ${Number(date.slice(8))}
                  </button>
                </td>`;
              })}
            </tr>`;
          })}
        </tbody>
      </table>
      ${
        this.selected?.startsWith(key)
          ? this.#panel(this.selected, days.get(this.selected))
          : nothing
      }
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
    const coverage = model.holidayCoverage.find((item) => item.year === model.year);
    const national =
      coverage?.nationalRegional === "missing_year"
        ? null
        : coverage?.nationalRegional === "area_required"
          ? format("calendar.area_required", { year })
          : nationalCoverage(model.year, coverage);
    return html`<ul class="note notes">
      ${national ? html`<li data-test="coverage">${national}</li>` : nothing}
      ${
        coverage && listLacksLocalHolidays(coverage.local)
          ? html`<li data-test="town-holidays">${t("year.town_holidays")}</li>`
          : nothing
      }
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
    if (!model) return nothing;
    const days = new Map(model.days.map((day) => [day.date, day]));
    const tints = seasonTints(model.seasons);
    const prefix = `${model.year}-`;
    const stop =
      [this.focusDate, this.selected, model.today].find(
        (date): date is LocalDate => date != null && date.startsWith(prefix),
      ) ?? `${prefix}01-01`;
    const step = (by: number, test: string, label: Key, glyph: string) =>
      html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        @click=${() => this.#emit("year-change", { year: model.year + by })}
        >${glyph}</wt-button
      >`;
    return html`<div class="head">
        ${step(-1, "previous-year", "hours.calendar.previous_year", "‹")}
        <h2 data-test="year" aria-live="polite">${model.year}</h2>
        ${step(1, "next-year", "hours.calendar.next_year", "›")}
        ${
          this.readOnly
            ? nothing
            : html`<wt-button
                class="add"
                variant="secondary"
                data-test="add-special-day"
                @click=${(event: Event) =>
                  this.#action("open", "", undefined, event.currentTarget as HTMLElement)}
                >${t("year.add_special")}</wt-button
              >`
        }
      </div>
      <season-chips
        .seasons=${model.seasons}
        .clockRevision=${model.clockRevision}
        .api=${this.api}
        .specialDays=${this.specialDays}
        .readOnly=${this.readOnly}
      ></season-chips>
      <ul class="legend">
        ${(
          [
            ["public_holiday", "calendar.public"],
            ["special_day", "calendar.special_day"],
            ["closed", "hours.closed"],
          ] as const
        ).map(
          ([mark, label]) =>
            html`<li><span class="swatch" data-mark=${mark}></span>${t(label)}</li>`,
        )}
      </ul>
      ${
        model.publicHolidaysAvailable
          ? nothing
          : html`<p class="note warning" data-test="holidays-unavailable">
              ${format("year.holidays_unavailable", { year: String(model.year) })}
            </p>`
      }
      ${this.#warnings(model)} ${this.#area(model)} ${this.#notes(model)}
      <div class="months">
        ${MONTHS.map((month) => this.#month(model, month, days, tints, stop))}
      </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-year": OpeningHoursYearView;
  }
}
