import { html, type TemplateResult } from "lit";
import "@waitron/ui/src/components/wt-combobox.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { MonthNames } from "./opening-hours-day.js";
import type { ShowStation } from "./station-show.js";
import { t } from "./strings.js";

const ALL = "all";
const STATION = "station:";
export type CalendarShow = "" | "stations" | "all";

export const stationIcon = () =>
  html`<wt-icon name="prep-station" role="img" aria-label=${t("opening.prep_station")}></wt-icon>`;
export const stationExplanation = () =>
  html`<p data-test="station-explanation">
    ${t("opening.station_hours")} <a href="/manage/periods">${t("period.title")}</a>
  </p>`;

export function showPicker(options: {
  model: OpeningHoursMonth;
  chosen: string;
  names: MonthNames;
  onDepartment: (departmentId: string) => void;
  stations: readonly ShowStation[];
  stationId: string;
  onStation: (stationId: string) => void;
  show?: CalendarShow;
  week?: boolean;
  onShow?: (show: CalendarShow) => void;
}): TemplateResult {
  const { model, chosen, names, onDepartment, stations, stationId, onStation } = options;
  const value = stationId
    ? STATION + stationId
    : options.show
      ? `show:${options.show}`
      : chosen || ALL;
  const stationMark = { icon: "prep-station", iconLabel: t("opening.prep_station") };
  const choices = [
    ...(options.week && stations.length
      ? [{ value: "show:all", fixed: true, label: t("opening.show_all") }]
      : []),
    { value: ALL, fixed: true, label: t("opening.all_departments") },
    ...model.days[0]!.departments.map((d) => ({
      value: d.departmentId,
      label: names.name(d.departmentId),
      depth: 1,
    })),
    ...(stations.length
      ? [{ value: "show:stations", fixed: true, label: t("opening.all_stations"), ...stationMark }]
      : []),
    ...stations.map((station) => ({
      value: STATION + station.id,
      label: station.name,
      depth: 1,
      ...stationMark,
    })),
  ];
  return html`<wt-combobox
    name="departmentId"
    label=${t("opening.show")}
    search="never"
    .options=${choices}
    .value=${value}
    @wt-change=${(event: CustomEvent<{ value: string }>) => {
      event.stopPropagation();
      const chooser = event.currentTarget as HTMLElementTagNameMap["wt-combobox"];
      chooser.value = value;
      const picked = event.detail.value;
      if (picked.startsWith("show:")) {
        options.onShow?.(picked.slice(5) as CalendarShow);
        return;
      }
      if (picked.startsWith(STATION)) {
        const next = picked.slice(STATION.length);
        if (next !== stationId) onStation(next);
        return;
      }
      const next = picked === ALL ? "" : picked;
      if (stationId || options.show || next !== chosen) onDepartment(next);
    }}
  ></wt-combobox>`;
}
