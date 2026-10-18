import { layoutTables, placedAsRead, planOf, requireZone } from "./floor-plan.js";
import {
  and,
  eq,
  exists,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
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
  joinedOutOfService,
  needsMoving,
  resetRowMoves,
  workingOrders,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { readLocationClock, venueMomentAt } from "@waitron/reporting";
import { AppError, NEW_TABLE_SIZE, groupStep } from "@waitron/shared";
import {
  blockedMoves,
  movesTable,
  planReset,
  targetsFromMaster,
  type LiveTable,
  type Placement,
  type ResetPlan,
  type Target,
} from "./floor-reset-plan.js";
import { foodOnItsWay } from "./delivery-release.js";
import { markMoved, tableNeedsMoving } from "./floor-today-mark-moved.js";
import { blocksPlaceSql } from "./joined-split-layout.js";
import { zoneLayoutsOn, type LayoutRow, type ZoneLayoutState } from "./floor-layout-due.js";
import { moveChangedRooms, roomPrints, roomRevisions } from "./floor-revision.js";
import { leaveMerges } from "./floor-today-merges.js";
import { withMovedSlips } from "./moved-slips.js";
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

/** The layout a reset makes today's plan from. */
export interface ResetOnto {
  setId: string;
  occurrence: string | null;
}

/**
 * Copies a layout of the zone into today's plan, `"due"` naming the one due at `now`: replaces
 * the zone's reset rows with targetsFromMaster, records the layout, then catches up. Answers the
 * room's new revision; null, and nothing reset, when the venue's clock names no business day or
 * `"due"` finds no layout due.
 */
export async function resetZone(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
  onto: ResetOnto | "due",
): Promise<number | null> {
  await requireZone(tx, cfg, zoneId);
  const day = await todayBusinessDay(tx, cfg, now);
  if (day === null) return null;
  if (onto !== "due") return resetZoneOn(tx, cfg, removals, zoneId, day, now, onto);
  const { states, rows } = await zoneLayoutsOn(tx, cfg, [zoneId], now, day);
  const due = dueOnto(states.get(zoneId)!);
  if (due === null) return null;
  return resetZoneFor(tx, cfg, removals, zoneId, day, now, due, rows.get(zoneId), {
    keepTakenOff: false,
  });
}

/** `resetZone` onto `onto` on business day `day`, for a caller that has read the day. */
export async function resetZoneOn(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  day: string,
  now: Date,
  onto: ResetOnto,
): Promise<number> {
  const layout = await planOf(tx, { setId: onto.setId, zoneId });
  return resetZoneFor(tx, cfg, removals, zoneId, day, now, onto, layout, { keepTakenOff: false });
}

/**
 * Update layout: resets the zone onto the layout due at `now` on business day `day`, keeping
 * taken-off tables off, when it is the one `sent` names; refuses `floor_today.layout_changed`
 * otherwise. Answers the room's new revision.
 */
export async function updateLayout(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  day: string | null,
  now: Date,
  sent: { setId: string; layoutRevision: number },
): Promise<number> {
  const { states, rows } = await zoneLayoutsOn(tx, cfg, [zoneId], now, day);
  const due = states.get(zoneId)!.due;
  if (
    day === null ||
    due === null ||
    due.setId !== sent.setId ||
    due.revision !== sent.layoutRevision
  ) {
    throw new AppError("floor_today.layout_changed", { zoneId });
  }
  return resetZoneFor(
    tx,
    cfg,
    removals,
    zoneId,
    day,
    now,
    { setId: due.setId, occurrence: due.occurrence },
    rows.get(zoneId),
    { keepTakenOff: true },
  );
}

function dueOnto(state: ZoneLayoutState): ResetOnto | null {
  return state.due === null ? null : { setId: state.due.setId, occurrence: state.due.occurrence };
}

interface ResetOptions {
  /** Each reset row copies whether its table is taken off today, rather than clearing it. */
  keepTakenOff: boolean;
}

/** Answers the room's new revision. */
async function resetZoneFor(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  businessDay: string,
  now: Date,
  onto: ResetOnto,
  layout: LayoutRow | undefined,
  { keepTakenOff }: ResetOptions,
): Promise<number> {
  const [today] = await tx
    .select({ id: floorTodayZones.id, revision: floorTodayZones.revision })
    .from(floorTodayZones)
    .where(eq(floorTodayZones.zoneId, zoneId));
  const revision = (today?.revision ?? 0) + 1;
  const record = {
    businessDay,
    revision,
    setId: onto.setId,
    layoutRevision: layout?.revision ?? 0,
    occurrence: onto.occurrence,
  };
  if (today === undefined) {
    await tx.insert(floorTodayZones).values({ zoneId, ...record });
  } else {
    await tx.update(floorTodayZones).set(record).where(eq(floorTodayZones.id, today.id));
  }

  const master = placedAsRead(await layoutTables(tx, zoneId, layout?.id ?? null));
  const live = await zoneTables(tx, cfg, zoneId);
  const targets = targetsFromMaster(
    master.map((row) => ({
      id: row.id,
      label: row.label,
      seats: row.seats,
      fixed: row.fixed,
      placement: row.placement,
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
  const takenOff = keepTakenOff ? await takenOffIn(tx, live) : new Set<string>();
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
          takenOff: target.tableId !== null && takenOff.has(target.tableId),
        })),
      )
      .returning({ id: floorResetTables.id, planTableId: floorResetTables.planTableId });
    await copyParts(tx, zoneId, written);
  }
  await catchUpZone(tx, cfg, removals, zoneId, now, { inReset: true });
  return revision;
}

async function takenOffIn(
  tx: Transaction,
  tables: readonly { id: string }[],
): Promise<Set<string>> {
  if (tables.length === 0) return new Set();
  const rows = await tx
    .select({ tableId: floorTodayTables.tableId })
    .from(floorTodayTables)
    .where(
      and(
        inArray(
          floorTodayTables.tableId,
          tables.map((table) => table.id),
        ),
        eq(floorTodayTables.takenOff, true),
      ),
    );
  return new Set(rows.map((row) => row.tableId));
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
    .where(eq(floorPlanTables.zoneId, zoneId));
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

const joinedReset = alias(floorResetTables, "taken_back_joined");
const partReset = alias(floorResetTables, "taken_back_part");
const groupPart = alias(floorResetTables, "group_part");

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

export interface CatchUp {
  /** The catch-up runs inside a reset of the zone. */
  inReset: boolean;
  /** Marked reset rows Mark moved applies though their tables move. */
  carry?: ReadonlySet<string>;
}

/** Applies the zone's PENDING reset rows that can be applied now, repeating while a pass changes something. */
export async function catchUpZone(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
  options: CatchUp = { inReset: false },
): Promise<void> {
  while (await catchUpPass(tx, cfg, removals, zoneId, now, options));
}

/**
 * One pass; true when a reset row stopped being pending, which can free a name for the next, or
 * when rows were marked ready to move. Outside a reset, a row whose table, or a table of its joined
 * group, would move is marked rather than applied; marked rows wait for Mark moved.
 */
async function catchUpPass(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
  { inReset, carry = new Set() }: CatchUp,
): Promise<boolean> {
  const zoneRows = await tx
    .select({
      zoneId: floorZones.id,
      row: getTableColumns(floorResetTables),
      partRowId: groupPart.id,
      partTableId: groupPart.tableId,
    })
    .from(floorZones)
    .leftJoin(
      floorResetTables,
      and(eq(floorResetTables.zoneId, floorZones.id), eq(floorResetTables.pending, true)),
    )
    .leftJoin(
      floorResetTableParts,
      eq(floorResetTableParts.joinedResetTableId, floorResetTables.id),
    )
    .leftJoin(groupPart, eq(groupPart.id, floorResetTableParts.partResetTableId))
    .where(
      and(
        eq(floorZones.id, zoneId),
        eq(floorZones.locationId, cfg.locationId),
        eq(floorZones.active, true),
      ),
    );
  if (zoneRows.length === 0) throw new AppError("zone.not_found", { zoneId });
  // A pending joined row's group, by reset row, so a joined table still to create is in it too.
  // Once the joined table's row is applied, the group no longer waits.
  const groupOf = new Map<string, ResetGroup>();
  const byId = new Map<string, NonNullable<(typeof zoneRows)[number]["row"]>>();
  for (const { row, partRowId, partTableId } of zoneRows) {
    if (row === null) continue;
    byId.set(row.id, row);
    if (partRowId === null) continue;
    const group = groupOf.get(row.id) ?? { rows: [{ id: row.id, tableId: row.tableId }] };
    group.rows.push({ id: partRowId, tableId: partTableId });
    groupOf.set(row.id, group);
  }
  const rows = [...byId.values()];
  if (rows.length === 0) return false;
  const groups = [...groupOf.values()];
  const groupsOfRow = new Map<string, ResetGroup[]>();
  for (const group of groups) {
    for (const { id } of group.rows) groupsOfRow.set(id, [...(groupsOfRow.get(id) ?? []), group]);
  }
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

  const venueTables = await tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
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
  const todayRows = new Map(
    (
      await tx
        .select(getTableColumns(floorTodayTables))
        .from(floorTodayTables)
        .where(inArray(floorTodayTables.tableId, ids))
    ).map((row) => [row.tableId, row]),
  );
  const merges = await mergesOf(tx, ids);
  const merged = new Set(merges.map((m) => m.tableId));
  const splitOff = new Set(inZone.flatMap((t) => (t.splitOffFrom === null ? [] : [t.id])));
  const moves = (target: Pick<Target, "tableId" | "placement">) => {
    const today = target.tableId === null ? undefined : todayRows.get(target.tableId);
    return movesTable(
      today === undefined
        ? null
        : {
            placement: placementOf(today),
            takenOff: today.takenOff,
            inMerge: merged.has(today.tableId),
            splitOff: splitOff.has(today.tableId),
          },
      target,
    );
  };
  // A marked group waits for Mark moved while any of its tables would still move; once none
  // would (taken off, say), it applies as any other row does (plan decision 10).
  for (const id of stillToMove(rowOf, groupsOfRow, moves)) {
    if (carry.has(id)) continue;
    for (const [target, row] of rowOf) if (row.id === id) rowOf.delete(target);
  }
  const targets = [...rowOf.keys()];
  const withToday = new Set(todayRows.keys());
  const clearing = new Set(
    inZone.flatMap((table) => (table.needsClearingSince === null ? [] : [table.id])),
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
  const waiting = new Set([...held, ...refused, ...clearing]);
  const foodComing = await foodComingTo(
    tx,
    inZone.flatMap((table) => (table.splitOffFrom === null ? [] : [table.id, table.splitOffFrom])),
  );
  const removing = new Set(targets.filter((target) => target.remove).map((t) => t.tableId));
  const tied = await tablesTied(
    tx,
    ids.filter((id) => removing.has(id) && !waiting.has(id)),
  );
  const drawnAt = (tableId: string | null): Placement | null => {
    const today = tableId === null ? undefined : todayRows.get(tableId);
    return today === undefined || today.takenOff ? null : placementOf(today);
  };
  // Rows marked earlier whose table would still move: their tables will be carried by hand, so
  // they block no table off the map (plan decision 10).
  const needing = new Set(
    rows.flatMap((row) =>
      row.readyToMove &&
      row.tableId !== null &&
      moves({ tableId: row.tableId, placement: placementOf(row) })
        ? [row.tableId]
        : [],
    ),
  );
  let outOfService: Set<string> | undefined;
  let layoutPlaces: Map<string, Placement | null> | undefined;
  // Tables whose own move is blocked, and reset rows of tables to create whose place is taken.
  const blocked = new Set<string>();
  const blockedCreates = new Set<string>();
  let plan: ResetPlan;
  for (;;) {
    const createGroups = groups.filter((group) => group.rows.some((r) => blockedCreates.has(r.id)));
    const { mergedWithHeld, splitBusy, joinedBusy, waitingRows } = waitingTogether(
      inZone,
      merges,
      groups,
      new Set([
        ...waiting,
        ...blocked,
        ...createGroups.flatMap((group) =>
          group.rows.flatMap((r) => (r.tableId === null ? [] : [r.tableId])),
        ),
      ]),
      foodComing,
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
      clearing: clearing.has(table.id),
      joinedWithWaiting: joinedBusy.has(table.id),
      blocked: blocked.has(table.id),
    }));
    const waitingToCreate = new Set(
      [...rowOf].flatMap(([target, row]) =>
        target.tableId === null && (waitingRows.has(row.id) || blockedCreates.has(row.id))
          ? [target]
          : [],
      ),
    );
    plan = planReset({ targets, live, takenElsewhere, waitingToCreate });

    const drawnMoving: { tableId: string; from: Placement; to: Placement | null }[] = [];
    const offMoving: { tableId: string; from: null; to: Placement }[] = [];
    for (const { target } of plan.apply) {
      const row = rowOf.get(target)!;
      if (row.placed || target.placement === null) {
        if (!row.placed && moves(target)) {
          drawnMoving.push({ tableId: target.tableId!, from: drawnAt(target.tableId)!, to: null });
        }
        continue;
      }
      const from = drawnAt(target.tableId);
      if (from !== null) {
        if (moves(target))
          drawnMoving.push({ tableId: target.tableId!, from, to: target.placement });
        continue;
      }
      // A taken-off table that stays off at its new place is put down on nothing.
      const keepOff = row.takenOff || row.readyToMove;
      if (keepOff && todayRows.get(target.tableId!)?.takenOff === true) continue;
      offMoving.push({ tableId: target.tableId!, from: null, to: target.placement });
    }
    for (const target of plan.create) {
      if (target.placement !== null) {
        offMoving.push({ tableId: rowOf.get(target)!.id, from: null, to: target.placement });
      }
    }
    if (drawnMoving.length === 0 && offMoving.length === 0) break;
    outOfService ??= await joinedOutOfServiceIn(tx, ids);
    layoutPlaces ??= await layoutPlacesIn(tx, zoneId);
    const own = (tableId: string) => layoutPlaces!.get(tableId) ?? null;
    const leaving = new Set([...drawnMoving.map((m) => m.tableId), ...plan.remove, ...plan.hide]);
    const staying = inZone.flatMap((table) => {
      const place = drawnAt(table.id);
      return place === null ||
        leaving.has(table.id) ||
        blocked.has(table.id) ||
        needing.has(table.id) ||
        outOfService!.has(table.id)
        ? []
        : [{ tableId: table.id, place, own: own(table.id) }];
    });
    const keptPlaces = [...blocked].flatMap((tableId) => {
      const place = drawnAt(tableId);
      return place === null ? [] : [{ tableId, place, own: own(tableId) }];
    });
    const newly = [...blockedMoves({ moving: drawnMoving, staying: [...staying, ...keptPlaces] })];
    // On a later read a blocked drawn table is marked, as every drawn table that would move is,
    // and a table that needs moving blocks no table off the map (spec §7.5, No lock).
    const newlyOff = [
      ...blockedMoves({
        moving: offMoving,
        staying: inReset ? [...staying, ...keptPlaces] : staying,
      }),
    ];
    const createIds = new Set(plan.create.map((target) => rowOf.get(target)!.id));
    const before = blocked.size + blockedCreates.size;
    for (const id of [...newly, ...newlyOff])
      (createIds.has(id) ? blockedCreates : blocked).add(id);
    if (blocked.size + blockedCreates.size === before) break;
  }

  // A drawn table whose new place is taken keeps its place, marked ready to move (spec §7.5).
  const drawnBlocked = [...rowOf].flatMap(([target, row]) =>
    target.tableId !== null && blocked.has(target.tableId) && drawnAt(target.tableId) !== null
      ? [row.id]
      : [],
  );
  const marking = new Set(drawnBlocked);
  for (const id of drawnBlocked) {
    for (const group of groupsOfRow.get(id) ?? []) for (const r of group.rows) marking.add(r.id);
  }
  const toMark = [...marking].filter((id) => byId.has(id) && !byId.get(id)!.readyToMove);
  if (toMark.length > 0) {
    await tx
      .update(floorResetTables)
      .set({ readyToMove: true })
      .where(inArray(floorResetTables.id, toMark));
  }

  if (!inReset) {
    const marked = readyToMove(plan.apply, rowOf, groupsOfRow, moves).filter(
      (id) => !byId.get(id)!.readyToMove,
    );
    if (marked.length > 0) {
      await tx
        .update(floorResetTables)
        .set({ readyToMove: true })
        .where(inArray(floorResetTables.id, marked));
      return true;
    }
  }

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
    await tx
      .insert(floorTodayTables)
      .values({ tableId: created!.id, ...todayColumns(target, false) });
  }
  const placedNow = new Set<Target>();
  for (const { target, label } of plan.apply) {
    const tableId = target.tableId!;
    if (label !== null) await setLabel(tx, tableId, label);
    // Placed once per reset: a row waiting only for its name keeps the day's moves and merges.
    if (rowOf.get(target)!.placed) continue;
    placedNow.add(target);
    await leaveMerges(tx, [tableId]);
    // A table still taken off stays off at its new place when its row says so, or when the row was
    // marked, as staff then took it off after the reset (owner ruling).
    const keepOff = rowOf.get(target)!.takenOff || rowOf.get(target)!.readyToMove;
    const columns = todayColumns(target, keepOff && todayRows.get(tableId)?.takenOff === true);
    await tx
      .insert(floorTodayTables)
      .values({ tableId, ...columns })
      .onConflictDoUpdate({ target: floorTodayTables.tableId, set: columns });
  }
  for (const target of plan.seed) {
    await tx
      .insert(floorTodayTables)
      .values({ tableId: target.tableId!, ...todayColumns(target, false) });
  }
  const putBack = [...placedNow].map((target) => target.tableId!);
  if (putBack.length > 0) {
    // A part the copied plan no longer joins to it keeps its today's name.
    const takenBack = tx
      .select({ id: floorTodaySplitParts.partTableId })
      .from(floorTodaySplitParts)
      .innerJoin(joinedReset, eq(joinedReset.tableId, floorTodaySplitParts.joinedTableId))
      .innerJoin(floorResetTableParts, eq(floorResetTableParts.joinedResetTableId, joinedReset.id))
      .innerJoin(
        partReset,
        and(
          eq(partReset.id, floorResetTableParts.partResetTableId),
          eq(partReset.tableId, floorTodaySplitParts.partTableId),
        ),
      )
      .where(inArray(floorTodaySplitParts.joinedTableId, putBack));
    await tx
      .update(floorTodayTables)
      .set({ name: null })
      .where(inArray(floorTodayTables.tableId, takenBack));
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
        readyToMove: pending && row.readyToMove,
        placed: row.placed || placedNow.has(target),
        tableId: createdIds.get(target) ?? row.tableId,
      })
      .where(eq(floorResetTables.id, row.id));
  }
  return changed;
}

/** The tables among `tableIds` out of service because of a joined table. */
async function joinedOutOfServiceIn(
  tx: Transaction,
  tableIds: readonly string[],
): Promise<Set<string>> {
  const rows = await tx
    .select({ id: diningTables.id })
    .from(diningTables)
    .where(and(inArray(diningTables.id, [...tableIds]), joinedOutOfService(diningTables.id)));
  return new Set(rows.map((row) => row.id));
}

/**
 * Each marked row whose table would still move, with every row of its joined group (plan decision
 * 8). A group is marked whole, so a member that moves is itself a marked row here.
 */
function stillToMove(
  rowOf: ReadonlyMap<Target, { id: string; placed: boolean; readyToMove: boolean }>,
  groupsOfRow: ReadonlyMap<string, readonly ResetGroup[]>,
  moves: (target: Target) => boolean,
): Set<string> {
  const waiting = new Set<string>();
  for (const [target, row] of rowOf) {
    if (!row.readyToMove || row.placed || !moves(target)) continue;
    waiting.add(row.id);
    for (const group of groupsOfRow.get(row.id) ?? [])
      for (const r of group.rows) waiting.add(r.id);
  }
  return waiting;
}

/**
 * The reset rows to mark ready to move: each applied row not yet placed whose table moves, with
 * every row of a joined group (plan decision 8) holding one such row.
 */
function readyToMove(
  apply: ResetPlan["apply"],
  rowOf: ReadonlyMap<Target, { id: string; placed: boolean }>,
  groupsOfRow: ReadonlyMap<string, readonly ResetGroup[]>,
  moves: (target: Target) => boolean,
): string[] {
  const targetOf = new Map([...rowOf].map(([target, row]) => [row.id, target]));
  const moving = (rowId: string) => {
    const target = targetOf.get(rowId);
    return target !== undefined && !rowOf.get(target)!.placed && moves(target);
  };
  const marked = new Set<string>();
  for (const { target } of apply) {
    const row = rowOf.get(target)!;
    if (row.placed) continue;
    const together = groupsOfRow.get(row.id) ?? [];
    const members = new Set([row.id, ...together.flatMap((group) => group.rows.map((r) => r.id))]);
    if (![...members].some(moving)) continue;
    for (const id of members) if (targetOf.has(id)) marked.add(id);
  }
  return [...marked];
}

function todayColumns(target: Target, takenOff: boolean) {
  return {
    seats: target.seats,
    fixed: target.fixed,
    ...placementColumns(target.placement),
    takenOff,
    name: null,
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

/** A joined reset row and its parts' reset rows; `tableId` null for a table still to create. */
interface ResetGroup {
  rows: { id: string; tableId: string | null }[];
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
 * Grows `waiting` until it is closed under every tie: a merge with a waiting table waits whole, so
 * does a split group with a waiting member or a member in `foodComing`, and so does a joined group
 * of the reset with a waiting member. Applying any table of one would move a waiting table or one
 * food is on its way to.
 */
function waitingTogether(
  tables: readonly { id: string; splitOffFrom: string | null }[],
  merges: readonly { joinId: string; tableId: string }[],
  joinedGroups: readonly ResetGroup[],
  waiting: ReadonlySet<string>,
  foodComing: ReadonlySet<string>,
): {
  mergedWithHeld: Set<string>;
  splitBusy: Set<string>;
  joinedBusy: Set<string>;
  /** The reset rows of every joined group that waits, rows with no table yet included. */
  waitingRows: Set<string>;
} {
  let all = new Set(waiting);
  for (;;) {
    const mergedWithHeld = mergedWith(merges, all);
    const busy = (id: string | null) =>
      id !== null && (all.has(id) || mergedWithHeld.has(id) || foodComing.has(id));
    const splitBusy = busySplitGroups(tables, busy);
    const waitingGroups = joinedGroups.filter((group) => group.rows.some((r) => busy(r.tableId)));
    const joinedBusy = new Set(
      waitingGroups.flatMap((group) =>
        group.rows.flatMap((r) => (r.tableId === null ? [] : [r.tableId])),
      ),
    );
    const grown = new Set([...all, ...mergedWithHeld, ...splitBusy, ...joinedBusy]);
    if (grown.size === all.size) {
      const waitingRows = new Set(waitingGroups.flatMap((group) => group.rows.map((r) => r.id)));
      return { mergedWithHeld, splitBusy, joinedBusy, waitingRows };
    }
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

/**
 * For each zone with a table or a layout: resets it onto its due layout when its today's plan is
 * for an earlier business day (or it has none), else catchUpZone when it has pending rows; one
 * query finds those zones. A zone whose due layout has no saved row is left as it is (plan
 * decision 24). A caught-up zone whose plan changed moves its revision by one. Answers the
 * business day, null when the venue's clock names none.
 */
export async function ensureToday(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  now: Date,
): Promise<string | null> {
  const day = await todayBusinessDay(tx, cfg, now);
  if (day === null) return null;
  const zones = await tx
    .select({ zoneId: floorZones.id, businessDay: floorTodayZones.businessDay })
    .from(floorZones)
    .leftJoin(floorTodayZones, eq(floorTodayZones.zoneId, floorZones.id))
    .where(
      and(
        eq(floorZones.locationId, cfg.locationId),
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
              .select({ id: floorPlans.id })
              .from(floorPlans)
              .where(eq(floorPlans.zoneId, floorZones.id)),
          ),
        ),
        or(
          isNull(floorTodayZones.businessDay),
          lt(floorTodayZones.businessDay, day),
          catchUpDue(floorZones.id),
        ),
      ),
    );
  const resets = (businessDay: string | null) => businessDay === null || businessDay < day;
  const resetting = zones.flatMap((z) => (resets(z.businessDay) ? [z.zoneId] : []));
  const catchingUp = zones.flatMap((z) => (resets(z.businessDay) ? [] : [z.zoneId]));
  const layouts = await zoneLayoutsOn(tx, cfg, resetting, now, day);
  const before = catchingUp.length === 0 ? null : await roomPrints(tx, cfg, catchingUp);
  for (const { zoneId, businessDay } of zones) {
    if (resets(businessDay)) {
      const layout = layouts.rows.get(zoneId);
      const onto = dueOnto(layouts.states.get(zoneId)!);
      if (layout !== undefined && onto !== null) {
        await resetZoneFor(tx, cfg, removals, zoneId, day, now, onto, layout, {
          keepTakenOff: false,
        });
      }
    } else await catchUpZone(tx, cfg, removals, zoneId, now);
  }
  if (before === null) return day;
  const after = await roomPrints(tx, cfg, catchingUp);
  const changed = catchingUp.filter((zoneId) => after.get(zoneId) !== before.get(zoneId));
  if (changed.length > 0) {
    await moveChangedRooms(tx, await roomRevisions(tx, changed), before, after);
  }
  return day;
}

/** Each table's place in the layout the zone's last reset applies; null where it gives none. */
export async function layoutPlacesIn(
  tx: Transaction,
  zoneId: string,
): Promise<Map<string, Placement | null>> {
  const r = floorResetTables;
  const rows = await tx
    .select({
      tableId: r.tableId,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      shape: r.shape,
      rotation: r.rotation,
    })
    .from(r)
    .where(and(eq(r.zoneId, zoneId), isNotNull(r.tableId)));
  return new Map(rows.map((row) => [row.tableId!, placementOf(row)]));
}

const resetAlias = (name: string) => alias(floorResetTables, name);
type ResetAlias = ReturnType<typeof resetAlias>;
const dueRow = resetAlias("due_row");

/**
 * Whether a pending row of a pending joined group holding reset row `rowId` meets `where`. `link`
 * finds the joined row of a group holding the row; `sibling` then walks every row of that group,
 * the joined row and each part, as catchUpPass's groups do. `prefix` names the aliases, so a
 * `where` may nest another of these.
 */
function pendingGroupMember(
  rowId: SQLWrapper,
  prefix: string,
  where: (member: ResetAlias) => SQL,
): SQL {
  const names = ["link", "joined", "sibling", "member"].map((name) => `${prefix}_${name}`);
  const [linkName, joinedName, siblingName, memberName] = names as [string, string, string, string];
  const link = alias(floorResetTableParts, linkName);
  const joined = resetAlias(joinedName);
  const sibling = alias(floorResetTableParts, siblingName);
  const member = resetAlias(memberName);
  const as = (name: string) => sql.identifier(name);
  return sql`exists (
    select 1 from ${floorResetTableParts} ${as(linkName)}
    inner join ${floorResetTables} ${as(joinedName)}
      on ${joined.id} = ${link.joinedResetTableId} and ${joined.pending} = 1
    inner join ${floorResetTableParts} ${as(siblingName)}
      on ${sibling.joinedResetTableId} = ${link.joinedResetTableId}
    inner join ${floorResetTables} ${as(memberName)}
      on ${member.id} in (${sibling.joinedResetTableId}, ${sibling.partResetTableId})
    where ${rowId} in (${link.joinedResetTableId}, ${link.partResetTableId})
      and ${member.pending} = 1 and ${where(member)}
  )`;
}

/**
 * Whether the zone holds a pending reset row a catch-up could apply, whose place, and the place of
 * every pending row of a joined group holding it, is not taken: one not marked ready to move, or
 * a marked one whose table, and every pending, unplaced table of the joined group of a pending
 * joined row holding it (plan decision 8), no longer moves. Weaker than "will apply": a row can
 * still wait for its guests or its name.
 */
export function catchUpDue(zoneId: SQLWrapper): SQL {
  const r = dueRow;
  return sql`exists (
    select 1 from ${floorResetTables} ${sql.identifier("due_row")}
    where ${r.zoneId} = ${zoneId} and ${r.pending} = 1 and not ${placeTaken(r)}
    and not ${pendingGroupMember(r.id, "due", (m) => sql`${m.id} <> ${r.id} and ${placeTaken(m)}`)}
    and (
      ${r.readyToMove} = 0 or (
        not ${resetRowMoves(r)}
        and not ${pendingGroupMember(r.id, "due", (m) => sql`${m.placed} = 0 and ${resetRowMoves(m)}`)}
      )
    )
  )`;
}

/**
 * catchUpPass's rule for a row it would put down off the map, in SQL: the row is not yet placed,
 * has a place, its table is not drawn (and is not a taken-off one its row or its mark keeps off),
 * and a table drawn in the zone blocks that place (`blocksPlace`): not out of service in a joined
 * table, not needing moving, and not a pending member of a joined group holding the row, which
 * moves with it.
 */
function placeTaken(r: ResetAlias): SQL {
  const own = sql.identifier("place_own");
  const blocker = sql.identifier("place_blocker");
  const blockerTable = sql.identifier("place_blocker_table");
  const blockerRow = sql.identifier("place_blocker_row");
  const col = (table: SQLWrapper, name: string) => sql`${table}.${sql.identifier(name)}`;
  const b = (name: string) => col(blocker, name);
  const placeOf = (at: (name: string) => SQL) => ({
    x: at("x"),
    y: at("y"),
    width: at("width"),
    height: at("height"),
    rotation: at("rotation"),
    shape: at("shape"),
  });
  return sql`(
    ${r.placed} = 0 and ${r.x} is not null
    and not exists (
      select 1 from ${floorTodayTables} ${own}
      where ${col(own, "table_id")} = ${r.tableId}
        and (
          (${col(own, "x")} is not null and ${col(own, "taken_off")} = 0)
          or ((${r.readyToMove} = 1 or ${r.takenOff} = 1) and ${col(own, "taken_off")} = 1)
        )
    )
    and exists (
      select 1 from ${floorTodayTables} ${blocker}
      inner join ${diningTables} ${blockerTable} on ${col(blockerTable, "id")} = ${b("table_id")}
      left join ${floorResetTables} ${blockerRow}
        on ${col(blockerRow, "table_id")} = ${b("table_id")} and ${col(blockerRow, "zone_id")} = ${r.zoneId}
      where ${col(blockerTable, "zone_id")} = ${r.zoneId}
        and ${b("x")} is not null and ${b("taken_off")} = 0
        and not ${joinedOutOfService(b("table_id"))}
        and not ${needsMoving(b("table_id"))}
        and not ${pendingGroupMember(r.id, "place", (member) => sql`${member.tableId} = ${b("table_id")}`)}
        and ${blocksPlaceSql(
          { x: r.x, y: r.y, width: r.width, height: r.height, rotation: r.rotation },
          placeOf((name) => b(name)),
          placeOf((name) => col(blockerRow, name)),
        )}
    )
  )`;
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
 * Its label and its today's name are left alone. The kitchen is told of each bill of a party at the
 * table's group, and each counter order with food on its way to one of its tables, when
 * `kitchenToBeTold` (kitchen-print.ts) says so. On a table that needs moving it is Mark moved
 * (plan decision 23).
 */
export async function backToSaved(
  tx: Transaction,
  cfg: TillConfig,
  removals: readonly TableRemoval[],
  tableId: string,
  now: Date,
): Promise<void> {
  const { row, merge } = await todayOf(tx, cfg, tableId);
  if (await tableNeedsMoving(tx, tableId)) return markMoved(tx, cfg, removals, tableId, now);
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
  const members = merge?.members.map((member) => member.tableId) ?? [];
  await withMovedSlips(tx, cfg, members.length === 0 ? null : { tables: members }, async () => {
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
  });
}
