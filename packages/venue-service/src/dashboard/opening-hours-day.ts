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
  seasonId: string | null;
  specialDayId: string | null;
}

/** What the day box shows for one date of a month read. `departmentId` "" lists every department,
 *  each followed by its zones; a department id lists that department and its zones. */
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
  const names = new Map<string, string>(
    departments.flatMap((d) => [
      [d.id, d.name] as const,
      ...d.zones.map((z) => [z.id, z.name] as const),
    ]),
  );
  const periods = new Map(departments.flatMap((d) => d.periods.map((p) => [p.id, p.name])));
  const list = (ranges: readonly ServiceRange[]) =>
    ranges.map((range) =>
      format("month.range", {
        name: periods.get(range.periodId) ?? "",
        start: range.startsAt,
        end: range.endsAt,
      }),
    );
  const closed = (pieces: readonly ClosedRange[]) =>
    pieces.map(({ startsAt, endsAt }) =>
      format("day.closed_range", { start: startsAt, end: endsAt }),
    );
  const rows = day.departments
    .filter((d) => !departmentId || d.departmentId === departmentId)
    .flatMap((read): DayBoxRow[] => {
      const name = names.get(read.departmentId) ?? "";
      return [
        {
          name,
          text: read.ranges.length ? list(read.ranges).join(" · ") : t("hours.closed"),
          strong: true,
        },
        ...read.zones.map((zone) => {
          const own = zoneOwnHours(read.ranges, zone.closed, day);
          const text = !own.closed.length
            ? format("day.as_department", { name })
            : !own.ranges.length
              ? t("hours.closed")
              : [...list(own.ranges), ...closed(own.closed)].join(" · ");
          return {
            name: names.get(zone.zoneId) ?? "",
            text,
          };
        }),
      ];
    });
  return {
    name: special || holiday,
    nameKind: special ? "special" : holiday ? "holiday" : "",
    line,
    rows,
    seasonId: day.seasonId,
    specialDayId: day.specialDay?.id ?? null,
  };
}
