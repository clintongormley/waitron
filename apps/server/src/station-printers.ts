// Keeps this host's `station.*` codes reachable from the file that throws them.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { refuseDeletedPrinters } from "@waitron/layouts";
import {
  kitchenStations,
  printers,
  readStationPrinterPairs,
  withPrinter,
  withoutId,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";

// The station → printer mapping verbs. The `hardware.manage` gate is applied at the route, not here.

export interface StationPrinter {
  stationId: string;
  printerId: string;
}

export async function attachPrinterToStation(
  tx: Transaction,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  const [live] = await tx
    .select({ id: kitchenStations.id, printerIds: kitchenStations.printerIds })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.active, true)));
  if (live === undefined) throw new AppError("station.not_found", { stationId });

  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  await tx
    .update(kitchenStations)
    .set({ printerIds: withPrinter(live.printerIds, printerId) })
    .where(eq(kitchenStations.id, stationId));
}

export async function detachPrinterFromStation(
  tx: Transaction,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  await requireStation(tx, stationId);
  await refuseDeletedPrinters(tx, [printerId]);
  await removeMapping(tx, { stationId, printerId });
}

async function removeMapping(tx: Transaction, { stationId, printerId }: StationPrinter) {
  const [station] = await tx
    .select({ printerIds: kitchenStations.printerIds })
    .from(kitchenStations)
    .where(eq(kitchenStations.id, stationId));
  await tx
    .update(kitchenStations)
    .set({ printerIds: withoutId(station!.printerIds, printerId) })
    .where(eq(kitchenStations.id, stationId));
}

export async function replaceStationPrinters(
  tx: Transaction,
  stationId: string,
  printerIds: readonly string[],
): Promise<void> {
  await requireStation(tx, stationId);
  await refuseDeletedPrinters(tx, printerIds);
  const current = await listStationPrinters(tx, { stationId });
  for (const printerId of printerIds) {
    if (!current.some((row) => row.printerId === printerId)) {
      await attachPrinterToStation(tx, { stationId, printerId });
    }
  }
  for (const row of current) {
    if (!printerIds.includes(row.printerId)) await removeMapping(tx, row);
  }
}

export async function listStationPrinters(
  tx: Transaction,
  filter?: { stationId?: string; printerId?: string },
): Promise<StationPrinter[]> {
  if (filter?.stationId !== undefined) await requireStation(tx, filter.stationId);
  if (filter?.printerId !== undefined) await refuseDeletedPrinters(tx, [filter.printerId]);
  return readStationPrinterPairs(tx, {
    stationIds: filter?.stationId === undefined ? undefined : [filter.stationId],
    printerId: filter?.printerId,
    activeStationsOnly: true,
  });
}

async function requireStation(tx: Transaction, stationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.active, true)));
  if (!row) throw new AppError("station.not_found", { stationId });
}
