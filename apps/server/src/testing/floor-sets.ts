import { eq } from "drizzle-orm";
import { floorPlanSets, type Transaction } from "@waitron/db";
import { linkFloorPlanSet, readFloorPlanSets, zoneServicePolicies } from "@waitron/venue-service";
import type { LayoutRef } from "../floor-plan.js";
import type { TillConfig } from "../till-config.js";

/** The default set of the zone's department, made under `name` when the department has none. */
export async function defaultLayout(
  tx: Transaction,
  cfg: TillConfig,
  zoneId: string,
  name = "Standard",
): Promise<LayoutRef> {
  const [policy] = await tx
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, zoneId));
  if (policy === undefined) throw new Error(`defaultLayout: zone ${zoneId} has no department`);
  const sets = await readFloorPlanSets(tx, cfg, { departmentId: policy.departmentId });
  const held = sets.find((set) => set.isDefault);
  if (held !== undefined) return { setId: held.setId, zoneId };
  const [row] = await tx
    .insert(floorPlanSets)
    .values({ locationId: cfg.locationId })
    .returning({ id: floorPlanSets.id });
  await linkFloorPlanSet(tx, cfg, { setId: row!.id, departmentId: policy.departmentId, name });
  return { setId: row!.id, zoneId };
}
