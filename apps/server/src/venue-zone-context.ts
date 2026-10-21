import { asc, eq } from "drizzle-orm";
import {
  locations,
  nodes,
  tenants,
  locationBusinessDaySettings,
  locationDayCutoverChanges,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  businessDayAt,
  businessDayBounds,
  classifyTimeZone,
  timeZoneOffsetMinutes,
  type BusinessDayClock,
  type SavedTimeZone,
} from "@waitron/shared";
import type { IssueScope } from "@waitron/fiscal";

export interface ZoneContext {
  nodeId: string;
  locationId: string;
  legalName: string;
  country: string;
  province: string | null;
  savedZone: SavedTimeZone;
  clock: BusinessDayClock;
  clockRevision: number;
}

const storedCutover = (value: string): string =>
  /^([01]\d|2[0-3]):[0-5]\d:00$/.test(value) ? value.slice(0, 5) : value;

export async function readZoneContext(tx: Transaction, scope: IssueScope): Promise<ZoneContext> {
  const [node] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, scope.nodeId));
  if (node === undefined) throw new AppError("venue.time_zone_target_invalid", { reason: "node" });
  if (scope.locationId !== undefined && scope.locationId !== node.locationId)
    throw new AppError("venue.time_zone_target_invalid", { reason: "mismatch" });
  const [location] = await tx.select().from(locations).where(eq(locations.id, node.locationId));
  const [tenant] = await tx
    .select({ legalName: tenants.legalName, country: tenants.country })
    .from(tenants)
    .where(eq(tenants.id, 1));
  if (location === undefined || tenant === undefined)
    throw new AppError("venue.time_zone_target_invalid", { reason: "location" });
  const changes = await tx
    .select()
    .from(locationDayCutoverChanges)
    .where(eq(locationDayCutoverChanges.locationId, node.locationId))
    .orderBy(asc(locationDayCutoverChanges.effectiveBusinessDay));
  const [settings] = await tx
    .select()
    .from(locationBusinessDaySettings)
    .where(eq(locationBusinessDaySettings.locationId, node.locationId));
  return {
    nodeId: scope.nodeId,
    locationId: node.locationId,
    ...tenant,
    province: location.province,
    savedZone: classifyTimeZone(location.timeZone),
    clock: {
      timeZone: location.timeZone,
      dayCutover: storedCutover(location.dayCutover),
      cutoverChanges: changes.map((change) => ({
        effectiveBusinessDay: change.effectiveBusinessDay,
        dayCutover: storedCutover(change.dayCutover),
      })),
    },
    clockRevision: settings?.revision ?? 0,
  };
}

export function validateZoneClock(clock: BusinessDayClock, at: Date): void {
  const current = businessDayAt(clock, at);
  const days = new Set([current]);
  for (const change of clock.cutoverChanges) {
    for (const delta of [-1, 0, 1]) {
      const date = new Date(`${change.effectiveBusinessDay}T00:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + delta);
      days.add(date.toISOString().slice(0, 10));
    }
  }
  for (const day of days) businessDayBounds(clock, day);
}

export async function validateRetainedZoneClock(
  tx: Transaction,
  scope: IssueScope,
  candidateZone: string,
  at: Date,
): Promise<BusinessDayClock> {
  const context = await readZoneContext(tx, scope);
  const zone = classifyTimeZone(candidateZone);
  if (zone.kind !== "valid") throw new AppError("venue.time_zone_invalid", { reason: zone.kind });
  timeZoneOffsetMinutes(zone.timeZone, at);
  const clock = { ...context.clock, timeZone: zone.timeZone };
  validateZoneClock(clock, at);
  return clock;
}
