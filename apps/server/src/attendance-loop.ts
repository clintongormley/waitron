import { withTransaction, readVenueClock, type Database } from "@waitron/db";
import { and, eq, gt, sql } from "drizzle-orm";
import { attendanceDays, processAttendanceDay } from "@waitron/workforce";
import { nextAttendanceDay } from "./attendance-discovery.js";
import { readAttendanceFacts, readPlannedAttendanceShifts } from "./attendance-facts.js";
import type { JobDefinition } from "./job-runner.js";
import { businessDayBounds } from "@waitron/shared";

export type AttendancePassDeps = {
  db: Database;
  nodeId: string;
  now: () => Date;
  isPrimary: () => boolean;
};
export async function attendanceWorkPending(db: Database, now: Date): Promise<boolean> {
  const [due] = await db
    .select({ id: attendanceDays.id })
    .from(attendanceDays)
    .where(
      and(
        sql`${attendanceDays.nextDueAt} <= ${now.toISOString()}`,
        sql`${attendanceDays.endAt} <= ${now.toISOString()}`,
        sql`(${attendanceDays.dirtyRevision} > ${attendanceDays.evaluatedRevision} or ${attendanceDays.nextDueAt} > ${attendanceDays.endAt})`,
      ),
    )
    .limit(1);
  if (due !== undefined) return true;
  const future = await db
    .select({
      businessDay: attendanceDays.businessDay,
      startAt: attendanceDays.startAt,
      endAt: attendanceDays.endAt,
    })
    .from(attendanceDays)
    .where(
      and(eq(attendanceDays.evaluatedRevision, 0), gt(attendanceDays.endAt, now.toISOString())),
    );
  if (future.length === 0) return false;
  const clock = await readVenueClock(db);
  return future.some((day) => {
    const bounds = businessDayBounds(clock, day.businessDay);
    return bounds.startAt !== day.startAt || bounds.endAt !== day.endAt;
  });
}

export async function nextAttendanceDueAt(db: Database, now: Date): Promise<Date | null> {
  const [row] = await db
    .select({
      at: sql<string | null>`min(max(${attendanceDays.nextDueAt}, ${attendanceDays.endAt}))`,
    })
    .from(attendanceDays)
    .where(
      sql`${attendanceDays.dirtyRevision} > ${attendanceDays.evaluatedRevision} or ${attendanceDays.nextDueAt} > ${attendanceDays.endAt} or ${attendanceDays.endAt} > ${now.toISOString()}`,
    );
  return row?.at ? new Date(row.at) : null;
}

export function attendanceJob(deps: AttendancePassDeps & { maxSleepMs: number }): JobDefinition {
  return {
    name: "attendance.end_of_day",
    applies: deps.isPrimary,
    wakeOn: [
      "attendance_days",
      "time_entries",
      "workforce_chains",
      "day_cutover_changes",
      "settings.business_day",
    ],
    minSleepMs: 500,
    maxSleepMs: deps.maxSleepMs,
    backoff: { firstMs: 5_000, maxMs: 300_000 },
    async pass({ now }) {
      const more =
        (await attendanceWorkPending(deps.db, now)) && (await runAttendancePass(deps)).more;
      return { nextDueAt: more ? now : await nextAttendanceDueAt(deps.db, now) };
    },
  };
}

export async function runAttendancePass(
  deps: AttendancePassDeps,
): Promise<{ processed: boolean; more: boolean }> {
  if (!deps.isPrimary()) return { processed: false, more: false };
  return withTransaction(deps.db, async (tx) => {
    if (!deps.isPrimary()) return { processed: false, more: false };
    const now = deps.now();
    const day = await nextAttendanceDay(tx, { now });
    let appended = false;
    if (day !== null) {
      const result = await processAttendanceDay(tx, {
        day,
        nodeId: deps.nodeId,
        now,
        facts: await readAttendanceFacts(tx, day),
        planned: await readPlannedAttendanceShifts(tx, day),
      });
      appended = result.automaticEntryIds.length > 0;
    }
    const [remaining] = await tx
      .select({ id: attendanceDays.id })
      .from(attendanceDays)
      .where(
        and(
          sql`${attendanceDays.nextDueAt} <= ${now.toISOString()}`,
          sql`${attendanceDays.endAt} <= ${now.toISOString()}`,
          sql`(${attendanceDays.dirtyRevision} > ${attendanceDays.evaluatedRevision} or ${attendanceDays.nextDueAt} > ${attendanceDays.endAt})`,
        ),
      )
      .limit(1);
    return { processed: day !== null, more: appended || remaining !== undefined };
  });
}
