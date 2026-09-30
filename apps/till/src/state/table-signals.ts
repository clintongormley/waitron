import type { TableSignal } from "@waitron/shared";
import type { TableState } from "../api/client.js";

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
