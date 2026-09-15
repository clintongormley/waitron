import { eq, sql } from "drizzle-orm";
import { withTransaction, type Database, type Transaction } from "@waitron/db";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
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
  // `JSON.parse` on a non-JSON string throws a `SyntaxError` that EMBEDS the offending input in
  // its own message (verified on this repo's Node: `JSON.parse("sk_live_51ABCDEF")` produces
  // `SyntaxError: Unexpected token 's', "sk_live_51"... is not valid JSON`) — a decrypted
  // credential value inside an error message is exactly what this package must never produce, and
  // a raw non-`AppError` crossing the package boundary besides. Caught broadly and translated to a
  // structured code carrying only the row's identity.
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new AppError("credentials.malformed_payload", { purpose: ref.purpose });
  }
  // Valid JSON that is still not a credential: `null`, an array, or a bare string/number/boolean
  // all parse without throwing and would otherwise slip through an `as Record<string, string>`
  // cast with a type that lies about their shape.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError("credentials.malformed_payload", { purpose: ref.purpose });
  }
  return parsed as Record<string, string>;
}

/**
 * Seals and upserts. Validation runs BEFORE the write, so a rejected payload leaves no row.
 *
 * Inside `withTransaction`'s all-or-nothing transaction, that ordering does not change what an
 * UNCAUGHT rejection leaves behind — Postgres rolls back the whole transaction on any throw,
 * whichever end of this function it came from. What the ordering DOES decide is what a caller who
 * CATCHES the error and commits the surrounding transaction anyway ends up with: validate-first
 * commits nothing, validate-last commits the row. See `store.test.ts`'s "validates the payload
 * before it ever reaches the database" for how that distinction is actually observed — by reading
 * row state from inside the still-open transaction, not after it has already unwound.
 *
 * There is deliberately NO `isPurpose` check here: `purpose` is typed `Purpose`, so the only way to
 * reach this with an unknown one is from untyped input, and the one place that happens — the CLI —
 * validates at its own boundary. A defensive re-check would be a branch no test could turn red,
 * which is the dead surface this project's own rules reject.
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
    // Re-provisioning is the normal case — a rotated Stripe key, a renewed certificate — so an
    // upsert, not an insert that makes the caller delete first. `updated_at` is refreshed so
    // `list` reports when the material last changed.
    .onConflictDoUpdate({
      target: tenantCredentials.purpose,
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: ring.current.version,
        // The database clock, matching the column's own `defaultNow()` on the INSERT branch —
        // never the app clock (`new Date()`). Mixing the two would let host clock skew stamp an
        // update earlier than the original insert. Same idiom as
        // `packages/fiscal-verifactu/src/registro-sif.ts`'s `actualizadoEn: sql\`now()\``.
        updatedAt: sql`now()`,
      },
    });
}

/** True when a row was removed, false when there was none. A boolean rather than void so the CLI
 * can tell "de-provisioned" from "there was nothing there" — the same reason
 * `recordIncidentOnce` and `completeRun` report what they actually did. */
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
 * The tenant ids to serve for `purpose`: the database's tenant when a credential for `purpose` is
 * provisioned, and none when it is not. Calls `credential_tenants` on the supplied database handle,
 * using the caller's privileges.
 *
 * This is what gives the host its tenant list, and it has a property worth naming: an unprovisioned
 * purpose enumerates nobody, so the vault IS the enrolment list for that duty — the host needs no
 * separate notion of "is Stripe configured".
 */
export async function credentialTenants(db: Database, purpose: string): Promise<TenantId[]> {
  const rows = await db.execute<{ tenant_id: string }>(sql`
    select credential_tenants(${purpose}) as tenant_id
  `);
  return rows.rows.map((r) => brandTenantId(r.tenant_id));
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
 * Row by row, each in its own transaction, deliberately: one transaction over the whole vault would
 * hold locks across every row, and a failure part-way would roll back work that is perfectly good.
 * Partial progress is SAFE here precisely because reads select their key by the row's own version —
 * an interrupted run leaves a readable vault, and re-running finishes it. That is the property
 * `rotate.test.ts`'s interrupted case pins down.
 *
 * Rows already on the current version are counted and skipped, which is what makes a second run a
 * no-op rather than a pointless re-encryption of everything. A row deleted between the listing and
 * its re-seal is not counted at all.
 *
 * `tryGetCredential` and `putCredential` share one `withTransaction` transaction per row. It does NOT
 * make the pair atomic against a concurrent `set`: under READ COMMITTED the SELECT takes no row lock,
 * so a `set` committing between the two is overwritten by this rotation's stale value. Preventing
 * that would need `SELECT ... FOR UPDATE` inside this transaction, or REPEATABLE READ plus a retry
 * loop — deliberately absent, because `rotate` is a maintenance-window operation and "rotation without
 * downtime" is out of scope (design spec §8).
 */
/* Coupled to the `PURPOSES` field registry, which is worth knowing before editing either.
 *
 * Rotation re-seals through `putCredential`, which re-runs `validatePayload` — so every stored
 * payload is re-checked against the CURRENT registry, not the one it was provisioned under. Add or
 * rename a field on an already-provisioned purpose and the next `rotate` throws
 * `credentials.invalid_payload` on the first affected row and abandons the sweep, discarding the
 * counts it had accumulated. Design §4 explicitly anticipates `fiscal.aeat`'s shape changing, so
 * this is reachable rather than theoretical: a one-line registry edit can block retiring a
 * compromised key until that purpose is re-provisioned.
 *
 * Left as-is rather than skipping validation on the rotate path, because re-sealing a payload the
 * package would now refuse to accept is its own trap. */
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
