import { eq } from "drizzle-orm";
import { readVenue, nodes, type Transaction } from "@waitron/db";
import { AppError, classifySavedTimeZone, timeZoneOffsetMinutes } from "@waitron/shared";
import type { TrustedClock } from "./clock.js";

export type IssueScope = { nodeId: string };
export async function readIssueZone(tx: Transaction, scope: IssueScope): Promise<string> {
  const [node] = await tx.select({ id: nodes.id }).from(nodes).where(eq(nodes.id, scope.nodeId));
  if (node === undefined) throw new AppError("venue.time_zone_target_invalid", { reason: "node" });
  const zone = classifySavedTimeZone((await readVenue(tx)).timeZone);
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
