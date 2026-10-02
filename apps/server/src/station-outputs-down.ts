import { and, eq, gte, inArray, isNull, min, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  devices,
  kitchenStations,
  printJobs,
  printers,
  stationPrinters,
  ticketItems,
  type Transaction,
} from "@waitron/db";
import { PRINTER_UNPAIRED } from "@waitron/printing";
import { printJobInTrouble } from "./print-job-trouble.js";

export interface DownPrinter {
  stationId: string;
  stationName: string;
  printerId: string;
  printerName: string;
  since: string;
}

export interface DarkScreen {
  stationId: string;
  stationName: string;
  lastSeenAt: string | null;
}

export const SCREEN_DARK_MS = 3 * 60 * 1000;
export const WAITING_WINDOW_MS = 60 * 60 * 1000;

const laterDocument = alias(printJobs, "d");

export function stationPrintersDownQuery(
  tx: Transaction,
  locationId: string,
  now: Date,
  stationId?: string,
) {
  return tx
    .select({
      stationId: kitchenStations.id,
      stationName: kitchenStations.name,
      printerId: printers.id,
      printerName: printers.name,
      since: min(printJobs.createdAt),
    })
    .from(stationPrinters)
    .innerJoin(kitchenStations, eq(kitchenStations.id, stationPrinters.stationId))
    .innerJoin(printers, eq(printers.id, stationPrinters.printerId))
    .innerJoin(printJobs, eq(printJobs.printerId, printers.id))
    .where(
      and(
        eq(kitchenStations.locationId, locationId),
        eq(kitchenStations.active, true),
        stationId === undefined ? undefined : eq(kitchenStations.id, stationId),
        eq(printers.active, true),
        inArray(printJobs.status, ["queued", "printing", "failed"]),
        printJobInTrouble(now),
        or(isNull(printJobs.lastError), ne(printJobs.lastError, PRINTER_UNPAIRED)),
        sql`not exists (select 1 from ${printJobs} as ${laterDocument}
        where ${laterDocument.printerId} = ${printJobs.printerId}
        and ${laterDocument.kind} = 'document'
        and ${laterDocument.status} = 'done'
        and ${laterDocument}.rowid > ${printJobs}.rowid)`,
      ),
    )
    .groupBy(kitchenStations.id, kitchenStations.name, printers.id, printers.name);
}

export async function stationPrintersDown(
  tx: Transaction,
  locationId: string,
  now: Date,
  stationId?: string,
): Promise<DownPrinter[]> {
  const rows = await stationPrintersDownQuery(tx, locationId, now, stationId);
  return rows.map((r) => ({ ...r, since: r.since! }));
}

export function waitingDishesQuery(
  tx: Transaction,
  locationId: string,
  now: Date,
  stationIds?: readonly string[],
) {
  const since = new Date(now.getTime() - WAITING_WINDOW_MS).toISOString();
  return tx
    .selectDistinct({ stationId: kitchenStations.id })
    .from(kitchenStations)
    .innerJoin(ticketItems, eq(ticketItems.stationId, kitchenStations.id))
    .where(
      and(
        eq(kitchenStations.locationId, locationId),
        stationIds === undefined ? undefined : inArray(kitchenStations.id, [...stationIds]),
        inArray(ticketItems.state, ["queued", "preparing"]),
        gte(ticketItems.firedAt, since),
      ),
    );
}

export async function stationsWithWaitingDishes(
  tx: Transaction,
  locationId: string,
  now: Date,
  stationIds?: readonly string[],
): Promise<ReadonlySet<string>> {
  if (stationIds?.length === 0) return new Set();
  return new Set(
    (await waitingDishesQuery(tx, locationId, now, stationIds)).map((r) => r.stationId),
  );
}

export async function stationScreensDark(
  tx: Transaction,
  locationId: string,
  now: Date,
): Promise<DarkScreen[]> {
  const darkBefore = new Date(now.getTime() - SCREEN_DARK_MS).toISOString();
  const rows = await tx
    .select({
      stationId: kitchenStations.id,
      stationName: kitchenStations.name,
      lastSeenAt: sql<string | null>`max(${devices.lastSeenAt})`,
    })
    .from(kitchenStations)
    .innerJoin(devices, eq(devices.stationId, kitchenStations.id))
    .where(and(eq(kitchenStations.locationId, locationId), eq(devices.active, true)))
    .groupBy(kitchenStations.id, kitchenStations.name)
    .having(
      or(sql`max(${devices.lastSeenAt}) is null`, sql`max(${devices.lastSeenAt}) < ${darkBefore}`),
    );
  const waiting = await stationsWithWaitingDishes(
    tx,
    locationId,
    now,
    rows.map((r) => r.stationId),
  );
  return rows.filter((r) => waiting.has(r.stationId));
}
