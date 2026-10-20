import type { FloorMapDot, FloorMapFill, FloorMapTable } from "@waitron/ui";
import type { TableState } from "../api/client.js";
import { countText, t } from "../i18n/t.js";
import { needsMovingToday, onTodaysPlan } from "./floor-today.js";
import { signalOf } from "./table-signals.js";

/** The fills the till draws today; `fillWords` names each. */
type StandInFill = Extract<FloorMapFill, "free" | "reserved" | "seated" | "bill" | "clearing">;

export interface StandInStatus {
  fill: StandInFill;
  dot: FloorMapDot | null;
}

/** Most urgent last. A table that needs moving takes `clearing` too: staff must act on it before it
 * is seated, as for one needing clearing. */
const FILL_RANK: readonly StandInFill[] = ["free", "reserved", "seated", "bill", "clearing"];
const DOT_RANK: readonly (FloorMapDot | null)[] = [null, "ready", "forgotten"];

function fillOf(table: TableState): StandInFill {
  if (table.condition === "needs_clearing") return "clearing";
  if (needsMovingToday(table)) return "clearing";
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
  let fill: StandInFill = "free";
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
  // Needs clearing's words win over Needs moving's: it must be cleared first.
  const fillFrom =
    (status.fill === "clearing"
      ? members.find((each) => each.condition === "needs_clearing")
      : undefined) ?? members[statuses.findIndex((each) => each.fill === status.fill)]!;
  const dotFrom =
    status.dot === null
      ? undefined
      : members[statuses.findIndex((each) => each.dot === status.dot)];
  return { members, statuses, status, fillFrom, dotFrom };
}

function fillWords(table: TableState, fill: StandInFill): string {
  switch (fill) {
    case "clearing":
      return table.condition === "needs_clearing"
        ? t("floor.needs_clearing")
        : t("floor.needs_moving");
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
  dot: FloorMapDot | null;
  text: string;
} {
  const from = sources(tables);
  return { fill: from.status.fill, dot: from.status.dot, text: pinWords(from) };
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

type Look = Pick<FloorMapTable, "fill" | "dot" | "description" | "allergy">;

function lookOf(from: Sources): Look {
  return {
    fill: from.status.fill,
    dot: from.status.dot,
    description: wordsOf(from),
    ...(from.members.some((member) => member.hasAllergy) ? { allergy: true } : {}),
  };
}

/** The group a table is drawn and named with: its linked party's, else its merge's, else its own. */
export function drawnGroupKey(table: TableState, linkId: string | null): string {
  if (linkId !== null) return `link:${linkId}`;
  return table.today?.joinId == null ? `table:${table.id}` : `join:${table.today.joinId}`;
}

/**
 * Every member of a merge, and every table of a party drawn as two or more groups, carries the same
 * fill, dot and description, as `wt-floor-map` requires; the party's tables also carry its id as
 * `linkId`.
 */
export function mapTables(zoneTables: readonly TableState[]): FloorMapTable[] {
  // `wt-floor-map` draws each merge where its first member is listed, so a part split off, and any
  // merge holding one, goes last to land on top of its joined table.
  const onPlan = zoneTables.filter(onTodaysPlan);
  const liftedJoins = new Set(
    onPlan.flatMap(({ today }) =>
      today!.splitOffFrom !== null && today!.joinId !== null ? [today!.joinId] : [],
    ),
  );
  const lifted = ({ today }: TableState): boolean =>
    today!.splitOffFrom !== null || (today!.joinId !== null && liftedJoins.has(today!.joinId));
  const drawn = [...onPlan.filter((table) => !lifted(table)), ...onPlan.filter(lifted)];
  const groupsOfParty = new Map<string, Set<string>>();
  for (const table of drawn) {
    if (table.party === null) continue;
    const groups = groupsOfParty.get(table.party.id);
    const key = drawnGroupKey(table, null);
    if (groups) groups.add(key);
    else groupsOfParty.set(table.party.id, new Set([key]));
  }
  const linkOf = (table: TableState): string | null =>
    table.party !== null && groupsOfParty.get(table.party.id)!.size > 1 ? table.party.id : null;
  const lookKey = (table: TableState): string => drawnGroupKey(table, linkOf(table));
  const together = new Map<string, TableState[]>();
  for (const table of drawn) {
    const members = together.get(lookKey(table));
    if (members) members.push(table);
    else together.set(lookKey(table), [table]);
  }
  const looks = new Map<string, Look>();
  for (const [key, members] of together) looks.set(key, lookOf(sources(members)));
  return drawn.map((table) => {
    const today = table.today!;
    return {
      id: table.id,
      label: table.label,
      placement: today.placement!,
      ...looks.get(lookKey(table))!,
      joinId: today.joinId,
      fixed: today.fixed,
      linkId: linkOf(table),
      ...(today.name == null ? {} : { name: today.name }),
      ...(today.joinName == null ? {} : { groupName: today.joinName }),
    };
  });
}

const mustStayReachable = (table: TableState): boolean =>
  table.state !== "free" || table.condition !== "free";

/** The tables on today's plan, plus every table that must stay reachable, in the order given. */
export function listedTables(zoneTables: readonly TableState[]): TableState[] {
  return zoneTables.filter(
    (table) => table.today === null || onTodaysPlan(table) || mustStayReachable(table),
  );
}

/** Today's seats, or the merge's seats for one of its members. */
export function seatsFor(table: TableState): number | null {
  if (table.today === null) return null;
  return table.today.joinSeats ?? table.today.seats;
}

export function totalSeats(counts: readonly (number | null)[]): number | null {
  if (counts.length === 0 || counts.some((count) => count === null)) return null;
  return Math.max(
    1,
    Math.min(
      999,
      counts.reduce<number>((sum, count) => sum + count!, 0),
    ),
  );
}
