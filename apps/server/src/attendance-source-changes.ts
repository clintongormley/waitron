import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { readLocationClock } from "@waitron/reporting";
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
      ? await tx
          .select({ locationId: shifts.locationId, startsAt: shifts.startsAt })
          .from(shifts)
          .where(eq(shifts.id, id))
      : await tx
          .select({ locationId: rosterVersions.locationId, startsAt: shifts.startsAt })
          .from(rosterVersions)
          .leftJoin(
            shifts,
            and(
              eq(shifts.rosterVersionId, rosterVersions.id),
              eq(shifts.locationId, rosterVersions.locationId),
            ),
          )
          .where(eq(rosterVersions.id, id));
  const byLocation = new Map(
    watches.map((watch) => [watch.locationId, new Set(watch.previousDays)]),
  );
  for (const row of current) {
    let days = byLocation.get(row.locationId);
    if (!days) byLocation.set(row.locationId, (days = new Set()));
    if (row.startsAt !== null) {
      const clock = await readLocationClock(tx, row.locationId);
      days.add(businessDayAt(clock, new Date(row.startsAt)));
    }
  }
  for (const [locationId, days] of byLocation) {
    const clock = await readLocationClock(tx, locationId);
    for (const businessDay of days) {
      const scope = and(
        eq(attendanceDayWork.locationId, locationId),
        eq(attendanceDayWork.businessDay, businessDay),
      );
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
          locationId,
          businessDay,
          ...businessDayBounds(clock, businessDay),
        });
      }
    }
    await tx
      .insert(attendanceSourceState)
      .values({
        locationId,
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
}
