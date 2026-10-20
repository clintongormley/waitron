import type { FloorMapTable } from "@waitron/ui";
import type { TableState } from "../api/client.js";
import { mapLook } from "./floor-look.js";
import { onTodaysPlan } from "./floor-today.js";

export { readyText } from "./floor-look.js";

type Look = Pick<FloorMapTable, "fill" | "outline" | "pulse" | "cue" | "description" | "allergy">;

function lookOf(members: readonly TableState[], now: number): Look {
  const { fill, outline, pulse, cue, description } = mapLook(members, now);
  return {
    fill,
    outline,
    pulse,
    cue,
    description,
    ...(members.some((member) => member.hasAllergy) ? { allergy: true } : {}),
  };
}

/** The group a table is drawn and named with: its linked party's, else its merge's, else its own. */
export function drawnGroupKey(table: TableState, linkId: string | null): string {
  if (linkId !== null) return `link:${linkId}`;
  return table.today?.joinId == null ? `table:${table.id}` : `join:${table.today.joinId}`;
}

/**
 * Every member of a merge, and every table of a party drawn as two or more groups, carries the same
 * look, as `wt-floor-map` requires; the party's tables also carry its id as `linkId`.
 */
export function mapTables(zoneTables: readonly TableState[], now: number): FloorMapTable[] {
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
  for (const [key, members] of together) looks.set(key, lookOf(members, now));
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
