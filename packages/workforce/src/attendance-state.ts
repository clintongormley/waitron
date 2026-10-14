import { and, eq, sql } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { AttendanceDay } from "./attendance-types.js";
import { attendanceDayWork } from "./schema/attendance.js";
import "./errors.js";

export function assertAttendanceDay(day: AttendanceDay): void {
  const parsed = new Date(`${day.businessDay}T00:00:00.000Z`);
  if (
    !day.locationId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day.businessDay) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day.businessDay ||
    !Number.isFinite(Date.parse(day.startAt)) ||
    !Number.isFinite(Date.parse(day.endAt)) ||
    Date.parse(day.endAt) <= Date.parse(day.startAt)
  ) {
    throw new AppError("attendance.invalid", { reason: "invalid attendance day" });
  }
}

export async function enqueueAttendanceDay(tx: Transaction, day: AttendanceDay): Promise<void> {
  assertAttendanceDay(day);
  const bounds = {
    ...day,
    startAt: new Date(day.startAt).toISOString(),
    endAt: new Date(day.endAt).toISOString(),
  };
  const scope = and(
    eq(attendanceDayWork.locationId, day.locationId),
    eq(attendanceDayWork.businessDay, day.businessDay),
  );
  const [existing] = await tx.select().from(attendanceDayWork).where(scope);
  if (existing) {
    if (existing.startAt !== bounds.startAt || existing.endAt !== bounds.endAt) {
      throw new AppError("attendance.invalid", { reason: "saved attendance bounds changed" });
    }
    await tx
      .update(attendanceDayWork)
      .set({ dirtyRevision: sql`${attendanceDayWork.dirtyRevision} + 1` })
      .where(scope);
  } else {
    await tx.insert(attendanceDayWork).values({ ...bounds, nextDueAt: bounds.endAt });
  }
}
