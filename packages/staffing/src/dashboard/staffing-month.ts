import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { QueryController, codeMessage, codeOf, currentLocale } from "@waitron/dashboard-kit";
import { baseStyles, visuallyHiddenStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-button.js";
import "@waitron/ui/src/components/wt-combobox.js";
import { areaKey } from "../slots.js";
import type { StaffingArea, StaffingMonth, StaffingSeason } from "../staffing-types.js";
import type { StaffingApi } from "./client.js";
import { t, tf } from "./strings.js";

type Day = StaffingMonth["days"][number];

/** The months the month read serves, as the Opening hours month bounds them. */
const FIRST_MONTH = "0100-02";
const LAST_MONTH = "9998-12";
/** A Monday, so its week names the columns Monday first. */
const A_MONDAY = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;
const ALL = "all";
const TINTS = ["1", "2", "3", "4"];

function stepMonth(month: string, by: number): string {
  const index = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + by;
  return `${String(Math.floor(index / 12)).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = currentLocale().startsWith("es") ? "es-ES" : "en-GB";
  const key = `${locale} ${JSON.stringify(options)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
    formatters.set(key, formatter);
  }
  return formatter;
}
const utc = (date: string) => new Date(`${date}T00:00:00Z`);
/** A leap year, so a season ending 29 February reads as itself. */
const monthDay = (md: string) =>
  dateFormat({ day: "numeric", month: "short" }).format(utc(`2000-${md}`));

/** Each season's tint by its place in start order, as the Opening hours month tints it. */
function seasonTints(seasons: readonly StaffingSeason[]): Map<string, string> {
  return new Map(
    [...seasons]
      .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
      .map((season, index) => [season.id, TINTS[index % TINTS.length]!]),
  );
}

/** The Calendar's Staffing view: one month of whole Monday-to-Sunday weeks, each day listing the
 *  people needed per area as a bar and a number. ‹ › and the area picker move the Calendar's address
 *  through `open`; the host passes the address back as `month` and `params`. */
@customElement("staffing-month")
export class StaffingMonthView extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
        container: staffing-month / inline-size;
      }
      [data-tint="1"] {
        --tint: var(--wt-color-season-1);
        --on-tint: var(--wt-color-on-season-1);
        --tint-line: var(--wt-color-season-1-line);
      }
      [data-tint="2"] {
        --tint: var(--wt-color-season-2);
        --on-tint: var(--wt-color-on-season-2);
        --tint-line: var(--wt-color-season-2-line);
      }
      [data-tint="3"] {
        --tint: var(--wt-color-season-3);
        --on-tint: var(--wt-color-on-season-3);
        --tint-line: var(--wt-color-season-3-line);
      }
      [data-tint="4"] {
        --tint: var(--wt-color-season-4);
        --on-tint: var(--wt-color-on-season-4);
        --tint-line: var(--wt-color-season-4-line);
      }
      .head,
      .sub {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2) var(--wt-space-4);
        margin-block-end: var(--wt-space-2);
      }
      .head {
        gap: var(--wt-space-2);
      }
      .head h2 {
        margin: 0;
        font-size: var(--wt-font-size-lg);
      }
      .head h2::first-letter {
        text-transform: uppercase;
      }
      .seasons {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--wt-space-2);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .seasons-label,
      .legend {
        margin: 0;
        color: var(--wt-color-text-muted);
      }
      .chip {
        padding: var(--wt-space-1) var(--wt-space-3);
        border: 1px solid var(--wt-color-border);
        border-radius: var(--wt-radius-full);
      }
      .chip[data-tint] {
        background: var(--tint);
        color: var(--on-tint);
        border-color: var(--tint-line);
      }
      .alert {
        margin: 0 0 var(--wt-space-2);
        color: var(--wt-color-danger);
      }
      .loading {
        margin: 0;
        color: var(--wt-color-text-muted);
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
        height: 1px;
        padding: 0;
        vertical-align: top;
      }
      .day {
        display: flex;
        flex-direction: column;
        gap: var(--wt-space-1);
        height: 100%;
        min-width: 0;
        min-height: calc(var(--wt-tap-min) * 2);
        padding: var(--wt-space-1);
        border: 1px solid var(--wt-color-border);
        border-block-start: var(--wt-space-1) solid var(--wt-color-border);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-surface);
        color: var(--wt-color-text);
        font-size: var(--wt-font-size-sm);
        overflow: hidden;
      }
      .day[aria-current="date"] {
        box-shadow: inset 0 0 0 var(--wt-field-line-width-active) var(--wt-color-primary);
      }
      td[data-tint] .day {
        border-block-start-color: var(--tint-line);
      }
      td[data-outside] .day {
        background: var(--wt-color-bg);
        color: var(--wt-color-text-muted);
      }
      td[data-outside] .bar {
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
      .special {
        font-weight: var(--wt-font-weight-bold);
        color: var(--wt-color-palette-purple);
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      td[data-closed] .special {
        color: inherit;
      }
      .line {
        display: flex;
        align-items: center;
        gap: var(--wt-space-1);
        min-width: 0;
      }
      /* The month's largest number draws a bar a third of the day's width. */
      .bar {
        flex: 0 0 auto;
        width: calc(var(--share) * 33%);
        min-width: var(--wt-space-1);
        height: var(--wt-space-2);
        border-radius: var(--wt-radius-sm);
        background: var(--wt-color-palette-purple);
      }
      .label {
        display: flex;
        min-width: 0;
        white-space: nowrap;
      }
      .name {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .count {
        flex: none;
        white-space: pre;
      }
      /* A phone's width: the bar sits above its label, and today is marked on the number. */
      @container staffing-month (width < 560px) {
        table {
          border-spacing: calc(var(--wt-space-1) / 2);
        }
        .day {
          padding: var(--wt-space-1) calc(var(--wt-space-1) / 4);
        }
        .line {
          flex-direction: column;
          align-items: stretch;
          gap: 0;
        }
        .bar {
          width: calc(var(--share) * 100%);
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
      }
    `,
  ];

  @property({ attribute: false }) api!: StaffingApi;
  /** The Calendar's month, YYYY-MM. */
  @property() month = "";
  /** The address's words after `view/staffing`; `area` holds the chosen area's key. */
  @property({ attribute: false }) params: Readonly<Record<string, string>> = {};
  /** Nothing in the month writes yet; the painters of A585-4 will read it. */
  @property({ type: Boolean }) canWrite = false;
  /** Moves the Calendar's address. */
  @property({ attribute: false }) open!: (view: string, params: Record<string, string>) => void;

  @state() private read?: StaffingMonth;
  @state() private loadError?: string;

  readonly #queries = new QueryController(
    this,
    () => this.api.liveData,
    (error) => {
      this.loadError = tf("staffing.month.load_error", { reason: codeMessage(codeOf(error)) });
    },
    () => {
      this.loadError = undefined;
    },
  );
  #watching?: string;

  override willUpdate(): void {
    if (this.month && this.month !== this.#watching) this.#watch();
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.#watching = undefined;
    this.requestUpdate();
  }

  #watch(): void {
    const month = this.month;
    this.#watching = month;
    this.loadError = undefined;
    this.api
      .watchMonth(this.#queries, month, (read) => {
        this.read = read;
        this.loadError = undefined;
      })
      .catch(() => {
        // The controller's error callback has already said why.
      });
  }

  #go(params: Record<string, string>): void {
    this.open("staffing", params);
  }

  #chosen(areas: readonly StaffingArea[]): string {
    const asked = this.params.area;
    return areas.some(({ area }) => areaKey(area) === asked) ? asked! : ALL;
  }

  override render() {
    const current = this.month;
    if (!current) return nothing;
    const read = this.read?.month === current ? this.read : undefined;
    const step = (
      by: number,
      test: string,
      label: "staffing.month.previous" | "staffing.month.next",
      glyph: string,
    ) => {
      const target = stepMonth(current, by);
      const blocked = target < FIRST_MONTH || target > LAST_MONTH;
      return html`<wt-button
        variant="secondary"
        data-test=${test}
        aria-label=${t(label)}
        ?disabled=${blocked}
        @click=${() => {
          if (!blocked) this.#go({ ...this.params, month: target });
        }}
        >${glyph}</wt-button
      >`;
    };
    const title = `${dateFormat({ month: "long" }).format(utc(`${current}-01`))} ${Number(current.slice(0, 4))}`;
    return html`<div class="head">
        ${step(-1, "previous-month", "staffing.month.previous", "‹")}
        <h2 data-test="month" aria-live="polite">${title}</h2>
        ${step(1, "next-month", "staffing.month.next", "›")}
        ${this.read ? this.#picker(this.read.areas) : nothing}
      </div>
      ${
        this.loadError
          ? html`<p class="alert" role="alert" data-test="load-error">${this.loadError}</p>`
          : nothing
      }
      ${
        read
          ? this.#grid(read)
          : this.loadError
            ? nothing
            : html`<p class="loading" data-test="loading">${t("staffing.month.loading")}</p>`
      }`;
  }

  #picker(areas: readonly StaffingArea[]) {
    const chosen = this.#chosen(areas);
    const options = [
      { value: ALL, label: t("staffing.month.all_areas") },
      ...areas.map(({ area, name }) => ({ value: areaKey(area), label: name })),
    ];
    return html`<wt-combobox
      name="area"
      label=${t("staffing.month.area")}
      search="never"
      .options=${options}
      .value=${chosen}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = chosen;
        const next = event.detail.value;
        if (next === chosen) return;
        const params: Record<string, string> = { ...this.params, area: next };
        if (next === ALL) delete params.area;
        this.#go(params);
      }}
    ></wt-combobox>`;
  }

  #grid(month: StaffingMonth) {
    const { areas } = month;
    const chosen = this.#chosen(areas);
    const names = new Map(areas.map(({ area, name }) => [areaKey(area), name]));
    const shown = (day: Day) =>
      day.areas.filter(({ area }) => chosen === ALL || areaKey(area) === chosen);
    const largest = Math.max(1, ...month.days.flatMap((day) => day.areas.map((a) => a.needed)));
    const tints = seasonTints(month.seasons);
    const weeks = Array.from({ length: month.days.length / 7 }, (_, row) =>
      month.days.slice(row * 7, row * 7 + 7),
    );
    return html`<div class="sub">
        <span class="seasons-label">${t("staffing.month.seasons")}</span>
        <ul class="seasons" data-test="seasons" aria-label=${t("staffing.month.seasons")}>
          ${month.seasons.map(
            (season) =>
              html`<li class="chip" data-test="season" data-tint=${tints.get(season.id)!}>
                ${tf("staffing.month.season", {
                  name: season.name,
                  from: monthDay(season.startsOn),
                  to: monthDay(season.lastDay),
                })}
              </li>`,
          )}
        </ul>
        <p class="legend">${t("staffing.month.legend")}</p>
      </div>
      <table>
        <thead>
          <tr>
            ${Array.from({ length: 7 }, (_, index) => {
              const date = new Date(A_MONDAY + index * DAY_MS);
              return html`<th scope="col" abbr=${dateFormat({ weekday: "long" }).format(date)}>
                ${dateFormat({ weekday: "short" }).format(date)}
              </th>`;
            })}
          </tr>
        </thead>
        <tbody>
          ${weeks.map(
            (week) =>
              html`<tr>
                ${week.map((day) => this.#cell(day, month.today, shown(day), names, largest, tints))}
              </tr>`,
          )}
        </tbody>
      </table>`;
  }

  #cell(
    day: Day,
    today: string | null,
    areas: Day["areas"],
    names: Map<string, string>,
    largest: number,
    tints: Map<string, string>,
  ) {
    const isToday = day.date === today;
    const label = dateFormat({ weekday: "long", day: "numeric", month: "long" }).format(
      utc(day.date),
    );
    return html`<td
      data-date=${day.date}
      data-tint=${(day.seasonId && tints.get(day.seasonId)) || nothing}
      ?data-outside=${!day.inMonth}
      ?data-closed=${day.closedAllDay}
    >
      <div class="day" role="group" aria-label=${label} aria-current=${isToday ? "date" : nothing}>
        <span class="top">
          <span class="date">${Number(day.date.slice(8))}</span>
          ${isToday ? html`<span class="today">${t("staffing.month.today")}</span>` : nothing}
        </span>
        ${
          day.specialDay
            ? html`<span class="special" data-test="special" title=${day.specialDay.name}
                >${day.specialDay.name}</span
              >`
            : nothing
        }
        ${
          day.closedAllDay
            ? html`<span data-test="closed">${t("staffing.month.closed")}</span>`
            : nothing
        }
        ${areas.map(
          ({ area, needed }) =>
            html`<span class="line" data-test="area-line">
              <span
                class="bar"
                aria-hidden="true"
                data-test="bar"
                style=${styleMap({ "--share": String(needed / largest) })}
              ></span>
              <span class="label"
                ><span class="name" data-test="area-name" title=${names.get(areaKey(area)) ?? ""}
                  >${names.get(areaKey(area)) ?? ""}</span
                ><span class="count" data-test="area-count"> ${needed}</span></span
              >
            </span>`,
        )}
      </div>
    </td>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "staffing-month": StaffingMonthView;
  }
}
