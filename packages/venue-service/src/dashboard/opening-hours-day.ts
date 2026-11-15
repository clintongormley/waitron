import { currentLocale } from "@waitron/dashboard-kit";
import { holidayDateName } from "../holiday-naming.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { ClosedRange } from "../service-day.js";
import { joinPlacedRanges, placeOnDay, zoneOwnHours, type Placed } from "../zone-own-hours.js";
import type { DayBoxRow } from "./calendar-day-box.js";
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
  station(id: string): boolean;
  stationHeading(id: string): string;
  stationGroup(id: string): string;
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
    station: (id) => departments.some((d) => d.id === id && d.station),
    stationHeading: (id) => departments.find((d) => d.id === id)?.stationHeading ?? "",
    stationGroup: (id) => departments.find((d) => d.id === id)?.stationGroup ?? "",
    period: (id) => periods.get(id) ?? { name: "" },
  };
}

/** `departmentId` when `day`'s read carries it, else "" for every department. */
export function chosenDepartment(day: Day, departmentId: string): string {
  return day.departments.some((d) => d.departmentId === departmentId) ? departmentId : "";
}

export interface DayNameLine {
  name: string;
  kind: OpeningHoursDay["nameKind"];
}

/** A date's names as the Month and the Week write them: its special day's, left out when it is the
 *  holiday's, then its holiday's. */
export function dayNameLines(day: Day): DayNameLine[] {
  const holiday = holidayDateName(day.holidays, day.date, "", currentLocale());
  const special = day.specialDay?.name ?? "";
  const holidayNames = new Set([
    holidayDateName(day.holidays, day.date, ""),
    holidayDateName(day.holidays, day.date, "", "en"),
  ]);
  return [
    ...(special && !holidayNames.has(special) ? [{ name: special, kind: "special" as const }] : []),
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
  const holiday = holidayDateName(day.holidays, day.date, "", currentLocale());
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
      const department = {
        name: names.name(read.departmentId),
        text: openHoursText(read.ranges.map(placeOnDay(day))),
        strong: true,
      };
      return [
        department,
        ...read.zones.map((zone) => {
          const own = zoneOwnHours(read.ranges, zone.closed, day);
          return {
            name: names.name(zone.zoneId),
            text: openHoursText(own.ranges),
            ...(own.closed.length ? { strong: true } : { inheritedFrom: department.name }),
          };
        }),
      ];
    });
  return {
    name: special || holiday,
    nameKind: special ? "special" : holiday ? "holiday" : "",
    line,
    rows,
  };
}

export function openHoursText(ranges: readonly (ClosedRange & Placed)[]): string {
  const joined = joinPlacedRanges(ranges);
  return joined.length
    ? joined
        .map(({ startsAt, endsAt }) => format("day.open_range", { start: startsAt, end: endsAt }))
        .join(", ")
    : t("hours.closed");
}
