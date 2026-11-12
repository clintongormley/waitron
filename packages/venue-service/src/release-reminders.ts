import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import { departments, floorZones } from "@waitron/db";

export async function readReleaseReminderMinutesByZone(
  tx: Transaction,
  zoneIds: readonly string[],
): Promise<ReadonlyMap<string, number | null>> {
  if (zoneIds.length === 0) return new Map();
  const rows = await tx
    .select({
      zoneId: floorZones.id,
      minutes: departments.releaseReminderMinutes,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(and(inArray(floorZones.id, [...zoneIds]), eq(floorZones.active, true)));
  return new Map(rows.map((row) => [row.zoneId, row.minutes]));
}

export async function listDepartmentReminderMinutes(
  tx: Transaction,
): Promise<Record<string, number | null>> {
  const rows = await tx
    .select({ id: departments.id, minutes: departments.releaseReminderMinutes })
    .from(departments)
    .where(eq(departments.active, true));
  return Object.fromEntries(rows.map((row) => [row.id, row.minutes]));
}
