import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { readBusinessDayScheduleStatus } from "./business-day-schedule.js";
import type { HolidayCoverage, SpecialDaysModel } from "./holiday-types.js";
import { readHolidayAreaModel, readHolidays } from "./holidays.js";
import { venueLocalMoment } from "./hours-clock.js";
import { addDays, rangeDates } from "./hours-rules.js";
import type { CalendarTone, HolidayFact, LocalDate } from "./hours-types.js";
import { calendarDays } from "./hours.js";
import { holidayAreaSummary } from "./named-days.js";
import type { VenueScope } from "./operations.js";
import type { Season } from "./season-rules.js";
import { readSeasons } from "./seasons.js";
import type { BusinessDayScheduleStatus } from "./service-day-context.js";
import { missingHolidaysIn } from "./special-days.js";

export interface OpeningHoursYearDay {
  date: LocalDate;
  seasonId: string | null;
  specialDay: { id: string; name: string } | null;
  holidays: readonly HolidayFact[];
  tone: CalendarTone;
  /** The Closed tick, or every active department closed all day. */
  closed: boolean;
}

export interface OpeningHoursYear extends BusinessDayScheduleStatus {
  year: number;
  timeZone: string;
  today: LocalDate | null;
  seasons: readonly (Season & { lastDay: string })[];
  days: readonly OpeningHoursYearDay[];
  /** False when the official list for `year` has not shipped. */
  publicHolidaysAvailable: boolean;
  /** Each repeating date following a holiday's name that `year`'s list places nowhere. */
  missingHolidays: readonly { specialDayId: string; name: string; holidayName: string }[];
  holidayCoverage: readonly HolidayCoverage[];
  area: SpecialDaysModel["area"];
}

/** The MM-DD before the next season's start in `year`, so 02-29 in a leap year; `seasons` sorted by start. */
function lastDayIn(year: string, seasons: readonly Season[], startsOn: string): string {
  const next = seasons.find((season) => season.startsOn > startsOn) ?? seasons[0]!;
  return addDays(`${year}-${next.startsOn}`, -1).slice(5);
}

export async function readOpeningHoursYear(
  tx: Transaction,
  cfg: VenueScope,
  year: number,
  at: Date,
): Promise<OpeningHoursYear> {
  const yearText = String(year).padStart(4, "0");
  const dates = rangeDates(`${yearText}-01-01`, `${yearText}-12-31`);
  const clock = await readLocationClock(tx, cfg.locationId);
  const status = await readBusinessDayScheduleStatus(tx, cfg, clock, at);
  const holidays = await readHolidays(tx, cfg, dates[0]!, dates.at(-1)!);
  const area = await readHolidayAreaModel(tx, cfg);
  const seasons = await readSeasons(tx, cfg);
  const { days, seasonIdOn } = await calendarDays(tx, cfg, dates, holidays.facts, clock);
  const missing = await missingHolidaysIn(tx, cfg, [year]);
  return {
    ...status,
    year,
    timeZone: clock.timeZone,
    today: venueLocalMoment(at, clock)?.civilDate ?? null,
    seasons: seasons.map((season) => ({
      ...season,
      lastDay: lastDayIn(yearText, seasons, season.startsOn),
    })),
    days: days.map(({ date, specialDay, holidays: facts, tone, closed }) => ({
      date,
      seasonId: seasonIdOn.get(date) ?? null,
      specialDay,
      holidays: facts,
      tone,
      closed,
    })),
    publicHolidaysAvailable: !holidays.coverage.some(
      (coverage) => coverage.year === year && coverage.nationalRegional === "missing_year",
    ),
    missingHolidays: missing.map(({ specialDayId, name, holidayName }) => ({
      specialDayId,
      name,
      holidayName,
    })),
    holidayCoverage: holidays.coverage,
    area: holidayAreaSummary(area),
  };
}
