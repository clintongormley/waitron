import { eq, exists } from "drizzle-orm";
import { nowIso, tenants, withTransaction, type Database, type Transaction } from "@waitron/db";
import { AppError } from "@waitron/shared";
import { aadFor, open, seal } from "./cipher.js";
import { keyForVersion, type KeyRing } from "./keyring.js";
import { isPurpose, validatePayload, type Purpose } from "./purposes.js";
import { tenantCredentials } from "./schema/tenant-credentials.js";
import "./errors.js";

export interface CredentialRef {
  purpose: Purpose;
}

/** Everything `list` may reveal: which purposes are provisioned, on which key, last written when.
 * Deliberately no value, and no field names either. */
export interface CredentialMeta {
  purpose: string;
  keyVersion: number;
  updatedAt: string;
}

/**
 * Reads and decrypts the credential for one purpose. The purpose is authenticated as AAD, so a
 * ciphertext sealed for another purpose fails to decrypt.
 */
export async function getCredential(
  tx: Transaction,
  ring: KeyRing,
  ref: CredentialRef,
): Promise<Record<string, string>> {
  const value = await tryGetCredential(tx, ring, ref);
  if (value === null) {
    throw new AppError("credentials.missing", { purpose: ref.purpose });
  }
  return value;
}

/** Null ONLY when no row exists. A row that exists but cannot be decrypted throws — silently
 * treating an undecryptable credential as an absent one would let a host boot with a broken key
 * ring and fail later, somewhere else, for a reason nobody could trace back to here. */
export async function tryGetCredential(
  tx: Transaction,
  ring: KeyRing,
  ref: CredentialRef,
): Promise<Record<string, string> | null> {
  const [row] = await tx
    .select()
    .from(tenantCredentials)
    .where(eq(tenantCredentials.purpose, ref.purpose));
  if (row === undefined) return null;

  // The ROW's version, never the ring's current one: that is what keeps a half-finished rotation
  // readable instead of an outage.
  const key = keyForVersion(ring, row.keyVersion);
  if (key === null) {
    throw new AppError("credentials.key_version_unknown", {
      purpose: ref.purpose,
      keyVersion: row.keyVersion,
    });
  }

  const plaintext = open(key, aadFor(ref.purpose), {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.authTag,
  });
  if (plaintext === null) {
    // Wrong key, tampered ciphertext, or a row moved between purposes — one code for all three,
    // because distinguishing them would be an oracle. See cipher.ts's `open`.
    throw new AppError("credentials.decrypt_failed", { purpose: ref.purpose });
  }
  // `JSON.parse`'s `SyntaxError` quotes the input, which here is the decrypted credential.
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new AppError("credentials.malformed_payload", { purpose: ref.purpose });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError("credentials.malformed_payload", { purpose: ref.purpose });
  }
  return parsed as Record<string, string>;
}

/**
 * Seals and upserts. Validation runs BEFORE the write, so a caller that catches the refusal and
 * commits the surrounding transaction anyway commits no row.
 *
 * Deliberately no `isPurpose` check: `purpose` is typed, and the CLI checks its untyped input at
 * its own boundary.
 */
export async function putCredential(
  tx: Transaction,
  ring: KeyRing,
  params: { purpose: Purpose; value: Record<string, unknown> },
): Promise<void> {
  validatePayload(params.purpose, params.value);
  const sealed = seal(ring.current.key, aadFor(params.purpose), JSON.stringify(params.value));
  await tx
    .insert(tenantCredentials)
    .values({
      purpose: params.purpose,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
      keyVersion: ring.current.version,
    })
    // Re-provisioning is the normal case — a rotated Stripe key, a renewed certificate.
    .onConflictDoUpdate({
      target: tenantCredentials.purpose,
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: ring.current.version,
        // The same clock the column's `$defaultFn(nowIso)` reads on the INSERT branch.
        updatedAt: nowIso(),
      },
    });
}

/** True when a row was removed, false when there was none. */
export async function deleteCredential(tx: Transaction, ref: CredentialRef): Promise<boolean> {
  const removed = await tx
    .delete(tenantCredentials)
    .where(eq(tenantCredentials.purpose, ref.purpose))
    .returning({ purpose: tenantCredentials.purpose });
  return removed.length > 0;
}

/** Metadata for every credential in this database. */
export async function listCredentials(tx: Transaction): Promise<CredentialMeta[]> {
  const rows = await tx
    .select({
      purpose: tenantCredentials.purpose,
      keyVersion: tenantCredentials.keyVersion,
      updatedAt: tenantCredentials.updatedAt,
    })
    .from(tenantCredentials);
  return rows;
}

/**
 * Whether this database's taxpayer has a credential provisioned for `purpose`: the `tenants` row
 * and the vault row must both exist. The vault is the enrolment list for the duty the purpose
 * serves; the host keeps no separate "is Stripe configured" flag.
 */
export async function credentialProvisioned(db: Database, purpose: string): Promise<boolean> {
  const rows = await db
    .select({ taxpayer: tenants.id })
    .from(tenants)
    .where(
      exists(
        db
          .select({ purpose: tenantCredentials.purpose })
          .from(tenantCredentials)
          .where(eq(tenantCredentials.purpose, purpose)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface RotationResult {
  /** Rows re-sealed onto the ring's current key by THIS run. */
  rotated: number;
  /** Rows already on the current version — a resumed or repeated rotation, not an error. */
  alreadyCurrent: number;
}

/**
 * Re-seals every credential onto the ring's current key.
 *
 * One transaction per row, so a failure part-way keeps the rows already re-sealed. An interrupted
 * run leaves a readable vault because reads select their key by the row's own version; re-running
 * finishes it.
 *
 * Re-sealing goes through `putCredential`, so every payload is re-checked against the CURRENT
 * `PURPOSES`: a field added to or renamed on a provisioned purpose makes `rotate` throw
 * `credentials.invalid_payload` at that row and stop, until the purpose is re-provisioned. Kept
 * deliberately: re-sealing a payload the package would now refuse is its own trap.
 */
export async function rotateCredentials(db: Database, ring: KeyRing): Promise<RotationResult> {
  const result: RotationResult = { rotated: 0, alreadyCurrent: 0 };
  const rows = await withTransaction(db, (tx) => listCredentials(tx));
  for (const row of rows) {
    if (!isPurpose(row.purpose)) continue;
    if (row.keyVersion === ring.current.version) {
      result.alreadyCurrent += 1;
      continue;
    }
    const purpose = row.purpose;
    await withTransaction(db, async (tx) => {
      const value = await tryGetCredential(tx, ring, { purpose });
      if (value === null) return;
      await putCredential(tx, ring, { purpose, value });
      result.rotated += 1;
    });
  }
  return result;
}
