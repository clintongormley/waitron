import type { TableSignal } from "@waitron/shared";
import type { TableState } from "../api/client.js";
import { joinMembersById, tightName } from "./floor-today.js";

export function signalOf<K extends TableSignal["kind"]>(
  signals: readonly TableSignal[],
  kind: K,
): Extract<TableSignal, { kind: K }> | undefined {
  return signals.find(
    (signal): signal is Extract<TableSignal, { kind: K }> => signal.kind === kind,
  );
}

/** The party's bill request as the floor last read it. */
export function billRequestOf(
  tables: readonly TableState[],
  partyId: string,
): Extract<TableSignal, { kind: "bill_requested" }> | undefined {
  const row = tables.find((table) => table.party?.id === partyId);
  return row === undefined ? undefined : signalOf(row.signals, "bill_requested");
}

export interface StationReady {
  stationId: string;
  stationName: string;
  /** Each party with dishes ready at the station, by its display name. */
  parties: { name: string; count: number }[];
}

/**
 * The floor's `ready` signals read per station, in the order the floor first names each station and
 * each party. Every table of a party carries the party's signals, so a party is counted once.
 */
export function readyByStation(tables: readonly TableState[]): StationReady[] {
  const stations = new Map<string, StationReady>();
  const counted = new Set<string>();
  for (const table of tables) {
    const party = table.party;
    const ready = signalOf(table.signals, "ready");
    if (party === null || ready === undefined || counted.has(party.id)) continue;
    counted.add(party.id);
    for (const { stationId, stationName, count } of ready.byStation) {
      const station = stations.get(stationId) ?? { stationId, stationName, parties: [] };
      station.parties.push({ name: party.displayName, count });
      stations.set(stationId, station);
    }
  }
  return [...stations.values()];
}

export interface ReadyTable {
  partyId: string;
  tableId: string;
  name: string;
  count: number;
  /** The earliest readable ready time over the party's stations, epoch ms; null when none. */
  oldestReadyAt: number | null;
  /** The first moment one of its stations has waited its own ready warning time; never when none is timed. */
  warnsAt: number;
}

/**
 * Each party with food ready that sits at a table in one of `zoneIds`, named by those tables only,
 * in the order the floor first lists such a table. A table with no zone is in none.
 */
export function readyTables(
  tables: readonly TableState[],
  zoneIds: ReadonlySet<string>,
): ReadyTable[] {
  return groupTables(tables, (table) => {
    const party = table.party;
    if (party === null || table.zoneId === null || !zoneIds.has(table.zoneId)) return null;
    const ready = signalOf(table.signals, "ready");
    if (ready === undefined) return null;
    let count = 0;
    let oldestReadyAt: number | null = null;
    let warnsAt = Number.POSITIVE_INFINITY;
    for (const station of ready.byStation) {
      count += station.count;
      const readyAt = Date.parse(station.oldestReadyAt ?? "");
      if (Number.isNaN(readyAt)) continue;
      oldestReadyAt = Math.min(oldestReadyAt ?? readyAt, readyAt);
      warnsAt = Math.min(warnsAt, readyAt + station.readyWarningAfterMinutes * 60_000);
    }
    return { key: party.id, value: { partyId: party.id, count, oldestReadyAt, warnsAt } };
  }).map(({ value, table, name }) => ({ ...value, tableId: table.id, name }));
}

export interface ReadyBarTable extends ReadyTable {
  warning: boolean;
}

export interface ReadyBar {
  /** Warning tables first, then the rest; each group by `oldestReadyAt`, untimed last, ties in floor order. */
  tables: ReadyBarTable[];
  /** The first table's wait in whole minutes while it warns; null while the bar is calm. */
  waitedMinutes: number | null;
}

export function readyBar(entries: readonly ReadyTable[], now: number): ReadyBar {
  const tables = entries
    .map((entry) => ({ ...entry, warning: now >= entry.warnsAt }))
    .sort(
      (a, b) =>
        Number(b.warning) - Number(a.warning) ||
        (a.oldestReadyAt ?? Number.POSITIVE_INFINITY) -
          (b.oldestReadyAt ?? Number.POSITIVE_INFINITY),
    );
  const first = tables[0];
  // A table warns only once a station has a readable time, so a warning one has `oldestReadyAt`.
  const waitedMinutes =
    first?.warning === true ? Math.floor((now - first.oldestReadyAt!) / 60_000) : null;
  return { tables, waitedMinutes };
}

/** The next moment after `now` that `readyBar(entries, ·)` answers differently; never when none. */
export function nextReadyBarChange(entries: readonly ReadyTable[], now: number): number {
  let next = Number.POSITIVE_INFINITY;
  for (const entry of entries) if (entry.warnsAt > now) next = Math.min(next, entry.warnsAt);
  const { tables, waitedMinutes } = readyBar(entries, now);
  if (waitedMinutes !== null) {
    next = Math.min(next, tables[0]!.oldestReadyAt! + (waitedMinutes + 1) * 60_000);
  }
  return next;
}

/**
 * The tables `pick` keeps, one group per key in the order the floor first lists a kept table of
 * it: the first kept table, its picked value, and the kept tables' tight names, distinct, joined
 * with "+".
 */
export function groupTables<V>(
  tables: readonly TableState[],
  pick: (table: TableState) => { key: string; value: V } | null,
): { value: V; table: TableState; name: string }[] {
  const groups = new Map<string, { value: V; table: TableState; names: string[] }>();
  const joins = joinMembersById(tables);
  for (const table of tables) {
    const picked = pick(table);
    if (picked === null) continue;
    const name = tightName(table, joins);
    const known = groups.get(picked.key);
    if (known === undefined) groups.set(picked.key, { value: picked.value, table, names: [name] });
    else if (!known.names.includes(name)) known.names.push(name);
  }
  return [...groups.values()].map(({ value, table, names }) => ({
    value,
    table,
    name: names.join("+"),
  }));
}
