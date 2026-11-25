import { withTransaction, type Transaction } from "@waitron/db";
import { VENUE_SERVICE } from "./modules.js";
import type { TillApiDeps } from "./till-api-deps.js";
import type { ZoneSubject } from "./zone-access.js";

export async function resolveHttpOrderZone(
  deps: TillApiDeps,
  session: { device: { deviceProfileId: string } },
  lineCount: number,
  requestedZoneId: string | undefined,
): Promise<string | undefined> {
  if (requestedZoneId !== undefined || lineCount === 0) return requestedZoneId;
  return withTransaction(deps.db, (tx) => newOrderZoneIn(tx, session, lineCount, requestedZoneId));
}
/** {@link resolveHttpOrderZone} for a route already inside its transaction. */
export async function newOrderZoneIn(
  tx: Transaction,
  session: { device: { deviceProfileId: string } },
  lineCount: number,
  requestedZoneId: string | undefined,
): Promise<string | undefined> {
  if (requestedZoneId !== undefined || lineCount === 0) return requestedZoneId;
  return (
    await VENUE_SERVICE.resolveNewOrderZone(tx, {
      profileId: session.device.deviceProfileId,
    })
  ).zoneId;
}
/** The subjects that are named: a request's optional body ids leave out what they do not carry. */
export function named(...subjects: (ZoneSubject | false)[]): ZoneSubject[] {
  return subjects.filter((subject): subject is ZoneSubject => subject !== false);
}
