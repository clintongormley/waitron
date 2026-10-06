import { and, eq } from "drizzle-orm";
import { diningTables, withTransaction } from "@waitron/db";
import type { Database, Transaction } from "@waitron/db";
import type { LocationId } from "@waitron/shared";
import { VENUE_SERVICE } from "./modules.js";
import { partyZone } from "./parties.js";
import type { TillConfig } from "./till-config.js";

/** What a till request acts on, by where its service zone is read from. */
export type ZoneSubject =
  { zoneId: string } | { orderId: string } | { partyId: string } | { tableId: string };

/** The zones the session's profile may work in, or null when it has no department restriction. */
export type ZoneScope = ReadonlySet<string> | null;

async function subjectZone(
  tx: Transaction,
  cfg: TillConfig,
  subject: ZoneSubject,
): Promise<string | null> {
  if ("zoneId" in subject) return subject.zoneId.toLowerCase();
  if ("orderId" in subject) {
    const id = subject.orderId.toLowerCase();
    return (await VENUE_SERVICE.findOrderZones(tx, cfg, [id])).get(id) ?? null;
  }
  if ("partyId" in subject) return partyZone(tx, cfg, subject.partyId.toLowerCase());
  const [table] = await tx
    .select({ zoneId: diningTables.zoneId })
    .from(diningTables)
    .where(
      and(
        eq(diningTables.id, subject.tableId.toLowerCase()),
        eq(diningTables.locationId, cfg.locationId),
      ),
    );
  return table?.zoneId ?? null;
}

/**
 * Refuses `service_zone.not_allowed` when a subject sits in a zone the profile may not work in. A
 * subject that names nothing, or sits in no zone, passes, so the route answers it as it always has.
 */
export async function assertSubjectZones(
  tx: Transaction,
  cfg: TillConfig,
  profileId: string,
  subjects: readonly ZoneSubject[],
): Promise<void> {
  const zones = new Set<string>();
  for (const subject of subjects) {
    const zoneId = await subjectZone(tx, cfg, subject);
    if (zoneId !== null) zones.add(zoneId);
  }
  for (const zoneId of zones) await VENUE_SERVICE.assertProfileZone(tx, cfg, profileId, zoneId);
}

/**
 * {@link assertSubjectZones} in a read of its own, before the route's work. Like the session's
 * permission check, it is not in the transaction that acts, so a subject moved to another zone
 * between the two is acted on where it was checked.
 */
export async function gateZones(
  deps: { db: Database; cfg: TillConfig },
  session: { device: { deviceProfileId: string } },
  subjects: readonly ZoneSubject[],
): Promise<void> {
  await withTransaction(deps.db, (tx) =>
    assertSubjectZones(tx, deps.cfg, session.device.deviceProfileId, subjects),
  );
}

export async function readZoneScope(
  tx: Transaction,
  cfg: { locationId: LocationId },
  profileId: string,
): Promise<ZoneScope> {
  const { allowedZoneIds } = await VENUE_SERVICE.readProfileZones(tx, cfg, profileId);
  return allowedZoneIds === null ? null : new Set(allowedZoneIds);
}

/** A zone-less item is in no department, so every profile sees it. */
export function inScope(scope: ZoneScope, zoneId: string | null | undefined): boolean {
  return scope === null || zoneId === null || zoneId === undefined || scope.has(zoneId);
}

/** The orders the session's profile may see: those in its zones, and those in none. */
export async function visibleOrders<T extends { id: string }>(
  deps: { db: Database; cfg: TillConfig },
  session: { device: { deviceProfileId: string } },
  orders: readonly T[],
): Promise<T[]> {
  return withTransaction(deps.db, async (tx) => {
    const scope = await readZoneScope(tx, deps.cfg, session.device.deviceProfileId);
    if (scope === null) return [...orders];
    const zones = await VENUE_SERVICE.findOrderZones(
      tx,
      deps.cfg,
      orders.map((order) => order.id),
    );
    return orders.filter((order) => inScope(scope, zones.get(order.id)));
  });
}
