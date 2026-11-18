import { and, eq, isNull } from "drizzle-orm";
import { devices, nowIso, tillSessions } from "@waitron/db";
import type { Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import type { PersonAuthority } from "./authority.js";
import { verifyPersonCredential } from "./credential.js";
import { canUseDeviceProfile } from "./profile-admission.js";
import { hashSessionToken, mintSessionToken } from "./session-token.js";
import type { SecretCheck } from "./secret-check.js";

export interface Session {
  /** The row's identity — what `authorize` takes. Never the cookie. */
  id: string;
  /** The bearer token the shift cookie carries. Only its hash is stored. */
  token: string;
  personId: string;
  deviceId: string;
  authority: PersonAuthority;
  /** `null` means no preference. */
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
  const { authority, locale } = await verifyPersonCredential(
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
    .insert(tillSessions)
    .values({
      personId: input.personId,
      deviceId: input.deviceId,
      tokenHash: hashSessionToken(token),
    })
    .returning({ id: tillSessions.id });
  return {
    id: row!.id,
    token,
    personId: input.personId,
    deviceId: input.deviceId,
    authority,
    locale,
  };
}

/** End every shift session still open on a device. */
export async function endDeviceSessions(tx: Transaction, deviceId: string): Promise<void> {
  await tx
    .update(tillSessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(tillSessions.deviceId, deviceId), isNull(tillSessions.endedAt)));
}

/** True if this call closed the session; false if it was already ended, or the token names no
 * session — a row id or a stored hash names none. */
export async function endSession(tx: Transaction, token: string): Promise<boolean> {
  const updated = await tx
    .update(tillSessions)
    .set({ endedAt: nowIso() })
    .where(and(eq(tillSessions.tokenHash, hashSessionToken(token)), isNull(tillSessions.endedAt)))
    .returning({ id: tillSessions.id });
  return updated.length > 0;
}
