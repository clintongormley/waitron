import { readBusinessDayScheduleStatus } from "./business-day-schedule.js";
import { cutoverForBusinessDay } from "@waitron/shared";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { venueLocalMoment } from "./hours-clock.js";
import { readCalendarDays, type HolidayReader } from "./hours.js";
import { readHolidays, readHolidayAreaModel } from "./holidays.js";
import type { SpecialDaysModel } from "./holiday-types.js";
export type { SpecialDaysModel } from "./holiday-types.js";
import { holidayCityKey } from "./holiday-rules.js";
import type { LocalDate } from "./hours-types.js";
import type { VenueScope } from "./operations.js";

export async function readSpecialDaysModel(
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
  at: Date,
  holidays?: HolidayReader,
): Promise<SpecialDaysModel> {
  const clock = await readLocationClock(tx, cfg.locationId);
  const civilDate = venueLocalMoment(at, clock)?.civilDate ?? null;
  const status = await readBusinessDayScheduleStatus(tx, cfg, clock, at);
  const read = await readHolidays(tx, cfg, from, to);
  const area = await readHolidayAreaModel(tx, cfg);
  return {
    ...status,
    timeZone: clock.timeZone,
    dayCutover:
      status.currentBusinessDay === null
        ? clock.dayCutover
        : cutoverForBusinessDay(clock, status.currentBusinessDay),
    civilDate,
    clockReadable: civilDate !== null,
    days: await readCalendarDays(tx, cfg, from, to, holidays ?? (async () => read.facts)),
    holidayCoverage: read.coverage,
    holidaySources: read.sources,
    area: {
      readiness: area.readiness,
      addressKey: JSON.stringify([
        area.venue.country,
        area.venue.provinceCode,
        holidayCityKey(area.venue.city ?? ""),
      ]),
      options: area.areaOptions,
      required: area.areaRequired,
      chosen: area.chosen,
    },
    localHolidaysPerYear: area.localHolidaysPerYear,
  };
}
