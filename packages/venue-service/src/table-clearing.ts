import { and, asc, eq, inArray } from "drizzle-orm";
import { diningTables, type Transaction } from "@waitron/db";
import type { VenueScope } from "./operations.js";
import { departments, zoneServicePolicies } from "./schema/service.js";

export async function readTablesNeedingClearing(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (tableIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .innerJoin(zoneServicePolicies, eq(zoneServicePolicies.zoneId, diningTables.zoneId))
    // Not filtered on departments.active, unlike listNeedsClearingDepartmentIds:
    // plan 2026-10-19-a757-1, Decision 3.
    .innerJoin(departments, eq(departments.id, zoneServicePolicies.departmentId))
    .where(and(inArray(diningTables.id, [...tableIds]), eq(departments.needsClearing, true)));
  return new Set(rows.map((row) => row.id));
}

export async function listNeedsClearingDepartmentIds(
  tx: Transaction,
  cfg: VenueScope,
): Promise<string[]> {
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
        eq(departments.needsClearing, true),
      ),
    )
    .orderBy(asc(departments.id));
  return rows.map((row) => row.id);
}
