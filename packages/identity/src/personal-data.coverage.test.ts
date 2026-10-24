// Weaker than its name: it knows a person column only by the name `person_id`, and it proves a
// column was classified, not that IDENTITY_PERSONAL_DATA honours the classification
// (personal-data.test.ts's exact-files and no-secrets cases do that).
import { is } from "drizzle-orm";
import { SQLiteTable, getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

const CLASSIFIED: Record<string, { readonly in: string[]; readonly out: string[] }> = {
  persons: {
    in: [
      "id",
      "display_name",
      "first_names",
      "last_names",
      "telephone",
      "locale",
      "passkey_offered_at",
      "email",
      "pending_email",
      "email_verified_at",
      "role",
      "status",
      "created_at",
    ],
    out: [
      "display_name_folded",
      "pin_hash",
      "password_hash",
      "totp_secret",
      "email_folded",
      "pending_email_folded",
      "google_subject",
    ],
  },
  webauthn_credentials: {
    in: ["name", "aaguid", "created_at", "last_used_at"],
    out: ["id", "person_id", "credential_id", "public_key", "counter", "transports"],
  },
  recovery_codes: {
    in: ["used_at"],
    out: ["id", "person_id", "code_hash", "created_at"],
  },
  sessions: {
    in: ["device_id", "opened_at", "ended_at"],
    out: ["id", "person_id", "token_hash"],
  },
  management_sessions: {
    in: ["created_at", "last_seen_at", "ended_at"],
    out: ["id", "person_id", "token_hash"],
  },
  management_account_actions: {
    in: [
      "purpose",
      "target_email",
      "created_at",
      "expires_at",
      "used_at",
      "code_expires_at",
      "code_attempts",
    ],
    out: ["id", "person_id", "token_hash", "code_hash"],
  },
  totp_enrollments: {
    in: ["created_at", "expires_at"],
    out: ["id", "person_id", "encrypted_secret"],
  },
  webauthn_challenges: {
    in: ["created_at"],
    out: ["id", "person_id", "challenge"],
  },
  google_oidc_states: {
    in: ["expires_at"],
    out: ["id", "person_id", "mode", "state_hash", "nonce", "verifier"],
  },
  device_profile_admission_persons: {
    in: ["device_profile_id", "admitted"],
    out: ["person_id"],
  },
};

const tables = Object.values(schema).flatMap((value) =>
  is(value, SQLiteTable) ? [getTableConfig(value)] : [],
);

const personTables = tables.filter(
  (config) => config.name === "persons" || config.columns.some((c) => c.name === "person_id"),
);

describe("identity personal-data classification", () => {
  it("covers every identity table that names a person, and no other", () => {
    expect(personTables.map((config) => config.name).sort()).toEqual(
      Object.keys(CLASSIFIED).sort(),
    );
  });

  it.each(personTables.map((config) => [config.name, config] as const))(
    "classifies every column of %s exactly once",
    (name, config) => {
      expect(Object.keys(CLASSIFIED)).toContain(name);
      const { in: included, out: excluded } = CLASSIFIED[name]!;
      expect(included.filter((column) => excluded.includes(column))).toEqual([]);
      expect(config.columns.map((c) => c.name).sort()).toEqual([...included, ...excluded].sort());
    },
  );
});
