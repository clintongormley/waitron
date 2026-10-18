import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import { readDepartmentSeasonWeeks } from "./season-weeks.js";
import type { ClosedRange } from "./service-day.js";
import { readServiceZones } from "./zone-closed-times.js";
import { closureOutsideHours } from "./zone-own-hours.js";
import "./errors.js";

/** After a season-week write, inside its transaction: each listed zone's closures against its
 *  department's week in `seasonId` as now stored. `field` is the request path up to `days.`
 *  ("" or "zones.<i>."). */
export async function assertSeasonClosuresInHours(
  tx: Transaction,
  cfg: VenueScope,
  seasonId: string,
  zones: readonly {
    zoneId: string;
    field: string;
    days: readonly { weekday: number; ranges: readonly ClosedRange[] }[];
  }[],
): Promise<void> {
  if (zones.length === 0) return;
  const clock = await readLocationClock(tx, cfg.locationId);
  const departmentOf = new Map(
    (await readServiceZones(tx, cfg)).map((zone) => [zone.id, zone.departmentId]),
  );
  const weeks = await readDepartmentSeasonWeeks(
    tx,
    cfg,
    [...new Set(zones.map((zone) => departmentOf.get(zone.zoneId)!))],
    clock.dayCutover,
  );
  const day = { dayCutover: clock.dayCutover, endMinute: 1440 };
  for (const { zoneId, field, days } of zones) {
    const week = weeks.get(departmentOf.get(zoneId)!)?.get(seasonId);
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
