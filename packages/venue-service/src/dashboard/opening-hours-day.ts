import { holidayDateName } from "../holiday-naming.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { ServiceRange } from "../service-day.js";
import { zoneOwnHours, type ZoneOwnHours } from "../zone-own-hours.js";
import type { DayBoxRow } from "./calendar-day-box.js";
import { chosenDepartment } from "./calendar-show.js";
import { format } from "./hours-view.js";
import type { MonthDepartment } from "./opening-hours-month.js";
import { t } from "./strings.js";

type Day = OpeningHoursMonth["days"][number];

export interface OpeningHoursDay {
  name: string;
  nameKind: "special" | "holiday" | "";
  line: string;
  rows: DayBoxRow[];
}

/** Names for the read's ids, from the host's department list; an id the list lacks reads "". */
export interface MonthNames {
  name(id: string): string;
  period(id: string): { name: string; colour?: string };
}

export function monthNames(departments: readonly MonthDepartment[]): MonthNames {
  const named = new Map<string, string>(
    departments.flatMap((d) => [
      [d.id, d.name] as const,
      ...d.zones.map((z) => [z.id, z.name] as const),
    ]),
  );
  const periods = new Map(departments.flatMap((d) => d.periods.map((p) => [p.id, p] as const)));
  return {
    name: (id) => named.get(id) ?? "",
    period: (id) => periods.get(id) ?? { name: "" },
  };
}

export interface DayNameLine {
  name: string;
  kind: OpeningHoursDay["nameKind"];
}

/** A date's names as the Month and the Week write them: its special day's, left out when it is the
 *  holiday's, then its holiday's. */
export function dayNameLines(day: Day): DayNameLine[] {
  const holiday = holidayDateName(day.holidays, day.date, "");
  const special = day.specialDay?.name ?? "";
  return [
    ...(special && special !== holiday ? [{ name: special, kind: "special" as const }] : []),
    ...(holiday ? [{ name: holiday, kind: "holiday" as const }] : []),
  ];
}

/** What the day box shows for one date of a month read. `departmentId` "", or one the date's read
 *  does not carry, lists every department, each followed by its zones; a department id the read
 *  carries lists that department and its zones. */
export function openingHoursDay(
  day: Day,
  seasons: OpeningHoursMonth["seasons"],
  departments: readonly MonthDepartment[],
  departmentId: string,
): OpeningHoursDay {
  const holiday = holidayDateName(day.holidays, day.date, "");
  const special = day.specialDay?.name ?? "";
  const season = seasons.find(({ id }) => id === day.seasonId)?.name;
  const line = day.specialDay
    ? season
      ? format("day.replaces", { season })
      : t("calendar.special_day")
    : season
      ? format("day.standard", { season })
      : "";
  const names = monthNames(departments);
  const chosen = chosenDepartment(day, departmentId);
  const rows = day.departments
    .filter((d) => !chosen || d.departmentId === chosen)
    .flatMap((read) => {
      const department = departmentRow(read, names);
      return [
        department,
        ...read.zones.map((zone) =>
          zoneRow(
            zoneOwnHours(read.ranges, zone.closed, day),
            names.name(zone.zoneId),
            department.name,
            names,
          ),
        ),
      ];
    });
  return {
    name: special || holiday,
    nameKind: special ? "special" : holiday ? "holiday" : "",
    line,
    rows,
  };
}

/** The day box's row for a department of a date's read. */
export function departmentRow(read: Day["departments"][number], names: MonthNames): DayBoxRow {
  return {
    name: names.name(read.departmentId),
    text: read.ranges.length
      ? read.ranges.map((range) => serviceRangeText(range, names)).join(" · ")
      : t("hours.closed"),
    strong: true,
  };
}

/** The day box's row for the zone `name` of the department named `department`, from the zone's
 *  own hours. */
export function zoneRow(
  own: ZoneOwnHours,
  name: string,
  department: string,
  names: MonthNames,
): DayBoxRow {
  if (!own.closed.length) return { name, text: format("day.as_department", { name: department }) };
  const text = own.ranges.length
    ? [
        ...own.ranges.map((range) => serviceRangeText(range, names)),
        ...own.closed.map(({ startsAt, endsAt }) =>
          format("day.closed_range", { start: startsAt, end: endsAt }),
        ),
      ].join(" · ")
    : t("hours.closed");
  return { name, text, strong: true };
}

/** A range in words, "Dinner 20:00–23:00". */
export function serviceRangeText(range: ServiceRange, names: MonthNames): string {
  return format("month.range", {
    name: names.period(range.periodId).name,
    start: range.startsAt,
    end: range.endsAt,
  }).trim();
}
