import { and, eq, inArray } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { VenueScope } from "./operations.js";
import { departments, zoneServicePolicies } from "./schema/service.js";

export async function readReleaseReminderMinutesByZone(
  tx: Transaction,
  zoneIds: readonly string[],
): Promise<ReadonlyMap<string, number | null>> {
  if (zoneIds.length === 0) return new Map();
  const rows = await tx
    .select({
      zoneId: zoneServicePolicies.zoneId,
      minutes: departments.releaseReminderMinutes,
    })
    .from(zoneServicePolicies)
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(inArray(zoneServicePolicies.zoneId, [...zoneIds]));
  return new Map(rows.map((row) => [row.zoneId, row.minutes]));
}

export async function listDepartmentReminderMinutes(
  tx: Transaction,
  cfg: VenueScope,
): Promise<Record<string, number | null>> {
  const rows = await tx
    .select({ id: departments.id, minutes: departments.releaseReminderMinutes })
    .from(departments)
    .where(and(eq(departments.locationId, cfg.locationId), eq(departments.active, true)));
  return Object.fromEntries(rows.map((row) => [row.id, row.minutes]));
}
