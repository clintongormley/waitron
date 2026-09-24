import { getTableConfig } from "drizzle-orm/sqlite-core";
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
  it("declares persons' primary key, its two partial unique indexes and its check constraints", () => {
    const config = getTableConfig(api.persons);

    // The PK is inline on `id` (a column flag), not a composite in extraConfig; the indexes and
    // checks below ARE in extraConfig, so asserting them is what forces the lazy callback to run.
    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("persons_tenant_google_subject_uq");
    expect(indexNames).toContain("persons_tenant_pending_email_uq");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("persons_display_name_ck");
    expect(checkNames).toContain("persons_pin_hash_ck");
    expect(checkNames).toContain("persons_password_hash_ck");
    expect(checkNames).toContain("persons_totp_secret_ck");
  });
});

/**
 * Same mechanism for sessions — its index block is in the lazy extraConfig callback, so this both
 * forces it to run and pins what the generated baseline holds. It declares NO foreign key: the
 * caller supplies the person and the till, and a session whose person is gone resolves as none
 * (`authorize.ts`).
 */
describe("sessions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares sessions' primary key and its open-session index, and no foreign key", () => {
    const config = getTableConfig(api.sessions);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(config.foreignKeys).toEqual([]);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("sessions_open_idx");
    expect(indexNames).toContain("sessions_token_hash_uq");
    expect(config.checks.map((c) => c.name)).toContain("sessions_token_hash_ck");
  });
});

/**
 * Same mechanism for management_sessions — its index block is in the lazy extraConfig callback, so
 * this both forces it to run and pins what the generated baseline holds. A management session
 * belongs to a person, but declares no foreign key to one, for the same reason as sessions above.
 */
describe("management_sessions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares management_sessions' primary key and its open-session index, and no foreign key", () => {
    const config = getTableConfig(api.managementSessions);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(config.foreignKeys).toEqual([]);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("management_sessions_open_idx");
    expect(indexNames).toContain("management_sessions_token_hash_uq");
    expect(config.checks.map((c) => c.name)).toContain("management_sessions_token_hash_ck");
  });
});

/**
 * Same mechanism for webauthn_credentials — its FK/unique/index block is in the lazy extraConfig
 * callback, so this both forces it to run and pins the names the generated baseline uses. A
 * registered passkey belongs to a person, so its one FK is to persons; the credential id is unique.
 */
describe("webauthn_credentials constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares webauthn_credentials' primary key, its one foreign key, its unique credential id and its person index", () => {
    const config = getTableConfig(api.webauthnCredentials);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const fkNames = config.foreignKeys.map((fk) => fk.getName());
    expect(fkNames).toEqual(["webauthn_credentials_person_fk"]);

    const uniqueNames = config.uniqueConstraints.map((u) => u.getName());
    expect(uniqueNames).toContain("webauthn_credentials_credential_id_uq");

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("webauthn_credentials_person_idx");
  });
});

/**
 * webauthn_challenges declares no constraints of its own beyond its primary key: `person_id` is
 * nullable (a discoverable-login ceremony has no known person yet) and deliberately carries NO
 * foreign key, so a login challenge can be minted before anyone is identified.
 */
describe("webauthn_challenges constraint declarations", () => {
  it("declares its primary key and no foreign keys or indexes", () => {
    const config = getTableConfig(api.webauthnChallenges);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(config.foreignKeys).toEqual([]);
    expect(config.indexes).toEqual([]);
  });
});
