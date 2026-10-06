import { and, eq, isNull } from "drizzle-orm";
import { devices, nowIso } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { sessions } from "./schema/sessions.js";
import { verifyPersonCredential } from "./credential.js";
import { canUseDeviceProfile } from "./profile-admission.js";
import type { PersonRoleValue } from "./permissions.js";
import { hashSessionToken, mintSessionToken } from "./session-token.js";
import type { SecretCheck } from "./secret-check.js";

export interface Session {
  /** The row's identity — what `authorize` takes. Never the cookie. */
  id: string;
  /** The bearer token the shift cookie carries. Only its hash is stored. */
  token: string;
  personId: string;
  deviceId: string;
  /** Convenience for client-side affordances only: every server gate re-derives the role from the
   * session and re-checks the permission (`authorize`), so a tampered client value grants nothing. */
  role: PersonRoleValue;
  /** `null` means no preference: fall back to the venue default. */
  locale: string | null;
}

/**
 * Throws `pin.invalid`, whatever the reason the person cannot sign in — a person the device's
 * current profile does not admit included, refused only after their PIN was checked.
 */
export async function loginWithPin(
  tx: Transaction,
  input: { deviceId: string; personId: string; pin: string; checked?: SecretCheck },
): Promise<Session> {
  const { role, locale } = await verifyPersonCredential(
    tx,
    input.personId,
    input.pin,
    input.checked,
  );
  const [device] = await tx
    .select({ profileId: devices.deviceProfileId })
    .from(devices)
    .where(eq(devices.id, input.deviceId));
  // An unknown device is left to the session's foreign key to refuse.
  if (device !== undefined && !(await canUseDeviceProfile(tx, device.profileId, input.personId))) {
    throw new AppError("pin.invalid", {}, { reason: "not_admitted" });
  }

  const token = mintSessionToken();
  const [row] = await tx
    .insert(sessions)
    .values({
      personId: input.personId,
      deviceId: input.deviceId,
      tokenHash: hashSessionToken(token),
    })
    .returning({ id: sessions.id });
  return {
    id: row!.id,
    token,
    personId: input.personId,
    deviceId: input.deviceId,
    role,
    locale,
  };
}

/** End every shift session still open on a device. */
export async function endDeviceSessions(tx: Transaction, deviceId: string): Promise<void> {
  await tx
    .update(sessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(sessions.deviceId, deviceId), isNull(sessions.endedAt)));
}

/** True if this call closed the session; false if it was already ended, or the token names no
 * session — a row id or a stored hash names none. */
export async function endSession(tx: Transaction, token: string): Promise<boolean> {
  const updated = await tx
    .update(sessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(sessions.tokenHash, hashSessionToken(token)), isNull(sessions.endedAt)))
    .returning({ id: sessions.id });
  return updated.length > 0;
}
