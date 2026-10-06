import { and, eq } from "drizzle-orm";
import { diningTables } from "@waitron/db";
import type { Database, SQL, Transaction } from "@waitron/db";
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

/** {@link assertSubjectZones} for the session's profile, first thing in the route's own transaction. */
export async function checkZones(
  tx: Transaction,
  cfg: TillConfig,
  session: { device: { deviceProfileId: string } },
  subjects: readonly ZoneSubject[],
): Promise<void> {
  await assertSubjectZones(tx, cfg, session.device.deviceProfileId, subjects);
}

/**
 * {@link assertSubjectZones} for a route whose work runs in a helper that opens its own transaction.
 * It reads committed rows outside the transaction that acts, and takes no turn in the write queue.
 */
export async function gateZones(
  deps: { db: Database; cfg: TillConfig },
  session: { device: { deviceProfileId: string } },
  subjects: readonly ZoneSubject[],
): Promise<void> {
  await assertSubjectZones(deps.db, deps.cfg, session.device.deviceProfileId, subjects);
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

/** A WHERE condition on an order id for the orders the profile may see; none when it has no department. */
export type OrderZoneCondition = (orderId: SQL) => SQL;

export async function orderZoneCondition(
  tx: Transaction,
  cfg: TillConfig,
  profileId: string,
): Promise<OrderZoneCondition | undefined> {
  const scope = await readZoneScope(tx, cfg, profileId);
  if (scope === null) return undefined;
  return (orderId) => VENUE_SERVICE.orderInZones(cfg, orderId, [...scope]);
}

/** The orders the session's profile may see: those in its zones, and those in none. Read as {@link gateZones} reads. */
export async function visibleOrders<T extends { id: string }>(
  deps: { db: Database; cfg: TillConfig },
  session: { device: { deviceProfileId: string } },
  orders: readonly T[],
): Promise<T[]> {
  const scope = await readZoneScope(deps.db, deps.cfg, session.device.deviceProfileId);
  if (scope === null) return [...orders];
  const zones = await VENUE_SERVICE.findOrderZones(
    deps.db,
    deps.cfg,
    orders.map((order) => order.id),
  );
  return orders.filter((order) => inScope(scope, zones.get(order.id)));
}
