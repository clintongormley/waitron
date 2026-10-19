import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { DeleteImpactItem } from "@waitron/shared";
import type { VenueScope } from "./operations.js";
import { departments } from "./schema/service.js";
import { serviceSteps } from "./schema/service-steps.js";

export type CourseDeleteSettings = { readonly named: string[]; readonly seated: string[] };

export async function readCourseDeleteSettings(
  tx: Transaction,
  cfg: VenueScope,
  courseId: string,
): Promise<CourseDeleteSettings> {
  const named = await tx
    .select({ id: serviceSteps.id, departmentId: serviceSteps.departmentId })
    .from(serviceSteps)
    .innerJoin(departments, eq(departments.id, serviceSteps.departmentId))
    .where(and(eq(serviceSteps.courseId, courseId), eq(departments.locationId, cfg.locationId)));
  const touched = [...new Set(named.map((row) => row.departmentId))];
  const removed = new Set(named.map((row) => row.id));
  const remaining =
    touched.length === 0
      ? []
      : (
          await tx
            .select({
              id: serviceSteps.id,
              departmentId: serviceSteps.departmentId,
              position: serviceSteps.position,
              start: serviceSteps.start,
            })
            .from(serviceSteps)
            .where(inArray(serviceSteps.departmentId, touched))
        ).filter((row) => !removed.has(row.id));
  const lowest = new Map<string, number>();
  for (const row of remaining)
    lowest.set(
      row.departmentId,
      Math.min(lowest.get(row.departmentId) ?? row.position, row.position),
    );
  // Every tie at the lowest position counts: the configuration import refuses any of them.
  const seated = remaining
    .filter(
      (row) => row.start === "after_previous" && row.position === lowest.get(row.departmentId),
    )
    .map((row) => row.id);
  return { named: [...removed], seated };
}

export function courseDeleteSettingsRemoves({
  named,
  seated,
}: CourseDeleteSettings): DeleteImpactItem[] {
  return [
    { key: "course_service_steps", count: named.length, targets: [] },
    { key: "course_seated_steps", count: seated.length, targets: [] },
  ].filter((item) => item.count > 0);
}

export async function clearCourseDeleteSettings(
  tx: Transaction,
  { named, seated }: CourseDeleteSettings,
): Promise<void> {
  if (named.length > 0) await tx.delete(serviceSteps).where(inArray(serviceSteps.id, named));
  if (seated.length > 0)
    await tx.update(serviceSteps).set({ start: "seated" }).where(inArray(serviceSteps.id, seated));
}
