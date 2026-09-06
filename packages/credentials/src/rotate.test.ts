import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTenant } from "@waitron/db";
import { hasCode } from "@waitron/shared";
import { aadFor, seal } from "./cipher.js";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { tenantCredentials } from "./schema/tenant-credentials.js";
import { getCredential, putCredential, rotateCredentials } from "./store.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { captured } from "./testing/captured.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");

const RING_V1 = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const RING_BOTH = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
  WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
  WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
});
const RING_V2_ONLY = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});

const STRIPE = {
  secretKey: "sk_test_rot",
  webhookSecret: "whsec_rot",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });

/** Rotation enumerates the whole vault. Clear credentials between cases while reusing the
 * migrated database; stale tenant rows have no credentials to enumerate. */
beforeEach(async () => {
  await suite.db.execute(sql`truncate tenant_credentials cascade`);
});

describe("rotateCredentials", () => {
  it("re-seals every row onto the current key and advances its version", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH);
    expect(result.rotated).toBe(1);
    expect(result.alreadyCurrent).toBe(0);

    const versions = await suite.db.execute<{ key_version: number }>(sql`
      select key_version from tenant_credentials where tenant_id = ${tenantId}`);
    expect(versions.rows[0]!.key_version).toBe(2);

    // Readable with the new key ALONE — the old key can now be retired.
    const actual = await withTenant(suite.db, tenantId, (tx) =>
      getCredential(tx, RING_V2_ONLY, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });

  it("is idempotent — a second run rotates nothing", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, {
        tenantId,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AA", passphrase: "p", certKind: "sello" },
      }),
    );
    const first = await rotateCredentials(suite.db, RING_BOTH);
    expect(first.rotated).toBe(1);
    const second = await rotateCredentials(suite.db, RING_BOTH);
    expect(second.rotated).toBe(0);
    expect(second.alreadyCurrent).toBe(1);
  });

  it("finishes a rotation that was interrupted half-way", async () => {
    // The scenario key_version exists for: some rows on the old key, some already on the new one.
    // This pins rotateCredentials's own SKIP logic — that it discriminates row by row rather than
    // assuming the whole batch shares one state, so an interrupted run's leftover mix (some
    // rotated, some not) gets finished correctly rather than either re-rotating everything or
    // bailing out. It does NOT pin per-row key SELECTION for more than two key versions: with only
    // `current`/`previous` in the ring, any row not already on `current` is necessarily on
    // `previous`, so this test cannot distinguish "select the key by the row's own key_version"
    // from "always try `previous`". That per-row selection property is pinned separately by
    // store.test.ts's "serves a row on either ring member" test.
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_BOTH, {
        tenantId,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AA", passphrase: "p", certKind: "sello" },
      }),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH);
    expect(result.rotated).toBe(1);
    expect(result.alreadyCurrent).toBe(1);

    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials
      where tenant_id = ${tenantId} and key_version = 2`);
    expect(rows.rows[0]!.n).toBe(2);
  });

  it("refuses to run without a previous key when rows still need one", async () => {
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const error = await captured(() => rotateCredentials(suite.db, RING_V2_ONLY));
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
  });

  it("propagates — rather than swallows — an undecryptable row instead of silently leaving it on the retiring key", async () => {
    // Mutation check #3: if rotateCredentials caught tryGetCredential's throw and treated it as
    // "nothing to rotate here", this row would stay sealed under a key about to be retired FOREVER,
    // while `rotated`/`alreadyCurrent` still reported an ordinary, successful run — exactly the
    // failure mode that makes retiring the old key unsafe. Sealed directly with `seal()`, bypassing
    // `putCredential` (same technique as store.test.ts's `sealRawRow`), under a key neither ring
    // member matches — the row exists and its OWN key_version (1) IS one the ring carries
    // (RING_BOTH.previous), so this is `credentials.decrypt_failed` (wrong key material), not
    // `credentials.key_version_unknown` — a different one of tryGetCredential's three throw codes
    // than the "refuses to run without a previous key" case above.
    const tenantId = await seedTenant(suite.db);
    const strangerKey = Buffer.alloc(32, 9);
    const sealed = seal(strangerKey, aadFor(tenantId, "payments.stripe"), JSON.stringify(STRIPE));
    await withTenant(suite.db, tenantId, (tx) =>
      tx.insert(tenantCredentials).values({
        tenantId,
        purpose: "payments.stripe",
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: 1,
      }),
    );

    const error = await captured(() => rotateCredentials(suite.db, RING_BOTH));
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);

    // No phantom success, no partial write: the row is exactly as it was sealed.
    const row = await suite.db.execute<{ key_version: number }>(sql`
      select key_version from tenant_credentials where tenant_id = ${tenantId}`);
    expect(row.rows[0]!.key_version).toBe(1);
  });

  it("skips a row whose purpose the registry no longer knows, rather than crashing on it", async () => {
    // `listCredentials` has no notion of Purpose — it selects every row a tenant holds, known or
    // not (unlike `putCredential`'s WRITE side, which is typed `Purpose` and so cannot reach an
    // unknown one — see store.ts's own comment on why THAT check is deliberately absent). Rotation
    // reads back untyped rows off the same table, so a purpose the registry has since retired (or
    // a row seeded outside the registry entirely) is a real, reachable case here. Sealed directly
    // with raw bytes, bypassing `putCredential` — the same technique as
    // credentials.test.ts's "ordering-probe" row — since this row is never meant to be
    // decrypted; only the iv/auth-tag LENGTH constraints need satisfying, not real ciphertext.
    const tenantId = await seedTenant(suite.db);
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    await withTenant(suite.db, tenantId, (tx) =>
      tx.insert(tenantCredentials).values({
        tenantId,
        purpose: "legacy.retired-purpose",
        ciphertext: Buffer.from("stale"),
        iv: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
        keyVersion: 1,
      }),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH);
    expect(result.rotated).toBe(1);

    const rows = await suite.db.execute<{ purpose: string; key_version: number }>(sql`
      select purpose, key_version from tenant_credentials
      where tenant_id = ${tenantId} order by purpose`);
    const legacy = rows.rows.find((r) => r.purpose === "legacy.retired-purpose");
    // Untouched — still on the old version, because it was never processed at all.
    expect(legacy?.key_version).toBe(1);
  });

  it("does not count listed metadata whose tenant-purpose lookup finds no row", async () => {
    // Synthetic fixture for the absent-read branch: listCredentials returns both rows, then
    // each tenant's pass tries the other purpose, whose tenant-purpose pair is absent.
    // This exercises the count rule without claiming to simulate concurrent deletion.
    const p = await seedTenant(suite.db);
    const q = await seedTenant(suite.db);
    await withTenant(suite.db, p, (tx) =>
      putCredential(tx, RING_V1, { tenantId: p, purpose: "payments.stripe", value: STRIPE }),
    );
    await withTenant(suite.db, q, (tx) =>
      putCredential(tx, RING_V1, {
        tenantId: q,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AA", passphrase: "p", certKind: "sello" },
      }),
    );

    const result = await rotateCredentials(suite.db, RING_BOTH);
    // Exactly 2: P's own row and Q's own row, each rotated exactly once when its OWN tenant's pass
    // reaches it. Before M6's fix, the spurious `{tenantId: P, purpose: "fiscal.aeat"}` lookup
    // during P's pass (finding nothing) still incremented `rotated`, making this 3.
    expect(result.rotated).toBe(2);

    const versions = await suite.db.execute<{ tenant_id: string; key_version: number }>(sql`
      select tenant_id, key_version from tenant_credentials where tenant_id in (${p}, ${q})`);
    expect(versions.rows).toHaveLength(2);
    for (const row of versions.rows) expect(row.key_version).toBe(2);
  });
});
