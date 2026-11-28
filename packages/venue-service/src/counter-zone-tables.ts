import { and, eq, exists, or, type SQL } from "drizzle-orm";
import {
  departments,
  diningTables,
  floorPlanTables,
  floorZones,
  type Transaction,
} from "@waitron/db";
import { AppError } from "@waitron/shared";
import { effectiveOrderStart } from "./zone-order-start.js";
import "./errors.js";

export async function assertNoCounterTables(
  tx: Transaction,
  affectedZones: SQL,
  field: "orderStart" | "departmentId",
): Promise<void> {
  const rows = await tx
    .select({
      zoneName: floorZones.name,
      zoneOrderStart: floorZones.orderStart,
      departmentOrderStart: departments.orderStart,
    })
    .from(floorZones)
    .innerJoin(departments, eq(departments.id, floorZones.departmentId))
    .where(
      and(
        affectedZones,
        eq(floorZones.active, true),
        or(
          exists(
            tx
              .select({ id: floorPlanTables.id })
              .from(floorPlanTables)
              .where(eq(floorPlanTables.zoneId, floorZones.id)),
          ),
          exists(
            tx
              .select({ id: diningTables.id })
              .from(diningTables)
              .where(and(eq(diningTables.zoneId, floorZones.id), eq(diningTables.onFloor, true))),
          ),
        ),
      ),
    )
    .orderBy(floorZones.displayOrder, floorZones.name, floorZones.id);
  const firstCounter = rows.find(
    (row) => effectiveOrderStart(row.zoneOrderStart, row.departmentOrderStart) === "counter",
  );
  if (firstCounter !== undefined)
    throw new AppError("zone.counter_has_tables", { field, zoneName: firstCounter.zoneName });
}
