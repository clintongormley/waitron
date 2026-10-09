import { addDays } from "../hours-rules.js";
import { occursOn } from "../named-day-rules.js";
import type { NamedDay } from "../holiday-types.js";
import { formatDate } from "./hours-view.js";
import { t } from "./strings.js";
import type { NamedCalendarAction } from "./hours-calendar.js";
export const dateInWeek = (monday: string, weekday: number) => addDays(monday, (weekday + 6) % 7);
export const namedOn = (days: readonly NamedDay[], monday: string, weekday: number) =>
  monday ? days.find((day) => occursOn(day, dateInWeek(monday, weekday))) : undefined;
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
