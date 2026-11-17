import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as api from "./index.js";

describe("@waitron/identity barrel", () => {
  it("exports no migration set of its own: its tables are in core's set", () => {
    expect(Object.keys(api)).not.toContain("IDENTITY_MIGRATIONS");
    expect(api.IDENTITY_TABLES).toContain("persons");
  });
});

/** drizzle runs each table's extraConfig callback LAZILY; `getTableConfig` forces it. */
describe("persons constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares persons' primary key, its two partial unique indexes and its check constraints", () => {
    const config = getTableConfig(api.persons);
    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("persons_google_subject_uq");
    expect(indexNames).toContain("persons_pending_email_uq");

    const checkNames = config.checks.map((c) => c.name);
    expect(checkNames).toContain("persons_display_name_ck");
    expect(checkNames).toContain("persons_pin_hash_ck");
    expect(checkNames).toContain("persons_password_hash_ck");
    expect(checkNames).toContain("persons_totp_secret_ck");
  });
});

describe("sessions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares till_sessions' primary key, its indexes, and device and person keys", () => {
    const config = getTableConfig(api.tillSessions);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(
      config.foreignKeys.map((fk) => {
        const { columns, foreignTable } = fk.reference();
        return [columns.map((c) => c.name), getTableConfig(foreignTable).name, fk.onDelete];
      }),
    ).toEqual([
      [["device_id"], "devices", "restrict"],
      [["person_id"], "persons", "restrict"],
    ]);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("till_sessions_open_idx");
    expect(indexNames).toContain("till_sessions_token_hash_uq");
    expect(config.checks.map((c) => c.name)).toContain("till_sessions_token_hash_ck");
  });
});

describe("dashboard_sessions constraint declarations (forces the lazy extraConfig callback)", () => {
  it("declares dashboard_sessions' primary key, indexes and person key", () => {
    const config = getTableConfig(api.dashboardSessions);

    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(
      config.foreignKeys.map((fk) => {
        const { columns, foreignTable } = fk.reference();
        return [columns.map((c) => c.name), getTableConfig(foreignTable).name, fk.onDelete];
      }),
    ).toEqual([[["person_id"], "persons", "restrict"]]);

    const indexNames = config.indexes.map((i) => i.config.name);
    expect(indexNames).toContain("dashboard_sessions_open_idx");
    expect(indexNames).toContain("dashboard_sessions_token_hash_uq");
    expect(config.checks.map((c) => c.name)).toContain("dashboard_sessions_token_hash_ck");
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

describe("sign_in_challenges constraint declarations", () => {
  it("declares its primary key, person cascade, four checks and three indexes", () => {
    const config = getTableConfig(api.signInChallenges);
    expect(config.columns.find((c) => c.name === "id")?.primary).toBe(true);
    expect(config.checks.map((c) => c.name).sort()).toEqual([
      "sign_in_challenges_expiry_ck",
      "sign_in_challenges_kind_ck",
      "sign_in_challenges_shape_ck",
      "sign_in_challenges_state_hash_ck",
    ]);
    expect(config.foreignKeys.map((fk) => [fk.getName(), fk.onDelete])).toEqual([
      ["sign_in_challenges_person_fk", "cascade"],
    ]);
    expect(config.indexes.map((i) => i.config.name).sort()).toEqual([
      "sign_in_challenges_person_idx",
      "sign_in_challenges_state_hash_uq",
      "sign_in_challenges_totp_person_uq",
    ]);
  });
});
