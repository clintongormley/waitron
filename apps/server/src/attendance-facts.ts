import { and, asc, eq, gte, lt } from "drizzle-orm";
import { type Transaction } from "@waitron/db";
import { rosterVersions, shifts } from "@waitron/workforce";
import type { AttendanceDay, PlannedAttendanceShift } from "@waitron/workforce";

export { readStaffActivityFacts as readAttendanceFacts } from "@waitron/workforce";

export async function readPlannedAttendanceShifts(
  tx: Transaction,
  day: AttendanceDay,
): Promise<PlannedAttendanceShift[]> {
  return tx
    .select({
      id: shifts.id,
      personId: shifts.personId,
      startsAt: shifts.startsAt,
      endsAt: shifts.endsAt,
      rosterVersionId: rosterVersions.id,
    })
    .from(shifts)
    .innerJoin(rosterVersions, eq(shifts.rosterVersionId, rosterVersions.id))
    .where(
      and(
        eq(rosterVersions.status, "published"),
        gte(shifts.startsAt, day.startAt),
        lt(shifts.startsAt, day.endAt),
      ),
    )
    .orderBy(asc(shifts.startsAt), asc(shifts.endsAt), asc(shifts.id));
}
