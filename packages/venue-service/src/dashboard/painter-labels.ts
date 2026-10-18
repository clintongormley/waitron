import { currentLocale } from "@waitron/dashboard-kit";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { format } from "./hours-view.js";
import { t } from "./strings.js";

type Model = OpeningHoursModel;
type Department = Model["departments"][number];
type Period = Department["periods"][number];

export function listOf(names: readonly string[]): string {
  return new Intl.ListFormat(currentLocale().startsWith("es") ? "es-ES" : "en-GB", {
    type: "conjunction",
  }).format(names);
}
/** The department, active or not, that `key` (`d:<id>` or `z:<id>`) belongs to, when it is still
 *  in the model. */
export function departmentOf(model: Model, key: string): Department | undefined {
  const id = key.slice(2);
  return model.departments.find((department) =>
    key.startsWith("d:") ? department.id === id : department.zones.some((zone) => zone.id === id),
  );
}
/** The periods a department lists in `previous` and no longer lists in `model`; a department gone
 *  from `model` counts none, so its edits stay for the notice that drops them. */
export function removedPeriods(previous: Model, model: Model): Set<string> {
  const removed = new Set<string>();
  for (const department of model.departments) {
    const kept = new Set(department.periods.map(({ id }) => id));
    for (const { id } of previous.departments.find((entry) => entry.id === department.id)
      ?.periods ?? [])
      if (!kept.has(id)) removed.add(id);
  }
  return removed;
}
/** What a painter says beside Save when a refresh dropped edits: of the departments and zones
 *  `gone`, by name, and of those under the `inactive` departments. Empty when it dropped none. */
export function droppedNotice(gone: readonly string[], inactive: ReadonlySet<string>): string {
  return [
    gone.length
      ? format(gone.length === 1 ? "painter.removed_one" : "painter.removed_many", {
          names: listOf(gone),
        })
      : "",
    inactive.size
      ? format(inactive.size === 1 ? "painter.inactive_one" : "painter.inactive_many", {
          names: listOf([...inactive]),
        })
      : "",
  ]
    .filter(Boolean)
    .join(" ");
}

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
  if (reason === "outside_hours") return t("opening.closed_outside");
  if (code === "zone_closed_time.invalid") return t("opening.closed_invalid");
  if (code === "menu_timetable.invalid") return t("opening.check_day");
  return t("menu.save_error");
}
