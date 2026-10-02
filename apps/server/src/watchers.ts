import "./errors.js";
import { and, asc, eq, inArray } from "drizzle-orm";
import { AppError } from "@waitron/shared";
import {
  floorZones,
  isUniqueViolation,
  printers,
  stationPrinters,
  watchers,
  watcherPrinters,
  watcherStations,
  watcherZones,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { requireLiveStation } from "./kitchen.js";
import type { TillConfig } from "./till-config.js";

/** A flag follows every future member too; its corresponding list is empty. */
export interface WatcherFollows {
  everyStation: boolean;
  stationIds: readonly string[];
  everyZone: boolean;
  zoneIds: readonly string[];
}

export interface Watcher extends WatcherFollows {
  id: string;
  name: string;
  runsPass: boolean;
  displayOrder: number;
  active: boolean;
  printerIds: string[];
}

export interface WatcherInput extends WatcherFollows {
  name: string;
  runsPass: boolean;
  displayOrder?: number;
}

export function watcherSees(
  follows: WatcherFollows,
  dish: { stationId: string; zoneId: string | null },
): boolean {
  return (
    (follows.everyStation || follows.stationIds.includes(dish.stationId)) &&
    (follows.everyZone || (dish.zoneId !== null && follows.zoneIds.includes(dish.zoneId)))
  );
}

function invalid(field: string): never {
  throw new AppError("management.request_invalid", { field });
}

async function checkedInput(tx: Transaction, cfg: TillConfig, input: WatcherInput) {
  const name = input.name.trim();
  if (!name) invalid("name");
  const stationIds = [...new Set(input.stationIds)];
  const zoneIds = [...new Set(input.zoneIds)];
  if (input.everyStation === stationIds.length > 0) invalid("stationIds");
  if (input.everyZone === zoneIds.length > 0) invalid("zoneIds");
  for (const stationId of stationIds) await requireLiveStation(tx, cfg, stationId);
  for (const zoneId of zoneIds) {
    const [zone] = await tx
      .select({ id: floorZones.id })
      .from(floorZones)
      .where(
        and(
          eq(floorZones.id, zoneId),
          eq(floorZones.locationId, cfg.locationId),
          eq(floorZones.active, true),
        ),
      )
      .limit(1);
    if (!zone) throw new AppError("zone.not_found", { zoneId });
  }
  return { name, stationIds, zoneIds };
}

async function setFollows(
  tx: Transaction,
  watcherId: string,
  stationIds: string[],
  zoneIds: string[],
) {
  await tx.delete(watcherStations).where(eq(watcherStations.watcherId, watcherId));
  await tx.delete(watcherZones).where(eq(watcherZones.watcherId, watcherId));
  if (stationIds.length)
    await tx
      .insert(watcherStations)
      .values(stationIds.map((stationId) => ({ watcherId, stationId })));
  if (zoneIds.length)
    await tx.insert(watcherZones).values(zoneIds.map((zoneId) => ({ watcherId, zoneId })));
}

export async function createWatcher(
  tx: Transaction,
  cfg: TillConfig,
  input: WatcherInput,
): Promise<{ id: string }> {
  const checked = await checkedInput(tx, cfg, input);
  let id: string;
  try {
    const [row] = await tx
      .insert(watchers)
      .values({
        locationId: cfg.locationId,
        name: checked.name,
        everyStation: input.everyStation,
        everyZone: input.everyZone,
        runsPass: input.runsPass,
        displayOrder: input.displayOrder ?? 0,
      })
      .returning({ id: watchers.id });
    id = row!.id;
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("watcher.name_taken", { name: checked.name });
    throw error;
  }
  await setFollows(tx, id, checked.stationIds, checked.zoneIds);
  return { id };
}

export async function updateWatcher(
  tx: Transaction,
  cfg: TillConfig,
  watcherId: string,
  input: WatcherInput,
): Promise<void> {
  const [old] = await tx
    .select({ id: watchers.id })
    .from(watchers)
    .where(
      and(
        eq(watchers.id, watcherId),
        eq(watchers.locationId, cfg.locationId),
        eq(watchers.active, true),
      ),
    );
  if (!old) throw new AppError("watcher.not_found", { watcherId });
  const checked = await checkedInput(tx, cfg, input);
  try {
    await tx
      .update(watchers)
      .set({
        name: checked.name,
        everyStation: input.everyStation,
        everyZone: input.everyZone,
        runsPass: input.runsPass,
        displayOrder: input.displayOrder ?? 0,
      })
      .where(eq(watchers.id, watcherId));
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("watcher.name_taken", { name: checked.name });
    throw error;
  }
  await setFollows(tx, watcherId, checked.stationIds, checked.zoneIds);
}

export async function removeWatcher(
  tx: Transaction,
  cfg: TillConfig,
  watcherId: string,
): Promise<void> {
  const [found] = await tx
    .select({ active: watchers.active })
    .from(watchers)
    .where(and(eq(watchers.id, watcherId), eq(watchers.locationId, cfg.locationId)));
  if (!found) throw new AppError("watcher.not_found", { watcherId });
  if (!found.active) return;
  await tx.update(watchers).set({ active: false }).where(eq(watchers.id, watcherId));
  await tx.delete(watcherPrinters).where(eq(watcherPrinters.watcherId, watcherId));
}

async function assemble(
  tx: Transaction,
  rows: (typeof watchers.$inferSelect)[],
): Promise<Watcher[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const stations = await tx
    .select()
    .from(watcherStations)
    .where(inArray(watcherStations.watcherId, ids));
  const zones = await tx.select().from(watcherZones).where(inArray(watcherZones.watcherId, ids));
  const printers = await tx
    .select()
    .from(watcherPrinters)
    .where(inArray(watcherPrinters.watcherId, ids));
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    runsPass: row.runsPass,
    displayOrder: row.displayOrder,
    active: row.active,
    everyStation: row.everyStation,
    everyZone: row.everyZone,
    stationIds: stations.filter((s) => s.watcherId === row.id).map((s) => s.stationId),
    zoneIds: zones.filter((z) => z.watcherId === row.id).map((z) => z.zoneId),
    printerIds: printers.filter((p) => p.watcherId === row.id).map((p) => p.printerId),
  }));
}

export async function listWatchers(tx: Transaction, cfg: TillConfig): Promise<Watcher[]> {
  const rows = await tx
    .select()
    .from(watchers)
    .where(and(eq(watchers.locationId, cfg.locationId), eq(watchers.active, true)))
    .orderBy(asc(watchers.displayOrder), asc(watchers.name));
  return assemble(tx, rows);
}

export async function readWatcher(
  tx: Transaction,
  cfg: TillConfig,
  watcherId: string,
): Promise<Watcher | null> {
  const rows = await tx
    .select()
    .from(watchers)
    .where(and(eq(watchers.id, watcherId), eq(watchers.locationId, cfg.locationId)));
  return (await assemble(tx, rows))[0] ?? null;
}

/** A printer has one watcher, or station tickets, never both. */
export async function setPrinterWatcher(
  tx: Transaction,
  cfg: TillConfig,
  printerId: string,
  watcherId: string | null,
): Promise<void> {
  const [printer] = await tx
    .select({ id: printers.id })
    .from(printers)
    .where(
      and(
        eq(printers.id, printerId),
        eq(printers.locationId, cfg.locationId),
        eq(printers.active, true),
      ),
    );
  if (!printer) throw new AppError("printer.not_found", { id: printerId });
  if (watcherId === null) {
    await tx.delete(watcherPrinters).where(eq(watcherPrinters.printerId, printerId));
    return;
  }
  const [watcher] = await tx
    .select({ id: watchers.id })
    .from(watchers)
    .where(
      and(
        eq(watchers.id, watcherId),
        eq(watchers.locationId, cfg.locationId),
        eq(watchers.active, true),
      ),
    );
  if (!watcher) throw new AppError("watcher.not_found", { watcherId });
  const [station] = await tx
    .select({ stationId: stationPrinters.stationId })
    .from(stationPrinters)
    .where(eq(stationPrinters.printerId, printerId))
    .limit(1);
  if (station) throw new AppError("printer.makes_and_watches", { id: printerId });
  await tx.insert(watcherPrinters).values({ printerId, watcherId }).onConflictDoUpdate({
    target: watcherPrinters.printerId,
    set: { watcherId },
  });
}
