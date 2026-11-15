import { AppError } from "@waitron/shared";
import "./errors.js";
import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { floorZones, departmentCourses, kitchenCourses, insertInChunks } from "@waitron/db";

export async function readCourseSettingsByZone(
  tx: Transaction,
  zoneIds?: readonly string[],
): Promise<ReadonlyMap<string, readonly DepartmentCourseSetting[]>> {
  if (zoneIds?.length === 0) return new Map();
  const zones = await tx
    .select({ id: floorZones.id, departmentId: floorZones.departmentId })
    .from(floorZones)
    .where(
      and(
        eq(floorZones.active, true),
        zoneIds === undefined ? undefined : inArray(floorZones.id, [...zoneIds]),
      ),
    );
  if (zones.length === 0) return new Map();
  const settings = await listDepartmentCourseSettings(tx);
  return new Map(zones.map((zone) => [zone.id, settings[zone.departmentId] ?? []]));
}

export interface DepartmentCourseSetting {
  courseId: string;
  heldUntilFired: boolean;
  reminderMinutes: number | null;
}

export async function listDepartmentCourseSettings(
  tx: Transaction,
): Promise<Record<string, DepartmentCourseSetting[]>> {
  const rows = await tx
    .select({
      departmentId: departmentCourses.departmentId,
      courseId: departmentCourses.courseId,
      heldUntilFired: departmentCourses.heldUntilFired,
      reminderMinutes: departmentCourses.reminderMinutes,
    })
    .from(departmentCourses)
    .innerJoin(kitchenCourses, eq(kitchenCourses.id, departmentCourses.courseId))
    .orderBy(kitchenCourses.displayOrder, kitchenCourses.id);
  const result: Record<string, DepartmentCourseSetting[]> = {};
  for (const { departmentId, ...row } of rows) (result[departmentId] ??= []).push(row);
  return result;
}

export async function saveDepartmentCourseSettings(
  tx: Transaction,
  departmentId: string,
  settings: readonly DepartmentCourseSetting[],
): Promise<void> {
  const active = new Set(
    (
      await tx
        .select({ id: kitchenCourses.id })
        .from(kitchenCourses)
        .where(eq(kitchenCourses.active, true))
    ).map((row) => row.id),
  );
  if (settings.some((row) => !active.has(row.courseId)))
    throw new AppError("management.request_invalid", { field: "courseSettings" });
  await tx.delete(departmentCourses).where(eq(departmentCourses.departmentId, departmentId));
  const rows = settings
    .filter((row) => !row.heldUntilFired || row.reminderMinutes !== 10)
    .map((row) => ({ departmentId, ...row }));
  if (rows.length > 0) await insertInChunks(tx, departmentCourses, rows);
}
