import { and, asc, eq, inArray } from "drizzle-orm";
import {
  departments,
  newId,
  kitchenCourses,
  serviceSteps,
  type ServiceStepStart,
  type Transaction,
} from "@waitron/db";
import { starterName, type StarterStaffLanguage } from "@waitron/country-packs";
import { AppError } from "@waitron/shared";
import "./errors.js";
import { STARTER_STEP_NAMES } from "./starter-content.js";
import { readStarterStaffLanguage } from "./starter-language.js";

export interface ServiceStep {
  id: string;
  departmentId: string;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  afterStepId: string | null;
  minutes: number;
}

export interface ServiceStepInput {
  id?: string;
  key?: string;
  afterStepKey?: string | null;
  name: string;
  start: ServiceStepStart;
  courseId: string | null;
  minutes: number;
}

export async function listServiceSteps(tx: Transaction): Promise<ServiceStep[]> {
  return tx
    .select({
      id: serviceSteps.id,
      departmentId: serviceSteps.departmentId,
      name: serviceSteps.name,
      start: serviceSteps.start,
      courseId: serviceSteps.courseId,
      afterStepId: serviceSteps.afterStepId,
      minutes: serviceSteps.minutes,
    })
    .from(serviceSteps)
    .innerJoin(departments, eq(departments.id, serviceSteps.departmentId))
    .where(eq(departments.active, true))
    .orderBy(asc(serviceSteps.departmentId), asc(serviceSteps.position), asc(serviceSteps.id));
}

export async function listStepCourses(
  tx: Transaction,
): Promise<{ id: string; name: string; heldUntilFired: boolean }[]> {
  return tx
    .select({
      id: kitchenCourses.id,
      name: kitchenCourses.name,
      heldUntilFired: kitchenCourses.heldUntilFired,
    })
    .from(kitchenCourses)
    .where(eq(kitchenCourses.active, true))
    .orderBy(asc(kitchenCourses.displayOrder), asc(kitchenCourses.name));
}

/** Deletes children before parents while predecessor checks are immediate. */
export async function deleteServiceSteps(tx: Transaction, ids: readonly string[]): Promise<void> {
  const pending = await tx
    .select({ id: serviceSteps.id, afterStepId: serviceSteps.afterStepId })
    .from(serviceSteps)
    .where(inArray(serviceSteps.id, [...ids]));
  while (pending.length) {
    const parents = new Set(pending.map((row) => row.afterStepId));
    const index = pending.findIndex((row) => !parents.has(row.id));
    const [row] = pending.splice(index, 1);
    await tx.delete(serviceSteps).where(eq(serviceSteps.id, row!.id));
  }
}

/** Returns parents before children, refusing references outside this save and cycles. */
export function serviceStepOrder(
  steps: readonly { key: string; afterStepKey: string | null }[],
  refuse: (index: number) => never,
): number[] {
  const keys = new Map<string, number>();
  steps.forEach((step, index) => {
    if (keys.has(step.key)) refuse(index);
    keys.set(step.key, index);
  });
  const visiting = new Set<number>();
  const ordered = new Set<number>();
  const visit = (index: number): void => {
    if (ordered.has(index)) return;
    if (visiting.has(index)) refuse(index);
    visiting.add(index);
    const key = steps[index]!.afterStepKey;
    if (key !== null) {
      const parent = keys.get(key);
      if (parent === undefined) refuse(index);
      else visit(parent);
    }
    visiting.delete(index);
    ordered.add(index);
  };
  steps.forEach((_, index) => visit(index));
  return [...ordered];
}
export async function saveServiceSteps(
  tx: Transaction,
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
            .where(and(inArray(kitchenCourses.id, courseIds), eq(kitchenCourses.active, true)))
        ).map((row) => row.id),
  );
  const missing = courseIds.find((id) => !live.has(id));
  if (missing !== undefined) throw new AppError("course.not_found", { courseId: missing });

  const rows = steps.map((step, index) => ({
    key: step.key ?? step.id ?? `new:${index}`,
    afterStepKey: step.start === "after_step" ? (step.afterStepKey ?? null) : null,
    id: step.id ?? newId(),
  }));
  const refuse = (index: number): never => {
    throw new AppError("management.request_invalid", { field: `serviceSteps.${index}.start` });
  };
  steps.forEach((step, index) => {
    if (
      (step.start === "after_step") !== (rows[index]!.afterStepKey !== null) ||
      (step.start !== "after_step" && step.afterStepKey != null)
    )
      refuse(index);
  });
  const order = serviceStepOrder(rows, refuse);
  const byKey = new Map(rows.map((row) => [row.key, row.id]));
  // New parents must exist before kept children can be redirected away from an omitted parent.
  for (const position of order) {
    const step = steps[position]!;
    const row = rows[position]!;
    const values = {
      name: step.name.trim(),
      start: step.start,
      courseId: step.courseId,
      afterStepId: row.afterStepKey === null ? null : byKey.get(row.afterStepKey)!,
      minutes: step.minutes,
      position,
    };
    if (step.id === undefined)
      await tx.insert(serviceSteps).values({ id: row.id, departmentId, ...values });
    else await tx.update(serviceSteps).set(values).where(eq(serviceSteps.id, step.id));
  }
  const kept = new Set(rows.map((row) => row.id));
  await deleteServiceSteps(
    tx,
    [...stored].filter((id) => !kept.has(id)),
  );
}

export const STARTER_STEPS = [
  { name: "Set up", start: "seated", minutes: 0 },
  { name: "Take order", start: "after_step", minutes: 2 },
  { name: "Anything else?", start: "all_served", minutes: 10 },
] as const;

export async function addStarterServiceSteps(
  tx: Transaction,
  departmentId: string,
  staffLanguage?: StarterStaffLanguage,
): Promise<void> {
  const language = staffLanguage ?? (await readStarterStaffLanguage(tx));
  let previous: string | null = null;
  for (const [position, step] of STARTER_STEPS.entries()) {
    const id = newId();
    await tx.insert(serviceSteps).values({
      id,
      departmentId,
      position,
      name: starterName(STARTER_STEP_NAMES, step.name, language),
      start: step.start,
      courseId: null,
      afterStepId: step.start === "after_step" ? previous : null,
      minutes: step.minutes,
    });
    previous = id;
  }
}
