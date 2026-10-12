import { and, asc, eq, inArray, lte, or, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PaintRange, ZonePaint } from "./day-paint.js";
import type { LocalDate } from "./hours-types.js";
import { occurrenceIn, repeatKey } from "./named-day-rules.js";
import { wireTime, type VenueScope } from "./operations.js";
import {
  departmentDayRanges,
  departmentDays,
  specialDayDates,
  specialDays,
  zoneDayRanges,
  zoneDays,
} from "./schema/seasons.js";

export interface SpecialDayDateRule {
  date: LocalDate;
  repeats: boolean;
}

/** Where a special-day date falls in `year`: a one-off only in its own year, a repeating one from
 *  its first year on, and a 29 February only in leap years. Null when it does not fall in `year`. */
export function specialDateIn(rule: SpecialDayDateRule, year: number): LocalDate | null {
  return occurrenceIn(rule, year);
}

export interface SpecialDayOccurrence {
  specialDayId: string;
  dateId: string;
  storedDate: LocalDate;
  closedAllDay: boolean;
  paint: ReadonlyMap<string, PaintRange[]>;
  zonePaint: ReadonlyMap<string, ZonePaint[]>;
}

/** The special-day date standing on each of `days` (null when none), with its paint for every
 *  department and zone: one read of the dates, and one of the paint only when any date matched. */
export async function specialDaysOn(
  tx: Transaction,
  cfg: VenueScope,
  days: readonly LocalDate[],
): Promise<Map<LocalDate, SpecialDayOccurrence | null>> {
  const found = new Map<LocalDate, SpecialDayOccurrence | null>(days.map((day) => [day, null]));
  if (days.length === 0) return found;
  const ordered = [...new Set(days)].sort();
  const dates = await tx
    .select({
      specialDayId: specialDayDates.specialDayId,
      dateId: specialDayDates.id,
      date: specialDayDates.date,
      closedAllDay: specialDayDates.closedAllDay,
      repeats: specialDays.repeatsYearly,
    })
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId))
    .where(
      and(
        eq(specialDayDates.locationId, cfg.locationId),
        or(
          inArray(specialDayDates.date, ordered),
          and(
            eq(specialDays.repeatsYearly, true),
            inArray(sql`substr(${specialDayDates.date}, 6)`, [...new Set(ordered.map(repeatKey))]),
            lte(specialDayDates.date, ordered[ordered.length - 1]!),
          ),
        ),
      ),
    )
    .orderBy(asc(specialDayDates.date), asc(specialDayDates.id));
  const matched = new Map<LocalDate, (typeof dates)[number]>();
  for (const day of ordered) {
    const row = dates.find(
      (row) =>
        specialDateIn({ date: row.date, repeats: row.repeats }, Number(day.slice(0, 4))) === day,
    );
    if (row !== undefined) matched.set(day, row);
  }
  if (matched.size === 0) return found;
  const dateIds = [...new Set([...matched.values()].map((row) => row.dateId))];
  const paint = await tx
    .select({
      dateId: departmentDays.specialDayDateId,
      ownerId: departmentDays.departmentId,
      periodId: departmentDayRanges.periodId,
      kind: sql<ZonePaint["kind"] | null>`null`,
      startsAt: departmentDayRanges.startsAt,
      endsAt: departmentDayRanges.endsAt,
    })
    .from(departmentDays)
    .innerJoin(departmentDayRanges, eq(departmentDayRanges.dayId, departmentDays.id))
    .where(inArray(departmentDays.specialDayDateId, dateIds))
    .unionAll(
      tx
        .select({
          dateId: zoneDays.specialDayDateId,
          ownerId: zoneDays.zoneId,
          periodId: sql<string | null>`null`,
          kind: zoneDayRanges.kind,
          startsAt: zoneDayRanges.startsAt,
          endsAt: zoneDayRanges.endsAt,
        })
        .from(zoneDays)
        .innerJoin(zoneDayRanges, eq(zoneDayRanges.dayId, zoneDays.id))
        .where(inArray(zoneDays.specialDayDateId, dateIds)),
    );
  const departmentPaint = new Map<string, Map<string, PaintRange[]>>();
  const zonePaint = new Map<string, Map<string, ZonePaint[]>>();
  const add = <T>(
    into: Map<string, Map<string, T[]>>,
    dateId: string,
    ownerId: string,
    item: T,
  ) => {
    const owners = into.get(dateId) ?? new Map<string, T[]>();
    into.set(dateId, owners);
    owners.set(ownerId, [...(owners.get(ownerId) ?? []), item]);
  };
  for (const row of paint) {
    const range = { startsAt: wireTime(row.startsAt), endsAt: wireTime(row.endsAt) };
    if (row.kind === null)
      add(departmentPaint, row.dateId!, row.ownerId, { periodId: row.periodId, ...range });
    else add(zonePaint, row.dateId!, row.ownerId, { kind: row.kind, ...range });
  }
  for (const [day, row] of matched)
    found.set(day, {
      specialDayId: row.specialDayId,
      dateId: row.dateId,
      storedDate: row.date,
      closedAllDay: row.closedAllDay,
      paint: departmentPaint.get(row.dateId) ?? new Map(),
      zonePaint: zonePaint.get(row.dateId) ?? new Map(),
    });
  return found;
}
