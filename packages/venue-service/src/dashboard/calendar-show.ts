import { html, type TemplateResult } from "lit";
import "@waitron/ui/src/components/wt-combobox.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { MonthNames } from "./opening-hours-day.js";
import { t } from "./strings.js";

const ALL = "all";

/** The Show picker the Month and the Week share. */
export function showPicker(options: {
  model: OpeningHoursMonth;
  chosen: string;
  names: MonthNames;
  onDepartment: (departmentId: string) => void;
}): TemplateResult {
  const { model, chosen, names, onDepartment } = options;
  const value = chosen || ALL;
  const choices = [
    { value: ALL, label: t("opening.all_departments") },
    ...model.days[0]!.departments.map((d) => ({
      value: d.departmentId,
      label: names.name(d.departmentId),
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
      const next = event.detail.value === ALL ? "" : event.detail.value;
      if (next !== chosen) onDepartment(next);
    }}
  ></wt-combobox>`;
}
