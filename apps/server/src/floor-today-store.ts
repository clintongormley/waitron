import { and, eq, exists, inArray, isNull, lt, or } from "drizzle-orm";
import {
  diningTables,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  floorTodayJoinTables,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  partyTables,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { readLocationClock, venueMomentAt } from "@waitron/reporting";
import {
  planReset,
  targetsFromMaster,
  type LiveTable,
  type Placement,
  type Target,
} from "./floor-reset-plan.js";
import { leaveMerges } from "./floor-today-merges.js";
import { refusedByAModule, removeLiveTables, tablesTied } from "./table-removal.js";
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
export function placementOf(row: Placed): Placement | null {
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

export function placementColumns(placement: Placement | null): Placed {
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
  if (targets.length > 0) {
    await tx.insert(floorResetTables).values(
      targets.map((target) => ({
        zoneId,
        tableId: target.tableId,
        planTableId: target.planTableId,
        ...targetRow(target),
        remove: target.remove,
        pending: true,
      })),
    );
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
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zoneId: diningTables.zoneId,
      active: diningTables.active,
    })
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
  const refused = new Set(
    (
      await refusedByAModule(
        tx,
        cfg,
        removals,
        targets.flatMap(({ remove, tableId: id }) =>
          remove && id !== null && !held.has(id) && inZoneIds.has(id) ? [id] : [],
        ),
        now,
      )
    ).keys(),
  );
  const waiting = new Set([...held, ...refused]);
  const { merged, mergedWithHeld } = await mergesOf(tx, ids, waiting);
  const removing = new Set(targets.filter((target) => target.remove).map((t) => t.tableId));
  const tied = await tablesTied(
    tx,
    ids.filter((id) => removing.has(id) && !waiting.has(id)),
  );
  const live: LiveTable[] = inZone.map((table) => ({
    id: table.id,
    label: table.label,
    held: held.has(table.id),
    refused: refused.has(table.id),
    tied: held.has(table.id) || tied.has(table.id),
    hasToday: withToday.has(table.id),
    mergedWithHeld: mergedWithHeld.has(table.id),
  }));

  const plan = planReset({ targets, live, takenElsewhere });

  const kept = await removeLiveTables(tx, cfg, removals, plan.remove, now);
  const activeIds = new Set(inZone.filter((table) => table.active).map((table) => table.id));
  // A table already hidden is skipped; a kept one was changed by its failed removal, so is not.
  for (const tableId of plan.hide) {
    if (activeIds.has(tableId) || withToday.has(tableId) || merged.has(tableId)) {
      await hideTable(tx, tableId);
    }
  }
  for (const tableId of kept) await hideTable(tx, tableId);
  // Each renamed table first steps aside under a spare name, so a swap never meets the unique
  // (location, label) key halfway.
  const labelOf = new Map(inZone.map((table) => [table.id, table.label]));
  const renamed = plan.apply.filter(
    ({ target, label }) => label !== null && label !== labelOf.get(target.tableId!),
  );
  const spare = spareLabels(
    renamed.map(({ target }) => target.tableId!),
    new Set([
      ...venueTables.map((table) => table.label),
      ...plan.apply.flatMap(({ label }) => (label === null ? [] : [label])),
      ...plan.create.map((target) => target.label),
    ]),
  );
  for (const [tableId, label] of spare) await setLabel(tx, tableId, label);
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
    const pending = stillPending.has(target) || kept.has(target.tableId!);
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

/** Takes the table off today's plan; `active` false keeps every reader that skips an inactive table off it. */
async function hideTable(tx: Transaction, tableId: string): Promise<void> {
  await leaveMerges(tx, [tableId]);
  await tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId));
  await tx.update(diningTables).set({ active: false }).where(eq(diningTables.id, tableId));
}

/**
 * A name for each of `ids` that is not in `avoid` and not given to another of `ids`. A label may be
 * any string, a row id included, so an id alone is not a safe name to step aside under.
 */
export function spareLabels(
  ids: readonly string[],
  avoid: ReadonlySet<string>,
): Map<string, string> {
  const taken = new Set(avoid);
  const spare = new Map<string, string>();
  for (const id of ids) {
    let label = id;
    for (let n = 1; taken.has(label); n++) label = `${id} ${n}`;
    taken.add(label);
    spare.set(id, label);
  }
  return spare;
}

async function setLabel(tx: Transaction, tableId: string, label: string): Promise<void> {
  await tx.update(diningTables).set({ label }).where(eq(diningTables.id, tableId));
}

/** The zone's tables in a today's merge, and those in one with any of `tables`, those included. */
async function mergesOf(
  tx: Transaction,
  zoneTableIds: readonly string[],
  tables: ReadonlySet<string>,
): Promise<{ merged: Set<string>; mergedWithHeld: Set<string> }> {
  const members = await tx
    .select({ joinId: floorTodayJoinTables.joinId, tableId: floorTodayJoinTables.tableId })
    .from(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...zoneTableIds]));
  const joins = new Set(members.filter((m) => tables.has(m.tableId)).map((m) => m.joinId));
  return {
    merged: new Set(members.map((m) => m.tableId)),
    mergedWithHeld: new Set(members.filter((m) => joins.has(m.joinId)).map((m) => m.tableId)),
  };
}

/** For each zone with a master plan: resetZone when its today's plan is for an earlier business day (or it has none), else catchUpZone when it has pending rows; one query finds those zones. */
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
    .where(
      and(
        eq(floorZones.locationId, cfg.locationId),
        // A reset switches tables on; a disabled zone's tables must stay off.
        eq(floorZones.active, true),
        or(
          isNull(floorTodayZones.businessDay),
          lt(floorTodayZones.businessDay, day),
          exists(
            tx
              .select({ id: floorResetTables.id })
              .from(floorResetTables)
              .where(
                and(
                  eq(floorResetTables.zoneId, floorPlans.zoneId),
                  eq(floorResetTables.pending, true),
                ),
              ),
          ),
        ),
      ),
    );
  for (const { zoneId, businessDay } of zones) {
    if (businessDay === null || businessDay < day) {
      await resetZoneFor(tx, cfg, removals, zoneId, day, now);
    } else {
      await catchUpZone(tx, cfg, removals, zoneId, now);
    }
  }
}
