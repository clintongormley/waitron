import type { TableSignal } from "@waitron/shared";
import type { TableState } from "../api/client.js";
import { shownUnder } from "./floor-today.js";

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
  const parties = new Map<string, { entry: ReadyTable; names: string[] }>();
  for (const table of tables) {
    const party = table.party;
    if (party === null || table.zoneId === null || !zoneIds.has(table.zoneId)) continue;
    const ready = signalOf(table.signals, "ready");
    if (ready === undefined) continue;
    const name = shownUnder(table);
    const known = parties.get(party.id);
    if (known !== undefined) {
      if (!known.names.includes(name)) known.names.push(name);
      continue;
    }
    const count = ready.byStation.reduce((sum, station) => sum + station.count, 0);
    parties.set(party.id, {
      entry: { partyId: party.id, tableId: table.id, name, count },
      names: [name],
    });
  }
  return [...parties.values()].map(({ entry, names }) => ({ ...entry, name: names.join("+") }));
}
