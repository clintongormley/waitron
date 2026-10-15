import type { Transaction } from "@waitron/db";
import { locationId } from "@waitron/shared";
import { readOpeningHoursMonth } from "@waitron/venue-service";
import { listStaffingAreas, resolveStaffing } from "./paint.js";
import { areaKey, slotsForDay } from "./slots.js";
import type { StaffingMonth } from "./staffing-types.js";

/** `month` is a `YYYY-MM` the caller has checked; `at` decides `today`. */
export async function readStaffingMonth(
  tx: Transaction,
  cfg: { locationId: string },
  month: string,
  at: Date,
): Promise<StaffingMonth> {
  const hours = await readOpeningHoursMonth(
    tx,
    { locationId: locationId(cfg.locationId) },
    month,
    at,
  );
  const areas = await listStaffingAreas(tx, cfg);
  const resolved = await resolveStaffing(
    tx,
    cfg,
    hours.days.map((day) => day.date),
  );
  return {
    month,
    today: hours.today,
    seasons: hours.seasons.map(({ id, name, startsOn, lastDay }) => ({
      id,
      name,
      startsOn,
      lastDay,
    })),
    days: hours.days.map((day) => {
      const byArea = resolved.get(day.date)!;
      return {
        date: day.date,
        inMonth: day.inMonth,
        seasonId: day.seasonId,
        specialDay: day.specialDay,
        closedAllDay: day.closedAllDay,
        areas: areas.flatMap(({ area }) => {
          const blocks = byArea.get(areaKey(area));
          if (blocks === undefined) return [];
          const needed = slotsForDay(day.date, area, blocks, day.dayCutover).length;
          return [{ area, needed, unfilled: null }];
        }),
      };
    }),
  };
}
