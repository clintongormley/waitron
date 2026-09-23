import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "CREDENTIALS_CLASSIFICATION",
        "CREDENTIALS_MIGRATIONS",
        "tenantCredentials",
        "PURPOSES",
        "isPurpose",
        "validatePayload",
        "loadKeyRing",
        "credentialProvisioned",
        "deleteCredential",
        "getCredential",
        "listCredentials",
        "putCredential",
        "rotateCredentials",
        "tryGetCredential",
      ].sort(),
    );
  });

  it("does not export the CLI", () => {
    // `runCli` (cli.ts) and bin.ts's entry point are the provisioning tool's own surface, reached
    // through the bin — never through this library barrel. The exact-list assertion above already
    // pins this (an export of `runCli` would fail it), but this makes the intent explicit rather
    // than incidental.
    expect(Object.keys(api)).not.toContain("runCli");
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import never
 * runs it, which is why tenant-credentials.ts's PK/check block shows as uncovered even though
 * every other test in this package imports the table. Calling `getTableConfig` forces the callback
 * to run, and the assertions below are the meaningful check that tenant_credentials' constraints
 * actually exist under the names the migration and cipher/store depend
 * on — not a coverage stunt. Mirrors packages/scheduler/src/index.test.ts and
 * packages/payments/src/index.test.ts.
 */
describe("tenant_credentials constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares tenant_credentials' primary key on purpose, no foreign key, and its checks", () => {
    const config = getTableConfig(api.tenantCredentials);

    expect(config.primaryKeys[0]?.getName()).toBe("tenant_credentials_pk");
    expect(config.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(["purpose"]);
    expect(config.foreignKeys).toEqual([]);

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("tenant_credentials_key_version_ck");
    expect(checkNames).toContain("tenant_credentials_iv_len_ck");
    expect(checkNames).toContain("tenant_credentials_auth_tag_len_ck");
    expect(checkNames).toContain("tenant_credentials_purpose_ck");
  });
});

/**
 * A COMPILE-TIME case, and since the storage swap the only one on this subject: it goes red if a
 * column stops DECLARING `Uint8Array`. `pnpm --filter @waitron/credentials typecheck` is what runs
 * it.
 *
 * The RUNTIME half it used to sit beside — `credentials.test.ts`'s "hands the three sealed columns
 * back as plain Uint8Arrays, not node Buffers" — was deleted, because on this engine it can no
 * longer fail. `node:sqlite` hands a BLOB back as a plain `Uint8Array` whatever the column
 * declares (measured 2026-09-22 on Node v26.7.0, selecting a `blob` column back through
 * `openVenueDatabase`: `constructor.name` is `Uint8Array` and `Buffer.isBuffer` is `false`), so no
 * suite here can tell the column's `fromDriver` from the driver's own value. Nothing now checks at
 * RUNTIME that what a read hands back is not a node Buffer; `credentials.test.ts`'s own header
 * records that deletion and the argument behind it.
 */
describe("what a read hands back for the three sealed columns", () => {
  it("types them as Uint8Array, not as a node Buffer", () => {
    type CredentialRow = typeof api.tenantCredentials.$inferSelect;
    // A `Buffer` is assignable to a `Uint8Array` and not the other way round, so assigning a PLAIN
    // `Uint8Array` is the discriminating direction: this stops compiling the moment one of the
    // three columns goes back to declaring `Buffer`.
    const bytes = new Uint8Array([1, 2, 3]);
    const sealed: Pick<CredentialRow, "ciphertext" | "iv" | "authTag"> = {
      ciphertext: bytes,
      iv: bytes,
      authTag: bytes,
    };
    // The other direction, which the assignment above cannot give on its own: a column typed `any`
    // would accept a plain `Uint8Array` too. So the reverse must NOT compile, and `@ts-expect-error`
    // turns "it compiled after all" into a typecheck failure.
    // @ts-expect-error a sealed column is a Uint8Array, and a node Buffer is the narrower type
    const asBuffer: Buffer = sealed.ciphertext;
    expect(asBuffer).toBe(bytes);
  });
});
