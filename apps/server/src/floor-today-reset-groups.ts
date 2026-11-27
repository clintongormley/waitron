import {
  type Transaction,
  mergeOf,
  diningTables,
  floorResetTables,
  resetRowMoves,
  needsMoving,
} from "@waitron/db";
import { and, inArray, isNotNull, type SQLWrapper, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { Target, ResetPlan } from "./floor-reset-plan.js";
import { blocksPlaceSql } from "./joined-split-layout.js";

/**
 * Each marked row whose table would still move, with every row of its joined group. A group is
 * marked whole, so a member that moves is itself a marked row here.
 */
export function stillToMove(
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
 * every row of a joined group holding one such row.
 */
export function readyToMove(
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
    for (const id of members) marked.add(id);
  }
  return [...marked];
}
/** A joined reset row and its parts' reset rows; `tableId` null for a table still to create. */
export interface ResetGroup {
  rows: { id: string; tableId: string | null }[];
}
/** The members of the today's merges taking in any of the zone's tables. */
export function mergesOf(
  tx: Transaction,
  zoneTableIds: readonly string[],
): Promise<{ joinId: string; tableId: string }[]> {
  return tx
    .select({ joinId: mergeOf.mergeId, tableId: mergeOf.tableId })
    .from(diningTables)
    .where(and(inArray(diningTables.id, [...zoneTableIds]), isNotNull(diningTables.mergeId)))
    .then((rows) => rows.map((row) => ({ ...row, joinId: row.joinId! })));
}
export function waitingTogether(
  merges: readonly { joinId: string; tableId: string }[],
  joinedGroups: readonly ResetGroup[],
  waiting: ReadonlySet<string>,
): {
  mergedWithHeld: Set<string>;
  joinedBusy: Set<string>;
  /** The reset rows of every joined group that waits, rows with no table yet included. */
  waitingRows: Set<string>;
} {
  let all = new Set(waiting);
  for (;;) {
    const mergedWithHeld = mergedWith(merges, all);
    const busy = (id: string | null) => id !== null && (all.has(id) || mergedWithHeld.has(id));
    const waitingGroups = joinedGroups.filter((group) => group.rows.some((r) => busy(r.tableId)));
    const joinedBusy = new Set(
      waitingGroups.flatMap((group) =>
        group.rows.flatMap((r) => (r.tableId === null ? [] : [r.tableId])),
      ),
    );
    const grown = new Set([...all, ...mergedWithHeld, ...joinedBusy]);
    if (grown.size === all.size) {
      const waitingRows = new Set(waitingGroups.flatMap((group) => group.rows.map((r) => r.id)));
      return { mergedWithHeld, joinedBusy, waitingRows };
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
  const link = resetAlias(linkName);
  const joined = resetAlias(joinedName);
  const sibling = resetAlias(siblingName);
  const member = resetAlias(memberName);
  const as = (name: string) => sql.identifier(name);
  return sql`exists (
    select 1 from ${floorResetTables} ${as(linkName)}
    inner join ${floorResetTables} ${as(joinedName)}
      on ${joined.id} = ${link.partOfResetTableId} and ${joined.pending} = 1
    inner join ${floorResetTables} ${as(siblingName)}
      on ${sibling.partOfResetTableId} = ${link.partOfResetTableId}
    inner join ${floorResetTables} ${as(memberName)}
      on ${member.id} in (${sibling.partOfResetTableId}, ${sibling.id})
    where ${rowId} in (${link.partOfResetTableId}, ${link.id})
      and ${member.pending} = 1 and ${where(member)}
  )`;
}
/**
 * Whether the zone holds a pending reset row a catch-up could apply, whose place, and the place of
 * every pending row of a joined group holding it, is not taken: one not marked ready to move, or
 * a marked one whose table, and every pending, unplaced table of the joined group of a pending
 * joined row holding it, no longer moves. Weaker than "will apply": a row can
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
      select 1 from ${diningTables} ${own}
      where ${col(own, "id")} = ${r.tableId} and ${col(own, "on_floor")} = 1
        and (
          (${col(own, "today_x")} is not null and ${col(own, "taken_off")} = 0)
          or ((${r.readyToMove} = 1 or ${r.takenOff} = 1) and ${col(own, "taken_off")} = 1)
        )
    )
    and exists (
      select 1 from ${diningTables} ${blocker}
      inner join ${diningTables} ${blockerTable} on ${col(blockerTable, "id")} = ${b("id")}
      left join ${floorResetTables} ${blockerRow}
        on ${col(blockerRow, "table_id")} = ${b("id")} and ${col(blockerRow, "zone_id")} = ${r.zoneId}
      where ${col(blockerTable, "zone_id")} = ${r.zoneId} and ${b("on_floor")} = 1
        and ${b("today_x")} is not null and ${b("taken_off")} = 0
        and not ${needsMoving(b("id"))}
        and not ${pendingGroupMember(r.id, "place", (member) => sql`${member.tableId} = ${b("id")}`)}
        and ${blocksPlaceSql(
          { x: r.x, y: r.y, width: r.width, height: r.height, rotation: r.rotation },
          placeOf((name) => b(`today_${name}`)),
          placeOf((name) => col(blockerRow, name)),
        )}
    )
  )`;
}
