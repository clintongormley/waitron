import {
  type JoinSide,
  NEW_TABLE_SIZE,
  freeSide,
  groupStep,
  joinSide,
  touchingPlace,
} from "@waitron/shared";
import {
  type FloorMapDrop,
  clampToGrid,
  cropToTables,
  inNumberOrder,
  mergeLabel,
} from "@waitron/ui";
import type { TableParty, TableState, TodayPlacement } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import { t } from "../i18n/t.js";

export type DropAction =
  | { kind: "none" }
  | { kind: "say"; message: string }
  | { kind: "move"; tableId: string; x: number; y: number }
  | {
      kind: "merge";
      tableId: string;
      targetId: string;
      side: JoinSide;
      heading: string;
    }
  | { kind: "seat"; tableId: string; withTableIds: string[]; heading: string }
  | {
      kind: "join";
      party: TableParty;
      tableId: string;
      other: TableParty | null;
      merge: { moving: string; target: string; side: JoinSide } | null;
      heading: string;
    };

interface Group {
  members: TableState[];
  fixed: boolean;
  party: TableParty | null;
}

let floorMoments = 0;

/** Numbers a floor read's start and a change's answer in the order they happen: one strictly
 * increasing sequence for the whole till, so no two can tie. */
export function nextFloorMoment(): number {
  return ++floorMoments;
}

export function shownName(table: TableState): string {
  return table.today?.name ?? table.label;
}

/** What the group is called with no name of its own: its tables' shown names in number order. */
export function normalGroupName(members: readonly TableState[]): string {
  return mergeLabel(members.map(shownName));
}

export function groupName(members: readonly TableState[]): string {
  return members[0]?.today?.joinName ?? normalGroupName(members);
}

/** `table` and every other member of its merge, in `tables`' order; `table` alone in none. */
export function mergeMembersOf(tables: readonly TableState[], table: TableState): TableState[] {
  const joinId = table.today?.joinId ?? null;
  return joinId === null ? [table] : tables.filter((each) => each.today?.joinId === joinId);
}

function groupOf(zoneTables: readonly TableState[], table: TableState): Group {
  const members = mergeMembersOf(zoneTables, table);
  return {
    members,
    fixed: members.some((each) => each.today?.fixed === true),
    party: members.find((each) => each.party !== null)?.party ?? null,
  };
}

const centre = (p: TodayPlacement): { x: number; y: number } => ({
  x: p.x + p.width / 2,
  y: p.y + p.height / 2,
});

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

/** Decisions 5, 6 and 9 of the floor plan's slice 4: what dropping a group on the map asks for. */
export function dropAction(zoneTables: readonly TableState[], drop: FloorMapDrop): DropAction {
  const dragged = zoneTables.find((table) => table.id === drop.tableId);
  const from = dragged?.today?.placement;
  if (dragged === undefined || from == null) return { kind: "none" };
  const draggedGroup = groupOf(zoneTables, dragged);
  if (drop.targetId === null) {
    return draggedGroup.fixed
      ? { kind: "say", message: codeMessage("table.fixed") }
      : { kind: "move", tableId: dragged.id, x: drop.x, y: drop.y };
  }
  const target = zoneTables.find((table) => table.id === drop.targetId);
  if (target?.today?.placement == null || draggedGroup.members.includes(target)) {
    return { kind: "none" };
  }
  const targetGroup = groupOf(zoneTables, target);
  if (
    draggedGroup.party !== null &&
    targetGroup.party !== null &&
    draggedGroup.party.id === targetGroup.party.id
  ) {
    return { kind: "none" };
  }
  if (draggedGroup.members.length > 1) return { kind: "say", message: t("floor.drop_merge") };

  const both = [...draggedGroup.members, ...targetGroup.members];
  const heading = mergeLabel(both.flatMap((table) => joinedLabels(zoneTables, table)));
  const dropped: TodayPlacement = { ...from, x: drop.x, y: drop.y };
  const nearest = nearestMember(targetGroup.members, centre(dropped));
  const fixedSide = draggedGroup.fixed || targetGroup.fixed;
  const side = joinSide(nearest.today!.placement!, dropped);

  if (draggedGroup.party === null && targetGroup.party === null) {
    return fixedSide
      ? {
          kind: "seat",
          tableId: dragged.id,
          withTableIds: targetGroup.members.map((table) => table.id),
          heading,
        }
      : { kind: "merge", tableId: dragged.id, targetId: nearest.id, side, heading };
  }
  const merge = fixedSide ? null : { moving: dragged.id, target: nearest.id, side };
  if (targetGroup.party !== null) {
    return {
      kind: "join",
      party: targetGroup.party,
      tableId: dragged.id,
      other: draggedGroup.party,
      merge,
      heading,
    };
  }
  return {
    kind: "join",
    party: draggedGroup.party!,
    tableId: nearest.id,
    other: null,
    merge,
    heading,
  };
}

/** A joined table's still-joined tables' labels; any other table's own label. */
function joinedLabels(zoneTables: readonly TableState[], table: TableState): string[] {
  const parts = table.today?.joined?.parts ?? [];
  const labels = parts.flatMap((id) => zoneTables.find((each) => each.id === id)?.label ?? []);
  return labels.length === 0 ? [table.label] : labels;
}

/** The placed member whose centre is nearest `point`; the first on a tie. */
function nearestMember(
  members: readonly TableState[],
  point: { x: number; y: number },
): TableState {
  let best = members[0]!;
  for (const member of members) {
    if (
      distance(centre(member.today!.placement!), point) <
      distance(centre(best.today!.placement!), point)
    ) {
      best = member;
    }
  }
  return best;
}

/** The placement the floor draws until the next read (slice 4 decision 14): the moved group's members, or the merged table. */
export function pendingPlaces(
  zoneTables: readonly TableState[],
  action: DropAction,
): Map<string, TodayPlacement> {
  const places = new Map<string, TodayPlacement>();
  const placed = (id: string): TodayPlacement | null =>
    zoneTables.find((table) => table.id === id)?.today?.placement ?? null;
  if (action.kind === "move") {
    const table = zoneTables.find((each) => each.id === action.tableId);
    const from = placed(action.tableId);
    if (table === undefined || from === null) return places;
    const members = groupOf(zoneTables, table).members.map((m) => [m.id, placed(m.id)!] as const);
    const { dx, dy } = groupStep(
      members.map(([, p]) => p),
      { x: action.x - from.x, y: action.y - from.y },
    );
    for (const [id, p] of members) places.set(id, { ...p, x: p.x + dx, y: p.y + dy });
    return places;
  }
  const joined =
    action.kind === "merge"
      ? { moving: action.tableId, target: action.targetId, side: action.side }
      : action.kind === "join"
        ? action.merge
        : null;
  if (joined === null) return places;
  const moving = placed(joined.moving)!;
  const target = zoneTables.find((each) => each.id === joined.target)!;
  const against = target.today!.placement!;
  const members = mergeMembersOf(zoneTables, target).flatMap((each) =>
    each.today?.placement == null ? [] : [each.today.placement],
  );
  const side = freeSide(against, moving, members, joined.side);
  places.set(joined.moving, { ...moving, ...touchingPlace(against, moving, side) });
  return places;
}

/** A still-joined part, or a joined table that has come apart: the map, Join with… and every
 * picker that calls this leave it out. */
export function outOfServiceJoined(table: TableState): boolean {
  return (
    table.today !== null &&
    (table.today.inJoinedTable !== null || table.today.joined?.apart === true)
  );
}

export function onTodaysPlan(table: TableState): boolean {
  return (
    table.today !== null &&
    table.today.placement !== null &&
    !table.today.takenOff &&
    !outOfServiceJoined(table)
  );
}

/** Today's tables with no place, not taken off, not fixed and in no joined table: what Add a spare
 * table offers. */
export function sparesOf(zoneTables: readonly TableState[]): TableState[] {
  return zoneTables.filter(
    (table) =>
      table.today !== null &&
      table.today.placement === null &&
      !table.today.takenOff &&
      !table.today.fixed &&
      !outOfServiceJoined(table),
  );
}

export function takenOffOf(zoneTables: readonly TableState[]): TableState[] {
  return zoneTables.filter((table) => table.today?.takenOff === true);
}

/** Slice 4 decision 17: a spare's corner, centred in the crop the map first fits; (0, 0) with nothing placed. */
export function spareSpot(zoneTables: readonly TableState[]): { x: number; y: number } {
  const crop = cropToTables(
    zoneTables.filter(onTodaysPlan).map((table) => table.today!.placement!),
  );
  if (crop === null) return { x: 0, y: 0 };
  return {
    x: clampToGrid(crop.x + crop.width / 2 - NEW_TABLE_SIZE / 2),
    y: clampToGrid(crop.y + crop.height / 2 - NEW_TABLE_SIZE / 2),
  };
}

export type ApartReason = "guests" | "group" | "food";

export interface ResetTablePlan {
  joined: TableState;
  back: TableState[];
  apart: { table: TableState; reason: ApartReason }[];
  whole: boolean;
  /** Offered only to be refused: too few tables would be joined because the rest are in a group
   * with guests, which the server refuses `joined_table.tables_in_group` whatever the seats. */
  refusedInGroup: boolean;
}

/** What Reset table on `table` would take back: `table` is the joined table or a free table split
 * off it. `null` when it offers nothing. Mirrors the server's rule in
 * `apps/server/src/floor-today-reset-table.ts`, and also offers one case that rule refuses
 * (`refusedInGroup`). */
export function resetTableOf(
  table: TableState,
  zoneTables: readonly TableState[],
): ResetTablePlan | null {
  const today = table.today;
  if (today === null) return null;
  const joined =
    today.joined !== null
      ? table
      : today.splitOffFrom !== null
        ? zoneTables.find((each) => each.id === today.splitOffFrom)
        : undefined;
  const state = joined?.today?.joined;
  if (joined === undefined || state == null) return null;
  if (joined !== table && apartReason(table, zoneTables) !== null) return null;
  const byId = new Map(zoneTables.map((each) => [each.id, each]));
  const splitOff = state.splitOff.flatMap((id) => byId.get(id) ?? []);
  const back = splitOff.filter((each) => apartReason(each, zoneTables) === null);
  const apart = splitOff.flatMap((each) => {
    const reason = apartReason(each, zoneTables);
    return reason === null ? [] : [{ table: each, reason }];
  });
  const plan = { joined, back, apart, whole: apart.length === 0, refusedInGroup: false };
  if (back.length > 0 && state.parts.length + back.length >= 2) return plan;
  // Offered so that pressing it shows the server's `joined_table.tables_in_group` refusal, which
  // names the tables to split off the group first.
  const blockedByGroup =
    joined !== table &&
    apart.some(
      ({ table: each, reason }) =>
        (reason === "guests" || reason === "group") && each.today?.joinId != null,
    );
  return blockedByGroup ? { ...plan, refusedInGroup: true } : null;
}

function apartReason(table: TableState, zoneTables: readonly TableState[]): ApartReason | null {
  if (table.condition === "held") return "guests";
  if (mergeMembersOf(zoneTables, table).some((each) => each.condition === "held")) return "group";
  if (table.pendingDeliveries > 0) return "food";
  return null;
}

export type SheetAction =
  "join-with" | "split-off" | "reset-table" | "rotate" | "seats" | "back" | "take-off";

/** Slice 4 decisions 12 and 16: the details sheet's changes for today that apply to `table`, in
 * order. Reset table is offered only when `zoneTables` holds the joined table and its split-off tables. */
export function sheetActions(
  table: TableState,
  zoneTables: readonly TableState[] = [],
): SheetAction[] {
  const today = table.today;
  if (today === null || today.placement === null || today.takenOff) return [];
  const merged = today.joinId !== null;
  const clearing = table.condition === "needs_clearing";
  // A party-held table is `held`, never `free` (`tableCondition`, apps/server/src/working-order.ts).
  const free = table.condition === "free" && table.pendingDeliveries === 0;
  const joined = today.joined;
  const splitOff = today.splitOffFrom !== null;
  const applies: [SheetAction, boolean][] = [
    ["join-with", !merged && !clearing],
    ["split-off", merged || (joined !== null && joined.parts.length >= 2)],
    ["reset-table", resetTableOf(table, zoneTables) !== null],
    ["rotate", !today.fixed && !merged],
    ["seats", true],
    ["back", !splitOff && (joined === null || joined.splitOff.length === 0)],
    ["take-off", free && !merged && !splitOff],
  ];
  return applies.filter(([, offered]) => offered).map(([action]) => action);
}

/** Split tables… on `table` splits its group, as the server's `splitOff` decides: a joined table
 * with a table still joined splits as a joined table even in a group. */
export function splitsGroup(table: TableState): boolean {
  return table.today?.joinId != null && (table.today.joined?.parts.length ?? 0) === 0;
}

export interface GroupSplit {
  members: TableState[];
  name: string;
  asksSeats(staying: readonly string[]): boolean;
  /** For each party a ticked table holds, the tables it keeps, as `splitGroup` leaves them. A party
   * that would keep none is refused by the server, and one keeping a table off `zoneTables` is left
   * out rather than named wrongly. */
  guestsMoveTo(ticked: readonly string[]): string[];
  /** Whether a party a ticked table holds would keep none of its tables, which the server refuses
   * `merge.strands_party`. */
  strandsGuests(ticked: readonly string[]): boolean;
}

/** Split tables… on a table in a group: its members in number order, its name, and whether the
 * tables `staying` need seats. None are asked when no member has a party (as `splitGroup`'s holders
 * check in apps/server/src/floor-today-split-group.ts) and what stays is every table split off one
 * joined table with none of its tables still joined, none with food on its way. Left to the server:
 * a part held by a party when the joined table went live, which the till's tables do not show, and
 * whether each stands where that joined table's layout puts it. Its seats refusal makes the window
 * ask Seats. */
export function groupSplitOf(
  table: TableState,
  zoneTables: readonly TableState[],
): GroupSplit | null {
  if (!splitsGroup(table)) return null;
  const members = mergeMembersOf(zoneTables, table).sort((a, b) => inNumberOrder(a.label, b.label));
  const rejoins = (staying: readonly string[]): boolean => {
    if (members.some((each) => each.party !== null)) return false;
    const tables = members.filter((each) => staying.includes(each.id));
    const from = tables[0]?.today?.splitOffFrom ?? null;
    const joined = zoneTables.find((each) => each.id === from)?.today?.joined;
    return (
      joined != null &&
      joined.parts.length === 0 &&
      tables.every((each) => each.today?.splitOffFrom === from && each.pendingDeliveries === 0) &&
      joined.splitOff.every((id) => staying.includes(id))
    );
  };
  /** For each party a ticked table holds, the ids of the tables it keeps. */
  const keptBy = (ticked: readonly string[]): string[][] => {
    const parties = new Map<string, TableParty>();
    for (const each of members) {
      if (ticked.includes(each.id) && each.party !== null) parties.set(each.party.id, each.party);
    }
    return [...parties.values()].map((party) =>
      party.tableIds.filter((id) => !ticked.includes(id)),
    );
  };
  const guestsMoveTo = (ticked: readonly string[]): string[] =>
    keptBy(ticked).flatMap((kept) => {
      const tables = zoneTables.filter((each) => kept.includes(each.id));
      if (kept.length === 0 || tables.length !== kept.length) return [];
      return [mergeLabel(tables.map((each) => each.label).sort(inNumberOrder))];
    });
  return {
    members,
    name: mergeLabel(members.map((each) => each.label)),
    asksSeats: (staying) => staying.length >= 2 && !rejoins(staying),
    guestsMoveTo,
    strandsGuests: (ticked) => keptBy(ticked).some((kept) => kept.length === 0),
  };
}
