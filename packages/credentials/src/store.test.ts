import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { hasCode } from "@waitron/shared";
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
import { captured } from "./testing/captured.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

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

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS] });

// Listing reads the whole vault, so each case starts with an empty credential table.
beforeEach(async () => {
  // `delete`, not TRUNCATE: this engine has no TRUNCATE at all, and the statement did not even
  // reach execution — running this suite before the change printed `Error: near "truncate": syntax
  // error` from `packages/store/src/node-sqlite-adapter.ts:64`, which killed every case in the
  // file in its `beforeEach`. `tenant_credentials` is classified `local` (`./classification.ts`),
  // so it carries no append-only trigger to refuse the delete — the same reasoning as
  // `packages/fiscal-verifactu/src/acks.test.ts:123`.
  await suite.db.execute(sql`delete from tenant_credentials`);
});

/**
 * The seal's additional authenticated data is the purpose alone (`aadFor`, cipher.ts).
 */
describe("the seal binds each credential to its purpose", () => {
  it("round-trips a credential through the seal and the store", async () => {
    await withTransaction(suite.db, async (tx) => {
      await putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE });
    });
    const actual = await withTransaction(suite.db, async (tx) => {
      return getCredential(tx, RING_V1, { purpose: "payments.stripe" });
    });
    expect(actual).toEqual(STRIPE);
  });

  it("opens a row sealed with the purpose's bytes as its authenticated data", async () => {
    // Sealed here with `Buffer.from(purpose)` directly, not through `aadFor`: this pins the bytes the
    // store authenticates a read against, so a store that opened with anything else fails here.
    const sealed = seal(
      RING_V1.current.key,
      Buffer.from("payments.stripe", "utf8"),
      JSON.stringify(STRIPE),
    );
    await withTransaction(suite.db, (tx) =>
      tx.insert(tenantCredentials).values({
        purpose: "payments.stripe",
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: RING_V1.current.version,
      }),
    );
    const actual = await withTransaction(suite.db, async (tx) => {
      return getCredential(tx, RING_V1, { purpose: "payments.stripe" });
    });
    expect(actual).toEqual(STRIPE);
  });

  it("refuses a sealed row moved to another purpose with credentials.decrypt_failed", async () => {
    // The moved-row attack: someone with write access relabels a sealed row so a reader of one
    // purpose is handed another purpose's material. Same key, intact ciphertext and tag — only the
    // purpose differs, so only the authenticated data can refuse it. Both purposes share the
    // `payments.` prefix, so a binding to that prefix alone would also open the row.
    const sumup = { apiKey: "sup_x", merchantCode: "M1", affiliateAppId: "-", affiliateKey: "-" };
    await withTransaction(suite.db, async (tx) => {
      await putCredential(tx, RING_V1, { purpose: "payments.sumup", value: sumup });
      await tx.execute(sql`
        update tenant_credentials set purpose = 'payments.stripe' where purpose = 'payments.sumup'`);
    });
    const error = await captured(() =>
      withTransaction(suite.db, async (tx) => {
        return getCredential(tx, RING_V1, { purpose: "payments.stripe" });
      }),
    );
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
    expect(error.params).toEqual({ purpose: "payments.stripe" });
  });
});

describe("putCredential and getCredential", () => {
  it("round-trips a payload through the database", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    const actual = await withTransaction(suite.db, (tx) =>
      getCredential(tx, RING_V1, { purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(STRIPE);
  });

  it("stores no plaintext in the row", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    // `encode(ciphertext, 'escape')` is a PostgreSQL function this engine does not have
    // (`no such function: encode`, measured on node v26.7.0), and it is not needed: `binary` is a
    // BLOB column and a raw select of it hands back the bytes as a `Uint8Array` (same measurement,
    // `r.b.constructor.name === "Uint8Array"`). The decode moves to the READ, as in
    // `packages/fiscal-verifactu/src/reconcile.test.ts`'s `incidentsFor`. `latin1` is what makes
    // this the same search the SQL did: it maps every byte to one character, so any ASCII run
    // present in the ciphertext appears verbatim in the string being searched.
    const rows = await suite.db.execute<{ blob: Uint8Array }>(sql`
      select ciphertext as blob from tenant_credentials`);
    expect(Buffer.from(rows.rows[0]!.blob).toString("latin1")).not.toContain("sk_test_x");
  });

  it("overwrites an existing purpose rather than failing on the primary key", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    const updated = { ...STRIPE, secretKey: "sk_test_rotated" };
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: updated }),
    );
    const actual = await withTransaction(suite.db, (tx) =>
      getCredential(tx, RING_V1, { purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(updated);
  });

  it("stamps the ring's current key version", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V2_ONLY, { purpose: "payments.stripe", value: STRIPE }),
    );
    const rows = await suite.db.execute<{ key_version: number }>(sql`
      select key_version from tenant_credentials`);
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
    // comparing two clock reads taken moments apart: the value comes from JavaScript
    // (`nowIso`, `packages/db/src/schema/columns.ts`), whose ISO string carries milliseconds and
    // no more, and two `withTransaction` round trips can land inside the same one, so a
    // correctly-behaving implementation can produce byte-identical timestamps — verified flaky
    // (2/15, then 5/20 runs) when this test compared "before" and "after" reads of the real clock
    // instead. Backdating removes the race entirely: `2020-01-01T00:00:00Z` can only ever be the
    // value this test itself wrote, so its absence after the second `putCredential` call can only
    // mean the UPDATE branch's `updatedAt` set line actually ran — deterministic regardless of how
    // fast the two puts complete.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    const BACKDATED = "2020-01-01T00:00:00Z";
    await suite.db.execute(sql`
      update tenant_credentials set updated_at = ${BACKDATED}
      where purpose = 'payments.stripe'`);
    const before = await suite.db.execute<{ updated_at: string }>(sql`
      select updated_at from tenant_credentials`);
    const rotated = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    const updated = { ...STRIPE, secretKey: "sk_test_rotated" };
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, rotated, { purpose: "payments.stripe", value: updated }),
    );
    const after = await suite.db.execute<{ key_version: number; updated_at: string }>(sql`
      select key_version, updated_at from tenant_credentials`);
    expect(after.rows[0]!.key_version).toBe(2);
    expect(after.rows[0]!.updated_at).not.toBe(before.rows[0]!.updated_at);
    const actual = await withTransaction(suite.db, (tx) =>
      getCredential(tx, rotated, { purpose: "payments.stripe" }),
    );
    expect(actual).toEqual(updated);
  });

  it("validates the payload before it ever reaches the database", async () => {
    // The row count is read via `tx.execute`, INSIDE the same still-open transaction
    // `putCredential` ran in — not via the top-level `db` handle afterward. `withTransaction` wraps
    // this whole callback in `suite.db.transaction(...)`, which rolls back the ENTIRE transaction on an
    // uncaught throw regardless of where inside it the throw happened, so a post-hoc external
    // count can never tell "validated before the insert" apart from "validated after it" — both
    // end at 0 rows once the transaction unwinds. `captured` here catches the AppError itself
    // (rather than letting it escape `withTransaction`'s callback), so the transaction commits
    // normally; the SELECT below observes whatever `putCredential` actually did before failing,
    // not what a rollback erased on its behalf. Carrying on inside the transaction is safe HERE
    // for one reason: `credentials.invalid_payload` is a JavaScript throw raised BEFORE any
    // statement reaches the database (`putCredential` calls `validatePayload` first), which is the
    // property this test is about. Catching a refusal the DATABASE issued is a different shape:
    // on SQLite the transaction survives it, so what a savepoint buys there is discarding the
    // failed attempt's own earlier writes (`packages/store/src/node-sqlite-adapter.ts`).
    const n = await withTransaction(suite.db, async (tx) => {
      const error = await captured(() =>
        putCredential(tx, RING_V1, {
          purpose: "payments.stripe",
          value: { secretKey: "sk_test_x" },
        }),
      );
      expect(hasCode(error, "credentials.invalid_payload")).toBe(true);
      // No `::int`: the cast only flattened PostgreSQL's bigint `count` to a JavaScript number,
      // and this engine returns one already — measured on node v26.7.0, `select count(*) as n`
      // over a one-row table gives `{ n: 1 }` with `typeof n === "number"`.
      const rows = await tx.execute<{ n: number }>(sql`
        select count(*) as n from tenant_credentials`);
      return rows.rows[0]!.n;
    });
    expect(n).toBe(0);
  });

  it("raises credentials.missing for a purpose that was never provisioned", async () => {
    const error = await captured(() =>
      withTransaction(suite.db, (tx) => getCredential(tx, RING_V1, { purpose: "fiscal.aeat" })),
    );
    expect(hasCode(error, "credentials.missing")).toBe(true);
  });

  it("raises credentials.decrypt_failed when the ring's key is wrong", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    // Same VERSION, different key material — the operator replaced the key without rotating.
    const wrong = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "1",
    });
    const error = await captured(() =>
      withTransaction(suite.db, (tx) => getCredential(tx, wrong, { purpose: "payments.stripe" })),
    );
    expect(hasCode(error, "credentials.decrypt_failed")).toBe(true);
  });

  it("raises credentials.key_version_unknown when the ring lost the row's key", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    const error = await captured(() =>
      withTransaction(suite.db, (tx) =>
        getCredential(tx, RING_V2_ONLY, { purpose: "payments.stripe" }),
      ),
    );
    expect(hasCode(error, "credentials.key_version_unknown")).toBe(true);
  });

  it("serves a row on either ring member — the interrupted-rotate case", async () => {
    // The reason key_version is a column and not a constant. A rotate killed half-way leaves rows
    // on both versions, and the vault must keep serving both until it is re-run.
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    const both = loadKeyRing({
      WAITRON_CREDENTIALS_KEY: K2,
      WAITRON_CREDENTIALS_KEY_VERSION: "2",
      WAITRON_CREDENTIALS_KEY_PREVIOUS: K1,
      WAITRON_CREDENTIALS_KEY_PREVIOUS_VERSION: "1",
    });
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, both, {
        purpose: "fiscal.aeat",
        value: { pfxBase64: "AAAA", passphrase: "p", certKind: "sello" },
      }),
    );
    const onV1 = await withTransaction(suite.db, (tx) =>
      getCredential(tx, both, { purpose: "payments.stripe" }),
    );
    const onV2 = await withTransaction(suite.db, (tx) =>
      getCredential(tx, both, { purpose: "fiscal.aeat" }),
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
    purpose: "payments.stripe" | "fiscal.aeat",
    plaintext: string,
  ): Promise<void> {
    const sealed = seal(RING_V1.current.key, aadFor(purpose), plaintext);
    await withTransaction(suite.db, (tx) =>
      tx.insert(tenantCredentials).values({
        purpose,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
        keyVersion: RING_V1.current.version,
      }),
    );
  }

  it("raises credentials.malformed_payload for a row whose plaintext is not JSON at all", async () => {
    // A raw Stripe secret key, not a JSON-encoded object — exactly the shape a `JSON.parse`
    // `SyntaxError` would otherwise quote verbatim into its own message.
    await sealRawRow("payments.stripe", "sk_live_51ABCDEF");
    const error = await captured(() =>
      withTransaction(suite.db, (tx) => getCredential(tx, RING_V1, { purpose: "payments.stripe" })),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
    expect(JSON.stringify(error)).not.toContain("sk_live_51ABCDEF");
  });

  it("raises credentials.malformed_payload for a row whose plaintext is the JSON literal null", async () => {
    // Valid JSON — `JSON.parse` does not throw — but not an object, so it must be rejected by the
    // shape check rather than silently cast to `Record<string, string>`.
    await sealRawRow("payments.stripe", "null");
    const error = await captured(() =>
      withTransaction(suite.db, (tx) => getCredential(tx, RING_V1, { purpose: "payments.stripe" })),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
  });

  it("raises credentials.malformed_payload for a row whose plaintext is a JSON array", async () => {
    // Valid JSON, and `typeof [] === "object"` — so `Array.isArray` is what this guard needs, not
    // just `parsed === null`. Before this test existed, mutating the three-operand guard down to
    // `if (parsed === null)` left the whole suite green: a row sealed to `["sk_live_x"]` would have
    // been returned from getCredential typed as Record<string, string>, and a host reading `.length`
    // off the array or indexing a numeric key would silently misbehave rather than fail loudly here.
    await sealRawRow("payments.stripe", JSON.stringify(["sk_live_x"]));
    const error = await captured(() =>
      withTransaction(suite.db, (tx) => getCredential(tx, RING_V1, { purpose: "payments.stripe" })),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
  });

  it("raises credentials.malformed_payload for a row whose plaintext is a bare JSON scalar", async () => {
    // Valid JSON — a quoted string parses fine — but `typeof "x" !== "object"`, so this is the
    // branch the `typeof parsed !== "object"` operand exists for, distinct from both the null check
    // and the array check above. Same mutation-check as the array case: narrowing the guard to
    // `if (parsed === null)` leaves this row's malformed shape undetected.
    await sealRawRow("payments.stripe", JSON.stringify("sk_live_x"));
    const error = await captured(() =>
      withTransaction(suite.db, (tx) => getCredential(tx, RING_V1, { purpose: "payments.stripe" })),
    );
    expect(hasCode(error, "credentials.malformed_payload")).toBe(true);
  });
});

describe("tryGetCredential", () => {
  it("returns null rather than throwing when nothing is provisioned", async () => {
    const actual = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, RING_V1, { purpose: "fiscal.aeat" }),
    );
    expect(actual).toBeNull();
  });
});

describe("deleteCredential", () => {
  it("removes the row and reports that it did", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    const deleted = await withTransaction(suite.db, (tx) =>
      deleteCredential(tx, { purpose: "payments.stripe" }),
    );
    expect(deleted).toBe(true);
    const after = await withTransaction(suite.db, (tx) =>
      tryGetCredential(tx, RING_V1, { purpose: "payments.stripe" }),
    );
    expect(after).toBeNull();
  });

  it("reports false when there was nothing to delete", async () => {
    const deleted = await withTransaction(suite.db, (tx) =>
      deleteCredential(tx, { purpose: "payments.stripe" }),
    );
    expect(deleted).toBe(false);
  });
});

describe("listCredentials", () => {
  it("returns metadata and never a value", async () => {
    await withTransaction(suite.db, (tx) =>
      putCredential(tx, RING_V1, { purpose: "payments.stripe", value: STRIPE }),
    );
    // Exercise the metadata projection.
    const rows = await withTransaction(suite.db, async (tx) => {
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
    expect(Object.keys(rows[0]!).sort()).toEqual(["keyVersion", "purpose", "updatedAt"]);
  });
});
