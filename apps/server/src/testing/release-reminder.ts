import { eq } from "drizzle-orm";
import {
  departments,
  departmentCourses,
  kitchenCourses,
  statementChunks,
  type Transaction,
} from "@waitron/db";

export async function setReleaseReminderInDepartment(
  tx: Transaction,
  departmentId: string,
  minutes: number | null,
): Promise<void> {
  const courses = await tx
    .select({ courseId: kitchenCourses.id })
    .from(kitchenCourses)
    .where(eq(kitchenCourses.active, true));
  for (const rows of statementChunks(
    departmentCourses,
    courses.map((course) => ({ departmentId, ...course, reminderMinutes: minutes })),
  ))
    await tx
      .insert(departmentCourses)
      .values(rows)
      .onConflictDoUpdate({
        target: [departmentCourses.departmentId, departmentCourses.courseId],
        set: { reminderMinutes: minutes },
      });
}

export async function setReleaseReminderInEveryDepartment(
  tx: Transaction,
  minutes: number | null,
): Promise<void> {
  const rows = await tx.select({ id: departments.id }).from(departments);
  if (rows.length === 0)
    throw new Error("setReleaseReminderInEveryDepartment: the database has no department yet");
  for (const { id } of rows) await setReleaseReminderInDepartment(tx, id, minutes);
}
