import { and, eq, gte, inArray, isNull, lt, min, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import {
  deviceProfiles,
  devices,
  kitchenStations,
  passItemMarks,
  printJobs,
  printers,
  stationPrinters,
  ticketItems,
  type Transaction,
} from "@waitron/db";
import { PRINTER_UNPAIRED } from "@waitron/printing";
import { printJobInTrouble } from "./print-job-trouble.js";
import { locationId as brandLocationId, type LocationId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { firedPassDishes, passScopeOf, passSees } from "./pass-board.js";
import type { TillConfig } from "./till-config.js";

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

export interface DarkPass {
  deviceId: string;
  deviceName: string;
  kind: "pass" | "pass_monitor";
  lastSeenAt: string | null;
}

export const SCREEN_DARK_MS = 3 * 60 * 1000;
export const WAITING_WINDOW_MS = 60 * 60 * 1000;

const laterDocument = alias(printJobs, "d");

/** With `withSwitchedOff`, a station switched off on its own page keeps its printers, as a
 *  station screen still shows its waiting dishes (owner 2026-10-09). */
export interface PrintersDownOptions {
  withSwitchedOff?: boolean;
}

export function stationPrintersDownQuery(
  tx: Transaction,
  locationId: string,
  now: Date,
  stationIds?: readonly string[],
  options: PrintersDownOptions = {},
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
        options.withSwitchedOff === true ? undefined : eq(kitchenStations.active, true),
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
  options: PrintersDownOptions = {},
): Promise<DownPrinter[]> {
  if (stationIds?.length === 0) return [];
  const rows = await stationPrintersDownQuery(tx, locationId, now, stationIds, options);
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

export type StationScreens = Awaited<ReturnType<typeof readStationScreensWithSwitchedOff>>;

export function readStationScreensWithSwitchedOff(
  tx: Transaction,
  cfg: { locationId: LocationId },
) {
  return VENUE_SERVICE.readStationScreens(tx, cfg, { withSwitchedOff: true });
}

/** `screens`, when given, is {@link readStationScreensWithSwitchedOff}'s answer in this transaction. */
export async function stationScreensDark(
  tx: Transaction,
  venueLocationId: string,
  now: Date,
  screens?: StationScreens,
): Promise<DarkScreen[]> {
  const darkBefore = new Date(now.getTime() - SCREEN_DARK_MS).toISOString();
  screens ??= await readStationScreensWithSwitchedOff(tx, {
    locationId: brandLocationId(venueLocationId),
  });
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

/** Active kitchen displays running a pass screen or pass monitor, unseen for `SCREEN_DARK_MS`,
 *  whose own board would list a dish fired within `WAITING_WINDOW_MS`. A held dish has no
 *  firing time, so it never counts. */
export async function passScreensDark(
  tx: Transaction,
  cfg: TillConfig,
  now: Date,
): Promise<DarkPass[]> {
  const darkBefore = new Date(now.getTime() - SCREEN_DARK_MS).toISOString();
  const silent = await tx
    .select({ id: devices.id, label: devices.label, lastSeenAt: devices.lastSeenAt })
    .from(devices)
    .innerJoin(deviceProfiles, eq(deviceProfiles.id, devices.deviceProfileId))
    .where(
      and(
        eq(devices.locationId, cfg.locationId),
        eq(devices.active, true),
        eq(deviceProfiles.formFactor, "kds"),
        or(isNull(devices.lastSeenAt), lt(devices.lastSeenAt, darkBefore)),
      ),
    )
    .orderBy(devices.label, devices.id);
  if (silent.length === 0) return [];
  const screens = await VENUE_SERVICE.readDevicesKitchenScreens(
    tx,
    cfg,
    silent.map((device) => device.id),
  );
  const passes = silent.flatMap((device) => {
    const running = screens.get(device.id)!.find((screen) => screen.available);
    return running === undefined || running.kind === "station"
      ? []
      : [{ ...device, kind: running.kind, scope: passScopeOf(running) }];
  });
  if (passes.length === 0) return [];
  const since = new Date(now.getTime() - WAITING_WINDOW_MS).toISOString();
  const dishes = await firedPassDishes(
    tx,
    cfg,
    since,
    passes.some((pass) => pass.scope.zoneIds !== null),
  );
  if (dishes.length === 0) return [];
  const screenIds = passes.flatMap((pass) => (pass.kind === "pass" ? [pass.id] : []));
  const marks =
    screenIds.length === 0
      ? []
      : await tx
          .select({ deviceId: passItemMarks.deviceId, itemId: passItemMarks.ticketItemId })
          .from(passItemMarks)
          .where(
            and(
              inArray(passItemMarks.deviceId, screenIds),
              inArray(
                passItemMarks.ticketItemId,
                dishes.map((dish) => dish.id),
              ),
            ),
          );
  const done = new Set(marks.map((mark) => `${mark.deviceId} ${mark.itemId}`));
  return passes
    .filter((pass) =>
      dishes.some(
        (dish) =>
          passSees(pass.scope, dish) &&
          (pass.kind === "pass"
            ? dish.servedAt === null && !done.has(`${pass.id} ${dish.id}`)
            : dish.awayAt === null),
      ),
    )
    .map((pass) => ({
      deviceId: pass.id,
      deviceName: pass.label,
      kind: pass.kind,
      lastSeenAt: pass.lastSeenAt,
    }));
}
