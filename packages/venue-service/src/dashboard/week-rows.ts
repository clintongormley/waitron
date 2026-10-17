import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import { placeOnDay, zoneOwnHours } from "../zone-own-hours.js";
import { FIRST_MONTH, LAST_MONTH, mondayOf } from "./calendar-grid.js";
import { format } from "./hours-view.js";
import {
  chosenDepartment,
  departmentRow,
  serviceRangeText,
  zoneRow,
  type MonthNames,
} from "./opening-hours-day.js";
import { t } from "./strings.js";

type Day = OpeningHoursMonth["days"][number];

/** Monday to Sunday of the week holding `date`. */
export function weekDates(date: LocalDate): LocalDate[] {
  const monday = mondayOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** The `YYYY-MM` of that week's Monday: the month read that holds the whole week. */
export function weekMonth(date: LocalDate): string {
  return mondayOf(date).slice(0, 7);
}

/** Whether the month read holding the week of `date` is one the calendar can show. */
export function weekInRange(date: LocalDate): boolean {
  const month = weekMonth(date);
  return month >= FIRST_MONTH && month <= LAST_MONTH;
}

/** The week's seven days from `model`, or undefined when the read does not hold all seven. */
export function weekDays(model: OpeningHoursMonth, date: LocalDate): Day[] | undefined {
  const byDate = new Map(model.days.map((day) => [day.date, day] as const));
  const days = weekDates(date).map((d) => byDate.get(d));
  return days.every((day) => day !== undefined) ? days : undefined;
}

export interface WeekBlock {
  kind: "open" | "closed";
  /** null for a closed piece. */
  periodId: string | null;
  /** Minutes after the day's changeover, as `placeOnDay` gives. */
  start: number;
  end: number;
  startsAt: string;
  endsAt: string;
  /** The words inside the block; "" when faded. */
  text: string;
  /** The tooltip's words, "Terrace · Dinner 22:00–23:00". */
  label: string;
  /** A zone piece that only follows its department. */
  faded: boolean;
}

export interface WeekRow {
  key: string;
  name: string;
  zone: boolean;
  /** As `DayBoxRow.strong`: a department, or a zone with hours of its own. */
  strong: boolean;
  blocks: WeekBlock[];
  /** The words inside an empty track: "Closed all day" or "". */
  empty: string;
  /** The day box's words for the same row. */
  words: string;
}

/** `chosen` "" (or an id the day's read lacks): one row per department. A department id: it,
 *  then its zones. */
export function weekRows(day: Day, chosen: string, names: MonthNames): WeekRow[] {
  const one = chosenDepartment(day, chosen);
  const place = placeOnDay(day);
  const label = (name: string, text: string) => format("week.block_label", { name, text });
  return day.departments
    .filter((read) => !one || read.departmentId === one)
    .flatMap((read): WeekRow[] => {
      const name = names.name(read.departmentId);
      const department: WeekRow = {
        key: read.departmentId,
        name,
        zone: false,
        strong: true,
        blocks: read.ranges.map((range) => {
          const text = serviceRangeText(range, names);
          return {
            kind: "open",
            periodId: range.periodId,
            ...place(range),
            text,
            label: label(name, text),
            faded: false,
          };
        }),
        empty: !read.ranges.length && day.closedAllDay ? t("week.closed_all_day") : "",
        words: departmentRow(read, names).text,
      };
      if (!one) return [department];
      const zones = read.zones.map((zone): WeekRow => {
        const zoneName = names.name(zone.zoneId);
        const own = zoneOwnHours(read.ranges, zone.closed, day);
        const open = own.ranges.map((piece): WeekBlock => {
          const text = serviceRangeText(piece, names);
          const faded = read.ranges.some(
            (range) =>
              range.periodId === piece.periodId &&
              range.startsAt === piece.startsAt &&
              range.endsAt === piece.endsAt,
          );
          return {
            kind: "open",
            periodId: piece.periodId,
            start: piece.start,
            end: piece.end,
            startsAt: piece.startsAt,
            endsAt: piece.endsAt,
            text: faded ? "" : text,
            label: label(zoneName, text),
            faded,
          };
        });
        const closed = own.ranges.length
          ? own.closed.map((piece): WeekBlock => {
              const text = format("week.closed_range", {
                start: piece.startsAt,
                end: piece.endsAt,
              });
              return {
                kind: "closed",
                periodId: null,
                start: piece.start,
                end: piece.end,
                startsAt: piece.startsAt,
                endsAt: piece.endsAt,
                text,
                label: label(zoneName, text),
                faded: false,
              };
            })
          : [];
        return {
          key: zone.zoneId,
          name: zoneName,
          zone: true,
          strong: own.closed.length > 0,
          blocks: [...open, ...closed].sort((a, b) => a.start - b.start),
          empty: "",
          words: zoneRow(own, zoneName, name, names).text,
        };
      });
      return [department, ...zones];
    });
}
