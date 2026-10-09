import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
import { venueLocalMoment } from "./hours-clock.js";
import { readCalendarDays, type HolidayReader } from "./hours.js";
import { readHolidays, readHolidayAreaModel } from "./holidays.js";
import type { NamedDaysModel, NamedDay } from "./holiday-types.js";
export type { NamedDaysModel, NamedDay, NamedCalendarDay } from "./holiday-types.js";
import { holidayCityKey } from "./holiday-rules.js";
import { rangeDates } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { occursOn, repeatKey, type NamedDayKind } from "./named-day-rules.js";
import type { VenueScope } from "./operations.js";
import { specialDateHours, specialDates } from "./schema/hours.js";

export interface NamedDayOccurrence {
  id: string;
  date: LocalDate;
  storedDate: LocalDate;
  name: string;
  kind: NamedDayKind;
  repeats: boolean;
  ownHours: boolean;
  closeWholeVenue: boolean;
}

export async function namedDaysOn(
  tx: Transaction,
  cfg: VenueScope,
  dates: readonly LocalDate[],
): Promise<Map<LocalDate, NamedDayOccurrence>> {
  const found = new Map<LocalDate, NamedDayOccurrence>();
  if (dates.length === 0) return found;
  const ordered = [...new Set(dates)].sort();
  const rows = await tx
    .select()
    .from(specialDates)
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        or(
          inArray(specialDates.date, ordered),
          and(
            inArray(specialDates.repeatOn, [...new Set(ordered.map(repeatKey))]),
            lte(specialDates.date, ordered[ordered.length - 1]!),
          ),
        ),
      ),
    )
    .orderBy(asc(specialDates.date), asc(specialDates.id));
  for (const date of ordered) {
    const row = rows.find((row) =>
      occursOn({ date: row.date, repeats: row.repeatOn !== null }, date),
    );
    if (row !== undefined)
      found.set(date, {
        id: row.id,
        date,
        storedDate: row.date,
        name: row.name,
        kind: row.kind,
        repeats: row.repeatOn !== null,
        ownHours: row.ownHours,
        closeWholeVenue: row.closeWholeVenue,
      });
  }
  return found;
}

export async function namedDaysBetween(
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
): Promise<NamedDayOccurrence[]> {
  return [...(await namedDaysOn(tx, cfg, rangeDates(from, to))).values()];
}

export async function readNamedDaysModel(
  tx: Transaction,
  cfg: VenueScope,
  from: LocalDate,
  to: LocalDate,
  at: Date,
  holidays?: HolidayReader,
): Promise<NamedDaysModel> {
  const dates = rangeDates(from, to);
  const clock = await readLocationClock(tx, cfg.locationId);
  const civilDate = venueLocalMoment(at, clock)?.civilDate ?? null;
  const read = await readHolidays(tx, cfg, from, to);
  const area = await readHolidayAreaModel(tx, cfg);
  const named = await namedDaysOn(tx, cfg, dates);
  const stationRows = await tx
    .select({ id: specialDateHours.specialDateId })
    .from(specialDateHours)
    .innerJoin(specialDates, eq(specialDates.id, specialDateHours.specialDateId))
    .where(
      and(
        eq(specialDates.locationId, cfg.locationId),
        inArray(
          specialDates.id,
          [...named.values()].map(({ id }) => id),
        ),
      ),
    );
  const stationDays = new Set(stationRows.map(({ id }) => id));
  const days = await readCalendarDays(tx, cfg, from, to, holidays ?? (async () => read.facts));
  return {
    timeZone: clock.timeZone,
    dayCutover: clock.dayCutover,
    civilDate,
    clockReadable: civilDate !== null,
    days: days.map((day) => {
      const occurrence = named.get(day.date);
      const namedDay: NamedDay | null =
        occurrence === undefined
          ? null
          : {
              id: occurrence.id,
              date: occurrence.storedDate,
              name: occurrence.name,
              kind: occurrence.kind,
              repeats: occurrence.repeats,
              ownHours: occurrence.ownHours,
              closeWholeVenue: occurrence.closeWholeVenue,
              hasStationHours: stationDays.has(occurrence.id),
            };
      const closed = day.tone === "closed";
      return {
        date: day.date,
        namedDay,
        holidays: day.holidays,
        tone: day.holidays.some(({ scope }) => scope !== "local")
          ? "public_holiday"
          : namedDay?.kind === "holiday"
            ? "own_holiday"
            : namedDay !== null
              ? "working_day"
              : closed
                ? "closed"
                : "standard",
        ownHours: namedDay?.ownHours ?? false,
        closed,
      };
    }),
    holidayCoverage: read.coverage,
    holidaySources: read.sources,
    area: {
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
