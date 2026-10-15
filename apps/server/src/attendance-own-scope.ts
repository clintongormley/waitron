import "./errors.js";
import { and, eq } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { attendanceQuestions, timeEntries } from "@waitron/workforce";

export async function assertOwnAttendanceLocation(
  tx: Transaction,
  scope: { personId: string; locationId: string; currentLocationId: string },
): Promise<void> {
  const { personId, locationId, currentLocationId } = scope;
  if (locationId === currentLocationId) return;
  const [entry] = await tx
    .select({ id: timeEntries.id })
    .from(timeEntries)
    .where(and(eq(timeEntries.personId, personId), eq(timeEntries.locationId, locationId)))
    .limit(1);
  if (entry) return;
  const [question] = await tx
    .select({ id: attendanceQuestions.id })
    .from(attendanceQuestions)
    .where(
      and(
        eq(attendanceQuestions.personId, personId),
        eq(attendanceQuestions.locationId, locationId),
      ),
    )
    .limit(1);
  if (!question) throw new AppError("attendance.not_permitted", { personId });
}
