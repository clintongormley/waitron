import { cancelUnclaimedAttendanceMail } from "./attendance-mail.js";
import type { Transaction } from "@waitron/db";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { AttendanceDay } from "./attendance-types.js";
import { assertAttendanceDay } from "./attendance-state.js";
import { attendanceQuestions } from "./schema/attendance.js";
import { rosterVersions } from "./schema/roster-versions.js";
import { shifts } from "./schema/shifts.js";

export async function retireObsoleteRotaQuestions(
  tx: Transaction,
  day: AttendanceDay,
): Promise<void> {
  assertAttendanceDay(day);
  const obsolete = await tx
    .select({ id: attendanceQuestions.id })
    .from(attendanceQuestions)
    .leftJoin(
      shifts,
      and(
        sql`${attendanceQuestions.shiftKey} = 'rota:' || ${shifts.id}`,
        eq(shifts.personId, attendanceQuestions.personId),
        gte(shifts.startsAt, new Date(day.startAt).toISOString()),
        lt(shifts.startsAt, new Date(day.endAt).toISOString()),
      ),
    )
    .leftJoin(
      rosterVersions,
      and(eq(rosterVersions.id, shifts.rosterVersionId), eq(rosterVersions.status, "published")),
    )
    .where(
      and(
        eq(attendanceQuestions.businessDay, day.businessDay),
        eq(attendanceQuestions.active, true),
        eq(attendanceQuestions.kind, "missing-times"),
        isNull(attendanceQuestions.openEntryId),
        isNull(attendanceQuestions.resolvedByEntryId),
        sql`${attendanceQuestions.shiftKey} like 'rota:%'`,
        isNull(rosterVersions.id),
      ),
    );
  for (const { id } of obsolete) {
    await tx
      .update(attendanceQuestions)
      .set({ active: false, inactiveReason: "rota_superseded" })
      .where(eq(attendanceQuestions.id, id));
    // An in-flight send cannot be recalled; its outcome still belongs to the original question.
    await cancelUnclaimedAttendanceMail(tx, id);
  }
}
