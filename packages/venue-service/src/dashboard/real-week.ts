import { html } from "lit";
import { addDays } from "../hours-rules.js";
import type { SpecialDaysModel } from "../holiday-types.js";
import type { OpeningHoursModel } from "../menu-timetable-types.js";
import { seasonOn } from "../season-rules.js";
import type { SpecialDayDetail } from "../special-days.js";
import { formatDate } from "./hours-view.js";
import { specialOn, type DatedSpecial } from "./special-date.js";
import { t } from "./strings.js";
export const dateInWeek = (monday: string, weekday: number) => addDays(monday, (weekday + 6) % 7);
export const seasonIdOn = (seasons: OpeningHoursModel["seasons"], date: string) =>
  seasonOn(seasons, date)?.id ?? "";
/** The picked season governs the standard week; in a real week each date follows its own season. */
export const seasonIdOf = (
  seasons: OpeningHoursModel["seasons"],
  seasonId: string,
  monday: string,
  weekday: number,
) => (monday ? seasonIdOn(seasons, dateInWeek(monday, weekday)) : seasonId);
/** What a real week shows on a date: the calendar's name and closure, and the special day's paint
 *  once its detail has been read. */
export interface DateFacts {
  name?: string;
  closed: boolean;
  special?: DatedSpecial;
}
export function dateFacts(
  calendar: SpecialDaysModel | undefined,
  specials: ReadonlyMap<string, SpecialDayDetail>,
  date: string,
): DateFacts {
  const day = calendar?.days?.find((row) => row.date === date);
  return {
    name: day?.specialDay?.name,
    closed: !!day?.closed,
    special: day?.specialDay ? specialOn(day, specials.get(day.specialDay.id), date) : undefined,
  };
}
export function realDayLabel(monday: string, weekday: number, facts?: DateFacts) {
  const name = t(`hours.day.${weekday}` as Parameters<typeof t>[0]);
  return monday
    ? `${name} · ${formatDate(dateInWeek(monday, weekday))}${facts?.name ? ` · ${facts.name}` : ""}${facts?.closed ? ` · ${t("hours.closed")}` : ""}`
    : name;
}
export const dayLink = (host: HTMLElement, date: string) =>
  html`<a
    data-test="day-link"
    href=${`/manage/opening-hours/view/day/date/${date}`}
    @click=${(event: MouseEvent) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
        return;
      event.preventDefault();
      event.stopPropagation();
      if (host.isConnected)
        host.dispatchEvent(
          new CustomEvent("day-open", { detail: { date }, bubbles: true, composed: true }),
        );
    }}
    >${t("opening.open_day")}</a
  >`;
