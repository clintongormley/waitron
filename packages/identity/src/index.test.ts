import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./index.js";
import * as api from "./index.js";

describe("@waitron/identity barrel", () => {
  it("exports the migration descriptor with the identity journal table", () => {
    expect(IDENTITY_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_identity");
  });
});

/**
 * drizzle invokes each table's `(t) => [...]` extraConfig callback LAZILY — a plain import never
 * runs it, which is why persons.ts's FK/index/check block shows as uncovered even though the
 * barrel imports the table. Calling `getTableConfig` forces the callback to run, and the
 * assertions below are the meaningful check that persons' constraints exist under the names the
 * baseline uses — not a coverage stunt. Mirrors packages/credentials/src/index.test.ts.
 */
describe("persons constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares persons' primary key, foreign key and check constraints", () => {
    const config = getTableConfig(api.persons);

    // The PK is inline on `id` (a column flag), not a composite in extraConfig; the FK, index and
    // checks below ARE in extraConfig, so asserting them is what forces the lazy callback to run.
    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("persons_tenant_fk");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("persons_display_name_ck");
    expect(checkNames).toContain("persons_pin_hash_ck");
    expect(checkNames).toContain("persons_password_hash_ck");
    expect(checkNames).toContain("persons_totp_secret_ck");
  });
});

/**
 * Same mechanism for sessions — its FK/index block is in the lazy extraConfig callback, so this
 * both forces it to run and pins the names the generated baseline uses. sessions keys to the
 * TILL, not the node: the three FKs are to tenants, persons and tills.
 */
describe("sessions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares sessions' primary key, its three foreign keys, and its tenant/open indexes", () => {
    const config = getTableConfig(api.sessions);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("sessions_tenant_fk");
    expect(fkNames).toContain("sessions_person_fk");
    expect(fkNames).toContain("sessions_till_fk");

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("sessions_tenant_id_idx");
    expect(indexNames).toContain("sessions_open_idx");
  });
});

/**
 * Same mechanism for management_sessions — its FK/index block is in the lazy extraConfig
 * callback, so this both forces it to run and pins the names the generated baseline references. A
 * management session belongs to a person within a tenant (browser dashboard login), so its two
 * FKs are to tenants and persons — no till.
 */
describe("management_sessions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares management_sessions' primary key, its two foreign keys, and its tenant/open indexes", () => {
    const config = getTableConfig(api.managementSessions);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("management_sessions_tenant_fk");
    expect(fkNames).toContain("management_sessions_person_fk");

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("management_sessions_tenant_id_idx");
    expect(indexNames).toContain("management_sessions_open_idx");
  });
});

/**
 * Same mechanism for webauthn_credentials — its FK/unique/index block is in the lazy extraConfig
 * callback, so this both forces it to run and pins the names the generated baseline uses. A
 * registered passkey belongs to a person within a tenant, so its two FKs are to tenants and
 * persons; the credential id is unique per tenant.
 */
describe("webauthn_credentials constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares webauthn_credentials' primary key, its two foreign keys, its per-tenant unique credential id and its person index", () => {
    const config = getTableConfig(api.webauthnCredentials);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toContain("webauthn_credentials_tenant_fk");
    expect(fkNames).toContain("webauthn_credentials_person_fk");

    const uniqueNames = config.uniqueConstraints.map((u) => u.getName());
    expect(uniqueNames).toContain("webauthn_credentials_credential_id_uq");

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("webauthn_credentials_person_idx");
  });
});

/**
 * Same mechanism for webauthn_challenges — its FK/index block is in the lazy extraConfig callback, so
 * this both forces it to run and pins the names the generated baseline references. A challenge belongs to a tenant; person_id is
 * nullable (a discoverable-login ceremony has no known person yet) and carries no FK, so the ONE FK is
 * to tenants.
 */
describe("webauthn_challenges constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares webauthn_challenges' primary key, its single tenant foreign key, and its tenant index", () => {
    const config = getTableConfig(api.webauthnChallenges);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(["webauthn_challenges_tenant_fk"]);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("webauthn_challenges_tenant_idx");
  });
});
