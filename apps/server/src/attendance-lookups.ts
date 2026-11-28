import { asc } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { persons } from "@waitron/identity";
import { maySelfApproveAttendance } from "@waitron/workforce";
import type { AttendanceLookups } from "@waitron/workforce/attendance-contract";

export async function readAttendanceLookups(
  tx: Transaction,
  personId: string,
): Promise<AttendanceLookups> {
  const people = await tx
    .select({ personId: persons.id, displayName: persons.displayName })
    .from(persons)
    .orderBy(asc(persons.displayName), asc(persons.id));
  return {
    viewer: { personId, canSelfApprove: await maySelfApproveAttendance(tx, personId) },
    people,
  };
}
