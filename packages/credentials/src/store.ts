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
        // The same clock the column's own `$defaultFn(nowIso)` reads on the INSERT branch, so the
        // two branches cannot disagree the way a database clock paired with an app clock could.
        // That pairing is what the PostgreSQL `now()` here used to be: the DATABASE's clock, once
        // per transaction. This engine has no such function and the statement failed outright with
        // `no such function: now`.
        updatedAt: nowIso(),
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
 * Whether this database's taxpayer has a credential provisioned for `purpose`.
 *
 * An ordinary query on the supplied handle. It replaces a PostgreSQL function,
 * `credential_tenants(text)`, which this engine has no counterpart for — SQLite defines no SQL
 * functions of its own, and the call threw `no such function: credential_tenants`
 * (`packages/credentials/src/credentials.test.ts`, both `credentialProvisioned` cases, run
 * 2026-09-22 before this replacement). Nothing about privileges is claimed here any more, because
 * there is no role to claim it of.
 *
 * Two facts in one statement, exactly as the function it replaces selected them — the taxpayer row
 * and an `EXISTS` over the vault, so BOTH must hold. Its body, for comparison:
 * `git show origin/main:packages/credentials/drizzle/0001_credentials_baseline_sql.sql`. The
 * `ORDER BY id` it carried is gone rather than kept: the caller reads emptiness, and `tenants` is a
 * singleton (`packages/db/src/schema/tenants.ts`'s `tenants_singleton_ck`), so no ordering is
 * observable. Pinned from both ends by `credentials.test.ts` — the vault half by a credential for a
 * DIFFERENT purpose answering false, the taxpayer half by an unseeded `tenants` answering false
 * while the purpose IS provisioned.
 *
 * This is what tells the host which duties to run, and it has a property worth naming: an
 * unprovisioned purpose matches no row, so the vault IS the enrolment list for that duty — the
 * host needs no separate notion of "is Stripe configured".
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
 * `tryGetCredential` and `putCredential` share one `withTransaction` transaction per row. On
 * PostgreSQL that did NOT make the pair atomic against a concurrent `set`: under READ COMMITTED the
 * SELECT took no row lock, so a `set` committing between the two was overwritten by this rotation's
 * stale value. It was accepted rather than fixed — `rotate` is a maintenance-window operation and
 * "rotation without downtime" is out of scope (design spec §8) — and what it declined was
 * `SELECT ... FOR UPDATE` inside the transaction, or REPEATABLE READ plus a retry loop. There is
 * nothing to accept on this engine: `withTransaction` runs its body inside `db.withWriteLock`
 * (`packages/db/src/tenancy.ts:44`), so one write transaction runs on the venue file at a time
 * (`packages/store/src/write-queue.ts`) and no `set` can commit between ONE row's read and its
 * write. Between two rows it still can — this paragraph is only about the pair inside one row's
 * transaction.
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
