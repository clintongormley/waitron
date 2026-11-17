import "./errors.js";
import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { readVenueClock, type Transaction } from "@waitron/db";
import { AppError, businessDayAt, businessDayBounds } from "@waitron/shared";
import {
  attendanceDays,
  enqueueAttendanceDay,
  retireObsoleteRotaQuestions,
  processAttendanceDay,
  readLatestLiveEntry,
  type AttendanceDay,
  type AttendanceDayResult,
  rosterVersions,
  shifts,
} from "@waitron/workforce";
import { markAttendanceSourceChanged } from "./attendance-source-changes.js";
import { readAttendanceFacts, readPlannedAttendanceShifts } from "./attendance-facts.js";
import { readTillClockState, type TillClockState } from "./till-clock-state.js";

/** The state it read, or `null` when it reconciled a day and the caller must read it again. */
export async function reconcileAttendanceBeforeClock(
  tx: Transaction,
  scope: { nodeId: string; personId: string },
  at: Date,
): Promise<TillClockState | null> {
  const state = await readTillClockState(tx, scope, at);
  if (state.state === "out") return state;
  const start = await readLatestLiveEntry(tx, scope.personId, { kind: "in" });
  if (!start) return state;
  const clock = await readVenueClock(tx);
  const businessDay = businessDayAt(clock, new Date(start.eventAt));
  const day = {
    businessDay,
    ...businessDayBounds(clock, businessDay),
  };
  if (Date.parse(day.endAt) > at.getTime()) return state;
  const [saved] = await tx
    .select()
    .from(attendanceDays)
    .where(eq(attendanceDays.businessDay, businessDay));
  if (!saved) await enqueueAttendanceDay(tx, day);
  await reconcileAttendanceDay(tx, { nodeId: scope.nodeId, personId: scope.personId, day }, at);
  return null;
}

export async function reconcileAttendanceDay(
  tx: Transaction,
  scope: { nodeId: string; personId: string; day: AttendanceDay },
  at: Date,
): Promise<AttendanceDayResult> {
  const { day } = scope;
  return processAttendanceDay(tx, {
    day,
    nodeId: scope.nodeId,
    personId: scope.personId,
    now: at,
    facts: await readAttendanceFacts(tx, day),
    planned: await readPlannedAttendanceShifts(tx, day),
  });
}
export async function nextAttendanceDay(
  tx: Transaction,
  scope: { now: Date },
): Promise<AttendanceDay | null> {
  if (!Number.isFinite(scope.now.getTime()))
    throw new AppError("attendance.invalid", { reason: "invalid attendance instant" });
  const clock = await readVenueClock(tx);
  const markMovedShifts = async (work: AttendanceDay) => {
    const planned = await tx
      .select({ id: shifts.id, startsAt: shifts.startsAt })
      .from(shifts)
      .innerJoin(rosterVersions, eq(rosterVersions.id, shifts.rosterVersionId))
      .where(
        and(
          eq(rosterVersions.status, "published"),
          gte(shifts.startsAt, work.startAt),
          lt(shifts.startsAt, work.endAt),
        ),
      );
    for (const shift of planned)
      if (businessDayAt(clock, new Date(shift.startsAt)) !== work.businessDay)
        await markAttendanceSourceChanged(tx, "shift", shift.id);
  };
  const future = await tx
    .select()
    .from(attendanceDays)
    .where(
      and(
        eq(attendanceDays.evaluatedRevision, 0),
        sql`${attendanceDays.endAt} > ${scope.now.toISOString()}`,
      ),
    );
  for (const work of future) {
    const bounds = businessDayBounds(clock, work.businessDay);
    if (work.startAt === bounds.startAt && work.endAt === bounds.endAt) continue;
    await markMovedShifts(work);
    await tx
      .update(attendanceDays)
      .set({
        ...bounds,
        nextDueAt:
          work.nextDueAt === work.endAt || work.nextDueAt < bounds.endAt
            ? bounds.endAt
            : work.nextDueAt,
      })
      .where(eq(attendanceDays.id, work.id));
  }
  const [work] = await tx
    .select()
    .from(attendanceDays)
    .where(
      and(
        sql`${attendanceDays.nextDueAt} <= ${scope.now.toISOString()}`,
        sql`${attendanceDays.endAt} <= ${scope.now.toISOString()}`,
        sql`(${attendanceDays.dirtyRevision} > ${attendanceDays.evaluatedRevision} or ${attendanceDays.nextDueAt} > ${attendanceDays.endAt})`,
      ),
    )
    .orderBy(
      asc(attendanceDays.businessDay),
      asc(attendanceDays.startAt),
      asc(attendanceDays.id),
    )
    .limit(1);
  if (work) {
    const bounds = businessDayBounds(clock, work.businessDay);
    if (work.startAt !== bounds.startAt || work.endAt !== bounds.endAt) {
      if (work.evaluatedRevision !== 0)
        throw new AppError("attendance.invalid", { reason: "saved attendance bounds changed" });
      await markMovedShifts(work);
      const nextDueAt =
        work.nextDueAt === work.endAt || work.nextDueAt < bounds.endAt
          ? bounds.endAt
          : work.nextDueAt;
      await tx
        .update(attendanceDays)
        .set({ ...bounds, nextDueAt })
        .where(eq(attendanceDays.id, work.id));
      Object.assign(work, bounds, { nextDueAt });
      if (work.endAt > scope.now.toISOString()) return null;
    }
  }
  if (!work) return null;
  const day = {
    businessDay: work.businessDay,
    startAt: work.startAt,
    endAt: work.endAt,
  };
  await retireObsoleteRotaQuestions(tx, day);
  return day;
}
