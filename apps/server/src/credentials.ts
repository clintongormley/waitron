import { withTransaction } from "@waitron/db";
import type { Database } from "@waitron/db";
import { getCredential } from "@waitron/credentials";
import type { KeyRing, PURPOSES, Purpose } from "@waitron/credentials";
import { AppError } from "@waitron/shared";
import "./errors.js";

/**
 * Read the credential for a purpose on each pass. Provisioning and rotation
 * therefore take effect without a restart, and decrypted secrets are not cached
 * for the lifetime of the process.
 */
export function readCredential(
  db: Database,
  ring: KeyRing,
  purpose: Purpose,
): Promise<Record<string, string>> {
  return withTransaction(db, (tx) => getCredential(tx, ring, { purpose }));
}

/**
 * One field of a decrypted credential, refused when absent. A read does not re-check the payload
 * against `PURPOSES`, so a row sealed under an older field list decrypts without the field. An
 * empty string is not checked because a write refuses one (`validatePayload`).
 */
export function credentialField<P extends Purpose>(
  payload: Record<string, string | undefined>,
  purpose: P,
  field: (typeof PURPOSES)[P][number],
): string {
  const value = payload[field];
  if (value === undefined) throw new AppError("server.credential_unusable", { purpose, field });
  return value;
}
