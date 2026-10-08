import { and, asc, eq, inArray, lte, or } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { rangeDates } from "./hours-rules.js";
import type { LocalDate } from "./hours-types.js";
import { occursOn, repeatKey, type NamedDayKind } from "./named-day-rules.js";
import type { VenueScope } from "./operations.js";
import { specialDates } from "./schema/hours.js";

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
