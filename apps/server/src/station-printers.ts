// Keeps this host's `station.*` codes reachable from the file that throws them.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { kitchenStations, printers, stationPrinters } from "@waitron/db";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PrintConfig } from "@waitron/printing";

// The station → printer mapping verbs. The `printer.manage` gate is applied at the route, not here.
// One taxpayer per database and the mapping carries no location, so nothing in `cfg` narrows these.

export interface StationPrinter {
  stationId: string;
  printerId: string;
}

/**
 * Record that a fire at this station prints a ticket at this printer. Both ends must be active. The
 * table's only unique constraint is its `(station_id, printer_id)` key, so the untargeted
 * `onConflictDoNothing` makes re-attaching an attached pair a no-op.
 */
export async function attachPrinterToStation(
  tx: Transaction,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  const [live] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(and(eq(kitchenStations.id, stationId), eq(kitchenStations.active, true)));
  if (live === undefined) throw new AppError("station.not_found", { stationId });

  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  await tx.insert(stationPrinters).values({ stationId, printerId }).onConflictDoNothing();
}

/**
 * Deliberately does not check that either end is still active: a mapping to a retired station or
 * printer must stay detachable so the config can be cleaned up.
 */
export async function detachPrinterFromStation(
  tx: Transaction,
  cfg: PrintConfig,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  void cfg;
  await tx
    .delete(stationPrinters)
    .where(and(eq(stationPrinters.stationId, stationId), eq(stationPrinters.printerId, printerId)));
}

export async function listStationPrinters(
  tx: Transaction,
  cfg: PrintConfig,
  filter?: { stationId?: string; printerId?: string },
): Promise<StationPrinter[]> {
  void cfg;
  const conditions: SQL[] = [];
  if (filter?.stationId !== undefined) {
    conditions.push(eq(stationPrinters.stationId, filter.stationId));
  }
  if (filter?.printerId !== undefined) {
    conditions.push(eq(stationPrinters.printerId, filter.printerId));
  }
  return tx
    .select({ stationId: stationPrinters.stationId, printerId: stationPrinters.printerId })
    .from(stationPrinters)
    .where(and(...conditions))
    .orderBy(stationPrinters.stationId, stationPrinters.printerId);
}
