import type { FloorMapDot, FloorMapFill, FloorMapTable } from "@waitron/ui";
import type { TableState } from "../api/client.js";
import { countText, t } from "../i18n/t.js";
import { signalOf } from "./table-signals.js";

export interface StandInStatus {
  fill: FloorMapFill;
  dot: FloorMapDot | null;
}

/** Most urgent last. */
const FILL_RANK: readonly FloorMapFill[] = ["free", "reserved", "seated", "bill", "clearing"];
const DOT_RANK: readonly (FloorMapDot | null)[] = [null, "ready", "forgotten"];

function fillOf(table: TableState): FloorMapFill {
  if (table.condition === "needs_clearing") return "clearing";
  if (signalOf(table.signals, "bill_requested")) return "bill";
  if (table.state !== "free") return "seated";
  return table.nextReservation === null ? "free" : "reserved";
}

function dotOf(table: TableState): FloorMapDot | null {
  if (table.timingBand === "forgotten") return "forgotten";
  return table.readyToServe > 0 ? "ready" : null;
}

export function standInStatus(table: TableState): StandInStatus {
  return { fill: fillOf(table), dot: dotOf(table) };
}

export function combinedStatus(statuses: readonly StandInStatus[]): StandInStatus {
  let fill: FloorMapFill = "free";
  let dot: FloorMapDot | null = null;
  for (const status of statuses) {
    if (FILL_RANK.indexOf(status.fill) > FILL_RANK.indexOf(fill)) fill = status.fill;
    if (DOT_RANK.indexOf(status.dot) > DOT_RANK.indexOf(dot)) dot = status.dot;
  }
  return { fill, dot };
}

interface Sources {
  members: readonly TableState[];
  /** One per member, in the same order. */
  statuses: readonly StandInStatus[];
  status: StandInStatus;
  fillFrom: TableState;
  dotFrom: TableState | undefined;
}

/**
 * A merge's words read each count from one member, never a sum: the server repeats a party's
 * signals on every table it sits at (`packages/shared/src/table-signals.ts`) and its counts too,
 * because the `tab` subquery of the floor read groups by `pt.table_id`
 * (`apps/server/src/working-order.ts`).
 */
function sources(tables: TableState | readonly TableState[]): Sources {
  const members: readonly TableState[] = Array.isArray(tables) ? tables : [tables as TableState];
  const statuses = members.map(standInStatus);
  const status = combinedStatus(statuses);
  const fillFrom = members[statuses.findIndex((each) => each.fill === status.fill)]!;
  const dotFrom =
    status.dot === null
      ? undefined
      : members[statuses.findIndex((each) => each.dot === status.dot)];
  return { members, statuses, status, fillFrom, dotFrom };
}

function fillWords(table: TableState, fill: FloorMapFill): string {
  switch (fill) {
    case "clearing":
      return t("floor.needs_clearing");
    case "bill":
      return t("signal.bill_requested");
    case "seated":
      return t("floor.status_seated");
    case "reserved":
      return `${t("floor.reserved")} ${table.nextReservation!.time}`;
    case "free":
      return t("floor.free");
  }
}

/** "2 ready", or "1 ready" for one. */
export function readyText(n: number): string {
  return countText(n, "table.flash_ready", "table.flash_ready_one");
}

function dotWords(table: TableState, dot: FloorMapDot): string {
  return dot === "forgotten" ? t("floor.forgotten") : readyText(table.readyToServe);
}

/** The fill's words, then the dot's: "Seated, 2 ready". Pass a merge's members together. */
export function statusWords(tables: TableState | readonly TableState[]): string {
  return wordsOf(sources(tables));
}

function wordsOf({ status, fillFrom, dotFrom }: Sources): string {
  const fill = fillWords(fillFrom, status.fill);
  return dotFrom === undefined ? fill : `${fill}, ${dotWords(dotFrom, status.dot!)}`;
}

/** The status pin's fill and shortest word. Pass a merge's members together. */
export function statusPin(tables: TableState | readonly TableState[]): {
  fill: FloorMapFill;
  text: string;
} {
  const from = sources(tables);
  return { fill: from.status.fill, text: pinWords(from) };
}

export function pinText(tables: TableState | readonly TableState[]): string {
  return statusPin(tables).text;
}

function pinWords({ members, statuses, status, fillFrom, dotFrom }: Sources): string {
  if (dotFrom !== undefined) return dotWords(dotFrom, status.dot!);
  if (status.fill === "seated") {
    const toServe = Math.max(
      ...members.filter((_, i) => statuses[i]!.fill === "seated").map((m) => m.pendingToServe),
    );
    if (toServe > 0) return `${toServe} ${t("floor.to_serve")}`;
  }
  return fillWords(fillFrom, status.fill);
}

export function isPlannedZone(zoneTables: readonly TableState[]): boolean {
  return zoneTables.some((table) => table.today !== null);
}

type Look = Pick<FloorMapTable, "fill" | "dot" | "description">;

function lookOf(from: Sources): Look {
  return { fill: from.status.fill, dot: from.status.dot, description: wordsOf(from) };
}

/** Every member of a merge carries the same fill, dot and description, as `wt-floor-map` requires. */
export function mapTables(zoneTables: readonly TableState[]): FloorMapTable[] {
  const merges = new Map<string, TableState[]>();
  for (const table of zoneTables) {
    const joinId = table.today?.joinId;
    if (joinId == null) continue;
    const members = merges.get(joinId);
    if (members) members.push(table);
    else merges.set(joinId, [table]);
  }
  const looks = new Map<string, Look>();
  for (const [joinId, members] of merges) looks.set(joinId, lookOf(sources(members)));
  const mapped: FloorMapTable[] = [];
  for (const table of zoneTables) {
    const today = table.today;
    if (today === null || today.placement === null || today.takenOff) continue;
    const look = today.joinId === null ? lookOf(sources(table)) : looks.get(today.joinId)!;
    mapped.push({
      id: table.id,
      label: table.label,
      placement: today.placement,
      ...look,
      joinId: today.joinId,
    });
  }
  return mapped;
}

const mustStayReachable = (table: TableState): boolean =>
  table.state !== "free" || table.condition !== "free";

/** The tables on today's plan, plus every table that must stay reachable, in the order given. */
export function listedTables(zoneTables: readonly TableState[]): TableState[] {
  return zoneTables.filter(
    (table) =>
      table.today === null ||
      (table.today.placement !== null && !table.today.takenOff) ||
      mustStayReachable(table),
  );
}

/** Today's seats, a merge's seats for a member of one, or the old capacity with no today's row. */
export function seatsFor(table: TableState): number | null {
  if (table.today === null) return table.capacity;
  return table.today.joinSeats ?? table.today.seats;
}
