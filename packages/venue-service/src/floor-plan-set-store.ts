import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { floorZones, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import "./errors.js";
import type { VenueScope } from "./operations.js";
import { departmentFloorPlanSets } from "./schema/floor-plan-sets.js";
import { departments, zoneServicePolicies } from "./schema/service.js";

export interface FloorPlanSetSummary {
  setId: string;
  departmentId: string;
  name: string;
  isDefault: boolean;
  /** The department's zones, in display order. */
  zoneIds: readonly string[];
}

/** Gives a core floor plan set to a department under `name`; the department's first set is its default. */
export async function linkFloorPlanSet(
  tx: Transaction,
  cfg: VenueScope,
  input: { setId: string; departmentId: string; name: string },
): Promise<void> {
  const [department] = await tx
    .select({ id: departments.id })
    .from(departments)
    .where(
      and(
        eq(departments.id, input.departmentId),
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
      ),
    );
  if (department === undefined)
    throw new AppError("department.not_found", { departmentId: input.departmentId });
  const held = await tx
    .select({ name: departmentFloorPlanSets.name })
    .from(departmentFloorPlanSets)
    .where(eq(departmentFloorPlanSets.departmentId, input.departmentId));
  if (held.some(({ name }) => name === input.name))
    throw new AppError("floor_plan_set.name_taken", {
      departmentId: input.departmentId,
      name: input.name,
    });
  await tx.insert(departmentFloorPlanSets).values({
    setId: input.setId,
    departmentId: input.departmentId,
    name: input.name,
    isDefault: held.length === 0,
  });
}

/** The sets of the venue's active departments, each department's default first, then by name. */
export async function readFloorPlanSets(
  tx: Transaction,
  cfg: VenueScope,
  filter: { setIds?: readonly string[]; departmentId?: string } = {},
): Promise<FloorPlanSetSummary[]> {
  if (filter.setIds?.length === 0) return [];
  const sets = await tx
    .select({
      setId: departmentFloorPlanSets.setId,
      departmentId: departmentFloorPlanSets.departmentId,
      name: departmentFloorPlanSets.name,
      isDefault: departmentFloorPlanSets.isDefault,
    })
    .from(departmentFloorPlanSets)
    .innerJoin(departments, eq(departments.id, departmentFloorPlanSets.departmentId))
    .where(
      and(
        eq(departments.locationId, cfg.locationId),
        eq(departments.active, true),
        filter.setIds === undefined
          ? undefined
          : inArray(departmentFloorPlanSets.setId, [...filter.setIds]),
        filter.departmentId === undefined
          ? undefined
          : eq(departmentFloorPlanSets.departmentId, filter.departmentId),
      ),
    )
    .orderBy(
      asc(departmentFloorPlanSets.departmentId),
      desc(departmentFloorPlanSets.isDefault),
      asc(departmentFloorPlanSets.name),
    );
  if (sets.length === 0) return [];
  const zones = await tx
    .select({ zoneId: floorZones.id, departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .innerJoin(floorZones, eq(floorZones.id, zoneServicePolicies.zoneId))
    .where(
      and(
        eq(zoneServicePolicies.locationId, cfg.locationId),
        eq(floorZones.active, true),
        inArray(zoneServicePolicies.departmentId, [...new Set(sets.map((s) => s.departmentId))]),
      ),
    )
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  return sets.map((set) => ({
    ...set,
    zoneIds: zones.filter((z) => z.departmentId === set.departmentId).map((z) => z.zoneId),
  }));
}
