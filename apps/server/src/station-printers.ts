// Keeps this host's `station.*` codes reachable from the file that throws them.
import "./errors.js";
import { and, eq } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import { refuseDeletedPrinters } from "@waitron/layouts";
import { kitchenStations, printers, stationPrinters } from "@waitron/db";
import type { SQL } from "drizzle-orm";
import type { Transaction } from "@waitron/db";
import type { PrintConfig } from "@waitron/printing";

// The station → printer mapping verbs. The `printer.manage` gate is applied at the route, not here.

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
  { stationId, printerId, locationId }: StationPrinter & Pick<PrintConfig, "locationId">,
): Promise<void> {
  const [live] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, stationId),
        eq(kitchenStations.active, true),
        eq(kitchenStations.locationId, locationId),
      ),
    );
  if (live === undefined) throw new AppError("station.not_found", { stationId });

  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(and(eq(printers.id, printerId), eq(printers.active, true)));
  if (printer === undefined) throw new AppError("printer.not_found", { id: printerId });

  await tx.insert(stationPrinters).values({ stationId, printerId }).onConflictDoNothing();
}

export async function detachPrinterFromStation(
  tx: Transaction,
  cfg: PrintConfig,
  { stationId, printerId }: StationPrinter,
): Promise<void> {
  await requireStation(tx, cfg, stationId);
  await refuseDeletedPrinters(tx, [printerId]);
  await removeMapping(tx, { stationId, printerId });
}

async function removeMapping(tx: Transaction, { stationId, printerId }: StationPrinter) {
  await tx
    .delete(stationPrinters)
    .where(and(eq(stationPrinters.stationId, stationId), eq(stationPrinters.printerId, printerId)));
}

export async function replaceStationPrinters(
  tx: Transaction,
  cfg: PrintConfig,
  stationId: string,
  printerIds: readonly string[],
): Promise<void> {
  await requireStation(tx, cfg, stationId);
  await refuseDeletedPrinters(tx, printerIds);
  const current = await listStationPrinters(tx, cfg, { stationId });
  for (const printerId of printerIds) {
    if (!current.some((row) => row.printerId === printerId)) {
      await attachPrinterToStation(tx, { stationId, printerId, locationId: cfg.locationId });
    }
  }
  for (const row of current) {
    if (!printerIds.includes(row.printerId)) await removeMapping(tx, row);
  }
}

export async function listStationPrinters(
  tx: Transaction,
  cfg: PrintConfig,
  filter?: { stationId?: string; printerId?: string },
): Promise<StationPrinter[]> {
  if (filter?.stationId !== undefined) await requireStation(tx, cfg, filter.stationId);
  if (filter?.printerId !== undefined) await refuseDeletedPrinters(tx, [filter.printerId]);
  const conditions: SQL[] = [
    eq(kitchenStations.locationId, cfg.locationId),
    eq(kitchenStations.active, true),
  ];
  if (filter?.stationId !== undefined) {
    conditions.push(eq(stationPrinters.stationId, filter.stationId));
  }
  if (filter?.printerId !== undefined) {
    conditions.push(eq(stationPrinters.printerId, filter.printerId));
  }
  return tx
    .select({ stationId: stationPrinters.stationId, printerId: stationPrinters.printerId })
    .from(stationPrinters)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinters.stationId))
    .where(and(...conditions))
    .orderBy(stationPrinters.stationId, stationPrinters.printerId);
}

async function requireStation(tx: Transaction, cfg: PrintConfig, stationId: string): Promise<void> {
  const [row] = await tx
    .select({ id: kitchenStations.id })
    .from(kitchenStations)
    .where(
      and(
        eq(kitchenStations.id, stationId),
        eq(kitchenStations.locationId, cfg.locationId),
        eq(kitchenStations.active, true),
      ),
    );
  if (!row) throw new AppError("station.not_found", { stationId });
}
