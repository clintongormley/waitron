import { html, type TemplateResult } from "lit";
import "@waitron/ui/src/components/wt-combobox.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { MonthNames } from "./opening-hours-day.js";
import type { ShowStation } from "./station-show.js";
import { t } from "./strings.js";

const ALL = "all";
const STATION = "station:";

/** The Show picker the Month and the Week share: every department, one department, or, when
 *  `stations` are given, one prep station; `stationId` set shows that station. */
export function showPicker(options: {
  model: OpeningHoursMonth;
  chosen: string;
  names: MonthNames;
  onDepartment: (departmentId: string) => void;
  stations?: readonly ShowStation[];
  stationId?: string;
  onStation?: (stationId: string) => void;
}): TemplateResult {
  const { model, chosen, names, onDepartment, stations = [], stationId = "", onStation } = options;
  const value = stationId ? STATION + stationId : chosen || ALL;
  const grouped = (group: string) => (stations.length ? { group } : {});
  const choices = [
    { value: ALL, label: t("opening.all_departments") },
    ...model.days[0]!.departments.map((d) => ({
      value: d.departmentId,
      label: names.name(d.departmentId),
      ...grouped(t("opening.show_departments")),
    })),
    ...stations.map((station) => ({
      value: STATION + station.id,
      label: station.name,
      group: t("nav.prep_stations"),
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
      if (picked.startsWith(STATION)) {
        const next = picked.slice(STATION.length);
        if (next !== stationId) onStation?.(next);
        return;
      }
      const next = picked === ALL ? "" : picked;
      if (stationId || next !== chosen) onDepartment(next);
    }}
  ></wt-combobox>`;
}
