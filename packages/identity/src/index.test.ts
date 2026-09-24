import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { IDENTITY_MIGRATIONS } from "./index.js";
import * as api from "./index.js";

describe("@waitron/identity barrel", () => {
  it("exports the migration descriptor with the identity journal table", () => {
    expect(IDENTITY_MIGRATIONS.migrationsTable).toBe("__drizzle_migrations_identity");
  });
});

/** drizzle runs each table's extraConfig callback LAZILY; `getTableConfig` forces it. */
describe("persons constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares persons' primary key, its two partial unique indexes and its check constraints", () => {
    const config = getTableConfig(api.persons);
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

/** It declares NO foreign key; `schema/sessions.ts` says why. */
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

/** It declares no foreign key to persons; `schema/management-sessions.ts` says why. */
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

describe("webauthn_challenges constraint declarations", () => {
  it("declares its primary key and no foreign keys or indexes", () => {
    const config = getTableConfig(api.webauthnChallenges);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(config.foreignKeys).toEqual([]);
    expect(config.indexes).toEqual([]);
  });
});
