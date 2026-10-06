import { and, eq } from "drizzle-orm";
import { diningTables } from "@waitron/db";
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
 * {@link assertSubjectZones} for a route whose work runs in a helper that opens its own transaction
 * (`parkOrder`, `recordTillSale`, `placeOrder`, `takeBillPayment` and the like), so it cannot share
 * that transaction. It reads outside any transaction, on the read connection, so it takes no turn
 * in the write queue; and a subject moved to another zone between this read and the helper's
 * transaction is acted on where it was checked.
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

/** Of a list of order ids, the ones the profile may see; none to filter when it has no department. */
export type OrderFilter = (orderIds: readonly string[]) => Promise<ReadonlySet<string>>;

export async function orderFilter(
  tx: Transaction,
  cfg: TillConfig,
  profileId: string,
): Promise<OrderFilter | undefined> {
  const scope = await readZoneScope(tx, cfg, profileId);
  if (scope === null) return undefined;
  return async (orderIds) => {
    const zones = await VENUE_SERVICE.findOrderZones(tx, cfg, orderIds);
    return new Set(orderIds.filter((id) => inScope(scope, zones.get(id))));
  };
}

/**
 * The orders the session's profile may see: those in its zones, and those in none. Read outside any
 * transaction, like {@link gateZones}, because the list it filters was read by a helper of its own.
 */
export async function visibleOrders<T extends { id: string }>(
  deps: { db: Database; cfg: TillConfig },
  session: { device: { deviceProfileId: string } },
  orders: readonly T[],
): Promise<T[]> {
  const visible = await orderFilter(deps.db, deps.cfg, session.device.deviceProfileId);
  if (visible === undefined) return [...orders];
  const shown = await visible(orders.map((order) => order.id));
  return orders.filter((order) => shown.has(order.id));
}
