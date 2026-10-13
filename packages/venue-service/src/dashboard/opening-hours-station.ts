import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { StationServiceTimes } from "../station-service-times.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import { businessDateToday } from "./opening-hours-day.js";
import { weekdayLabel } from "./season-week-view.js";
import { t } from "./strings.js";
import "./service-grid.js";

@customElement("opening-hours-station")
export class OpeningHoursStation extends LitElement {
  static override styles = [
    baseStyles,
    css`
      :host {
        display: block;
        min-width: 0;
      }
      span[slot] {
        display: block;
        overflow-wrap: anywhere;
      }
    `,
  ];
  @property({ attribute: false }) api!: OpeningHoursApi;
  @property({ attribute: false }) model!: OpeningHoursModel;
  @property() stationId = "";
  @state() private times?: StationServiceTimes;
  @state() private error = "";
  private detach?: () => void;
  private key = "";
  /** The server reads a normal week in the season of its first date: this week's Monday. */
  private monday = "";
  override connectedCallback() {
    super.connectedCallback();
    this.requestUpdate();
  }
  override disconnectedCallback() {
    this.detach?.();
    this.key = "";
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    const today = businessDateToday(this.model) || "2026-01-05";
    const monday = addDays(today, -((weekdayOf(today) + 6) % 7));
    const key = `${this.stationId}:${monday}`;
    if (key === this.key) return;
    this.detach?.();
    this.key = key;
    this.monday = monday;
    this.times = undefined;
    this.error = "";
    if (!this.stationId) return;
    this.detach = this.api.watchStationTimes(
      this.stationId,
      monday,
      addDays(monday, 6),
      true,
      (times) => {
        if (this.isConnected && this.key === key) {
          this.times = times;
          this.error = "";
        }
      },
      () => {
        if (this.isConnected && this.key === key) this.error = t("opening.load_error");
      },
      () => {
        if (this.isConnected && this.key === key) this.error = "";
      },
    );
  }
  override render() {
    const times = this.times;
    if (this.error) return html`<p role="alert">${this.error}</p>`;
    if (!times) return nothing;
    if (times.always)
      return html`<p>
        ${t(times.always === "default" ? "prep.always_open_default" : "prep.station_switched_off")}
      </p>`;
    const departments = this.model.departments.filter((department) => department.active);
    const columns = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(this.monday, index);
      const day = times.days.find((day) => day.date === date);
      return departments.map((department) => ({
        key: `${date}:${department.id}`,
        label: weekdayLabel(weekdayOf(date)),
        slots: day?.departments.find((row) => row.departmentId === department.id)?.ranges ?? [],
        periods: department.periods,
        editable: false,
        narrow: true,
      }));
    }).flat();
    return html`<service-grid
      .columns=${columns}
      .dayCutover=${this.model.dayCutover}
      .readOnly=${true}
    >
      ${columns.map((column) => html`<span slot=${`header-${column.key}`}>${departments.find((department) => column.key.endsWith(`:${department.id}`))!.name}</span>`)}
    </service-grid>`;
  }
}
declare global {
  interface HTMLElementTagNameMap {
    "opening-hours-station": OpeningHoursStation;
  }
}
