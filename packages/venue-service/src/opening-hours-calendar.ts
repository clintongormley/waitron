import type { Transaction } from "@waitron/db";
import type { BusinessDayClock } from "@waitron/shared";
import {
  readLocationClock,
  readLocationClockAndPlace,
  type LocationPlace,
} from "@waitron/reporting";
import { readBusinessDayScheduleStatus } from "./business-day-schedule.js";
import {
  readDayPlan,
  resolveDepartmentsDays,
  resolveZoneClosedDays,
  type DayPlan,
} from "./day-resolver.js";
import type { HolidayCoverage, SpecialDaysModel } from "./holiday-types.js";
import { readHolidayFacts, readHolidayYear } from "./holidays.js";
import { isReadableZone, venueLocalMoment } from "./hours-clock.js";
import { addDays, rangeDates, weekdayOf } from "./hours-rules.js";
import type { CalendarTone, HolidayFact, LocalDate } from "./hours-types.js";
import { calendarDays } from "./hours.js";
import { readActiveDepartments } from "./menu-timetable.js";
import { holidayAreaSummary } from "./named-days.js";
import type { VenueScope } from "./operations.js";
import { seasonOn, type Season } from "./season-rules.js";
import { readSeasons } from "./seasons.js";
import type { ClosedRange, ServiceRange } from "./service-day.js";
import { serviceDayWallContext, type BusinessDayScheduleStatus } from "./service-day-context.js";
import { missingHolidaysIn } from "./special-days.js";
import { readServiceZones } from "./zone-closed-times.js";

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
  const { read: holidays, area, dates: holidayDates } = await readHolidayYear(tx, cfg, year);
  const seasons = await readSeasons(tx, cfg);
  const { days, seasonIdOn } = await calendarDays(tx, cfg, dates, holidays.facts, clock, seasons);
  const missing = await missingHolidaysIn(tx, cfg, [year], holidayDates);
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

export interface OpeningHoursMonth extends BusinessDayScheduleStatus {
  month: string;
  today: LocalDate | null;
  /** The seasons the returned dates touch, in the order they are first touched. */
  seasons: readonly (Season & { lastDay: string })[];
  /** The whole Monday-to-Sunday weeks that cover `month`. */
  days: readonly {
    date: LocalDate;
    inMonth: boolean;
    /** The business day's own changeover, and its length in minutes up to the next day's. */
    dayCutover: string;
    endMinute: number;
    seasonId: string | null;
    specialDay: { id: string; name: string } | null;
    holidays: readonly HolidayFact[];
    closedAllDay: boolean;
    departments: readonly {
      departmentId: string;
      ranges: readonly ServiceRange[];
      zones: readonly { zoneId: string; closed: readonly ClosedRange[] }[];
    }[];
  }[];
}

/** The MM-DD before the start that next follows `date` in `season`'s occurrence holding it. */
function lastDayAfter(date: LocalDate, sorted: readonly Season[], season: Season): string {
  const next = sorted.find((other) => other.startsOn > season.startsOn) ?? sorted[0]!;
  const year = Number(date.slice(0, 4));
  let start = `${String(year).padStart(4, "0")}-${next.startsOn}`;
  if (start <= date) start = `${String(year + 1).padStart(4, "0")}-${next.startsOn}`;
  return addDays(start, -1).slice(5);
}

/** What a month of the calendar stands on before any hours: its dates, seasons and special days. */
export interface CalendarMonthPlan {
  month: string;
  today: LocalDate | null;
  /** The seasons the returned dates touch, in the order they are first touched. */
  seasons: readonly (Season & { lastDay: string })[];
  /** As stored. */
  clock: BusinessDayClock;
  /** `clock`, with a zone this runtime cannot place read as UTC, as the days' changeovers are. */
  wallClock: BusinessDayClock;
  place: LocationPlace;
  plan: DayPlan;
  /** The whole Monday-to-Sunday weeks that cover `month`. */
  days: readonly {
    date: LocalDate;
    inMonth: boolean;
    /** The business day's own changeover, and its length in minutes up to the next day's. */
    dayCutover: string;
    endMinute: number;
    seasonId: string | null;
    specialDay: { id: string; name: string } | null;
    closedAllDay: boolean;
  }[];
}

const wallClock = (stored: BusinessDayClock): BusinessDayClock =>
  isReadableZone(stored.timeZone) ? stored : { ...stored, timeZone: "UTC" };

/** `month` is a `YYYY-MM` the caller has checked. */
export async function readCalendarMonthPlan(
  tx: Transaction,
  cfg: VenueScope,
  month: string,
  at: Date,
): Promise<CalendarMonthPlan> {
  const first = `${month}-01`;
  const last = addDays(addDays(first, 32).slice(0, 7) + "-01", -1);
  const from = addDays(first, -((weekdayOf(first) + 6) % 7));
  const to = addDays(last, (7 - weekdayOf(last)) % 7);
  const dates = rangeDates(from, to);
  const { clock: stored, place } = await readLocationClockAndPlace(tx, cfg.locationId);
  const clock = wallClock(stored);
  const seasons = await readSeasons(tx, cfg);
  const plan = await readDayPlan(tx, cfg, dates, seasons, place);
  const touched = new Map<string, Season & { lastDay: string }>();
  for (const date of dates) {
    const season = seasons.find(({ id }) => id === plan.seasonIdOn.get(date));
    if (season !== undefined && !touched.has(season.id))
      touched.set(season.id, { ...season, lastDay: lastDayAfter(date, seasons, season) });
  }
  return {
    month,
    today: venueLocalMoment(at, stored)?.civilDate ?? null,
    seasons: [...touched.values()],
    clock: stored,
    wallClock: clock,
    place,
    plan,
    days: dates.map((date) => {
      const special = plan.special.get(date) ?? null;
      return {
        date,
        inMonth: date.startsWith(month),
        ...serviceDayWallContext(clock, date),
        seasonId: plan.seasonIdOn.get(date) ?? null,
        specialDay: special === null ? null : { id: special.specialDayId, name: special.name },
        closedAllDay: special?.closedAllDay ?? false,
      };
    }),
  };
}

/** `month` is a `YYYY-MM` the caller has checked. */
export async function readOpeningHoursMonth(
  tx: Transaction,
  cfg: VenueScope,
  month: string,
  at: Date,
): Promise<OpeningHoursMonth> {
  const frame = await readCalendarMonthPlan(tx, cfg, month, at);
  const { plan, wallClock: clock } = frame;
  const dates = frame.days.map(({ date }) => date);
  const status = await readBusinessDayScheduleStatus(tx, cfg, frame.clock, at);
  const departments = await readActiveDepartments(tx, cfg);
  const zones = await readServiceZones(tx, cfg);
  const hours = await resolveDepartmentsDays(
    tx,
    cfg,
    departments.map(({ id }) => id),
    dates,
    clock,
    plan,
  );
  const closures = await resolveZoneClosedDays(
    tx,
    cfg,
    zones.map(({ id }) => id),
    dates,
    clock,
    plan,
  );
  const factsOn = new Map<LocalDate, HolidayFact[]>();
  for (const fact of await readHolidayFacts(tx, cfg, dates[0]!, dates.at(-1)!, frame.place))
    factsOn.set(fact.date, [...(factsOn.get(fact.date) ?? []), fact]);
  return {
    ...status,
    month,
    today: frame.today,
    seasons: frame.seasons,
    days: frame.days.map((day) => ({
      ...day,
      holidays: factsOn.get(day.date) ?? [],
      departments: departments.map(({ id }) => ({
        departmentId: id,
        ranges: hours.get(id)!.get(day.date)!.ranges,
        zones: zones
          .filter(({ departmentId }) => departmentId === id)
          .map((zone) => ({ zoneId: zone.id, closed: closures.get(zone.id)!.get(day.date)! })),
      })),
    })),
  };
}

/** Each date's season week alone: what stands on it when no special day does. */
export interface SeasonDays {
  days: readonly {
    date: LocalDate;
    seasonId: string | null;
    dayCutover: string;
    departments: readonly {
      departmentId: string;
      ranges: readonly ServiceRange[];
      zones: readonly { zoneId: string; closed: readonly ClosedRange[] }[];
    }[];
  }[];
}

/** `dates` are dates the caller has checked; the answer keeps their order, each date once. */
export async function readSeasonDays(
  tx: Transaction,
  cfg: VenueScope,
  dates: readonly LocalDate[],
): Promise<SeasonDays> {
  const days = [...new Set(dates)];
  const clock = wallClock(await readLocationClock(tx, cfg.locationId));
  const seasons = await readSeasons(tx, cfg);
  const plan: DayPlan = {
    seasonIdOn: new Map(days.map((day) => [day, seasonOn(seasons, day)?.id ?? null])),
    special: new Map(days.map((day) => [day, null])),
  };
  const departments = await readActiveDepartments(tx, cfg);
  const zones = await readServiceZones(tx, cfg);
  const hours = await resolveDepartmentsDays(
    tx,
    cfg,
    departments.map(({ id }) => id),
    days,
    clock,
    plan,
  );
  const closures = await resolveZoneClosedDays(
    tx,
    cfg,
    zones.map(({ id }) => id),
    days,
    clock,
    plan,
  );
  return {
    days: days.map((date) => ({
      date,
      seasonId: plan.seasonIdOn.get(date)!,
      dayCutover: serviceDayWallContext(clock, date).dayCutover,
      departments: departments.map(({ id }) => ({
        departmentId: id,
        ranges: hours.get(id)!.get(date)!.ranges,
        zones: zones
          .filter(({ departmentId }) => departmentId === id)
          .map((zone) => ({ zoneId: zone.id, closed: closures.get(zone.id)!.get(date)! })),
      })),
    })),
  };
}
