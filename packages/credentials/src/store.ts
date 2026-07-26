import { and, eq, sql } from "drizzle-orm";
import { withTenant, type Database, type Transaction } from "@waitron/db";
import { AppError, tenantId as brandTenantId } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { aadFor, open, seal } from "./cipher.js";
import { keyForVersion, type KeyRing } from "./keyring.js";
import { PURPOSES, isPurpose, validatePayload, type Purpose } from "./purposes.js";
import { tenantCredentials } from "./schema/tenant-credentials.js";
import "./errors.js";

export interface CredentialRef {
  tenantId: TenantId;
  purpose: Purpose;
}

/** Everything `list` may reveal: which tenants hold which purposes, on which key, last written
 * when. Deliberately no value, and no field names either. */
export interface CredentialMeta {
  tenantId: TenantId;
  purpose: string;
  keyVersion: number;
  updatedAt: string;
}

/**
 * Reads and decrypts one credential. Runs inside `withTenant`, so RLS has already scoped the row;
 * `tenantId` is passed anyway because it is an AAD input, and because every other store function in
 * this repo names its tenant explicitly.
 */
export async function getCredential(
  tx: Transaction,
  ring: KeyRing,
  ref: CredentialRef,
): Promise<Record<string, string>> {
  const value = await tryGetCredential(tx, ring, ref);
  if (value === null) {
    throw new AppError("credentials.missing", { tenantId: ref.tenantId, purpose: ref.purpose });
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
    .where(
      and(eq(tenantCredentials.tenantId, ref.tenantId), eq(tenantCredentials.purpose, ref.purpose)),
    );
  if (row === undefined) return null;

  // The ROW's version, never the ring's current one: that is what keeps a half-finished rotation
  // readable instead of an outage.
  const key = keyForVersion(ring, row.keyVersion);
  if (key === null) {
    throw new AppError("credentials.key_version_unknown", {
      tenantId: ref.tenantId,
      purpose: ref.purpose,
      keyVersion: row.keyVersion,
    });
  }

  const plaintext = open(key, aadFor(ref.tenantId, ref.purpose), {
    ciphertext: row.ciphertext,
    iv: row.iv,
    authTag: row.authTag,
  });
  if (plaintext === null) {
    // Wrong key, tampered ciphertext, or a row moved between (tenant, purpose) pairs — one code for
    // all three, because distinguishing them would be an oracle. See cipher.ts's `open`.
    throw new AppError("credentials.decrypt_failed", {
      tenantId: ref.tenantId,
      purpose: ref.purpose,
    });
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
    throw new AppError("credentials.malformed_payload", {
      tenantId: ref.tenantId,
      purpose: ref.purpose,
    });
  }
  // Valid JSON that is still not a credential: `null`, an array, or a bare string/number/boolean
  // all parse without throwing and would otherwise slip through an `as Record<string, string>`
  // cast with a type that lies about their shape.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError("credentials.malformed_payload", {
      tenantId: ref.tenantId,
      purpose: ref.purpose,
    });
  }
  return parsed as Record<string, string>;
}

/**
 * Seals and upserts. Validation runs BEFORE the write, so a rejected payload leaves no row.
 *
 * Inside `withTenant`'s all-or-nothing transaction, that ordering does not change what an
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
  params: { tenantId: TenantId; purpose: Purpose; value: Record<string, unknown> },
): Promise<void> {
  validatePayload(params.purpose, params.value);
  const sealed = seal(
    ring.current.key,
    aadFor(params.tenantId, params.purpose),
    JSON.stringify(params.value),
  );
  await tx
    .insert(tenantCredentials)
    .values({
      tenantId: params.tenantId,
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
      target: [tenantCredentials.tenantId, tenantCredentials.purpose],
      set: {
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: ring.current.version,
        // The database clock, matching the column's own `defaultNow()` on the INSERT branch —
        // never the app clock (`new Date()`). Mixing the two would let host clock skew stamp an
        // update earlier than the original insert. Same idiom as
        // packages/fiscal-verifactu/src/registro-sif.ts's `actualizadoEn: sql\`now()\``.
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
    .where(
      and(eq(tenantCredentials.tenantId, ref.tenantId), eq(tenantCredentials.purpose, ref.purpose)),
    )
    .returning({ purpose: tenantCredentials.purpose });
  return removed.length > 0;
}

/** Metadata for every row VISIBLE to this transaction — so inside `withTenant` it is one tenant's,
 * and the CLI's cross-tenant listing goes through `credentialTenants` instead. */
export async function listCredentials(tx: Transaction): Promise<CredentialMeta[]> {
  const rows = await tx
    .select({
      tenantId: tenantCredentials.tenantId,
      purpose: tenantCredentials.purpose,
      keyVersion: tenantCredentials.keyVersion,
      updatedAt: tenantCredentials.updatedAt,
    })
    .from(tenantCredentials);
  return rows as CredentialMeta[];
}

/**
 * Which tenants hold a credential for `purpose`. Runs on the SYSTEM connection, NOT inside
 * `withTenant`: it must see every tenant's rows to answer at all, which is a deliberately
 * cross-tenant read of a FORCE-RLS table. That crossing goes through `credential_tenants`
 * (migration 0002), a SECURITY DEFINER function owned by the NOLOGIN `credentials_enumerator` role,
 * which alone carries a permissive USING (true) SELECT policy. The function returns ONLY tenant ids.
 *
 * This is what gives the host its tenant list, and it has a property worth naming: a tenant with no
 * credential for a purpose is not enumerated for it, so the vault IS the enrolment list for that
 * duty — the host needs no separate notion of "which tenants are configured for Stripe".
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
 * hold locks across every tenant, and a failure part-way would roll back work that is perfectly
 * good. Partial progress is SAFE here precisely because reads select their key by the row's own
 * version — an interrupted run leaves a readable vault, and re-running finishes it. That is the
 * property `rotate.test.ts`'s interrupted case pins down.
 *
 * Rows already on the current version are counted and skipped, which is what makes a second run a
 * no-op rather than a pointless re-encryption of everything.
 *
 * `tryGetCredential` and `putCredential` share one `withTenant` transaction per row, so the read
 * and the re-write are evaluated under one tenant GUC. It does NOT make the pair atomic against a
 * concurrent `set`: under READ COMMITTED the SELECT takes no row lock, so a `set` committing
 * between the two is overwritten by this rotation's stale value whether the gap spans one
 * transaction or two. Preventing that would need `SELECT ... FOR UPDATE` inside this transaction,
 * or REPEATABLE READ plus a retry loop — deliberately absent, because `rotate` is a
 * maintenance-window operation and "rotation without downtime" is out of scope (design spec §8).
 * No test pins this, and none can without a second connection.
 *
 * **Needs a connection that is not a SUPERUSER or `BYPASSRLS` role to report truthful counts.**
 * Every read here goes through `withTenant`, which relies on RLS to scope it — FORCE ROW LEVEL
 * SECURITY binds even the table's own owner (drizzle/0001_credentials_rls.sql's `FORCE ROW LEVEL
 * SECURITY`, same as `packages/fiscal-verifactu`'s `envios_tenant_isolation`), so a plain,
 * non-superuser owner connection reports truthfully. Only a superuser or a `BYPASSRLS` role
 * actually bypasses the policy — if the connection handed to this function is one of those,
 * `listCredentials(tx)` inside `withTenant(db, tenantId, ...)` returns the WHOLE table on every
 * call regardless of which tenant is being visited, so every tenant's pass re-reads every OTHER
 * tenant's rows too — inflating `rotated`/`alreadyCurrent` by roughly the tenant count and doing
 * O(tenants² × purposes) redundant work. No corruption results (re-sealing the same row more than
 * once under the current key is idempotent), but the operator's only success signal — this
 * function's own return value — is wrong. Connect as `app_user` (or a role that inherits it and
 * carries neither SUPERUSER nor BYPASSRLS), not a superuser or BYPASSRLS role.
 */
/* Coupled to the `PURPOSES` field registry, which is worth knowing before editing either.
 *
 * Rotation re-seals through `putCredential`, which re-runs `validatePayload` — so every stored
 * payload is re-checked against the CURRENT registry, not the one it was provisioned under. Add or
 * rename a field on an already-provisioned purpose and the next `rotate` throws
 * `credentials.invalid_payload` on the first affected row and abandons the sweep, discarding the
 * counts it had accumulated. Design §4 explicitly anticipates `fiscal.aeat`'s shape changing, so
 * this is reachable rather than theoretical: a one-line registry edit can block retiring a
 * compromised key until every affected tenant is re-provisioned.
 *
 * Left as-is rather than skipping validation on the rotate path, because re-sealing a payload the
 * package would now refuse to accept is its own trap. Recorded here because nothing else says it,
 * and the failure names a `purpose` but no `tenantId` — so the operator learns which purpose
 * blocked the run, not which tenant. */
export async function rotateCredentials(db: Database, ring: KeyRing): Promise<RotationResult> {
  const result: RotationResult = { rotated: 0, alreadyCurrent: 0 };
  // Concurrent, not sequential: the per-purpose enumerations are independent, and `Promise.all`
  // preserves input order so the resulting Set's iteration order — and therefore the rotation
  // order — is unchanged. Matches what `runCli`'s `list` already does with the same call.
  const perPurpose = await Promise.all(
    Object.keys(PURPOSES).map((purpose) => credentialTenants(db, purpose)),
  );
  const tenants = new Set<TenantId>(perPurpose.flat());

  for (const tenantId of tenants) {
    const rows = await withTenant(db, tenantId, (tx) => listCredentials(tx));
    for (const row of rows) {
      if (!isPurpose(row.purpose)) continue;
      if (row.keyVersion === ring.current.version) {
        result.alreadyCurrent += 1;
        continue;
      }
      const purpose = row.purpose;
      await withTenant(db, tenantId, async (tx) => {
        const value = await tryGetCredential(tx, ring, { tenantId, purpose });
        // `value === null` here means the row `listCredentials` just saw a moment ago is gone. In
        // production that needs a genuinely concurrent `delete` racing this exact window — a
        // host-level concurrency scenario this package's own "real database, never mocked" test
        // convention cannot construct deterministically (see this function's own doc comment).
        // rotate.test.ts's "does not count a row that vanished" test reaches this SAME branch by a
        // different, fully deterministic route instead (PGlite's superuser RLS bypass surfacing a
        // foreign tenant's row). `rotated` is NOT incremented on this path — nothing was actually
        // re-sealed — which is what keeps this a genuine silent no-op rather than a phantom success.
        if (value === null) return;
        await putCredential(tx, ring, { tenantId, purpose, value });
        result.rotated += 1;
      });
    }
  }
  return result;
}
