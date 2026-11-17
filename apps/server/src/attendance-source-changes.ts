import { eq, sql } from "drizzle-orm";
import { readVenueClock, type Transaction } from "@waitron/db";
import { businessDayAt, businessDayBounds } from "@waitron/shared";
import {
  attendanceDays,
  enqueueAttendanceDay,
  rosterVersions,
  shifts,
} from "@waitron/workforce";

export async function markAttendanceSourceChanged(
  tx: Transaction,
  source: "rota" | "shift",
  id: string,
): Promise<void> {
  const current =
    source === "shift"
      ? await tx
          .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt })
          .from(shifts)
          .where(eq(shifts.id, id))
      : await tx
          .select({ startsAt: shifts.startsAt, endsAt: shifts.endsAt })
          .from(rosterVersions)
          .leftJoin(shifts, eq(shifts.rosterVersionId, rosterVersions.id))
          .where(eq(rosterVersions.id, id));
  if (current.length === 0) return;
  const clock = await readVenueClock(tx);
  const days = new Set<string>();
  for (const row of current)
    if (row.startsAt !== null && row.endsAt !== null) {
      days.add(businessDayAt(clock, new Date(row.startsAt)));
      days.add(businessDayAt(clock, new Date(Date.parse(row.endsAt) - 1)));
    }
  for (const businessDay of days) {
    const scope = eq(attendanceDays.businessDay, businessDay);
    const [saved] = await tx.select().from(attendanceDays).where(scope);
    // A mutable rota cannot relabel the bounds of an already captured attendance day.
    if (saved) {
      await tx
        .update(attendanceDays)
        .set({
          dirtyRevision: sql`${attendanceDays.dirtyRevision} + 1`,
        })
        .where(scope);
    } else {
      await enqueueAttendanceDay(tx, {
        businessDay,
        ...businessDayBounds(clock, businessDay),
      });
    }
  }
}
