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
import type { FloorZone, TableParty, TableState, TodayPlacement } from "../api/client.js";
import { codeMessage } from "../i18n/codes.js";
import type { StringKey } from "../i18n/strings.js";
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

/** A room's revision as an answer gave it, and when, numbered by `nextFloorMoment`. */
export interface CarriedRevision {
  revision: number;
  answeredAt: number;
}

/** `carried` with an answer's rooms in place, each answered now. */
export function carryRevisions(
  carried: ReadonlyMap<string, CarriedRevision>,
  zoneRevisions: Readonly<Record<string, number>> | undefined,
): ReadonlyMap<string, CarriedRevision> {
  const answeredAt = nextFloorMoment();
  return new Map([
    ...carried,
    ...Object.entries(zoneRevisions ?? {}).map(([zoneId, revision]): [string, CarriedRevision] => [
      zoneId,
      { revision, answeredAt },
    ]),
  ]);
}

export function shownName(table: TableState): string {
  return table.today?.name ?? table.label;
}

/** A sentence naming the table: by its saved label in `saved`'s words ("Table 3 …"), or by today's
 * name in `named`'s ("Ventana …"). */
export function tableSentence(table: TableState, saved: StringKey, named: StringKey): string {
  return table.today?.name == null
    ? t(saved).replace("{table}", () => table.label)
    : t(named).replace("{table}", () => table.today!.name!);
}

/** Its group's name for today, else its own name for today, else its saved label, as `shown()` in
 * `packages/db/src/party-table-labels.ts`. */
export function shownUnder(table: TableState): string {
  return table.today?.joinName ?? shownName(table);
}

/** The tables of each of today's joins, by join id, in `tables`' order. */
export function joinMembersById(tables: readonly TableState[]): Map<string, TableState[]> {
  const joins = new Map<string, TableState[]>();
  for (const table of tables) {
    const joinId = table.today?.joinId;
    if (joinId == null) continue;
    const members = joins.get(joinId);
    if (members === undefined) joins.set(joinId, [table]);
    else members.push(table);
  }
  return joins;
}

/** The name a tight place shows: a table of today's join by the join's tables' short names, in
 * number order, else its own saved short name; today's names never. `joins` is
 * {@link joinMembersById} of the tables in view. */
export function tightName(
  table: TableState,
  joins: ReadonlyMap<string, readonly TableState[]>,
): string {
  const joinId = table.today?.joinId;
  const members = joinId == null ? [] : (joins.get(joinId) ?? []);
  return members.length === 0 ? table.shortName : mergeLabel(members.map((each) => each.shortName));
}

export function withoutTodaysNames(table: TableState): TableState {
  return table.today === null
    ? table
    : { ...table, today: { ...table.today, name: null, joinName: null } };
}

/** The details sheet's heading: the merge's name, else the table's own name for today, else
 * "Table 4". */
export function detailsHeading(table: TableState, mergeName: string | null): string {
  return (
    mergeName ?? table.today?.name ?? t("floor.table_title").replace("{table}", () => table.label)
  );
}

/** The table's saved name when its sheet's heading is a name for today, else null. */
export function savedNameUnder(table: TableState, heading: string): string | null {
  const shown = shownUnder(table);
  return shown !== table.label && shown === heading ? table.label : null;
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
  const heading = targetGroup.members[0]!.today?.joinName ?? mergeLabel(both.map(shownName));
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

/** Whether guests may be seated at a free table in `zone`: the server's `openTab` refuses any area
 * but table service. A zone the till has not read is left to the server. */
export function seatsGuests(zone: FloorZone | undefined): boolean {
  return zone === undefined || zone.serviceMode === "table_tab";
}

/** Whether the drop seats guests at a free table, which `openTab` (a seat) and `refuseUnseatable`
 * (a party joined onto a free table) refuse outside table service. */
export function seatsAtFreeTable(action: DropAction): boolean {
  return action.kind === "seat" || (action.kind === "join" && action.other === null);
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

/** A reset left this table's change waiting: it is not seated, joined or given a party until
 * someone marks it moved. */
export function needsMovingToday(table: TableState): boolean {
  return table.today?.needsMoving === true;
}

export function onTodaysPlan(table: TableState): boolean {
  return table.today !== null && table.today.placement !== null && !table.today.takenOff;
}

export function sparesOf(zoneTables: readonly TableState[]): TableState[] {
  return zoneTables.filter(
    (table) =>
      table.today !== null &&
      table.today.placement === null &&
      !table.today.takenOff &&
      !table.today.fixed,
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

export type SheetAction =
  "join-with" | "split-off" | "rotate" | "seats" | "rename" | "back" | "take-off";

export function sheetActions(
  table: TableState,
  _zoneTables: readonly TableState[] = [],
): SheetAction[] {
  const today = table.today;
  if (today === null || today.placement === null || today.takenOff) return [];
  const merged = today.joinId !== null;
  const clearing = table.condition === "needs_clearing";
  // A party-held table is `held`, never `free` (`tableCondition`, apps/server/src/working-order.ts).
  const free = table.condition === "free" && table.pendingDeliveries === 0;
  const applies: [SheetAction, boolean][] = [
    ["join-with", !merged && !clearing && !needsMovingToday(table)],
    ["split-off", merged],
    ["rotate", !today.fixed && !merged],
    ["seats", true],
    ["rename", true],
    ["back", true],
    ["take-off", free && !merged],
  ];
  return applies.filter(([, offered]) => offered).map(([action]) => action);
}

export function splitsGroup(table: TableState): boolean {
  return table.today?.joinId != null;
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

export function groupSplitOf(
  table: TableState,
  zoneTables: readonly TableState[],
): GroupSplit | null {
  if (!splitsGroup(table)) return null;
  const members = mergeMembersOf(zoneTables, table).sort((a, b) => inNumberOrder(a.label, b.label));
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
  /** As the party will read its tables: the group keeps its row and name only while two or more
   * of its tables stay (`leaveAsGroup`), and a named group is read once. */
  const guestsMoveTo = (ticked: readonly string[]): string[] => {
    const groupStays = members.filter((each) => !ticked.includes(each.id)).length >= 2;
    return keptBy(ticked).flatMap((kept) => {
      const tables = zoneTables.filter((each) => kept.includes(each.id));
      if (kept.length === 0 || tables.length !== kept.length) return [];
      const names = tables.map((each) =>
        groupStays || !members.includes(each) ? shownUnder(each) : shownName(each),
      );
      return [mergeLabel([...new Set(names)].sort(inNumberOrder))];
    });
  };
  return {
    members,
    name: groupName(members),
    asksSeats: (staying) => staying.length >= 2,
    guestsMoveTo,
    strandsGuests: (ticked) => keptBy(ticked).some((kept) => kept.length === 0),
  };
}
