import { holidayDateName } from "../holiday-naming.js";
import type { OpeningHoursMonth } from "../opening-hours-calendar.js";
import type { ClosedRange, ServiceRange } from "../service-day.js";
import { zoneOwnHours } from "../zone-own-hours.js";
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
  const list = (ranges: readonly ServiceRange[]) =>
    ranges.map((range) =>
      format("month.range", {
        name: names.period(range.periodId).name,
        start: range.startsAt,
        end: range.endsAt,
      }).trim(),
    );
  const closed = (pieces: readonly ClosedRange[]) =>
    pieces.map(({ startsAt, endsAt }) =>
      format("day.closed_range", { start: startsAt, end: endsAt }),
    );
  const chosen = day.departments.some((d) => d.departmentId === departmentId) ? departmentId : "";
  const rows = day.departments
    .filter((d) => !chosen || d.departmentId === chosen)
    .flatMap((read): DayBoxRow[] => {
      const name = names.name(read.departmentId);
      return [
        {
          name,
          text: read.ranges.length ? list(read.ranges).join(" · ") : t("hours.closed"),
          strong: true,
        },
        ...read.zones.map((zone) => {
          const own = zoneOwnHours(read.ranges, zone.closed, day);
          const row = { name: names.name(zone.zoneId) };
          if (!own.closed.length) return { ...row, text: format("day.as_department", { name }) };
          const text = own.ranges.length
            ? [...list(own.ranges), ...closed(own.closed)].join(" · ")
            : t("hours.closed");
          return { ...row, text, strong: true };
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
