import { and, eq, sql } from "drizzle-orm";
import { readVenueClock, venueLocationId, type Transaction } from "@waitron/db";
import { businessDayAt, businessDayBounds } from "@waitron/shared";
import {
  attendanceDayWork,
  attendanceSourceState,
  enqueueAttendanceDay,
  rosterVersions,
  shifts,
} from "@waitron/workforce";

export async function markAttendanceSourceChanged(
  tx: Transaction,
  source: "rota" | "shift",
  id: string,
): Promise<void> {
  const key = `${source === "rota" ? "version" : "shift"}:${id}`;
  const watches = await tx
    .select()
    .from(attendanceSourceState)
    .where(
      and(
        eq(attendanceSourceState.source, "rota"),
        eq(attendanceSourceState.recordKind, "watch"),
        eq(attendanceSourceState.key, key),
      ),
    );
  const current =
    source === "shift"
      ? await tx.select({ startsAt: shifts.startsAt }).from(shifts).where(eq(shifts.id, id))
      : await tx
          .select({ startsAt: shifts.startsAt })
          .from(rosterVersions)
          .leftJoin(shifts, eq(shifts.rosterVersionId, rosterVersions.id))
          .where(eq(rosterVersions.id, id));
  if (watches.length === 0 && current.length === 0) return;
  const clock = await readVenueClock(tx);
  const days = new Set(watches.flatMap((watch) => watch.previousDays));
  for (const row of current)
    if (row.startsAt !== null) days.add(businessDayAt(clock, new Date(row.startsAt)));
  for (const businessDay of days) {
    const scope = eq(attendanceDayWork.businessDay, businessDay);
    const [saved] = await tx.select().from(attendanceDayWork).where(scope);
    // A mutable rota cannot relabel the bounds of an already captured attendance day.
    if (saved) {
      await tx
        .update(attendanceDayWork)
        .set({
          dirtyRevision: sql`${attendanceDayWork.dirtyRevision} + 1`,
        })
        .where(scope);
    } else {
      await enqueueAttendanceDay(tx, {
        businessDay,
        ...businessDayBounds(clock, businessDay),
      });
    }
  }
  await tx
    .insert(attendanceSourceState)
    .values({
      locationId: await venueLocationId(tx),
      source: "rota",
      recordKind: "watch",
      key,
      previousDays: [...days].sort(),
      fingerprint: null,
      nextDueAt: "1970-01-01T00:00:00.000Z",
    })
    .onConflictDoUpdate({
      target: [
        attendanceSourceState.locationId,
        attendanceSourceState.source,
        attendanceSourceState.recordKind,
        attendanceSourceState.key,
      ],
      set: {
        previousDays: [...days].sort(),
        fingerprint: null,
        nextDueAt: "1970-01-01T00:00:00.000Z",
      },
    });
}
