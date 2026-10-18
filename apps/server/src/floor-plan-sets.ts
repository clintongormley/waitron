import { and, asc, eq, inArray } from "drizzle-orm";
import {
  floorPlanPlacements,
  floorPlans,
  floorPlanSets,
  floorPlanTableParts,
  floorPlanTables,
  floorPlanTableSizes,
  floorTodayZones,
  floorZones,
  type Transaction,
} from "@waitron/db";
import type { FloorPlanSets } from "@waitron/module";
import { AppError } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

/**
 * A layout's tables on the plan and spare, each table counted once (spec §3). A part's place
 * reads as off while its joined table is placed; an unplaced joined table with a placed part has
 * come apart, so it is no spare, and its unplaced parts are free tables; while none of its parts
 * is placed, its parts are still joined and the joined table is the spare.
 */
export function layoutCounts(
  tables: readonly { id: string; placed: boolean; partOf: string | null }[],
): { onPlan: number; spare: number } {
  const placed = new Set(tables.filter((t) => t.placed).map((t) => t.id));
  const partsOf = new Map<string, string[]>();
  for (const t of tables) {
    if (t.partOf === null) continue;
    const parts = partsOf.get(t.partOf);
    if (parts === undefined) partsOf.set(t.partOf, [t.id]);
    else parts.push(t.id);
  }
  const anyPartPlaced = (joinedId: string) =>
    (partsOf.get(joinedId) ?? []).some((id) => placed.has(id));
  let onPlan = 0;
  let spare = 0;
  for (const t of tables) {
    if (t.partOf !== null && placed.has(t.partOf)) continue;
    if (t.placed) onPlan += 1;
    else if (t.partOf !== null ? anyPartPlaced(t.partOf) : !anyPartPlaced(t.id)) spare += 1;
  }
  return { onPlan, spare };
}

async function setsOfLocation(
  tx: Transaction,
  cfg: TillConfig,
  setIds: readonly string[],
): Promise<string[]> {
  if (setIds.length === 0) return [];
  const rows = await tx
    .select({ id: floorPlanSets.id })
    .from(floorPlanSets)
    .where(
      and(eq(floorPlanSets.locationId, cfg.locationId), inArray(floorPlanSets.id, [...setIds])),
    );
  const held = new Set(rows.map((row) => row.id));
  return setIds.filter((id) => held.has(id));
}

async function zonesOfLocation(
  tx: Transaction,
  cfg: TillConfig,
  zoneIds: readonly string[],
): Promise<string[]> {
  if (zoneIds.length === 0) return [];
  const rows = await tx
    .select({ id: floorZones.id })
    .from(floorZones)
    .where(and(eq(floorZones.locationId, cfg.locationId), inArray(floorZones.id, [...zoneIds])));
  const held = new Set(rows.map((row) => row.id));
  return zoneIds.filter((id) => held.has(id));
}

async function copyLayouts(
  tx: Transaction,
  cfg: TillConfig,
  fromSetId: string,
  toSetId: string,
): Promise<void> {
  const held = await setsOfLocation(tx, cfg, [fromSetId, toSetId]);
  for (const setId of [fromSetId, toSetId])
    if (!held.includes(setId)) throw new AppError("floor_plan_set.not_found", { setId });
  const plans = await tx
    .select()
    .from(floorPlans)
    .where(eq(floorPlans.setId, fromSetId))
    .orderBy(asc(floorPlans.id));
  for (const plan of plans) {
    const [copy] = await tx
      .insert(floorPlans)
      .values({ zoneId: plan.zoneId, setId: toSetId, revision: 1, savedAt: plan.savedAt })
      .returning({ id: floorPlans.id });
    const places = await tx
      .select({
        planTableId: floorPlanPlacements.planTableId,
        x: floorPlanPlacements.x,
        y: floorPlanPlacements.y,
        width: floorPlanPlacements.width,
        height: floorPlanPlacements.height,
        shape: floorPlanPlacements.shape,
        rotation: floorPlanPlacements.rotation,
      })
      .from(floorPlanPlacements)
      .where(eq(floorPlanPlacements.planId, plan.id));
    if (places.length > 0)
      await tx
        .insert(floorPlanPlacements)
        .values(places.map((place) => ({ ...place, planId: copy!.id })));
    const sizes = await tx
      .select({
        planTableId: floorPlanTableSizes.planTableId,
        width: floorPlanTableSizes.width,
        height: floorPlanTableSizes.height,
      })
      .from(floorPlanTableSizes)
      .where(eq(floorPlanTableSizes.planId, plan.id));
    if (sizes.length > 0)
      await tx
        .insert(floorPlanTableSizes)
        .values(sizes.map((size) => ({ ...size, planId: copy!.id })));
  }
}

async function readLayouts(
  tx: Transaction,
  cfg: TillConfig,
  requestedZones: readonly string[],
  requestedPairs: readonly { setId: string; zoneId: string }[],
): ReturnType<FloorPlanSets["readLayouts"]> {
  const zoneIds = await zonesOfLocation(tx, cfg, [
    ...new Set([...requestedZones, ...requestedPairs.map((p) => p.zoneId)]),
  ]);
  const setIds = await setsOfLocation(tx, cfg, [...new Set(requestedPairs.map((p) => p.setId))]);
  if (zoneIds.length === 0) return { tableCounts: new Map(), layouts: [] };
  const zoneHeld = new Set(zoneIds);
  const setHeld = new Set(setIds);
  const pairs = requestedPairs.filter((p) => zoneHeld.has(p.zoneId) && setHeld.has(p.setId));
  const asked = new Set(pairs.map((p) => `${p.setId}:${p.zoneId}`));
  const tables = await tx
    .select({
      id: floorPlanTables.id,
      zoneId: floorPlanTables.zoneId,
      partOf: floorPlanTableParts.joinedTableId,
    })
    .from(floorPlanTables)
    .leftJoin(floorPlanTableParts, eq(floorPlanTableParts.partTableId, floorPlanTables.id))
    .where(inArray(floorPlanTables.zoneId, zoneIds));
  const plans =
    pairs.length === 0
      ? []
      : (
          await tx
            .select({
              id: floorPlans.id,
              setId: floorPlans.setId,
              zoneId: floorPlans.zoneId,
              revision: floorPlans.revision,
            })
            .from(floorPlans)
            .where(
              and(
                inArray(floorPlans.setId, [...new Set(pairs.map((p) => p.setId))]),
                inArray(floorPlans.zoneId, [...new Set(pairs.map((p) => p.zoneId))]),
              ),
            )
        ).filter((plan) => asked.has(`${plan.setId}:${plan.zoneId}`));
  const places =
    plans.length === 0
      ? []
      : await tx
          .select({ planId: floorPlanPlacements.planId, tableId: floorPlanPlacements.planTableId })
          .from(floorPlanPlacements)
          .where(
            inArray(
              floorPlanPlacements.planId,
              plans.map((plan) => plan.id),
            ),
          );
  const tablesOf = new Map<string, { id: string; partOf: string | null }[]>(
    zoneIds.map((zoneId) => [zoneId, []]),
  );
  for (const t of tables) tablesOf.get(t.zoneId)?.push({ id: t.id, partOf: t.partOf });
  const planOf = new Map(plans.map((plan) => [`${plan.setId}:${plan.zoneId}`, plan]));
  const placedOf = new Map<string, Set<string>>();
  for (const row of places) {
    const placed = placedOf.get(row.planId);
    if (placed === undefined) placedOf.set(row.planId, new Set([row.tableId]));
    else placed.add(row.tableId);
  }
  const counted = new Set(requestedZones);
  const tableCounts = new Map(
    zoneIds
      .filter((zoneId) => counted.has(zoneId))
      .map((zoneId) => [zoneId, tablesOf.get(zoneId)!.length]),
  );
  const layouts = pairs.map(({ setId, zoneId }) => {
    const plan = planOf.get(`${setId}:${zoneId}`);
    const placed = (plan === undefined ? undefined : placedOf.get(plan.id)) ?? new Set<string>();
    const counts = layoutCounts(
      tablesOf.get(zoneId)!.map((t) => ({ id: t.id, placed: placed.has(t.id), partOf: t.partOf })),
    );
    return { setId, zoneId, revision: plan?.revision ?? 0, ...counts };
  });
  return { tableCounts, layouts };
}

async function zonesShowing(tx: Transaction, cfg: TillConfig, setId: string): Promise<string[]> {
  const rows = await tx
    .select({ zoneId: floorTodayZones.zoneId })
    .from(floorTodayZones)
    .innerJoin(floorZones, eq(floorZones.id, floorTodayZones.zoneId))
    .where(and(eq(floorTodayZones.setId, setId), eq(floorZones.locationId, cfg.locationId)))
    .orderBy(asc(floorZones.displayOrder), asc(floorZones.name), asc(floorZones.id));
  return rows.map((row) => row.zoneId);
}

export function floorPlanSetsFor(cfg: TillConfig): FloorPlanSets {
  return {
    async create(tx) {
      const [row] = await tx
        .insert(floorPlanSets)
        .values({ locationId: cfg.locationId })
        .returning({ id: floorPlanSets.id });
      return row!.id;
    },
    copyLayouts: (tx, fromSetId, toSetId) => copyLayouts(tx, cfg, fromSetId, toSetId),
    readLayouts: (tx, zoneIds, pairs) => readLayouts(tx, cfg, zoneIds, pairs),
    zonesShowing: (tx, setId) => zonesShowing(tx, cfg, setId),
  };
}

export async function removeSets(
  tx: Transaction,
  cfg: TillConfig,
  requested: readonly string[],
): Promise<void> {
  const setIds = await setsOfLocation(tx, cfg, requested);
  if (setIds.length === 0) return;
  const plans = await tx
    .select({ id: floorPlans.id })
    .from(floorPlans)
    .where(inArray(floorPlans.setId, setIds));
  const planIds = plans.map((plan) => plan.id);
  await tx.delete(floorPlanPlacements).where(inArray(floorPlanPlacements.planId, planIds));
  await tx.delete(floorPlanTableSizes).where(inArray(floorPlanTableSizes.planId, planIds));
  await tx.delete(floorPlans).where(inArray(floorPlans.id, planIds));
  await tx
    .update(floorTodayZones)
    .set({ setId: null })
    .where(inArray(floorTodayZones.setId, setIds));
  await tx.delete(floorPlanSets).where(inArray(floorPlanSets.id, setIds));
}
