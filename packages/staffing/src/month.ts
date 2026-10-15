import type { Transaction } from "@waitron/db";
import { cutoverForBusinessDay, locationId } from "@waitron/shared";
import { readCalendarMonthPlan } from "@waitron/venue-service";
import { listStaffingAreas, resolveStaffing } from "./paint.js";
import { areaKey, slotsForDay, placeShift, matchAreaDay } from "./slots.js";
import { mondayOf, readRotaRows } from "./rota-data.js";
import type { StaffingMonth } from "./staffing-types.js";

/** `month` is a `YYYY-MM` the caller has checked; `at` decides `today`. */
export async function readStaffingMonth(
  tx: Transaction,
  cfg: { locationId: string },
  month: string,
  at: Date,
): Promise<StaffingMonth> {
  const frame = await readCalendarMonthPlan(
    tx,
    { locationId: locationId(cfg.locationId) },
    month,
    at,
  );
  const areas = await listStaffingAreas(tx, cfg);
  const resolved = await resolveStaffing(
    tx,
    cfg,
    frame.days.map((day) => day.date),
    { plan: frame.plan, areas, cutover: frame.clock.dayCutover },
  );
  const first = frame.days[0]!.date;
  const last = mondayOf(frame.days.at(-1)!.date);
  const rota = await readRotaRows(tx, cfg, first, last);
  const placed = new Map(
    [...rota.byWeek].map(([week, rows]) => [
      week,
      rows.map((row) => placeShift(row, (day) => cutoverForBusinessDay(frame.clock, day))),
    ]),
  );
  return {
    month,
    today: frame.today,
    areas,
    seasons: frame.seasons.map(({ id, name, startsOn, lastDay }) => ({
      id,
      name,
      startsOn,
      lastDay,
    })),
    days: frame.days.map((day) => {
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
          const week = mondayOf(day.date);
          const unfilled = rota.selected.has(week)
            ? matchAreaDay(
                slotsForDay(day.date, area, blocks, day.dayCutover),
                (placed.get(week) ?? []).filter(
                  (s) =>
                    s.businessDay === day.date &&
                    s.area !== null &&
                    areaKey(s.area) === areaKey(area),
                ),
                () => true,
              ).slots.filter((s) => s.status.kind === "unfilled").length
            : null;
          return [{ area, needed, unfilled }];
        }),
      };
    }),
  };
}
