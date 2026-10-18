import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import { resolveDepartmentsDays } from "./day-resolver.js";
import type { LocalDate } from "./hours-types.js";
import type { ClosedWeekDay } from "./menu-timetable-types.js";
import type { VenueScope } from "./operations.js";
import { readDepartmentSeasonWeeks, type ServingRead } from "./season-weeks.js";
import { inForceClock, serviceDayContext } from "./service-day-context.js";
import { readServiceZones } from "./zone-closed-times.js";
import { closureOutsideHours } from "./zone-own-hours.js";
import "./errors.js";

/** The department `departmentOf` gives a zone, refusing a zone it does not hold. */
function departmentIn(departmentOf: ReadonlyMap<string, string>) {
  return (zoneId: string) => {
    const id = departmentOf.get(zoneId);
    if (id === undefined) throw new AppError("service_zone.not_found", { zoneId });
    return id;
  };
}

/** After a season-week write, inside its transaction: each listed zone's closures against its
 *  department's week in `seasonId` as now stored, read from the start in force at `at`. `field`
 *  is the request path up to `days.` ("" or "zones.<i>."). Without `read`, the clock and the
 *  zones are read here. */
export async function assertSeasonClosuresInHours(
  tx: Transaction,
  cfg: VenueScope,
  seasonId: string,
  zones: readonly { zoneId: string; field: string; days: readonly ClosedWeekDay[] }[],
  at: Date,
  read?: ServingRead,
): Promise<void> {
  if (zones.length === 0) return;
  const { clock, departmentOf } = read ?? {
    clock: await readLocationClock(tx, cfg.locationId),
    departmentOf: new Map(
      (await readServiceZones(tx, cfg)).map((zone) => [zone.id, zone.departmentId]),
    ),
  };
  const department = departmentIn(departmentOf);
  const { dayCutover } = inForceClock(clock, at);
  const weeks = await readDepartmentSeasonWeeks(
    tx,
    cfg,
    [...new Set(zones.map((zone) => department(zone.zoneId)))],
    dayCutover,
  );
  const day = { dayCutover, endMinute: 1440 };
  for (const { zoneId, field, days } of zones) {
    const week = weeks.get(department(zoneId))?.get(seasonId);
    for (const [j, { weekday, ranges }] of days.entries()) {
      const k = closureOutsideHours(week?.[weekday] ?? [], ranges, day);
      if (k !== -1)
        throw new AppError("zone_closed_time.invalid", {
          field: `${field}days.${j}.ranges.${k}`,
          reason: "outside_hours",
          zoneId,
          weekday,
        });
    }
  }
}

/** After a special-day write, inside its transaction: each sent zone entry's closed ranges
 *  against its department's resolved day on that date, with the clock and departments the write
 *  read. Dates `closedAllDay` names are skipped. A zone id is read in lower case, as
 *  `saveSpecialDay` stores it. */
export async function assertDatedClosuresInHours(
  tx: Transaction,
  cfg: VenueScope,
  zonePaint: readonly {
    zoneId: string;
    date: LocalDate;
    ranges: readonly { kind: string; startsAt: string; endsAt: string }[];
  }[],
  closedAllDay: ReadonlySet<LocalDate>,
  { clock, departmentOf }: ServingRead,
): Promise<void> {
  const checked = [...zonePaint.entries()]
    .filter(([, entry]) => !closedAllDay.has(entry.date))
    .map(([i, entry]) => [i, { ...entry, zoneId: entry.zoneId.toLowerCase() }] as const);
  if (checked.length === 0) return;
  const department = departmentIn(departmentOf);
  const resolved = await resolveDepartmentsDays(
    tx,
    cfg,
    [...new Set(checked.map(([, entry]) => department(entry.zoneId)))],
    [...new Set(checked.map(([, entry]) => entry.date))],
    clock,
  );
  for (const [i, { zoneId, date, ranges }] of checked) {
    const closed = [...ranges.entries()].filter(([, range]) => range.kind === "closed");
    const hours = resolved.get(department(zoneId))?.get(date)?.ranges ?? [];
    const j = closureOutsideHours(
      hours,
      closed.map(([, range]) => range),
      serviceDayContext(clock, date),
    );
    if (j !== -1)
      throw new AppError("special_day.invalid", {
        field: `zonePaint.${i}.ranges.${closed[j]![0]}`,
        reason: "outside_hours",
        zoneId,
        date,
      });
  }
}
