import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { holidayDateName } from "../holiday-naming.js";
import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import { showPicker } from "./calendar-show.js";
import { formatDayHeading, formatWeekTitleParts } from "./hours-view.js";
import { monthNames, type MonthNames } from "./opening-hours-day.js";
import {
  FIRST_MONTH,
  LAST_MONTH,
  type CalendarDayOpen,
  type MonthDepartment,
} from "./opening-hours-month.js";
import { fixedTitle, fixedTitleStyles } from "./fixed-title.js";
import { closedHatch, periodColourStyles } from "./period-colour-styles.js";
import { t, VENUE_SERVICE_STRINGS } from "./strings.js";
import { weekDates, weekDays, weekMonth, weekRows, type WeekRow } from "./week-rows.js";

type Day = OpeningHoursMonth["days"][number];

const RULER_STEP = 120;

type TitlePart = ReturnType<typeof formatWeekTitleParts>[number];

let widthCandidates: TitlePart[][] | undefined;
/** The titles of every week whose Monday falls in 2026, in each interface language. */
function titleCandidates(): TitlePart[][] {
  if (!widthCandidates) {
    widthCandidates = [];
    for (const language of Object.keys(VENUE_SERVICE_STRINGS))
      for (let monday = "2026-01-05"; monday < "2027-01-01"; monday = addDays(monday, 7))
        widthCandidates.push(formatWeekTitleParts(monday, addDays(monday, 6), language));
  }
  return widthCandidates;
}

function clockText(cutover: string, minutes: number): string {
  const [h, m] = cutover.split(":").map(Number) as [number, number];
  const total = (h * 60 + m + minutes) % 1440;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** The Monday-to-Sunday week holding `date`, each day a section of rows with its hours drawn as
 *  blocks on one scale, the week's longest day. A day's name sends `calendar-day-open`; ‹ › send
 *  `week-change`, the title's months and years `week-month-open` and `week-year-open`, and Show
 *  `week-department-change`. */
@customElement("opening-hours-week")
export class OpeningHoursWeekView extends LitElement {
  static override styles = [
    baseStyles,
    periodColourStyles,
    fixedTitleStyles,
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
      .title-link {
        display: inline-block;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-primary-text);
        font: inherit;
        text-decoration: underline;
        cursor: pointer;
      }
      .title-link:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .hint {
        ${visuallyHiddenStyles}
      }
      .ruler,
      .row {
        display: grid;
        grid-template-columns: calc(var(--wt-tap-min) * 4) minmax(0, 1fr);
        column-gap: var(--wt-space-2);
        align-items: center;
      }
      .ruler {
        font-size: var(--wt-font-size-sm);
        color: var(--wt-color-text-muted);
        border-block-end: 1px solid var(--wt-color-border);
        padding-block-end: var(--wt-space-1);
      }
      .scale {
        position: relative;
        grid-column: 2;
        height: var(--wt-space-4);
      }
      .label {
        position: absolute;
        inset-block-start: 0;
        white-space: nowrap;
      }
      section {
        padding-block: var(--wt-space-2);
        border-block-end: 1px solid var(--wt-color-border);
      }
      h3 {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: var(--wt-space-2);
        margin: 0 0 var(--wt-space-1);
        font-size: var(--wt-font-size-md);
      }
      .day-name {
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--wt-color-text);
        font: inherit;
        font-weight: var(--wt-font-weight-bold);
        cursor: pointer;
      }
      .day-name:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .name {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-bold);
      }
      .name.special {
        color: var(--wt-color-palette-purple);
      }
      .name.holiday {
        color: var(--wt-color-palette-red);
      }
      .row {
        margin-block-start: var(--wt-space-1);
        font-size: var(--wt-font-size-sm);
      }
      .row-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--wt-color-text);
      }
      .row-name.strong {
        font-weight: var(--wt-font-weight-bold);
      }
      .spoken {
        ${visuallyHiddenStyles}
      }
      .lane {
        min-width: 0;
      }
      .track {
        position: relative;
        display: flex;
        align-items: center;
        height: calc(var(--wt-tap-min) / 2);
        padding-inline: var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-border);
        color: var(--wt-color-text);
        overflow: hidden;
        white-space: nowrap;
      }
      .block {
        position: absolute;
        inset-block: 0;
        display: flex;
        align-items: center;
        padding-inline: var(--wt-space-1);
        overflow: hidden;
        background: var(--period-fill);
        color: var(--period-on-fill);
        font-weight: var(--wt-font-weight-bold);
      }
      .block[data-kind="closed"] {
        background: ${closedHatch};
        color: var(--wt-color-text);
      }
      .block[data-faded] {
        opacity: var(--wt-opacity-disabled);
      }
      .text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ];

  /** The read of `weekMonth(date)`. */
  @property({ attribute: false }) model?: OpeningHoursMonth;
  /** The shown date; the week holding it is drawn. */
  @property() date = "";
  /** The chosen department; "" draws every department. */
  @property() departmentId = "";
  @property({ attribute: false }) departments: readonly MonthDepartment[] = [];

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  #dayButton(date: LocalDate): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>(
      `[data-test="day-name"][data-date="${date}"]`,
    );
  }

  #chosen(model: OpeningHoursMonth): string {
    return model.days[0]!.departments.some((d) => d.departmentId === this.departmentId)
      ? this.departmentId
      : "";
  }

  override render() {
    if (!this.date) return nothing;
    const dates = weekDates(this.date);
    const step = (by: number, test: string, label: Parameters<typeof t>[0], glyph: string) => {
      const target = addDays(this.date, by);
      const month = weekMonth(target);
      const blocked = month < FIRST_MONTH || month > LAST_MONTH;
      return html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        ?disabled=${blocked}
        @click=${() => {
          if (!blocked) this.#emit("week-change", { date: target });
        }}
        >${glyph}</wt-button
      >`;
    };
    // A candidate is shaped as the title is, its links inline-blocks; shaped otherwise, Chromium
    // measured the Month's title a hair wider.
    const candidates = titleCandidates().map(
      (parts) =>
        html`${parts.map((part) =>
          part.month || part.year ? html`<span class="title-link">${part.text}</span>` : part.text,
        )}`,
    );
    const heading = html`${formatWeekTitleParts(dates[0]!, dates[6]!).map((part) => {
      const { month, year } = part;
      if (month)
        return html`<button
          type="button"
          class="title-link"
          data-test="week-month"
          data-month=${month}
          aria-describedby="month-hint"
          @click=${() => this.#emit("week-month-open", { month })}
        >
          ${part.text}
        </button>`;
      if (year)
        return html`<button
          type="button"
          class="title-link"
          data-test="week-year"
          data-year=${year}
          aria-describedby="year-hint"
          @click=${() => this.#emit("week-year-open", { year })}
        >
          ${part.text}
        </button>`;
      return part.text;
    })}`;
    const days = this.model ? weekDays(this.model, this.date) : undefined;
    return html`<div class="head">
        ${step(-7, "previous-week", "week.previous", "‹")}
        ${fixedTitle(html`<h2 data-test="week" aria-live="polite">${heading}</h2>`, candidates)}
        ${step(7, "next-week", "week.next", "›")}
        ${days && this.model ? this.#show(this.model) : nothing}
      </div>
      <span id="month-hint" class="hint">${t("week.month_view_hint")}</span>
      <span id="year-hint" class="hint">${t("month.year_view_hint")}</span>
      ${days && this.model ? this.#week(this.model, days) : nothing}`;
  }

  #show(model: OpeningHoursMonth) {
    return showPicker({
      model,
      chosen: this.#chosen(model),
      names: monthNames(this.departments),
      onDepartment: (departmentId) => this.#emit("week-department-change", { departmentId }),
    });
  }

  #week(model: OpeningHoursMonth, days: Day[]) {
    const chosen = this.#chosen(model);
    const names = monthNames(this.departments);
    const longest = Math.max(...days.map((day) => day.endMinute));
    const labels = Array.from(
      { length: Math.floor(longest / RULER_STEP) + 1 },
      (_, i) => i * RULER_STEP,
    );
    return html`<div class="ruler" aria-hidden="true">
        <div class="scale">
          ${labels.map(
            (minute) =>
              html`<span class="label" style=${styleMap({ left: `${(minute / longest) * 100}%` })}
                >${clockText(days[0]!.dayCutover, minute)}</span
              >`,
          )}
        </div>
      </div>
      ${days.map((day) => this.#day(day, chosen, names, longest))}`;
  }

  #day(day: Day, chosen: string, names: MonthNames, longest: number) {
    const holiday = holidayDateName(day.holidays, day.date, "");
    const special = day.specialDay?.name ?? "";
    const lines = [
      ...(special && special !== holiday ? [{ name: special, kind: "special" }] : []),
      ...(holiday ? [{ name: holiday, kind: "holiday" }] : []),
    ];
    return html`<section data-date=${day.date}>
      <h3>
        <button
          type="button"
          class="day-name"
          data-test="day-name"
          data-date=${day.date}
          @click=${() =>
            this.#emit<CalendarDayOpen>("calendar-day-open", {
              date: day.date,
              returnTo: () => this.#dayButton(day.date),
            })}
        >
          ${formatDayHeading(day.date)}
        </button>
        ${lines.map((line) => html`<span class="name ${line.kind}">${line.name}</span>`)}
      </h3>
      ${weekRows(day, chosen, names).map((row) => this.#row(row, day, names, longest))}
    </section>`;
  }

  #row(row: WeekRow, day: Day, names: MonthNames, longest: number) {
    const span = day.endMinute;
    return html`<div class="row" data-row=${row.key}>
      <span class="row-name ${row.zone ? "" : "strong"}" aria-hidden="true">${row.name}</span>
      <span class="spoken">${`${row.name}: ${row.words}`}</span>
      <div class="lane">
        <div
          class="track"
          aria-hidden="true"
          style=${styleMap({ width: `${(span / longest) * 100}%` })}
        >
          ${
            row.blocks.length
              ? row.blocks.map(
                  (block) =>
                    html`<span
                      class="block"
                      data-kind=${block.kind}
                      data-colour=${
                        (block.periodId && names.period(block.periodId).colour) || nothing
                      }
                      ?data-faded=${block.faded}
                      style=${styleMap({
                        left: `${(block.start / span) * 100}%`,
                        width: `${((block.end - block.start) / span) * 100}%`,
                      })}
                      ><span class="text">${block.text}</span></span
                    >`,
                )
              : row.empty
          }
        </div>
      </div>
    </div>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-week": OpeningHoursWeekView;
  }
}
