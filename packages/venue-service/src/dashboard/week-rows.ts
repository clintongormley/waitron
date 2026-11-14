import type { LocalDate } from "../hours-types.js";
import { addDays } from "../hours-rules.js";
import type { ServiceRange } from "../service-day.js";
import type { DayBoxRow } from "./calendar-day-box.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import {
  joinPlacedRanges,
  placeOnDay,
  zoneOwnHours,
  type ZoneOwnHours,
} from "../zone-own-hours.js";
import { FIRST_MONTH, LAST_MONTH, mondayOf } from "./calendar-grid.js";
import { format } from "./hours-view.js";
import { chosenDepartment, type MonthNames } from "./opening-hours-day.js";
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

/** `model`'s days at `dates`, in that order, or undefined when the read does not hold every one. */
export function daysAt(model: OpeningHoursMonth, dates: readonly LocalDate[]): Day[] | undefined {
  const byDate = new Map(model.days.map((day) => [day.date, day] as const));
  const days = dates.map((d) => byDate.get(d));
  return days.every((day) => day !== undefined) ? days : undefined;
}

/** The week's seven days from `model`, or undefined when the read does not hold all seven. */
export function weekDays(model: OpeningHoursMonth, date: LocalDate): Day[] | undefined {
  return daysAt(model, weekDates(date));
}

export interface WeekBlock {
  kind: "open";
  periodId: string;
  /** Minutes after the day's changeover, as `placeOnDay` gives. */
  start: number;
  end: number;
  startsAt: string;
  endsAt: string;
  /** The words inside the block; "" when faded. */
  text: string;
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
  /** Period detail for the phone layout and spoken row. */
  words: string;
}

/** Each period keeps its name, colour and times in the detailed Week. */
function departmentBlocks(
  read: Day["departments"][number],
  place: ReturnType<typeof placeOnDay>,
  names: MonthNames,
): WeekBlock[] {
  return read.ranges.map((range) => {
    const text = serviceRangeText(range, names);
    return {
      kind: "open",
      periodId: range.periodId,
      ...place(range),
      text,
      faded: false,
    };
  });
}

/** `chosen` "" (or an id the day's read lacks): one row per department. A department id: it,
 *  then its zones. */
export function weekRows(day: Day, chosen: string, names: MonthNames): WeekRow[] {
  const one = chosenDepartment(day, chosen);
  const place = placeOnDay(day);
  return day.departments
    .filter((read) => !one || read.departmentId === one)
    .flatMap((read): WeekRow[] => {
      const name = names.name(read.departmentId);
      const department: WeekRow = {
        key: read.departmentId,
        name,
        zone: false,
        strong: true,
        blocks: departmentBlocks(read, place, names),
        empty: !read.ranges.length && day.closedAllDay ? t("week.closed_all_day") : "",
        words: detailedDepartmentRow(read, names).text,
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
            faded,
          };
        });

        return {
          key: zone.zoneId,
          name: zoneName,
          zone: true,
          strong: own.closed.length > 0,
          blocks: open.sort((a, b) => a.start - b.start),
          empty: "",
          words: detailedZoneRow(own, zoneName, name, names).text,
        };
      });
      return [department, ...zones];
    });
}

/** A prep station's day, its `departments` the ones that send it orders: one row per department,
 *  its blocks the times it sends, its words "No orders" when it sends none. */
export function weekStationRows(day: Day, names: MonthNames): WeekRow[] {
  const place = placeOnDay(day);
  return day.departments.map((read) => {
    const name = names.name(read.departmentId);
    const blocks = departmentBlocks(read, place, names);
    return {
      key: read.departmentId,
      name,
      zone: false,
      strong: true,
      blocks,
      empty: "",
      words: blocks.length ? blocks.map((block) => block.text).join(" · ") : t("month.no_orders"),
    };
  });
}

function detailedDepartmentRow(read: Day["departments"][number], names: MonthNames): DayBoxRow {
  return {
    name: names.name(read.departmentId),
    text: read.ranges.length
      ? read.ranges.map((range) => serviceRangeText(range, names)).join(" · ")
      : t("hours.closed"),
    strong: true,
  };
}

function detailedZoneRow(
  own: ZoneOwnHours,
  name: string,
  department: string,
  names: MonthNames,
): DayBoxRow {
  if (!own.closed.length) return { name, text: format("day.as_department", { name: department }) };
  const text = own.ranges.length
    ? [
        ...own.ranges.map((range) => serviceRangeText(range, names)),
        ...joinPlacedRanges(own.closed).map(({ startsAt, endsAt }) =>
          format("day.closed_range", { start: startsAt, end: endsAt }),
        ),
      ].join(" · ")
    : t("hours.closed");
  return { name, text, strong: true };
}

function serviceRangeText(range: ServiceRange, names: MonthNames): string {
  return format("month.range", {
    name: names.period(range.periodId).name,
    start: range.startsAt,
    end: range.endsAt,
  }).trim();
}
