import { requireZone } from "./floor-plan.js";
import { and, eq, exists, getTableColumns, inArray, isNull, lt, or } from "drizzle-orm";
import {
  diningTables,
  floorPlans,
  floorPlanTableParts,
  floorPlanTables,
  floorResetTableParts,
  floorResetTables,
  floorTodayJoins,
  floorTodayJoinTables,
  floorTodaySplitParts,
  floorTodayTables,
  floorTodayZones,
  floorZones,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { readLocationClock, venueMomentAt } from "@waitron/reporting";
import { AppError, NEW_TABLE_SIZE, groupStep } from "@waitron/shared";
import {
  planReset,
  targetsFromMaster,
  type LiveTable,
  type Placement,
  type Target,
} from "./floor-reset-plan.js";
import { foodOnItsWay } from "./delivery-release.js";
import { leaveMerges } from "./floor-today-merges.js";
import { holdersOf } from "./parties.js";
import {
  refuseInJoinedTable,
  refuseUnfree,
  refuseUnmovable,
  todayOf,
} from "./floor-today-table.js";
import { refusedByAModule, removeLiveTables, tablesTied } from "./table-removal.js";
import type { TillConfig } from "./till-config.js";
import "./errors.js";

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
  await requireZone(tx, cfg, zoneId);
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
  await tx
    .delete(floorResetTableParts)
    .where(
      inArray(
        floorResetTableParts.joinedResetTableId,
        tx
          .select({ id: floorResetTables.id })
          .from(floorResetTables)
          .where(eq(floorResetTables.zoneId, zoneId)),
      ),
    );
  await tx.delete(floorResetTables).where(eq(floorResetTables.zoneId, zoneId));
  if (targets.length > 0) {
    const written = await tx
      .insert(floorResetTables)
      .values(
        targets.map((target) => ({
          zoneId,
          tableId: target.tableId,
          planTableId: target.planTableId,
          ...targetRow(target),
          remove: target.remove,
          pending: true,
        })),
      )
      .returning({ id: floorResetTables.id, planTableId: floorResetTables.planTableId });
    await copyParts(tx, zoneId, written);
  }
  await catchUpZone(tx, cfg, removals, zoneId, now);
}

/** Skips a joined table more than one live table follows: its parts would join two copied tables. */
async function copyParts(
  tx: Transaction,
  zoneId: string,
  written: readonly { id: string; planTableId: string | null }[],
): Promise<void> {
  const master = await tx
    .select({ joined: floorPlanTableParts.joinedTableId, part: floorPlanTableParts.partTableId })
    .from(floorPlanTableParts)
    .innerJoin(floorPlanTables, eq(floorPlanTables.id, floorPlanTableParts.joinedTableId))
    .innerJoin(floorPlans, eq(floorPlans.id, floorPlanTables.planId))
    .where(eq(floorPlans.zoneId, zoneId));
  const rowsOf = new Map<string, string[]>();
  for (const row of written) {
    if (row.planTableId === null) continue;
    rowsOf.set(row.planTableId, [...(rowsOf.get(row.planTableId) ?? []), row.id]);
  }
  const copied = master.flatMap(({ joined, part }) => {
    const joinedRows = rowsOf.get(joined) ?? [];
    if (joinedRows.length !== 1) return [];
    return (rowsOf.get(part) ?? []).map((partRow) => ({
      joinedResetTableId: joinedRows[0]!,
      partResetTableId: partRow,
    }));
  });
  if (copied.length > 0) await tx.insert(floorResetTableParts).values(copied);
}

function zoneTables(tx: Transaction, cfg: TillConfig, zoneId: string) {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      planTableId: diningTables.planTableId,
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
  const zoneRows = await tx
    .select({ zoneId: floorZones.id, row: getTableColumns(floorResetTables) })
    .from(floorZones)
    .leftJoin(
      floorResetTables,
      and(eq(floorResetTables.zoneId, floorZones.id), eq(floorResetTables.pending, true)),
    )
    .where(
      and(
        eq(floorZones.id, zoneId),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (zoneRows.length === 0) throw new AppError("zone.not_found", { zoneId });
  const rows = zoneRows.flatMap(({ row }) => (row === null ? [] : [row]));
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
      splitOffFrom: floorTodaySplitParts.joinedTableId,
    })
    .from(diningTables)
    .leftJoin(floorTodaySplitParts, eq(floorTodaySplitParts.partTableId, diningTables.id))
    .where(eq(diningTables.locationId, cfg.locationId));
  const inZone = venueTables.filter((table) => table.zoneId === zoneId);
  const takenElsewhere = new Set(
    venueTables.filter((table) => table.zoneId !== zoneId).map((table) => table.label),
  );
  const ids = inZone.map((table) => table.id);
  const inZoneIds = new Set(ids);
  const held = new Set((await holdersOf(tx, ids)).keys());
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
  const merges = await mergesOf(tx, ids);
  const merged = new Set(merges.map((m) => m.tableId));
  const foodComing = await foodComingTo(
    tx,
    inZone.flatMap((table) => (table.splitOffFrom === null ? [] : [table.id, table.splitOffFrom])),
  );
  const { mergedWithHeld, splitBusy } = waitingTogether(inZone, merges, waiting, foodComing);
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
    splitWithBusy: splitBusy.has(table.id),
  }));

  const plan = planReset({ targets, live, takenElsewhere });

  const kept = await removeLiveTables(tx, cfg, removals, plan.remove, now);
  // A table already hidden is skipped; a kept one was changed by its failed removal, so is not.
  for (const tableId of plan.hide) {
    if (withToday.has(tableId) || merged.has(tableId)) {
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
    await leaveMerges(tx, [tableId]);
    await tx
      .insert(floorTodayTables)
      .values({ tableId, ...todayColumns(target) })
      .onConflictDoUpdate({ target: floorTodayTables.tableId, set: todayColumns(target) });
  }
  for (const target of plan.seed) {
    await tx.insert(floorTodayTables).values({ tableId: target.tableId!, ...todayColumns(target) });
  }
  const putBack = [...placedNow].map((target) => target.tableId!);
  if (putBack.length > 0) {
    await tx
      .delete(floorTodaySplitParts)
      .where(inArray(floorTodaySplitParts.joinedTableId, putBack));
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

async function hideTable(tx: Transaction, tableId: string): Promise<void> {
  await leaveMerges(tx, [tableId]);
  await tx.delete(floorTodayTables).where(eq(floorTodayTables.tableId, tableId));
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

/** Every member of each split group, a joined table and the parts split off it, of which some member is `busy`. */
function busySplitGroups(
  tables: readonly { id: string; splitOffFrom: string | null }[],
  busy: (tableId: string) => boolean,
): Set<string> {
  const groups = new Map<string, string[]>();
  for (const { id, splitOffFrom } of tables) {
    if (splitOffFrom === null) continue;
    groups.set(splitOffFrom, [...(groups.get(splitOffFrom) ?? [splitOffFrom]), id]);
  }
  return new Set([...groups.values()].filter((group) => group.some(busy)).flat());
}

/** The members of the today's merges taking in any of the zone's tables. */
function mergesOf(
  tx: Transaction,
  zoneTableIds: readonly string[],
): Promise<{ joinId: string; tableId: string }[]> {
  return tx
    .select({ joinId: floorTodayJoinTables.joinId, tableId: floorTodayJoinTables.tableId })
    .from(floorTodayJoinTables)
    .where(inArray(floorTodayJoinTables.tableId, [...zoneTableIds]));
}

/**
 * Grows `waiting` until it is closed under both ties: a merge with a waiting table waits whole, and
 * so does a split group with a waiting member or a member in `foodComing`. Applying any table of
 * either would move a waiting table or one food is on its way to.
 */
function waitingTogether(
  tables: readonly { id: string; splitOffFrom: string | null }[],
  merges: readonly { joinId: string; tableId: string }[],
  waiting: ReadonlySet<string>,
  foodComing: ReadonlySet<string>,
): { mergedWithHeld: Set<string>; splitBusy: Set<string> } {
  let all = new Set(waiting);
  for (;;) {
    const mergedWithHeld = mergedWith(merges, all);
    const splitBusy = busySplitGroups(
      tables,
      (id) => all.has(id) || mergedWithHeld.has(id) || foodComing.has(id),
    );
    const grown = new Set([...all, ...mergedWithHeld, ...splitBusy]);
    if (grown.size === all.size) return { mergedWithHeld, splitBusy };
    all = grown;
  }
}

/** The tables in a merge with any of `tables`, those included. */
function mergedWith(
  members: readonly { joinId: string; tableId: string }[],
  tables: ReadonlySet<string>,
): Set<string> {
  const joins = new Set(members.filter((m) => tables.has(m.tableId)).map((m) => m.joinId));
  return new Set(members.filter((m) => joins.has(m.joinId)).map((m) => m.tableId));
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

/** Moves the table's top-left corner to `at`; a merge's members all move by the same distance. */
export async function moveToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  at: { x: number; y: number },
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  refuseUnmovable(today);
  const members = (today.merge?.members ?? [today.row]).filter((m) => m.x !== null);
  const { dx, dy } = groupStep(
    members.map((m) => ({ x: m.x!, y: m.y! })),
    { x: at.x - today.row.x!, y: at.y - today.row.y! },
  );
  for (const member of members) {
    await tx
      .update(floorTodayTables)
      .set({ x: member.x! + dx, y: member.y! + dy })
      .where(eq(floorTodayTables.id, member.id));
  }
}

/** Turns the table 15° clockwise about its centre: its corner, `x` and `y`, does not change. */
export async function rotateToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  refuseUnmovable(today);
  if (today.merge !== null) throw new AppError("table.merged", { tableId });
  await tx
    .update(floorTodayTables)
    .set({ rotation: (today.row.rotation! + 15) % 360 })
    .where(eq(floorTodayTables.id, today.row.id));
}

/** Puts a spare on the map with its top-left corner at `at`; a table with a place is left alone. */
export async function placeSpareToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  at: { x: number; y: number },
): Promise<void> {
  const { row } = await todayOf(tx, cfg, tableId);
  await refuseInJoinedTable(tx, [tableId]);
  if (row.takenOff) throw new AppError("table.taken_off", { tableId });
  if (row.x !== null) return;
  if (row.fixed) throw new AppError("table.fixed", { tableId });
  await tx
    .update(floorTodayTables)
    .set({
      x: at.x,
      y: at.y,
      width: NEW_TABLE_SIZE,
      height: NEW_TABLE_SIZE,
      shape: "rect",
      rotation: 0,
    })
    .where(eq(floorTodayTables.id, row.id));
}

/** Those of `tableIds` an order with food on its way is delivered to. */
export async function foodComingTo(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Set<string>> {
  if (tableIds.length === 0) return new Set();
  const rows = await tx
    .selectDistinct({ tableId: workingOrders.deliveryTableId })
    .from(workingOrders)
    .where(and(inArray(workingOrders.deliveryTableId, [...tableIds]), foodOnItsWay()));
  return new Set(rows.map((row) => row.tableId!));
}

/** An order with food on its way to the table. */
export async function refuseDeliveryPending(tx: Transaction, tableId: string): Promise<void> {
  const [delivery] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(eq(workingOrders.deliveryTableId, tableId), foodOnItsWay()));
  if (delivery !== undefined) throw new AppError("table.delivery_pending", { tableId });
}

/** A table split off a joined table goes back only through Join again or the reset. */
async function refuseSplitOff(tx: Transaction, tableId: string): Promise<void> {
  const [splitOff] = await tx
    .select({ id: floorTodaySplitParts.id })
    .from(floorTodaySplitParts)
    .where(eq(floorTodaySplitParts.partTableId, tableId))
    .limit(1);
  if (splitOff !== undefined) throw new AppError("table.split_off", { tableId });
}

/** Takes a free table off today's plan, keeping its place; one already taken off is left as it is. */
export async function takeOffToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  if (today.row.takenOff) return;
  if (today.merge !== null) throw new AppError("table.merged", { tableId });
  await refuseInJoinedTable(tx, [tableId]);
  await refuseSplitOff(tx, tableId);
  await refuseUnfree(tx, [tableId]);
  await refuseDeliveryPending(tx, tableId);
  await tx
    .update(floorTodayTables)
    .set({ takenOff: true })
    .where(eq(floorTodayTables.id, today.row.id));
}

export async function putBackToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<void> {
  const { row } = await todayOf(tx, cfg, tableId);
  await tx.update(floorTodayTables).set({ takenOff: false }).where(eq(floorTodayTables.id, row.id));
}

/** Today's seats for the table, or for its merge when it is in one. */
export async function seatsToday(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
  seats: number,
): Promise<void> {
  const today = await todayOf(tx, cfg, tableId);
  if (today.row.takenOff) throw new AppError("table.taken_off", { tableId });
  if (today.merge !== null) {
    await tx
      .update(floorTodayJoins)
      .set({ seats })
      .where(eq(floorTodayJoins.id, today.merge.joinId));
    return;
  }
  await tx.update(floorTodayTables).set({ seats }).where(eq(floorTodayTables.id, today.row.id));
}

/**
 * Sets the table's today's row from what the last reset copied for it, after it leaves any merge.
 * Its name is left alone: names change only at a reset or a catch-up.
 */
export async function backToSaved(
  tx: Transaction,
  cfg: TillConfig,
  tableId: string,
): Promise<void> {
  const { row } = await todayOf(tx, cfg, tableId);
  await refuseSplitOff(tx, tableId);
  const [splitOff] = await tx
    .select({ id: floorTodaySplitParts.id })
    .from(floorTodaySplitParts)
    .where(eq(floorTodaySplitParts.joinedTableId, tableId))
    .limit(1);
  if (splitOff !== undefined) throw new AppError("joined_table.parts_split_off", { tableId });
  const [saved] = await tx
    .select()
    .from(floorResetTables)
    .where(eq(floorResetTables.tableId, tableId));
  if (saved === undefined || saved.remove) {
    throw new AppError("table.not_on_today_plan", { tableId });
  }
  await leaveMerges(tx, [tableId]);
  await tx
    .update(floorTodayTables)
    .set({
      seats: saved.seats,
      fixed: saved.fixed,
      ...placementColumns(placementOf(saved)),
      takenOff: false,
    })
    .where(eq(floorTodayTables.id, row.id));
}
