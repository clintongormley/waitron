import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

type Model = OpeningHoursModel;
type Period = Model["departments"][number]["periods"][number];

/** The name of the department (`d:<id>`) or zone (`z:<id>`) a painter's key stands for. */
export function ownerName(model: Model, key: string): string {
  const id = key.slice(2);
  if (key.startsWith("d:")) return model.departments.find((entry) => entry.id === id)?.name ?? "";
  return (
    model.departments.flatMap(({ zones }) => zones).find((entry) => entry.id === id)?.name ?? ""
  );
}

export function refusalReason(code: string, reason: unknown, period: Period | undefined): string {
  if (reason === "end_offset")
    return period
      ? format("menu.offset_timetable_named", { period: period.name })
      : t("menu.offset_timetable");
  if (reason === "clock_skips") return t("menu.time_skipped");
  if (code === "zone_closed_time.invalid") return t("opening.closed_invalid");
  if (code === "menu_timetable.invalid") return t("opening.check_day");
  return t("menu.save_error");
}
