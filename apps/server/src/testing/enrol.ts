import { asAppUser, withTenant, type Database } from "@waitron/db";
import { createJoinRequest, acceptDeviceJoinRequest } from "../join-requests.js";
import type { TillConfig } from "../till-config.js";

/**
 * Enrol a device the way production now does — knock, then accept — in one call, so the suites that
 * only ever wanted "a device exists" do not each re-implement the two-step flow. Deliberately NOT a
 * production verb: it bypasses the pairing window and the numeric match, which is exactly what a
 * fixture wants and exactly what a route must never do.
 */
export async function enrolDeviceForTest(
  db: Database,
  cfg: TillConfig,
  input: { name: string; profileId: string; stationId?: string; registerId?: string },
): Promise<{ deviceId: string; token: string }> {
  return withTenant(db, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const made = await createJoinRequest(tx, cfg, { kind: "device", label: input.name });
    const accepted = await acceptDeviceJoinRequest(tx, cfg, made.joinId, {
      choice: made.verificationNumber,
      profileId: input.profileId,
      stationId: input.stationId ?? null,
      registerId: input.registerId ?? null,
    });
    /* v8 ignore next -- the fixture always passes the request's own number */
    if (!accepted.ok) throw new Error("enrolDeviceForTest: mismatch");
    return { deviceId: accepted.deviceId, token: made.token };
  });
}
