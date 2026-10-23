import { departments } from "@waitron/venue-service";
import type { Transaction } from "@waitron/db";

export async function setReleaseReminderInEveryDepartment(
  tx: Transaction,
  minutes: number | null,
): Promise<void> {
  const switched = await tx
    .update(departments)
    .set({ releaseReminderMinutes: minutes })
    .returning({ id: departments.id });
  if (switched.length === 0) {
    throw new Error("setReleaseReminderInEveryDepartment: the database has no department yet");
  }
}
