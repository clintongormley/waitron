import { addDays } from "../hours-rules.js";
import { occursOn } from "../named-day-rules.js";
import type { NamedDay } from "../holiday-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { seasonOn } from "../season-rules.js";
import { seasonWeek } from "./season-choice.js";
import { formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import type { NamedCalendarAction } from "./hours-calendar.js";
export const dateInWeek = (monday: string, weekday: number) => addDays(monday, (weekday + 6) % 7);
export const namedOn = (days: readonly NamedDay[], monday: string, weekday: number) =>
  monday ? days.find((day) => occursOn(day, dateInWeek(monday, weekday))) : undefined;
export const seasonIdOn = (seasons: OpeningHoursModel["seasons"], date: string) =>
  seasonOn(seasons, date)?.id ?? "";
/** The picked season governs the standard week; in a real week each date follows its own season. */
export const seasonIdOf = (
  seasons: OpeningHoursModel["seasons"],
  seasonId: string,
  monday: string,
  weekday: number,
) => (monday ? seasonIdOn(seasons, dateInWeek(monday, weekday)) : seasonId);
type SeasonModel = Pick<OpeningHoursModel, "seasons" | "departments">;
const departmentOf = (model: SeasonModel, departmentId: string) =>
  model.departments.find((department) => department.id === departmentId);
export const seasonWeekOn = (model: SeasonModel, departmentId: string, date: string) =>
  seasonWeek(departmentOf(model, departmentId)?.seasonWeeks ?? [], seasonIdOn(model.seasons, date));
export const zoneSeasonWeekOn = (
  model: SeasonModel,
  departmentId: string,
  zoneId: string,
  date: string,
) =>
  seasonWeek(
    departmentOf(model, departmentId)?.zones.find((zone) => zone.id === zoneId)?.seasonWeeks ?? [],
    seasonIdOn(model.seasons, date),
  );
export function realDayLabel(monday: string, weekday: number, day?: NamedDay) {
  const name = t(`hours.day.${weekday}` as Parameters<typeof t>[0]);
  return monday
    ? `${name} · ${formatDate(dateInWeek(monday, weekday))}${day ? ` · ${day.name}` : ""}${day?.closeWholeVenue ? ` · ${t("hours.closed")}` : ""}`
    : name;
}
export function giveOwnHours(
  host: HTMLElement,
  monday: string,
  weekday: number,
  day: NamedDay | undefined,
  button: HTMLElement,
) {
  host.dispatchEvent(
    new CustomEvent<NamedCalendarAction>("named-calendar-action", {
      detail: {
        kind: "own",
        date: dateInWeek(monday, weekday),
        day,
        holidays: [],
        returnTo: () => (button.isConnected ? button : null),
      },
      bubbles: true,
      composed: true,
    }),
  );
}
