import { eq, inArray } from "drizzle-orm";
import { openingHours, specialDayDates, specialDays, type Transaction } from "@waitron/db";
import type { PaintRange, ZonePaint } from "./day-paint.js";
import type { LocalDate } from "./hours-types.js";
import { wireTime } from "./operations.js";

export const specialDayOccurrenceColumns = {
  specialDayId: specialDayDates.specialDayId,
  name: specialDays.name,
  dateId: specialDayDates.id,
  date: specialDayDates.date,
  closedAllDay: specialDayDates.closedAllDay,
};

export interface SpecialDayOccurrence {
  specialDayId: string;
  name: string;
  dateId: string;
  storedDate: LocalDate;
  closedAllDay: boolean;
  paint: ReadonlyMap<string, PaintRange[]>;
  zonePaint: ReadonlyMap<string, ZonePaint[]>;
}

interface OccurrenceRow {
  specialDayId: string;
  name: string;
  dateId: string;
  date: LocalDate;
  closedAllDay: boolean;
}

/** One read of the department and zone paint of `dateIds`, and a builder of each date's
 *  occurrence from it. */
export async function occurrencesOf(
  tx: Transaction,
  dateIds: readonly string[],
): Promise<(row: OccurrenceRow) => SpecialDayOccurrence> {
  const paint = await tx
    .select({
      dateId: openingHours.specialDayDateId,
      departmentId: openingHours.departmentId,
      zoneId: openingHours.zoneId,
      periodId: openingHours.periodId,
      kind: openingHours.kind,
      startsAt: openingHours.startsAt,
      endsAt: openingHours.endsAt,
    })
    .from(openingHours)
    .where(inArray(openingHours.specialDayDateId, [...dateIds]));
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
    if (row.departmentId !== null)
      add(departmentPaint, row.dateId!, row.departmentId, { periodId: row.periodId, ...range });
    else
      add(zonePaint, row.dateId!, row.zoneId!, { kind: row.kind as ZonePaint["kind"], ...range });
  }
  return (row) => ({
    specialDayId: row.specialDayId,
    name: row.name,
    dateId: row.dateId,
    storedDate: row.date,
    closedAllDay: row.closedAllDay,
    paint: departmentPaint.get(row.dateId) ?? new Map(),
    zonePaint: zonePaint.get(row.dateId) ?? new Map(),
  });
}

/** Each stored date's own paint, independent of which repeating day would stand there. */
export async function storedSpecialDayOccurrences(
  tx: Transaction,
): Promise<SpecialDayOccurrence[]> {
  const dates = await tx
    .select(specialDayOccurrenceColumns)
    .from(specialDayDates)
    .innerJoin(specialDays, eq(specialDays.id, specialDayDates.specialDayId));
  if (dates.length === 0) return [];
  const occurrence = await occurrencesOf(
    tx,
    dates.map(({ dateId }) => dateId),
  );
  return dates.map(occurrence);
}
