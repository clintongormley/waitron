import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { baseStyles } from "@waitron/ui";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import type { StationServiceTimes } from "../station-service-times.js";
import type { OpeningHoursApi } from "./opening-hours-client.js";
import { addDays, weekdayOf } from "../hours-rules.js";
import { realDayLabel } from "./real-week.js";
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
  @property() weekStart = "";
  @property({ type: Boolean }) normal = false;
  @state() private times?: StationServiceTimes;
  @state() private error = "";
  private detach?: () => void;
  private key = "";
  override disconnectedCallback() {
    this.detach?.();
    this.key = "";
    super.disconnectedCallback();
  }
  protected override willUpdate() {
    const key = `${this.stationId}:${this.weekStart}:${this.normal}`;
    if (key === this.key) return;
    this.detach?.();
    this.key = key;
    this.times = undefined;
    this.error = "";
    if (!this.stationId || !this.weekStart) return;
    this.detach = this.api.watchStationTimes(
      this.stationId,
      this.weekStart,
      addDays(this.weekStart, 6),
      this.normal,
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
      const date = addDays(this.weekStart, index);
      const day = times.days.find((day) => day.date === date);
      return departments.map((department) => ({
        key: `${date}:${department.id}`,
        label: realDayLabel(this.normal ? "" : this.weekStart, weekdayOf(date)),
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
