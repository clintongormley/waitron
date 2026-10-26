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
    const count = ready.byStation.reduce((sum, station) => sum + station.count, 0);
    return { key: party.id, value: { partyId: party.id, count } };
  }).map(({ value, table, name }) => ({ ...value, tableId: table.id, name }));
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
