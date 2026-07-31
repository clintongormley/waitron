import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, asAppUser, withTenant } from "@waitron/db";
import { hasCode } from "@waitron/shared";
import type { TenantId } from "@waitron/shared";
import { aadFor, seal } from "./cipher.js";
import { loadKeyRing } from "./keyring.js";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { tenantCredentials } from "./schema/tenant-credentials.js";
import {
  deleteCredential,
  getCredential,
  listCredentials,
  putCredential,
  tryGetCredential,
} from "./store.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { captured } from "./testing/captured.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";

const K1 = Buffer.alloc(32, 1).toString("base64");
const K2 = Buffer.alloc(32, 2).toString("base64");
const RING_V1 = loadKeyRing({ WAITRON_CREDENTIALS_KEY: K1, WAITRON_CREDENTIALS_KEY_VERSION: "1" });
const RING_V2_ONLY = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: K2,
  WAITRON_CREDENTIALS_KEY_VERSION: "2",
});

const STRIPE = {
  secretKey: "sk_test_x",
  webhookSecret: "whsec_x",
  successUrl: "https://example.test/ok",
  cancelUrl: "https://example.test/no",
};

const suite = usePgliteDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });

/** A tenant per test. `store.test.ts` in packages/scheduler is an order-dependent chain over one
 * shared key and it bit during a later fix; this suite pays one insert per test to avoid that. */
async function freshTenant(): Promise<TenantId> {
  return seedTenant(suite.db);
}

describe("putCredential and getCredential", () => {
  it("round-trips a payload through the database", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const actual = await withTenant(suite.db, tenantId, (tx) =>
      getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });

  it("stores no plaintext in the row", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const rows = await suite.db.execute<{ blob: string }>(sql`
      select encode(ciphertext, 'escape') as blob from tenant_credentials
      where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.blob).not.toContain("sk_test_x");
  });

  it("overwrites an existing purpose rather than failing on the primary key", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const updated = { ...STRIPE, secretKey: "sk_test_rotated" };
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: updated }),
    );
    const actual = await withTenant(suite.db, tenantId, (tx) =>
      getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(updated);
  });

  it("stamps the ring's current key version", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V2_ONLY, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const rows = await suite.db.execute<{ key_version: number }>(sql`
      select key_version from tenant_credentials where tenant_id = ${tenantId}`);
    expect(rows.rows[0]!.key_version).toBe(2);
  });

  it("re-provisioning after a rotate updates the stamped key version and the timestamp, not just the ciphertext", async () => {
    // The upsert's ON CONFLICT branch has its own SET clause, entirely separate from the INSERT
    // values above it — nothing enforces that the two branches agree on which columns they touch.
    // Provisioning once (so the row takes the INSERT path) and then again under a NEW current key
    // (so the row takes the UPDATE path) is what actually exercises that second branch; every
    // other test that reaches the conflict path re-puts under the SAME ring, so `keyVersion` 1→1
    // is a no-op there and would stay green even if the UPDATE branch never touched the column at
    // all.
    //
    // `updated_at` is checked by BACKDATING the row to a value no clock can produce, rather than
    // comparing two `now()` reads taken moments apart: PGlite's `now()` has limited sub-second
    // resolution, and two `withTenant` round trips can land inside the same tick, so a
    // correctly-behaving implementation can produce byte-identical timestamps — verified flaky
    // (2/15, then 5/20 runs) when this test compared "before" and "after" reads of the real clock
    // instead. Backdating removes the race entirely: `2020-01-01T00:00:00Z` can only ever be the
    // value this test itself wrote, so its absence after the second `putCredential` call can only
    // mean the UPDATE branch's `updatedAt` set line actually ran — deterministic regardless of how
    // fast the two puts complete.
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const BACKDATED = "2020-01-01T00:00:00Z";
    await suite.db.execute(sql`
      update tenant_credentials set updated_at = ${BACKDATED}
      where tenant_id = ${tenantId} and purpose = 'payments.stripe'`);
    const before = await suite.db.execute<{ updated_at: string }>(sql`
      select updated_at from tenant_credentials where tenant_id = ${tenantId}`);
    const rotated = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    const updated = { ...STRIPE, secretKey: "sk_test_rotated" };
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, rotated, { tenantId, purpose: "payments.stripe", value: updated }),
    );
    const after = await suite.db.execute<{ key_version: number; updated_at: string }>(sql`
      select key_version, updated_at from tenant_credentials where tenant_id = ${tenantId}`);
    expect(after.rows[0]!.key_version).toBe(2);
    expect(after.rows[0]!.updated_at).not.toBe(before.rows[0]!.updated_at);
    const actual = await withTenant(suite.db, tenantId, (tx) =>
      getCredential(tx, rotated, { tenantId, purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(updated);
  });

  it("validates the payload before it ever reaches the database", async () => {
    const tenantId = await freshTenant();
    // The row count is read via `tx.execute`, INSIDE the same still-open transaction
    // `putCredential` ran in — not via the top-level `db` handle afterward. `withTenant` wraps
    // this whole callback in `suite.db.transaction(...)`, which rolls back the ENTIRE transaction on an
    // uncaught throw regardless of where inside it the throw happened, so a post-hoc external
    // count can never tell "validated before the insert" apart from "validated after it" — both
    // end at 0 rows once the transaction unwinds. `captured` here catches the AppError itself
    // (rather than letting it escape `withTenant`'s callback), so the transaction commits
    // normally; the SELECT below observes whatever `putCredential` actually did before failing,
    // not what a rollback erased on its behalf.
    const n = await withTenant(suite.db, tenantId, async (tx) => {
      const error = await captured(() =>
        putCredential(tx, RING_V1, {
          tenantId,
          purpose: "payments.stripe",
          value: { secretKey: "sk_test_x" },
        }),
      );
      expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
      const rows = await tx.execute<{ n: number }>(sql`
        select count(*)::int as n from tenant_credentials where tenant_id = ${tenantId}`);
      return rows.rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it("raises credentials.missing for a purpose that was never provisioned", async () => {
    const tenantId = await freshTenant();
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, RING_V1, { tenantId, purpose: "fiscal.aeat" }),
      ),
    );
    expect(hasCode(error, "credentials.missing")).toBe(true);
  });

  it("raises credentials.decrypt_failed when the ring's key is wrong", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    // Same VERSION, different key material — the operator replaced the key without rotating.
    const wrong = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, wrong, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
  });

  it("raises credentials.key_version_unknown when the ring lost the row's key", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, RING_V2_ONLY, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
  });

  it("serves a row on either ring member — the interrupted-rotate case", async () => {
    // The reason key_version is a column and not a constant. A rotate killed half-way leaves rows
    // on both versions, and the vault must keep serving both until it is re-run.
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const both = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, both, {
        tenantId,
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    const onV1 = await withTenant(suite.db, tenantId, (tx) =>
      getCredential(tx, both, { tenantId, purpose: "payments.stripe" }),
    );
    const onV2 = await withTenant(suite.db, tenantId, (tx) =>
      getCredential(tx, both, { tenantId, purpose: "fiscal.aeat" }),
    );
    expect(onV1).toEqual(STRIPE);
    expect(onV2).toEqual({ pfxBase64: "AAAA", passphrase: "p", certKind: "sello" });
  });
});

/**
 * `getCredential`/`tryGetCredential` decrypt successfully — GCM authentication passes — but the
 * plaintext is not a credential. `putCredential` can never produce such a row (it always seals
 * `JSON.stringify` of a `validatePayload`-checked object), so these rows are sealed directly with
 * `seal()`, bypassing the store entirely — the actor these tests model is the same one cipher.ts's
 * own doc comment names: someone with database write access, not this package's own write path.
 */
describe("getCredential — a row that decrypts to something that is not a credential", () => {
  async function sealRawRow(
    tenantId: TenantId,
    purpose: "payments.stripe" | "fiscal.aeat",
    plaintext: string,
  ): Promise<void> {
    const sealed = seal(RING_V1.current.key, aadFor(tenantId, purpose), plaintext);
    await withTenant(suite.db, tenantId, (tx) =>
      tx.insert(tenantCredentials).values({
        tenantId,
        purpose,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: RING_V1.current.version,
      }),
    );
  }

  it("raises credentials.malformed_payload for a row whose plaintext is not JSON at all", async () => {
    const tenantId = await freshTenant();
    // A raw Stripe secret key, not a JSON-encoded object — exactly the shape a `JSON.parse`
    // `SyntaxError` would otherwise quote verbatim into its own message.
    await sealRawRow(tenantId, "payments.stripe", "sk_live_51ABCDEF");
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
    expect(JSON.stringify(error)).not.toContain("sk_live_51ABCDEF");
  });

  it("raises credentials.malformed_payload for a row whose plaintext is the JSON literal null", async () => {
    // Valid JSON — `JSON.parse` does not throw — but not an object, so it must be rejected by the
    // shape check rather than silently cast to `Record<string, string>`.
    const tenantId = await freshTenant();
    await sealRawRow(tenantId, "payments.stripe", "null");
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
  });

  it("raises credentials.malformed_payload for a row whose plaintext is a JSON array", async () => {
    // Valid JSON, and `typeof [] === "object"` — so `Array.isArray` is what this guard needs, not
    // just `parsed === null`. Before this test existed, mutating the three-operand guard down to
    // `if (parsed === null)` left the whole suite green: a row sealed to `["sk_live_x"]` would have
    // been returned from getCredential typed as Record<string, string>, and a host reading `.length`
    // off the array or indexing a numeric key would silently misbehave rather than fail loudly here.
    const tenantId = await freshTenant();
    await sealRawRow(tenantId, "payments.stripe", JSON.stringify(["sk_live_x"]));
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
  });

  it("raises credentials.malformed_payload for a row whose plaintext is a bare JSON scalar", async () => {
    // Valid JSON — a quoted string parses fine — but `typeof "x" !== "object"`, so this is the
    // branch the `typeof parsed !== "object"` operand exists for, distinct from both the null check
    // and the array check above. Same mutation-check as the array case: narrowing the guard to
    // `if (parsed === null)` leaves this row's malformed shape undetected.
    const tenantId = await freshTenant();
    await sealRawRow(tenantId, "payments.stripe", JSON.stringify("sk_live_x"));
    const error = await captured(() =>
      withTenant(suite.db, tenantId, (tx) =>
        getCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
  });
});

describe("tryGetCredential", () => {
  it("returns null rather than throwing when nothing is provisioned", async () => {
    const tenantId = await freshTenant();
    const actual = await withTenant(suite.db, tenantId, (tx) =>
      tryGetCredential(tx, RING_V1, { tenantId, purpose: "fiscal.aeat" }),
    );
    expect(actual).toBeNull();
  });
});

describe("deleteCredential", () => {
  it("removes the row and reports that it did", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    const deleted = await withTenant(suite.db, tenantId, (tx) =>
      deleteCredential(tx, { tenantId, purpose: "payments.stripe" }),
    );
    expect(deleted).toBe(true);
    const after = await withTenant(suite.db, tenantId, (tx) =>
      tryGetCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe" }),
    );
    expect(after).toBeNull();
  });

  it("reports false when there was nothing to delete", async () => {
    const tenantId = await freshTenant();
    const deleted = await withTenant(suite.db, tenantId, (tx) =>
      deleteCredential(tx, { tenantId, purpose: "payments.stripe" }),
    );
    expect(deleted).toBe(false);
  });
});

describe("listCredentials", () => {
  it("returns metadata and never a value", async () => {
    const tenantId = await freshTenant();
    await withTenant(suite.db, tenantId, (tx) =>
      putCredential(tx, RING_V1, { tenantId, purpose: "payments.stripe", value: STRIPE }),
    );
    // listCredentials(tx) carries no explicit tenant filter — its scoping IS the RLS policy
    // (store.ts's own comment: "so inside withTenant it is one tenant's"). PGlite connects as
    // superuser and bypasses RLS unconditionally, so without asAppUser this assertion would pass
    // for the wrong reason — the row count would only ever match by accident of test order. Same
    // precedent as packages/core's incidents.test.ts.
    const rows = await withTenant(suite.db, tenantId, async (tx) => {
      await asAppUser(tx);
      return listCredentials(tx);
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: "payments.stripe", keyVersion: 1 });
    // Asserts the PROJECTION, not just that the serialized plaintext string happens to be absent —
    // `JSON.stringify(rows).not.toContain("sk_test_x")` can never fail regardless of what
    // `listCredentials` selects, because the plaintext exists nowhere in the table for it to leak:
    // verified by widening the query to `tx.select().from(tenantCredentials)` (ciphertext and
    // all) and confirming the old assertion still passed. Naming the exact key set is what would
    // actually catch a future `listCredentials` that started selecting `ciphertext`, `iv` or
    // `authTag` alongside the metadata.
    expect(Object.keys(rows[0]!).sort()).toEqual([
      "keyVersion",
      "purpose",
      "tenantId",
      "updatedAt",
    ]);
  });
});
