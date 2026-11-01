import { eq } from "drizzle-orm";
import { locations, nodes, type Transaction } from "@waitron/db";
import { AppError, classifySavedTimeZone, timeZoneOffsetMinutes } from "@waitron/shared";
import type { TrustedClock } from "./clock.js";

export type IssueScope = { nodeId: string; locationId?: string };
export async function readIssueZone(tx: Transaction, scope: IssueScope): Promise<string> {
  const [node] = await tx
    .select({ locationId: nodes.locationId })
    .from(nodes)
    .where(eq(nodes.id, scope.nodeId));
  if (node === undefined) throw new AppError("venue.time_zone_target_invalid", { reason: "node" });
  if (scope.locationId !== undefined && scope.locationId !== node.locationId)
    throw new AppError("venue.time_zone_target_invalid", { reason: "mismatch" });
  const [location] = await tx
    .select({ timeZone: locations.timeZone })
    .from(locations)
    .where(eq(locations.id, node.locationId));
  if (location === undefined)
    throw new AppError("venue.time_zone_target_invalid", { reason: "location" });
  const zone = classifySavedTimeZone(location.timeZone);
  if (zone.kind !== "valid") throw new AppError("venue.time_zone_invalid", { reason: zone.kind });
  return zone.timeZone;
}
export async function prepareIssueClock(
  tx: Transaction,
  scope: IssueScope,
  source: TrustedClock,
): Promise<TrustedClock> {
  const zone = await readIssueZone(tx, scope);
  const reading = source.now();
  const instant = new Date(reading.instant.getTime());
  const frozen = { ...reading, instant, offsetMinutes: timeZoneOffsetMinutes(zone, instant) };
  return {
    now: () => ({ ...frozen, instant: new Date(instant.getTime()) }),
    anchor: (trusted) => source.anchor(trusted),
    currentAnchor: () => source.currentAnchor(),
  };
}
