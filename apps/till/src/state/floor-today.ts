import { type JoinSide, heldStep, joinSide, touchingPlace } from "@waitron/shared";
import { type FloorMapDrop, clampToGrid, cropToTables, mergeLabel } from "@waitron/ui";
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
      seatsGuess: number;
      heading: string;
    }
  | { kind: "seat"; tableId: string; withTableIds: string[]; heading: string }
  | {
      kind: "join";
      party: TableParty;
      tableId: string;
      other: TableParty | null;
      merge: { moving: string; target: string; side: JoinSide } | null;
      seatsGuess: number;
      heading: string;
    };

const SPARE_SIZE = 8;

interface Group {
  members: TableState[];
  fixed: boolean;
  party: TableParty | null;
}

function groupOf(zoneTables: readonly TableState[], table: TableState): Group {
  const joinId = table.today?.joinId ?? null;
  const members =
    joinId === null ? [table] : zoneTables.filter((each) => each.today?.joinId === joinId);
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
  const heading = mergeLabel(both.map((table) => table.label));
  const seatsGuess = both.reduce((sum, table) => sum + (table.today?.seats ?? 0), 0);
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
      : { kind: "merge", tableId: dragged.id, targetId: nearest.id, side, seatsGuess, heading };
  }
  const merge = fixedSide ? null : { moving: dragged.id, target: nearest.id, side };
  if (targetGroup.party !== null) {
    return {
      kind: "join",
      party: targetGroup.party,
      tableId: dragged.id,
      other: draggedGroup.party,
      merge,
      seatsGuess,
      heading,
    };
  }
  return {
    kind: "join",
    party: draggedGroup.party!,
    tableId: nearest.id,
    other: null,
    merge,
    seatsGuess,
    heading,
  };
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
    const xs = members.map(([, p]) => p.x);
    const ys = members.map(([, p]) => p.y);
    const dx = heldStep(action.x - from.x, Math.min(...xs), Math.max(...xs));
    const dy = heldStep(action.y - from.y, Math.min(...ys), Math.max(...ys));
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
  places.set(joined.moving, {
    ...moving,
    ...touchingPlace(placed(joined.target)!, moving, joined.side),
  });
  return places;
}

/** Today's tables with no place, not taken off and not fixed: what Add a spare table offers. */
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
    zoneTables.flatMap((table) =>
      table.today?.placement != null && !table.today.takenOff ? [table.today.placement] : [],
    ),
  );
  if (crop === null) return { x: 0, y: 0 };
  return {
    x: clampToGrid(crop.x + crop.width / 2 - SPARE_SIZE / 2),
    y: clampToGrid(crop.y + crop.height / 2 - SPARE_SIZE / 2),
  };
}

export type SheetAction = "join-with" | "split" | "rotate" | "seats" | "back" | "take-off";

/** Slice 4 decisions 12 and 16: the details sheet's changes for today that apply to `table`, in order. */
export function sheetActions(table: TableState): SheetAction[] {
  const today = table.today;
  if (today === null || today.placement === null || today.takenOff) return [];
  const merged = today.joinId !== null;
  const clearing = table.condition === "needs_clearing";
  // A party-held table is `held`, never `free` (`tableCondition`, apps/server/src/working-order.ts).
  const free = table.condition === "free" && table.pendingDeliveries === 0;
  const applies: [SheetAction, boolean][] = [
    ["join-with", !merged && !clearing],
    ["split", merged],
    ["rotate", !today.fixed && !merged],
    ["seats", true],
    ["back", true],
    ["take-off", free && !merged],
  ];
  return applies.filter(([, offered]) => offered).map(([action]) => action);
}
