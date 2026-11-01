import { eq } from "drizzle-orm";
import {
  nodes,
  locationBusinessDaySettings,
  readTenant,
  readVenueClockAndPlace,
  type Transaction,
} from "@waitron/db";
import {
  AppError,
  businessDayAt,
  businessDayBounds,
  classifyTimeZone,
  classifySavedTimeZone,
  timeZoneOffsetMinutes,
  type BusinessDayClock,
  type SavedTimeZone,
} from "@waitron/shared";
import type { IssueScope } from "@waitron/fiscal";

export interface ZoneContext {
  nodeId: string;
  legalName: string;
  country: string;
  province: string | null;
  savedZone: SavedTimeZone;
  clock: BusinessDayClock;
  clockRevision: number;
}

/** `scope.locationId` is not read: the box holds one venue. */
export async function readZoneContext(tx: Transaction, scope: IssueScope): Promise<ZoneContext> {
  const [node] = await tx.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, scope.nodeId));
  if (node === undefined) throw new AppError("venue.time_zone_target_invalid", { reason: "node" });
  const tenant = await readTenant(tx);
  if (tenant === null) throw new AppError("venue.not_found", {});
  const { clock, place } = await readVenueClockAndPlace(tx);
  // Keyed by the venue's row id, so the table holds at most one row.
  const [settings] = await tx.select().from(locationBusinessDaySettings).limit(1);
  return {
    nodeId: scope.nodeId,
    legalName: tenant.legalName,
    country: tenant.country,
    province: place.province,
    savedZone: classifySavedTimeZone(clock.timeZone),
    clock,
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
