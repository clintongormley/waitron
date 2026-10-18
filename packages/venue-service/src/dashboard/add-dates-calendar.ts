import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import { HOURS_RANGE_MAX_DAYS, type LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import { DayPicker, type DayRun } from "./day-picking.js";
import { format, formatLongDate, formatMonthName, formatWeekday } from "./hours-view.js";
import { t } from "./strings.js";

/** What `add-dates` carries: the dates to add, in order, none of them already chosen. */
export interface AddDates {
  dates: LocalDate[];
}

/** What `remove-dates` carries: chosen dates to take out of the draft. */
export interface RemoveDates {
  dates: LocalDate[];
}

/** The months the month read serves, so the host can read each month's taken dates. */
const FIRST_MONTH = "0100-02";
const LAST_MONTH = "9998-12";
/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = "2024-01-01";

function stepMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function monthDates(month: string): LocalDate[] {
  const dates: LocalDate[] = [];
  for (let date = `${month}-01`; date.startsWith(month); date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** A month of dates to pick from: a click adds a date, or removes a chosen one; a drag, a
 *  shift-click or Shift+arrow adds every date of the run. Dates another special day holds are
 *  marked with its name but still offered; the server refuses them. ‹ › send `month-change`. */
@customElement("add-dates-calendar")
export class AddDatesCalendar extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
      }
      .head {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-end: var(--wt-space-2);
      }
      .head h3 {
        flex: 1;
        margin: 0;
        font-size: var(--wt-font-size-md);
        text-align: center;
      }
      .head h3::first-letter {
        text-transform: uppercase;
      }
      /* Inside a modal dialog Chromium leaves a caret on a clicked date, and a shift-click would
         then select the dates' numbers. */
      table {
        user-select: none;
        width: 100%;
        border-collapse: separate;
        border-spacing: calc(var(--wt-space-1) / 2);
        table-layout: fixed;
      }
      th {
        font-size: var(--wt-font-size-sm);
        font-weight: var(--wt-font-weight-normal);
        color: var(--wt-color-text-muted);
      }
      td {
        padding: 0;
      }
      td button {
        position: relative;
        width: 100%;
        min-height: var(--wt-tap-min);
        padding: 0;
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font: inherit;
        cursor: pointer;
      }
      td[data-taken] button,
      .mark {
        border-color: var(--wt-color-palette-purple);
        border-style: dashed;
      }
      td[data-taken] button::after,
      .mark::after {
        content: "";
        position: absolute;
        inset-block-end: var(--wt-space-1);
        inset-inline-start: calc(50% - var(--wt-space-1) / 2);
        width: var(--wt-space-1);
        height: var(--wt-space-1);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-palette-purple);
      }
      td button[aria-pressed="true"] {
        border-color: var(--wt-color-primary);
        background: var(--wt-color-primary);
        color: var(--wt-color-on-primary);
      }
      td[data-picked] button {
        box-shadow: inset 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary);
      }
      td button:focus-visible {
        outline: var(--wt-field-line-width-active) solid var(--wt-color-focus);
        outline-offset: var(--wt-focus-offset);
      }
      .foot {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-2);
      }
      .hint,
      .message,
      .legend,
      .held {
        margin: 0;
        color: var(--wt-color-text-muted);
        font-size: var(--wt-font-size-sm);
      }
      .legend {
        display: flex;
        align-items: center;
        gap: var(--wt-space-2);
        margin-block-start: var(--wt-space-2);
      }
      /* A small copy of a held date's dashed outline and dot. */
      .mark {
        position: relative;
        flex: none;
        box-sizing: border-box;
        inline-size: var(--wt-space-5);
        block-size: var(--wt-space-5);
        border-width: 1px;
        border-radius: var(--wt-radius-sm);
      }
      .held:empty {
        display: none;
      }
    `,
  ];

  /** The `YYYY-MM` shown; ‹ › step it and send `month-change`. */
  @property() month = "";
  /** The dates the draft already holds, drawn chosen. */
  @property({ attribute: false }) selected: readonly LocalDate[] = [];
  /** Each date another special day holds, with that day's name. */
  @property({ attribute: false }) taken: ReadonlyMap<LocalDate, string> = new Map();
  @state() private message = "";
  /** The date last clicked or focused, whose holder is named under the month. */
  @state() private pointed: LocalDate | null = null;

  #emit<T>(name: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(name, { detail, bubbles: true, composed: true }));
  }

  #add(dates: LocalDate[]): void {
    const chosen = new Set(this.selected);
    const fresh = dates.filter((date) => !chosen.has(date));
    if (fresh.length) this.#emit<AddDates>("add-dates", { dates: fresh });
  }

  /** The last run a gesture added; a run the picker holds that is not this one is still being
   *  picked, so it is drawn marked. */
  #rangedRun: DayRun | null = null;

  #picker = new DayPicker(this, {
    button: (date) => this.renderRoot.querySelector<HTMLElement>(`td[data-date="${date}"] button`),
    canPick: () => true,
    dragOnTouch: true,
    choose: (date) => {
      this.pointed = date;
      this.message = "";
      if (this.selected.includes(date)) this.#emit<RemoveDates>("remove-dates", { dates: [date] });
      else this.#add([date]);
    },
    /** A refused run keeps its first date, so a nearer last date can follow. */
    ranged: (run) => {
      this.#rangedRun = run;
      this.requestUpdate();
      const dates: LocalDate[] = [];
      for (let date = run.from; date <= run.to; date = addDays(date, 1)) {
        if (dates.length === HOURS_RANGE_MAX_DAYS) {
          this.message = t("special.range_long");
          return;
        }
        dates.push(date);
      }
      this.message = "";
      this.#add(dates);
    },
  });

  #marking(): boolean {
    const run = this.#picker.run;
    return (
      run !== null &&
      run.from !== run.to &&
      (run.from !== this.#rangedRun?.from || run.to !== this.#rangedRun.to)
    );
  }

  override render() {
    if (!this.month) return nothing;
    const step = (by: number, test: string, label: Parameters<typeof t>[0], glyph: string) => {
      const target = stepMonth(this.month, by);
      return html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        ?disabled=${target < FIRST_MONTH || target > LAST_MONTH}
        @click=${() => {
          // From the month at the click, so presses before a redraw add up.
          const next = stepMonth(this.month, by);
          if (next < FIRST_MONTH || next > LAST_MONTH) return;
          this.month = next;
          this.#emit("month-change", { month: next });
        }}
        >${glyph}</wt-button
      >`;
    };
    const dates = monthDates(this.month);
    const focus = this.#picker.focusDate;
    const stop = focus !== null && dates.includes(focus) ? focus : dates[0]!;
    const cells: (LocalDate | null)[] = [
      ...Array.from({ length: (weekdayOf(dates[0]!) + 6) % 7 }, () => null),
      ...dates,
    ];
    while (cells.length % 7) cells.push(null);
    const weeks = Array.from({ length: cells.length / 7 }, (_, row) =>
      cells.slice(row * 7, row * 7 + 7),
    );
    const chosen = new Set(this.selected);
    const marking = this.#marking();
    const holder = dates.includes(this.pointed ?? "") ? this.taken.get(this.pointed!) : undefined;
    return html`<div class="head">
        ${step(-1, "previous-month", "month.previous", "‹")}
        <h3 data-test="month" aria-live="polite">
          ${formatMonthName(Number(this.month.slice(5, 7)))} ${Number(this.month.slice(0, 4))}
        </h3>
        ${step(1, "next-month", "month.next", "›")}
      </div>
      <table
        @pointerdown=${this.#picker.handlers.pointerdown}
        @click=${this.#picker.handlers.click}
        @dblclick=${this.#picker.handlers.dblclick}
        @keydown=${this.#picker.handlers.keydown}
        @contextmenu=${this.#picker.handlers.contextmenu}
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
                ${week.map((date) =>
                  date ? this.#cell(date, chosen, stop, marking) : html`<td></td>`,
                )}
              </tr>`,
          )}
        </tbody>
      </table>
      <div class="foot">
        <p class="hint" data-test="hint">${t("special.pick_hint")}</p>
        <p class="message" data-test="message" role="status">${this.message}</p>
      </div>
      ${
        dates.some((date) => this.taken.has(date))
          ? html`<p class="legend" data-test="legend">
              <span class="mark" aria-hidden="true"></span>${t("special.taken_legend")}
            </p>`
          : nothing
      }
      <p class="held" data-test="held" role="status">
        ${holder === undefined ? "" : format("special.taken_by", { name: holder })}
      </p>`;
  }

  #cell(date: LocalDate, chosen: ReadonlySet<LocalDate>, stop: LocalDate, marking: boolean) {
    const holder = this.taken.get(date);
    return html`<td
      data-date=${date}
      ?data-taken=${holder !== undefined}
      ?data-picked=${marking && this.#picker.isPicked(date)}
    >
      <button
        type="button"
        tabindex=${date === stop ? 0 : -1}
        aria-label=${holder ? `${formatLongDate(date)}, ${holder}` : formatLongDate(date)}
        aria-pressed=${chosen.has(date) ? "true" : "false"}
        title=${holder ?? nothing}
        @focus=${() => {
          this.pointed = date;
        }}
      >
        ${Number(date.slice(8))}
      </button>
    </td>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "add-dates-calendar": AddDatesCalendar;
  }
}
