import { and, asc, eq, inArray } from "drizzle-orm";
import { departments, diningTables, floorZones, type Transaction } from "@waitron/db";

export async function readTablesNeedingClearing(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (tableIds.length === 0) return new Set();
  const rows = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .innerJoin(floorZones, eq(floorZones.id, diningTables.zoneId))
    // Not filtered on departments.active, unlike listNeedsClearingDepartmentIds:
    // plan 2026-10-19-a757-1, Decision 3.
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(
      and(
        inArray(diningTables.id, [...tableIds]),
        eq(departments.needsClearing, true),
        eq(floorZones.active, true),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

export async function listNeedsClearingDepartmentIds(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.active, true), eq(departments.needsClearing, true)))
    .orderBy(asc(departments.id));
  return rows.map((row) => row.id);
}
