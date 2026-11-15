import { serviceSteps, type Transaction } from "@waitron/db";
import type { DeleteImpactItem } from "@waitron/shared";
import { deleteServiceSteps } from "./service-steps.js";

export type CourseDeleteSettings = { readonly named: string[] };

export async function readCourseDeleteSettings(
  tx: Transaction,
  courseId: string,
): Promise<CourseDeleteSettings> {
  const rows = await tx
    .select({
      id: serviceSteps.id,
      courseId: serviceSteps.courseId,
      afterStepId: serviceSteps.afterStepId,
    })
    .from(serviceSteps);
  const named = new Set(rows.filter((row) => row.courseId === courseId).map((row) => row.id));
  let size: number;
  do {
    size = named.size;
    for (const row of rows)
      if (row.afterStepId !== null && named.has(row.afterStepId)) named.add(row.id);
  } while (size !== named.size);
  return { named: [...named] };
}

export function courseDeleteSettingsRemoves({ named }: CourseDeleteSettings): DeleteImpactItem[] {
  return named.length === 0
    ? []
    : [{ key: "course_service_steps", count: named.length, targets: [] }];
}

export async function clearCourseDeleteSettings(
  tx: Transaction,
  { named }: CourseDeleteSettings,
): Promise<void> {
  await deleteServiceSteps(tx, named);
}
