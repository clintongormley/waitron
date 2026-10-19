import { departments } from "@waitron/venue-service";
import type { Transaction } from "@waitron/db";

export async function setNeedsClearingInEveryDepartment(
  tx: Transaction,
  on: boolean,
): Promise<void> {
  const switched = await tx
    .update(departments)
    .set({ needsClearing: on })
    .returning({ id: departments.id });
  if (switched.length === 0) {
    throw new Error("setNeedsClearingInEveryDepartment: the database has no department yet");
  }
}
