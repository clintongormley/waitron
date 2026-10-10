import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import {
  diningTables,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  partyTables,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { readLocationClock, venueMomentAt } from "@waitron/reporting";
import { AppError } from "@waitron/shared";
import {
  planReset,
  targetsFromMaster,
  type LiveTable,
  type Placement,
  type Target,
} from "./floor-reset-plan.js";
import type { TillConfig } from "./till-config.js";

type Placed = {
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  shape: "rect" | "round" | null;
  rotation: number | null;
};

/** The placement checks hold all six columns set or none, so `x` alone tells which. */
function placementOf(row: Placed): Placement | null {
  if (row.x === null) return null;
  return {
    x: row.x,
    y: row.y!,
    width: row.width!,
    height: row.height!,
    shape: row.shape!,
    rotation: row.rotation!,
  };
}

function placementColumns(placement: Placement | null): Placed {
  return placement ?? { x: null, y: null, width: null, height: null, shape: null, rotation: null };
}

function targetRow(target: Target) {
  return {
    label: target.label,
    seats: target.seats,
    fixed: target.fixed,
    ...placementColumns(target.placement),
  };
}

export async function todayBusinessDay(
  tx: Transaction,
  cfg: TillConfig,
  now: Date,
): Promise<string | null> {
  return venueMomentAt(now, await readLocationClock(tx, cfg.locationId))?.businessDay ?? null;
}

/** Copies the zone's master into today's plan: replaces the zone's reset rows with targetsFromMaster, then catches up. */
export async function resetZone(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
): Promise<void> {
  const day = await todayBusinessDay(tx, cfg, now);
  if (day !== null) await resetZoneFor(tx, cfg, removals, zoneId, day, now);
}

async function resetZoneFor(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  businessDay: string,
  now: Date,
): Promise<void> {
  const [today] = await tx
    .select({ id: floorTodayZones.id, generation: floorTodayZones.generation })
    .from(floorTodayZones)
    .where(eq(floorTodayZones.zoneId, zoneId));
  if (today === undefined) {
    await tx.insert(floorTodayZones).values({ zoneId, businessDay, generation: 1 });
  } else {
    await tx
      .update(floorTodayZones)
      .set({ businessDay, generation: today.generation + 1 })
      .where(eq(floorTodayZones.id, today.id));
  }

  const master = await tx
    .select()
    .from(floorPlanTables)
    .innerJoin(floorPlans, eq(floorPlans.id, floorPlanTables.planId))
    .where(eq(floorPlans.zoneId, zoneId));
  const live = await zoneTables(tx, cfg, zoneId);
  const targets = targetsFromMaster(
    master.map(({ floor_plan_tables: row }) => ({
      id: row.id,
      label: row.label,
      seats: row.seats,
      fixed: row.fixed,
      placement: placementOf(row),
    })),
    live,
  );
  await tx.delete(floorResetTables).where(eq(floorResetTables.zoneId, zoneId));
  for (const target of targets) {
    await tx.insert(floorResetTables).values({
      zoneId,
      tableId: target.tableId,
      planTableId: target.planTableId,
      ...targetRow(target),
      remove: target.remove,
      pending: true,
    });
  }
  await catchUpZone(tx, cfg, removals, zoneId, now);
}

function zoneTables(tx: Transaction, cfg: TillConfig, zoneId: string) {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      planTableId: diningTables.planTableId,
      planned: diningTables.planned,
    })
    .from(diningTables)
    .where(and(eq(diningTables.locationId, cfg.locationId), eq(diningTables.zoneId, zoneId)));
}

/** Applies the zone's PENDING reset rows that can be applied now, repeating while a pass changes something. */
export async function catchUpZone(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
): Promise<void> {
  while (await catchUpPass(tx, cfg, removals, zoneId, now));
}

/** One pass; true when a reset row stopped being pending, which can free a name for the next. */
async function catchUpPass(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .select()
    .from(floorResetTables)
    .where(and(eq(floorResetTables.zoneId, zoneId), eq(floorResetTables.pending, true)));
  if (rows.length === 0) return false;
  const rowOf = new Map<Target, (typeof rows)[number]>();
  for (const row of rows) {
    const target: Target = {
      tableId: row.tableId,
      planTableId: row.planTableId,
      label: row.label,
      seats: row.seats,
      fixed: row.fixed,
      placement: placementOf(row),
      remove: row.remove,
    };
    rowOf.set(target, row);
  }
  const targets = [...rowOf.keys()];

  const venueTables = await tx
    .select({ id: diningTables.id, label: diningTables.label, zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(eq(diningTables.locationId, cfg.locationId));
  const inZone = venueTables.filter((table) => table.zoneId === zoneId);
  const takenElsewhere = new Set(
    venueTables.filter((table) => table.zoneId !== zoneId).map((table) => table.label),
  );
  const ids = inZone.map((table) => table.id);
  const inZoneIds = new Set(ids);
  const held = new Set(
    (
      await tx
        .select({ tableId: partyTables.tableId })
        .from(partyTables)
        .where(and(inArray(partyTables.tableId, ids), isNull(partyTables.leftAt)))
    ).map((row) => row.tableId),
  );
  const withToday = new Set(
    (
      await tx
        .select({ tableId: floorTodayTables.tableId })
        .from(floorTodayTables)
        .where(inArray(floorTodayTables.tableId, ids))
    ).map((row) => row.tableId),
  );
  // A refused table waits whole: held, and counted as having its today's row so nothing seeds it.
  const refused = new Set<string>();
  for (const target of targets) {
    const id = target.tableId;
    if (!target.remove || id === null || held.has(id) || !inZoneIds.has(id)) continue;
    if (await refusedByAModule(tx, cfg, removals, id, now)) refused.add(id);
  }
  const waiting = new Set([...held, ...refused]);
  const mergedWithHeld = await mergedWithAny(tx, ids, waiting);
  const live: LiveTable[] = inZone.map((table) => ({
    id: table.id,
    label: table.label,
    held: waiting.has(table.id),
    tied: tableTied(waiting, table.id),
    hasToday: withToday.has(table.id) || refused.has(table.id),
    mergedWithHeld: mergedWithHeld.has(table.id),
  }));

  const plan = planReset({ targets, live, takenElsewhere });

  for (const tableId of plan.remove) await removeLiveTable(tx, tableId);
  for (const tableId of plan.hide) await hideTable(tx, tableId);
  const labelOf = new Map(inZone.map((table) => [table.id, table.label]));
  for (const { target, label } of plan.apply) {
    if (label !== null && label !== labelOf.get(target.tableId!)) {
      await setLabel(tx, target.tableId!, target.tableId!);
    }
  }
  const createdIds = new Map<Target, string>();
  for (const target of plan.create) {
    const [created] = await tx
      .insert(diningTables)
      .values({
        locationId: cfg.locationId,
        zoneId,
        label: target.label,
        planTableId: target.planTableId,
        planned: true,
      })
      .returning({ id: diningTables.id });
    createdIds.set(target, created!.id);
    await tx.insert(floorTodayTables).values({ tableId: created!.id, ...todayColumns(target) });
  }
  const placedNow = new Set<Target>();
  for (const { target, label } of plan.apply) {
    const tableId = target.tableId!;
    if (label !== null) await setLabel(tx, tableId, label);
    // Placed once per reset: a row waiting only for its name keeps the day's moves and merges.
    if (rowOf.get(target)!.placed) continue;
    placedNow.add(target);
    await tx.update(diningTables).set({ active: true }).where(eq(diningTables.id, tableId));
    await leaveMerges(tx, [tableId]);
    await tx
      .insert(floorTodayTables)
      .values({ tableId, ...todayColumns(target) })
      .onConflictDoUpdate({ target: floorTodayTables.tableId, set: todayColumns(target) });
  }
  for (const target of plan.seed) {
    await tx.insert(floorTodayTables).values({ tableId: target.tableId!, ...todayColumns(target) });
  }

  const stillPending = new Set(plan.pending);
  let changed = false;
  for (const [target, row] of rowOf) {
    const pending = stillPending.has(target);
    if (pending && !placedNow.has(target)) continue;
    if (!pending) changed = true;
    await tx
      .update(floorResetTables)
      .set({
        pending,
        placed: row.placed || placedNow.has(target),
        tableId: createdIds.get(target) ?? row.tableId,
      })
      .where(eq(floorResetTables.id, row.id));
  }
  return changed;
}

function todayColumns(target: Target) {
  return {
    seats: target.seats,
    fixed: target.fixed,
    ...placementColumns(target.placement),
    takenOff: false,
  };
}

async function refusedByAModule(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<boolean> {
  for (const removal of removals) {
    try {
      await removal.refuse(tx, { locationId: cfg.locationId }, tableId, now);
    } catch (error) {
      if (error instanceof AppError) return true;
      throw error;
    }
  }
  return false;
}

/** Until Task 1.9 a table is tied exactly while it is held. */
function tableTied(held: ReadonlySet<string>, tableId: string): boolean {
  return held.has(tableId);
}

/** Until Task 1.9 a removal hides the table. */
async function removeLiveTable(tx: Transaction, tableId: string): Promise<void> {
  await hideTable(tx, tableId);
}

/** Takes the table off today's plan; `active` false keeps every reader that skips an inactive table off it. */
async function hideTable(tx: Transaction, tableId: string): Promise<void> {
  await leaveMerges(tx, [tableId]);
  await tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId));
  await tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, tableId));
}

async function setLabel(tx: Transaction, tableId: string, label: string): Promise<void> {
  await tx.update(diningTables).set({ label }).where(eq(diningTables.id, tableId));
}

/** Tables in a today's merge with any of `tables`, those tables included. */
async function mergedWithAny(
  tx: Transaction,
  zoneTableIds: readonly string[],
  tables: ReadonlySet<string>,
): Promise<Set<string>> {
  const members = await tx
    .select({ joinId: floorTodayJoinTables.joinId, tableId: floorTodayJoinTables.tableId })
    .from(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...zoneTableIds]));
  const joins = new Set(members.filter((m) => tables.has(m.tableId)).map((m) => m.joinId));
  return new Set(members.filter((m) => joins.has(m.joinId)).map((m) => m.tableId));
}

/**
 * The tables leave their today's merges; a merge left with fewer than two members goes, and its last
 * member goes back to where it stood before the merge.
 */
async function leaveMerges(tx: Transaction, tableIds: readonly string[]): Promise<void> {
  const left = await tx
    .delete(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...tableIds]))
    .returning({ joinId: floorTodayJoinTables.joinId });
  for (const joinId of new Set(left.map((row) => row.joinId))) {
    const rest = await tx
      .select({
        tableId: floorTodayJoinTables.tableId,
        beforeX: floorTodayJoinTables.beforeX,
        beforeY: floorTodayJoinTables.beforeY,
        beforeRotation: floorTodayJoinTables.beforeRotation,
      })
      .from(floorTodayJoinTables)
      .where(eq(floorTodayJoinTables.joinId, joinId));
    if (rest.length >= 2) continue;
    for (const member of rest) {
      await tx
        .update(floorTodayTables)
        .set({ x: member.beforeX, y: member.beforeY, rotation: member.beforeRotation })
        .where(and(eq(floorTodayTables.tableId, member.tableId), isNotNull(floorTodayTables.x)));
    }
    await tx.delete(floorTodayJoinTables).where(eq(floorTodayJoinTables.joinId, joinId));
    await tx.delete(floorTodayJoins).where(eq(floorTodayJoins.id, joinId));
  }
}

/** For each zone with a master plan: resetZone when its today's plan is for an earlier business day (or it has none), else catchUpZone when it has pending rows. */
export async function ensureToday(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
): Promise<void> {
  const day = await todayBusinessDay(tx, cfg, now);
  if (day === null) return;
  const zones = await tx
    .select({ zoneId: floorPlans.zoneId, businessDay: floorTodayZones.businessDay })
    .from(floorPlans)
    .innerJoin(floorZones, eq(floorZones.id, floorPlans.zoneId))
    .leftJoin(floorTodayZones, eq(floorTodayZones.zoneId, floorPlans.zoneId))
    .where(eq(floorZones.locationId, cfg.locationId));
  for (const { zoneId, businessDay } of zones) {
    if (businessDay === null || businessDay < day) {
      await resetZoneFor(tx, cfg, removals, zoneId, day, now);
    } else {
      await catchUpZone(tx, cfg, removals, zoneId, now);
    }
  }
}
