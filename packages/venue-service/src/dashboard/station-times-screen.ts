import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import "@waitron/ui/src/components/wt-combobox.js";
import type { LocalDate } from "../hours-types.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { RoutingPeriod } from "../routing-types.js";
import type { StationServiceTimes } from "../station-service-times.js";
import { browserToday, format } from "./hours-view.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import type { MonthDepartment } from "./opening-hours-month.js";
import "./opening-hours-month.js";
import type { PrepStation } from "./routing-client.js";
import { t } from "./strings.js";

export type TimesStation = Pick<
  PrepStation,
  "id" | "name" | "active" | "isDefault" | "displayOrder"
>;
export type TimesPeriod = Pick<
  RoutingPeriod,
  "id" | "departmentId" | "departmentName" | "name" | "colour"
>;

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** The whole Monday-to-Sunday weeks covering `month`, worked out as `readOpeningHoursMonth` does, so
 *  the station read starts beside the month read; a draw still checks the two answers' dates agree. */
function monthWeeks(month: string): [LocalDate, LocalDate] {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + "-01", -1);
  return [addDays(first, -((weekdayOf(first) + 6) % 7)), addDays(last, (7 - weekdayOf(last)) % 7)];
}

/** One prep station's month, read-only: when it gets orders on each date, seasons and special days
 *  included. The picker sends `station-change`; the host answers by setting `stationId`. */
@customElement("prep-station-times")
export class PrepStationTimes extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      wt-combobox {
        display: block;
        max-width: calc(var(--wt-tap-min) * 7);
        margin-block-end: var(--wt-space-3);
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ attribute: false }) stations: readonly TimesStation[] = [];
  @property({ attribute: false }) periods: readonly TimesPeriod[] = [];
  /** The station to show; one not among the active stations shows the first. */
  @property() stationId = "";
  @state() private month = browserToday().slice(0, 7);
  @state() private monthModel?: OpeningHoursMonth;
  @state() private monthError = "";
  @state() private times?: { key: string; value: StationServiceTimes };
  @state() private timesError = "";
  private monthKey = "";
  private timesKey = "";
  private detachMonth?: () => void;
  private detachTimes?: () => void;
  #composed?: {
    meta: OpeningHoursMonth;
    times: StationServiceTimes;
    station: TimesStation;
    periods: readonly TimesPeriod[];
    model: OpeningHoursMonth;
    departments: readonly MonthDepartment[];
  };

  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }

  override disconnectedCallback() {
    this.#detach();
    super.disconnectedCallback();
  }

  #detach() {
    this.detachMonth?.();
    this.detachTimes?.();
    this.detachMonth = this.detachTimes = undefined;
    this.monthKey = this.timesKey = "";
  }

  #active(): TimesStation[] {
    return this.stations
      .filter((station) => station.active)
      .sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
  }

  #station(): TimesStation | undefined {
    const active = this.#active();
    return active.find((station) => station.id === this.stationId) ?? active[0];
  }

  protected override willUpdate() {
    const station = this.#station();
    if (!this.isConnected || !station) {
      this.#detach();
      return;
    }
    const month = this.month;
    if (month !== this.monthKey) {
      this.detachMonth?.();
      this.monthKey = month;
      this.monthError = "";
      const current = () => this.isConnected && this.monthKey === month;
      this.detachMonth = this.api.watchMonth(
        month,
        (model) => {
          if (!current()) return;
          this.monthModel = model;
          this.monthError = "";
        },
        () => {
          if (current()) this.monthError = t("prep.load_error");
        },
        () => {
          if (current()) this.monthError = "";
        },
      );
    }
    const [from, to] = monthWeeks(month);
    const key = `${station.id}:${from}:${to}`;
    if (key !== this.timesKey) {
      this.detachTimes?.();
      this.timesKey = key;
      this.timesError = "";
      const current = () => this.isConnected && this.timesKey === key;
      this.detachTimes = this.api.watchStationTimes(
        station.id,
        from,
        to,
        (value) => {
          if (!current()) return;
          this.times = { key, value };
          this.timesError = "";
        },
        () => {
          if (current()) this.timesError = t("prep.load_error");
        },
        () => {
          if (current()) this.timesError = "";
        },
      );
    }
  }

  /** The month read's dates, each carrying the station's one row (empty on a date it gets nothing),
   *  or nothing until both reads answer for the shown month and station over the same dates. */
  #compose(station: TimesStation, times: StationServiceTimes) {
    const meta = this.monthModel;
    if (
      meta?.month !== this.month ||
      times.days.length !== meta.days.length ||
      times.days.some((day, index) => day.date !== meta.days[index]!.date)
    )
      return undefined;
    const cached = this.#composed;
    if (
      cached?.meta === meta &&
      cached.times === times &&
      cached.station === station &&
      cached.periods === this.periods
    )
      return cached;
    const fed = new Set(
      times.days.flatMap((day) => day.departments.map((row) => row.departmentId)),
    );
    const model: OpeningHoursMonth = {
      ...meta,
      days: meta.days.map((day, index) => {
        const cutover = minutes(day.dayCutover);
        const offset = (time: string) => (minutes(time) - cutover + 1440) % 1440;
        return {
          ...day,
          departments: [
            {
              departmentId: station.id,
              zones: [],
              ranges: times.days[index]!.departments.flatMap((row) => row.ranges).sort(
                (a, b) => offset(a.startsAt) - offset(b.startsAt),
              ),
            },
          ],
        };
      }),
    };
    const departments: MonthDepartment[] = [
      {
        id: station.id,
        name: station.name,
        zones: [],
        periods: this.periods.map(({ id, name, colour, departmentName }) => ({
          id,
          colour,
          name:
            fed.size > 1
              ? format("prep.times.period", { period: name, department: departmentName })
              : name,
        })),
      },
    ];
    this.#composed = { meta, times, station, periods: this.periods, model, departments };
    return this.#composed;
  }

  #picker(stations: readonly TimesStation[], station: TimesStation) {
    return html`<wt-combobox
      name="stationId"
      label=${t("prep.times.station")}
      search="never"
      .options=${stations.map(({ id, name }) => ({ value: id, label: name }))}
      .value=${station.id}
      @wt-change=${(event: CustomEvent<{ value: string }>) => {
        event.stopPropagation();
        (event.currentTarget as HTMLElementTagNameMap["wt-combobox"]).value = station.id;
        if (event.detail.value !== station.id)
          this.dispatchEvent(
            new CustomEvent("station-change", {
              detail: { stationId: event.detail.value },
              bubbles: true,
              composed: true,
            }),
          );
      }}
    ></wt-combobox>`;
  }

  override render() {
    const station = this.#station();
    if (!station) return html`<p>${t("prep.stations_empty")}</p>`;
    const error = this.monthError || this.timesError;
    const times = this.times?.key === this.timesKey ? this.times.value : undefined;
    const head = html`${this.#picker(this.#active(), station)}
    ${error ? html`<p role="alert" data-test="read-error">${error}</p>` : nothing}`;
    if (times?.always)
      return html`${head}
        <p data-test="always-open">${t("prep.always_open_default")}</p>`;
    const composed = times ? this.#compose(station, times) : undefined;
    return html`${head}
      <opening-hours-month
        .month=${this.month}
        .model=${composed?.model}
        .departments=${composed?.departments ?? []}
        readOnly
        stationMode
        @month-change=${(event: CustomEvent<{ month: string }>) => {
          event.stopPropagation();
          this.month = event.detail.month;
        }}
      ></opening-hours-month>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "prep-station-times": PrepStationTimes;
  }
}
