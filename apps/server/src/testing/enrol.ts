import { withTransaction, type Database } from "@waitron/db";
import { createJoinRequest, acceptDeviceJoinRequest } from "../join-requests.js";
import type { TillConfig } from "../till-config.js";

/**
 * Enrol a device — knock, then accept — in one call. Deliberately NOT a production verb: it bypasses
 * the pairing window, the number check and the claim, which a route must never do.
 */
export async function enrolDeviceForTest(
  db: Database,
  cfg: TillConfig,
  input: {
    name: string;
    profileId: string;
    stationId?: string;
    watcherId?: string;
  },
): Promise<{ deviceId: string; token: string }> {
  return withTransaction(db, async (tx) => {
    const made = await createJoinRequest(tx, cfg, { kind: "device", label: input.name });
    const accepted = await acceptDeviceJoinRequest(tx, cfg, made.joinId, {
      label: input.name,
      profileId: input.profileId,
      stationId: input.stationId ?? null,
      watcherId: input.watcherId ?? null,
    });
    return { deviceId: accepted.deviceId, token: made.token };
  });
}
