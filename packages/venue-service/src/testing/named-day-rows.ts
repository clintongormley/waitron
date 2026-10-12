import { and, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { SpecialDate, SpecialDateInput } from "../hours-types.js";
import type { VenueScope } from "../operations.js";
import { repeatKey } from "../repeat-rules.js";
import { specialDates } from "../schema/hours.js";
import { menuDayTimetables } from "../schema/menus.js";
import { zoneClosedTimes } from "../schema/zone-closed-times.js";

const fact = (row: typeof specialDates.$inferSelect): SpecialDate => ({
  id: row.id,
  date: row.date,
  name: row.name,
  kind: row.kind,
  repeats: row.repeatOn !== null,
  ownHours: row.ownHours,
  closeWholeVenue: row.closeWholeVenue,
});

/** A raw `special_dates` row, for suites whose code still reads the table no writer fills. It
 *  checks nothing a writer would; extra input fields are ignored. */
export async function insertNamedDay(
  tx: Transaction,
  cfg: VenueScope,
  input: SpecialDateInput & Record<string, unknown>,
): Promise<SpecialDate> {
  const [row] = await tx
    .insert(specialDates)
    .values({
      locationId: cfg.locationId,
      date: input.date,
      name: input.name,
      kind: input.kind ?? "working_day",
      repeatOn: input.repeats === true ? repeatKey(input.date) : null,
      ownHours: input.ownHours ?? false,
      closeWholeVenue: input.closeWholeVenue,
    })
    .returning();
  return fact(row!);
}

export async function readNamedDay(
  tx: Transaction,
  cfg: VenueScope,
  id: string,
): Promise<SpecialDate | undefined> {
  const [row] = await tx
    .select()
    .from(specialDates)
    .where(and(eq(specialDates.id, id), eq(specialDates.locationId, cfg.locationId)));
  return row === undefined ? undefined : fact(row);
}

/** What turning a named day's own hours off did: the date keeps the week again, so its dated
 *  timetables and zone closures go. */
export async function keepWeekOn(tx: Transaction, id: string): Promise<void> {
  await tx.update(specialDates).set({ ownHours: false }).where(eq(specialDates.id, id));
  await tx.delete(menuDayTimetables).where(eq(menuDayTimetables.specialDateId, id));
  await tx.delete(zoneClosedTimes).where(eq(zoneClosedTimes.specialDateId, id));
}
