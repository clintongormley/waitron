import { floorZones } from "@waitron/db";
import { eq } from "drizzle-orm";
import { floorPlanSets, type Transaction } from "@waitron/db";
import { linkFloorPlanSet, readFloorPlanSets } from "@waitron/venue-service";
import type { LayoutRef } from "../floor-plan.js";

/** The default set of the zone's department, made under `name` when the department has none. */
export async function defaultLayout(
  tx: Transaction,
  _cfg: unknown,
  zoneId: string,
  name = "Standard",
): Promise<LayoutRef> {
  const [policy] = await tx
    .select({ departmentId: floorZones.departmentId })
    .from(floorZones)
    .where(eq(floorZones.id, zoneId));
  if (policy === undefined) throw new Error(`defaultLayout: zone ${zoneId} has no department`);
  const sets = await readFloorPlanSets(tx, { departmentId: policy.departmentId });
  const held = sets.find((set) => set.isDefault);
  if (held !== undefined) return { setId: held.setId, zoneId };
  const [row] = await tx.insert(floorPlanSets).values({}).returning({ id: floorPlanSets.id });
  await linkFloorPlanSet(tx, { setId: row!.id, departmentId: policy.departmentId, name });
  return { setId: row!.id, zoneId };
}
