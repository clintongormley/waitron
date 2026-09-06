import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("the public surface", () => {
  it("exports exactly the intended names", () => {
    expect(Object.keys(api).sort()).toEqual(
      [
        "CREDENTIALS_MIGRATIONS",
        "tenantCredentials",
        "PURPOSES",
        "isPurpose",
        "validatePayload",
        "loadKeyRing",
        "credentialTenants",
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
 * runs it, which is why tenant-credentials.ts's PK/FK/check block shows as uncovered even though
 * every other test in this package imports the table. Calling `getTableConfig` forces the callback
 * to run, and the assertions below are the meaningful check that tenant_credentials' constraints
 * actually exist under the names the migration and cipher/store depend
 * on — not a coverage stunt. Mirrors packages/scheduler/src/index.test.ts and
 * packages/payments/src/index.test.ts.
 */
describe("tenant_credentials constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares tenant_credentials' primary key, foreign key and check constraints", () => {
    const config = getTableConfig(api.tenantCredentials);

    expect(config.primaryKeys[0]?.getName()).toBe("tenant_credentials_pk");

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("tenant_credentials_tenant_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("tenant_credentials_key_version_ck");
    expect(checkNames).toContain("tenant_credentials_iv_len_ck");
    expect(checkNames).toContain("tenant_credentials_auth_tag_len_ck");
    expect(checkNames).toContain("tenant_credentials_purpose_ck");
  });
});
