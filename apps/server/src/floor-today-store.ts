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
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  diningTables,
  floorPlans,
  floorPlanTables,
  floorResetTables,
  tableMerges,
  floorZones,
  readVenueClock,
  shortNameColumns,
  statementChunks,
  workingOrders,
  OFF_FLOOR,
  todaySet,
  todayColumns,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import type { TableRemoval } from "@waitron/module";
import { venueMomentAt } from "@waitron/reporting";
import { AppError, NEW_TABLE_SIZE, compareLabels, shortNameKey } from "@waitron/shared";
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
import {
  deliveryTablesMatching,
  foodOnItsWay,
  openDeliveryToJoiningGroup,
} from "./delivery-release.js";
import { partPlaces } from "./joined-split-layout.js";
import { zoneLayoutsOn, type LayoutRow, type ZoneLayoutState } from "./floor-layout-due.js";
import { moveChangedRooms, roomPrints, roomRevisions } from "./floor-revision.js";
import { leaveMerges, leaveMergesRestoring } from "./floor-today-merges.js";
import { holdersOf } from "./parties.js";
import { refusedByAModule, removeLiveTables, tablesTied } from "./table-removal.js";
import "./errors.js";
import {
  type ResetGroup,
  mergesOf,
  stillToMove,
  waitingTogether,
  readyToMove,
  catchUpDue,
} from "./floor-today-reset-groups.js";

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
    shortName: target.shortName,
    seats: target.seats,
    fixed: target.fixed,
    ...placementColumns(target.placement),
  };
}

export async function todayBusinessDay(tx: Transaction, now: Date): Promise<string | null> {
  return venueMomentAt(now, await readVenueClock(tx))?.businessDay ?? null;
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
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
  onto: ResetOnto | "due",
): Promise<number | null> {
  await requireZone(tx, zoneId);
  const day = await todayBusinessDay(tx, now);
  if (day === null) return null;
  if (onto !== "due") return resetZoneOn(tx, removals, zoneId, day, now, onto);
  const { states, rows } = await zoneLayoutsOn(tx, [zoneId], now, day);
  const due = dueOnto(states.get(zoneId)!);
  if (due === null) return null;
  return resetZoneFor(tx, removals, zoneId, day, now, due, rows.get(zoneId), {
    keepTakenOff: false,
  });
}

/** `resetZone` onto `onto` on business day `day`, for a caller that has read the day. */
export async function resetZoneOn(
  tx: Transaction,
  removals: readonly TableRemoval[],
  zoneId: string,
  day: string,
  now: Date,
  onto: ResetOnto,
): Promise<number> {
  const layout = await planOf(tx, { setId: onto.setId, zoneId });
  return resetZoneFor(tx, removals, zoneId, day, now, onto, layout, { keepTakenOff: false });
}

/**
 * Update layout: resets the zone onto the layout due at `now` on business day `day`, keeping
 * taken-off tables off, when it is the one `sent` names; refuses `floor_today.layout_changed`
 * otherwise. Answers the room's new revision.
 */
export async function updateLayout(
  tx: Transaction,
  removals: readonly TableRemoval[],
  zoneId: string,
  day: string | null,
  now: Date,
  sent: { setId: string; layoutRevision: number },
): Promise<number> {
  const { states, rows } = await zoneLayoutsOn(tx, [zoneId], now, day);
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
  removals: readonly TableRemoval[],
  zoneId: string,
  businessDay: string,
  now: Date,
  onto: ResetOnto,
  layout: LayoutRow | undefined,
  { keepTakenOff }: ResetOptions,
): Promise<number> {
  const [today] = await tx
    .select({ id: floorZones.id, revision: floorZones.todayRevision })
    .from(floorZones)
    .where(eq(floorZones.id, zoneId));
  const revision = (today?.revision ?? 0) + 1;
  await tx
    .update(floorZones)
    .set({
      todayBusinessDay: businessDay,
      todayRevision: revision,
      todaySetId: onto.setId,
      todayLayoutRevision: layout?.revision ?? 0,
      todayOccurrence: onto.occurrence,
    })
    .where(eq(floorZones.id, zoneId));

  const recorded = await layoutTables(tx, zoneId, layout?.id ?? null);
  const master = placedAsRead(recorded);
  const sizeOf = new Map(recorded.map((row) => [row.id, row.placement ?? row.keptSize]));
  const joinedIds = new Set(master.flatMap((row) => (row.partOf === null ? [] : [row.partOf])));
  const slots = new Map<string, Placement>();
  for (const joined of master.filter((row) => joinedIds.has(row.id) && row.placement !== null)) {
    const parts = master
      .filter((row) => row.partOf === joined.id)
      .sort((a, b) => compareLabels(a.label, b.label));
    const places = partPlaces(
      joined.placement!,
      parts.map((row) => ({
        tableId: row.id,
        width: sizeOf.get(row.id)?.width ?? NEW_TABLE_SIZE,
        height: sizeOf.get(row.id)?.height ?? NEW_TABLE_SIZE,
      })),
      0,
    );
    for (const [index, part] of parts.entries()) slots.set(part.id, places[index]!);
  }
  const live = await zoneTables(tx, zoneId);
  const targets = targetsFromMaster(
    master.map((row) => ({
      id: row.id,
      label: row.label,
      shortName: row.shortName,
      seats: row.seats,
      fixed: row.fixed,
      placement: slots.get(row.id) ?? row.placement,
    })),
    live,
    joinedIds,
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
  await catchUpZone(tx, removals, zoneId, now, { inReset: true });
  return revision;
}

async function takenOffIn(
  tx: Transaction,
  tables: readonly { id: string }[],
): Promise<Set<string>> {
  if (tables.length === 0) return new Set();
  const rows = await tx
    .select({ tableId: diningTables.id })
    .from(diningTables)
    .where(
      and(
        inArray(
          diningTables.id,
          tables.map((table) => table.id),
        ),
        eq(diningTables.takenOff, true),
      ),
    );
  return new Set(rows.map((row) => row.tableId));
}

async function copyParts(
  tx: Transaction,
  zoneId: string,
  written: readonly { id: string; planTableId: string | null }[],
): Promise<void> {
  const master = await tx
    .select({ joined: floorPlanTables.partOfTableId, part: floorPlanTables.id })
    .from(floorPlanTables)
    .where(and(eq(floorPlanTables.zoneId, zoneId), isNotNull(floorPlanTables.partOfTableId)));
  const rowsOf = new Map<string, string[]>();
  for (const row of written) {
    if (row.planTableId === null) continue;
    rowsOf.set(row.planTableId, [...(rowsOf.get(row.planTableId) ?? []), row.id]);
  }
  const copied = master.flatMap(({ joined, part }) => {
    const joinedRow = rowsOf.get(joined!)![0]!;
    return (rowsOf.get(part) ?? []).map((partRow) => ({
      joinedResetTableId: joinedRow,
      partResetTableId: partRow,
    }));
  });
  for (const rows of statementChunks(floorResetTables, copied))
    await tx
      .update(floorResetTables)
      .set({
        partOfResetTableId: sql`case ${floorResetTables.id} ${sql.join(
          rows.map((row) => sql`when ${row.partResetTableId} then ${row.joinedResetTableId}`),
          sql` `,
        )} end`,
      })
      .where(
        inArray(
          floorResetTables.id,
          rows.map((row) => row.partResetTableId),
        ),
      );
}

const groupPart = alias(floorResetTables, "group_part");

function zoneTables(tx: Transaction, zoneId: string) {
  return tx
    .select({
      id: diningTables.id,
      label: diningTables.label,
      planTableId: diningTables.planTableId,
      shortName: diningTables.shortName,
    })
    .from(diningTables)
    .where(eq(diningTables.zoneId, zoneId));
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
  removals: readonly TableRemoval[],
  zoneId: string,
  now: Date,
  options: CatchUp = { inReset: false },
): Promise<void> {
  while (await catchUpPass(tx, removals, zoneId, now, options));
}

/**
 * One pass; true when a reset row stopped being pending, which can free a name for the next, or
 * when rows were marked ready to move. Outside a reset, a row whose table, or a table of its joined
 * group, would move is marked rather than applied; marked rows wait for Mark moved.
 */
async function catchUpPass(
  tx: Transaction,
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
    .leftJoin(groupPart, eq(groupPart.partOfResetTableId, floorResetTables.id))
    .where(and(eq(floorZones.id, zoneId), eq(floorZones.active, true)));
  if (zoneRows.length === 0) throw new AppError("zone.not_found", { zoneId });
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
    if (groupOf.has(row.id)) continue;
    const target: Target = {
      tableId: row.tableId,
      planTableId: row.planTableId,
      label: row.label,
      shortName: row.shortName,
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
      shortName: diningTables.shortName,
      zoneId: diningTables.zoneId,
      needsClearingSince: diningTables.needsClearingSince,
    })
    .from(diningTables);
  const inZone = venueTables.filter((table) => table.zoneId === zoneId);
  const takenElsewhere = new Set(
    venueTables.filter((table) => table.zoneId !== zoneId).map((table) => table.label),
  );
  const shortNameKeysElsewhere = new Set(
    venueTables.flatMap((table) =>
      table.zoneId !== zoneId && table.shortName !== null ? [shortNameKey(table.shortName)] : [],
    ),
  );
  const ids = inZone.map((table) => table.id);
  const inZoneIds = new Set(ids);
  const held = new Set((await holdersOf(tx, ids)).keys());
  const todayRows = new Map(
    (
      await tx
        .select(todayColumns)
        .from(diningTables)
        .where(and(inArray(diningTables.id, ids), eq(diningTables.onFloor, true)))
    ).map((row) => [row.tableId, row]),
  );
  const merges = await mergesOf(tx, ids);
  const merged = new Set(merges.map((m) => m.tableId));
  const moves = (target: Pick<Target, "tableId" | "placement">) => {
    const today = target.tableId === null ? undefined : todayRows.get(target.tableId);
    return movesTable(
      today === undefined
        ? null
        : {
            placement: placementOf(today),
            takenOff: today.takenOff,
            inMerge: merged.has(today.tableId),
          },
      target,
    );
  };
  // A marked group waits for Mark moved while any of its tables would still move; once none
  // would (taken off, say), it applies as any other row does.
  for (const id of stillToMove(rowOf, groupsOfRow, moves)) {
    if (carry.has(id)) continue;
    for (const [target, row] of rowOf) if (row.id === id) rowOf.delete(target);
  }
  const carried = new Set([
    ...carry,
    ...[...rowOf.values()].flatMap((row) =>
      carry.has(row.id) && row.tableId !== null ? [row.tableId] : [],
    ),
  ]);
  const targets = [...rowOf.keys()];
  const withToday = new Set(todayRows.keys());
  const clearing = new Set(
    inZone.flatMap((table) => (table.needsClearingSince === null ? [] : [table.id])),
  );
  const refused = new Set(
    (
      await refusedByAModule(
        tx,
        removals,
        targets.flatMap(({ remove, tableId: id }) =>
          remove && id !== null && !held.has(id) && inZoneIds.has(id) ? [id] : [],
        ),
        now,
      )
    ).keys(),
  );
  const resetIds = new Set(rows.flatMap((row) => (row.tableId === null ? [] : [row.tableId])));
  // Full resets may dissolve free groups; catch-up waits for members outside the reset.
  const otherGroup = groups.flatMap((group) => {
    const ids = new Set(group.rows.flatMap((row) => (row.tableId === null ? [] : [row.tableId])));
    const joins = new Set(merges.filter((m) => ids.has(m.tableId)).map((m) => m.joinId));
    return [...joins].some((joinId) => {
      const members = merges.filter((m) => m.joinId === joinId);
      return (
        members.some((m) => !ids.has(m.tableId)) &&
        !(inReset && members.every((m) => resetIds.has(m.tableId)))
      );
    })
      ? [...ids]
      : [];
  });
  const deliveryHolds = await deliveryTablesMatching(
    tx,
    ids,
    sql`(${foodOnItsWay()} or ${openDeliveryToJoiningGroup()})`,
  );
  const waiting = new Set([...held, ...refused, ...clearing, ...otherGroup, ...deliveryHolds]);
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
  // they block no table off the map.
  const needing = new Set(
    rows.flatMap((row) =>
      row.readyToMove &&
      row.tableId !== null &&
      moves({ tableId: row.tableId, placement: placementOf(row) })
        ? [row.tableId]
        : [],
    ),
  );
  let layoutPlaces: Map<string, Placement | null> | undefined;
  // Tables whose own move is blocked, and reset rows of tables to create whose place is taken.
  const blocked = new Set<string>();
  const blockedCreates = new Set<string>();
  let plan: ResetPlan;
  let waitingGroupRows: ReadonlySet<string>;
  for (;;) {
    const createGroups = groups.filter((group) => group.rows.some((r) => blockedCreates.has(r.id)));
    const { mergedWithHeld, joinedBusy, waitingRows } = waitingTogether(
      merges,
      groups,
      new Set([
        ...waiting,
        ...blocked,
        ...createGroups.flatMap((group) =>
          group.rows.flatMap((r) => (r.tableId === null ? [] : [r.tableId])),
        ),
      ]),
    );
    waitingGroupRows = waitingRows;
    const live: LiveTable[] = inZone.map((table) => ({
      id: table.id,
      label: table.label,
      shortName: table.shortName,
      held: held.has(table.id),
      refused: refused.has(table.id) || deliveryHolds.has(table.id),
      tied: held.has(table.id) || tied.has(table.id),
      hasToday: withToday.has(table.id),
      mergedWithHeld: mergedWithHeld.has(table.id),
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
    plan = planReset({ targets, live, takenElsewhere, shortNameKeysElsewhere, waitingToCreate });

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
    layoutPlaces ??= await layoutPlacesIn(tx, zoneId);
    const own = (tableId: string) => layoutPlaces!.get(tableId) ?? null;
    const leaving = new Set([...drawnMoving.map((m) => m.tableId), ...plan.remove, ...plan.hide]);
    const staying = inZone.flatMap((table) => {
      const place = drawnAt(table.id);
      return place === null ||
        leaving.has(table.id) ||
        blocked.has(table.id) ||
        needing.has(table.id)
        ? []
        : [{ tableId: table.id, place, own: own(table.id) }];
    });
    const keptPlaces = [...blocked].flatMap((tableId) => {
      const place = drawnAt(tableId);
      return place === null ? [] : [{ tableId, place, own: own(tableId) }];
    });
    const newly = [...blockedMoves({ moving: drawnMoving, staying: [...staying, ...keptPlaces] })];
    // On a later read a blocked drawn table is marked, as every drawn table that would move is,
    // and a table that needs moving blocks no table off the map.
    const newlyOff = [
      ...blockedMoves({
        moving: offMoving,
        staying: inReset ? [...staying, ...keptPlaces] : staying,
      }),
    ];
    const createIds = new Set(plan.create.map((target) => rowOf.get(target)!.id));
    const before = blocked.size + blockedCreates.size;
    for (const id of [...newly, ...newlyOff]) {
      if (!carried.has(id)) (createIds.has(id) ? blockedCreates : blocked).add(id);
    }
    if (blocked.size + blockedCreates.size === before) break;
  }

  // A drawn table whose new place is taken keeps its place, marked ready to move.
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

  const kept = await removeLiveTables(tx, removals, plan.remove, now);
  // A table already hidden is skipped; a kept one was changed by its failed removal, so is not.
  for (const tableId of plan.hide) {
    if (withToday.has(tableId) || merged.has(tableId)) {
      await hideTable(tx, tableId);
    }
  }
  for (const tableId of kept) await hideTable(tx, tableId);
  // Each renamed table first steps aside under a spare name, so a swap never meets the unique
  // label key halfway.
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
  // Short names step aside as null, which the unique short name key index never
  // matches, so a swap never meets it halfway.
  const shortKeyOf = new Map(
    inZone.map((table) => [table.id, shortNameColumns(table.shortName).shortNameKey]),
  );
  const shortRenamed = plan.apply.flatMap(({ target, label }) =>
    label !== null &&
    shortNameColumns(target.shortName).shortNameKey !== shortKeyOf.get(target.tableId!)
      ? [target.tableId!]
      : [],
  );
  if (shortRenamed.length > 0) {
    await tx
      .update(diningTables)
      .set(shortNameColumns(null))
      .where(inArray(diningTables.id, shortRenamed));
  }
  const createdIds = new Map<Target, string>();
  for (const target of plan.create) {
    const [created] = await tx
      .insert(diningTables)
      .values({
        zoneId,
        label: target.label,
        ...shortNameColumns(target.shortName),
        planTableId: target.planTableId,
      })
      .returning({ id: diningTables.id });
    createdIds.set(target, created!.id);
    await tx
      .update(diningTables)
      .set(todaySet(todayValues(target, false)))
      .where(eq(diningTables.id, created!.id));
  }
  const placedNow = new Set<Target>();
  for (const { target, label } of plan.apply) {
    const tableId = target.tableId!;
    if (label !== null) await setNames(tx, tableId, label, target.shortName);
    // Placed once per reset: a row waiting only for its name keeps the day's moves and merges.
    if (rowOf.get(target)!.placed) continue;
    placedNow.add(target);
    await leaveMerges(tx, [tableId]);
    // A table still taken off stays off at its new place when its row says so, or when the row was
    // marked, as staff then took it off after the reset.
    const keepOff = rowOf.get(target)!.takenOff || rowOf.get(target)!.readyToMove;
    const columns = todayValues(target, keepOff && todayRows.get(tableId)?.takenOff === true);
    await tx.update(diningTables).set(todaySet(columns)).where(eq(diningTables.id, tableId));
  }
  for (const target of plan.seed) {
    await tx
      .update(diningTables)
      .set(todaySet(todayValues(target, false)))
      .where(eq(diningTables.id, target.tableId!));
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
  for (const [joinedId, group] of groupOf) {
    const joined = byId.get(joinedId)!;
    const parts = await tx
      .select()
      .from(floorResetTables)
      .where(
        inArray(
          floorResetTables.id,
          group.rows.filter((r) => r.id !== joinedId).map((r) => r.id),
        ),
      );
    if (waitingGroupRows.has(joinedId) || parts.some((row) => row.pending || row.tableId === null))
      continue;
    const memberIds = parts.map((row) => row.tableId!);
    const [takenOff] = await tx
      .select({ id: diningTables.id })
      .from(diningTables)
      .where(and(inArray(diningTables.id, memberIds), eq(diningTables.takenOff, true)))
      .limit(1);
    if (takenOff !== undefined) continue;
    if (joined.x !== null) {
      await leaveMergesRestoring(tx, memberIds);
      const [merge] = await tx
        .insert(tableMerges)
        .values({ zoneId, name: joined.label, seats: joined.seats! })
        .returning({ id: tableMerges.id });
      for (const row of parts) {
        await tx
          .update(diningTables)
          .set({
            mergeId: merge!.id,
            mergeBeforeX: row.x!,
            mergeBeforeY: row.y!,
            mergeBeforeRotation: row.rotation!,
          })
          .where(eq(diningTables.id, row.tableId!));
      }
    }
    await tx
      .update(floorResetTables)
      .set({ pending: false, placed: true, readyToMove: false })
      .where(eq(floorResetTables.id, joinedId));
    changed = true;
  }
  return changed;
}

function todayValues(target: Target, takenOff: boolean) {
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
  await tx.update(diningTables).set(OFF_FLOOR).where(eq(diningTables.id, tableId));
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

async function setNames(
  tx: Transaction,
  tableId: string,
  label: string,
  shortName: string | null,
): Promise<void> {
  await tx
    .update(diningTables)
    .set({ label, ...shortNameColumns(shortName) })
    .where(eq(diningTables.id, tableId));
}

async function todayWork(tx: Transaction, now: Date) {
  const day = await todayBusinessDay(tx, now);
  if (day === null) return null;
  const zones = await tx
    .select({ zoneId: floorZones.id, businessDay: floorZones.todayBusinessDay })
    .from(floorZones)
    .where(
      and(
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
          isNull(floorZones.todayBusinessDay),
          lt(floorZones.todayBusinessDay, day),
          catchUpDue(floorZones.id),
        ),
      ),
    );
  const resets = (businessDay: string | null) => businessDay === null || businessDay < day;
  const resetting = zones.flatMap((z) => (resets(z.businessDay) ? [z.zoneId] : []));
  const catchingUp = zones.flatMap((z) => (resets(z.businessDay) ? [] : [z.zoneId]));
  const layouts = await zoneLayoutsOn(tx, resetting, now, day);
  return { day, zones, resets, catchingUp, layouts };
}

/** Conservative for catch-up: a candidate can still wait for guests or its name. */
export async function todayReconciliationDue(tx: Transaction, now: Date): Promise<boolean> {
  const work = await todayWork(tx, now);
  return (
    work !== null &&
    work.zones.some(
      ({ zoneId, businessDay }) =>
        !work.resets(businessDay) ||
        (work.layouts.rows.has(zoneId) && dueOnto(work.layouts.states.get(zoneId)!) !== null),
    )
  );
}

export async function ensureToday(
  tx: Transaction,
  removals: readonly TableRemoval[],
  now: Date,
): Promise<string | null> {
  const work = await todayWork(tx, now);
  if (work === null) return null;
  const { day, zones, resets, catchingUp, layouts } = work;
  const before = catchingUp.length === 0 ? null : await roomPrints(tx, catchingUp);
  for (const { zoneId, businessDay } of zones) {
    if (resets(businessDay)) {
      const layout = layouts.rows.get(zoneId);
      const onto = dueOnto(layouts.states.get(zoneId)!);
      if (layout !== undefined && onto !== null) {
        await resetZoneFor(tx, removals, zoneId, day, now, onto, layout, {
          keepTakenOff: false,
        });
      }
    } else await catchUpZone(tx, removals, zoneId, now);
  }
  if (before === null) return day;
  const after = await roomPrints(tx, catchingUp);
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

/** An order with food on its way to the table. */
export async function refuseDeliveryPending(tx: Transaction, tableId: string): Promise<void> {
  const [delivery] = await tx
    .select({ id: workingOrders.id })
    .from(workingOrders)
    .where(and(eq(workingOrders.deliveryTableId, tableId), foodOnItsWay()));
  if (delivery !== undefined) throw new AppError("table.delivery_pending", { tableId });
}
