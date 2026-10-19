import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { kitchenCourses, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { VenueScope } from "./operations.js";
import { departments } from "./schema/service.js";
import { serviceSteps, type ServiceStepStart } from "./schema/service-steps.js";

export interface ServiceStep {
  id: string;
  departmentId: string;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  minutes: number;
}

export interface ServiceStepInput {
  id?: string;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  minutes: number;
}

export async function listServiceSteps(tx: Transaction, cfg: VenueScope): Promise<ServiceStep[]> {
  return tx
    .select({
      id: serviceSteps.id,
      departmentId: serviceSteps.departmentId,
      name: serviceSteps.name,
      start: serviceSteps.start,
      courseId: serviceSteps.courseId,
      minutes: serviceSteps.minutes,
    })
    .from(serviceSteps)
    .innerJoin(departments, eq(departments.id, serviceSteps.departmentId))
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)))
    .orderBy(asc(serviceSteps.departmentId), asc(serviceSteps.position), asc(serviceSteps.id));
}

export async function listStepCourses(
  tx: Transaction,
  cfg: VenueScope,
): Promise<{ id: string; name: string }[]> {
  return tx
    .select({ id: kitchenCourses.id, name: kitchenCourses.name })
    .from(kitchenCourses)
    .where(and(eq(kitchenCourses.locationId, cfg.locationId), eq(kitchenCourses.active, true)))
    .orderBy(asc(kitchenCourses.displayOrder), asc(kitchenCourses.name));
}

/** Rows not sent are deleted and sent ids are updated in place, so a kept step keeps its id. */
export async function saveServiceSteps(
  tx: Transaction,
  cfg: VenueScope,
  departmentId: string,
  steps: readonly ServiceStepInput[],
): Promise<void> {
  const stored = new Set(
    (
      await tx
        .select({ id: serviceSteps.id })
        .from(serviceSteps)
        .where(eq(serviceSteps.departmentId, departmentId))
    ).map((row) => row.id),
  );
  for (const step of steps)
    if (step.id !== undefined && !stored.has(step.id))
      throw new AppError("service_step.not_found", { stepId: step.id });
  const courseIds = [
    ...new Set(steps.flatMap((step) => (step.courseId === null ? [] : [step.courseId]))),
  ];
  const live = new Set(
    courseIds.length === 0
      ? []
      : (
          await tx
            .select({ id: kitchenCourses.id })
            .from(kitchenCourses)
            .where(
              and(
                inArray(kitchenCourses.id, courseIds),
                eq(kitchenCourses.locationId, cfg.locationId),
                eq(kitchenCourses.active, true),
              ),
            )
        ).map((row) => row.id),
  );
  const missing = courseIds.find((id) => !live.has(id));
  if (missing !== undefined) throw new AppError("course.not_found", { courseId: missing });

  const kept = steps.flatMap((step) => (step.id === undefined ? [] : [step.id]));
  await tx
    .delete(serviceSteps)
    .where(and(eq(serviceSteps.departmentId, departmentId), notInArray(serviceSteps.id, kept)));
  for (const [position, step] of steps.entries()) {
    const values = {
      name: step.name.trim(),
      start: step.start,
      courseId: step.courseId,
      minutes: step.minutes,
      position,
    };
    if (step.id === undefined) await tx.insert(serviceSteps).values({ departmentId, ...values });
    else await tx.update(serviceSteps).set(values).where(eq(serviceSteps.id, step.id));
  }
}
