import { withTransaction, type Database } from "@waitron/db";
import {
  beginOwnTotpEnrollment,
  finishOwnTotpEnrollment,
  startManagementSession,
  type TotpKeyRing,
} from "@waitron/identity";
import { generateSync } from "otplib";

/** Enrols an authenticator through the profile screen's own two calls; returns its secret. */
export async function enrolAuthenticator(
  db: Database,
  personId: string,
  password: string,
  keyRing: TotpKeyRing,
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const { token } = await startManagementSession(tx, { personId });
    const { enrollmentId, secret } = await beginOwnTotpEnrollment(tx, {
      managementSessionId: token,
      currentPassword: password,
      keyRing,
    });
    await finishOwnTotpEnrollment(tx, {
      managementSessionId: token,
      enrollmentId,
      code: generateSync({ secret }),
      keyRing,
    });
    return secret;
  });
}

/**
 * A six-digit code that no step the verifier accepts around now produces for `secret`. The secret
 * is random per run, so a fixed code would occasionally be an accepted one.
 */
export function wrongTotpCode(secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const accepted = new Set(
    [-60, -30, 0, 30, 60].map((offset) => generateSync({ secret, epoch: now + offset })),
  );
  return ["000000", "111111", "222222", "333333", "444444", "555555"].find(
    (code) => !accepted.has(code),
  )!;
}

export const TOTP_KEY_RING: TotpKeyRing = { current: { version: 1, key: Buffer.alloc(32, 0x5) } };
