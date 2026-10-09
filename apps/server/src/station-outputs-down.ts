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
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";

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
  stationIds?: readonly string[],
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
        stationIds === undefined ? undefined : inArray(kitchenStations.id, [...stationIds]),
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
  stationIds?: readonly string[],
): Promise<DownPrinter[]> {
  if (stationIds?.length === 0) return [];
  const rows = await stationPrintersDownQuery(tx, locationId, now, stationIds);
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
  venueLocationId: string,
  now: Date,
): Promise<DarkScreen[]> {
  const darkBefore = new Date(now.getTime() - SCREEN_DARK_MS).toISOString();
  const screens = await VENUE_SERVICE.readStationScreens(
    tx,
    {
      locationId: venueLocationId as LocationId,
    },
    { withSwitchedOff: true },
  );
  if (screens.length === 0) return [];
  const seen = new Map(
    (
      await tx
        .select({ id: devices.id, lastSeenAt: devices.lastSeenAt })
        .from(devices)
        .where(
          inArray(
            devices.id,
            screens.map((screen) => screen.deviceId),
          ),
        )
    ).map((row) => [row.id, row.lastSeenAt]),
  );
  // A station's screens are dark when the most recent sighting among them is: one live screen
  // keeps the station lit.
  const lastSeen = new Map<string, string | null>();
  for (const screen of screens) {
    const at = seen.get(screen.deviceId) ?? null;
    for (const stationId of screen.stationIds) {
      const before = lastSeen.get(stationId);
      lastSeen.set(
        stationId,
        before === undefined ? at : before === null || (at !== null && at > before) ? at : before,
      );
    }
  }
  const dark = [...lastSeen].filter(([, at]) => at === null || at < darkBefore);
  if (dark.length === 0) return [];
  const waiting = await stationsWithWaitingDishes(
    tx,
    venueLocationId,
    now,
    dark.map(([stationId]) => stationId),
  );
  if (waiting.size === 0) return [];
  const darkSince = new Map(dark);
  const stations = await tx
    .select({ id: kitchenStations.id, name: kitchenStations.name })
    .from(kitchenStations)
    .where(inArray(kitchenStations.id, [...waiting]))
    .orderBy(kitchenStations.displayOrder, kitchenStations.name);
  return stations.map((station) => ({
    stationId: station.id,
    stationName: station.name,
    lastSeenAt: darkSince.get(station.id)!,
  }));
}
