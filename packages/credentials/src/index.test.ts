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
    expect(Object.keys(api)).not.toContain("runCli");
  });
});

/**
 * drizzle invokes a table's `(t) => [...]` extraConfig callback LAZILY, so a plain import never
 * runs it. `getTableConfig` forces it, and the assertions pin the constraint names the migration
 * declares.
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
 * A COMPILE-TIME case: it goes red if a column stops DECLARING `Uint8Array`.
 * `pnpm --filter @waitron/credentials typecheck` is what runs it.
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
