import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  engineErrorMessage,
  isRefusal,
  nowIso,
} from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: [CREDENTIALS_MIGRATIONS],
});

/** A well-formed row body, so each test below varies exactly one thing. */
const OK = {
  ciphertext: Buffer.from("sealed"),
  iv: Buffer.alloc(12, 1),
  authTag: Buffer.alloc(16, 2),
};

/**
 * `updated_at`, which every raw insert below has to supply itself: its value comes from a
 * `$defaultFn` drizzle runs only for a BUILDER insert, and the DDL declares no SQL default. The
 * inserts stay raw deliberately: what they prove is what the MIGRATION declares, not the values
 * drizzle would send.
 */
const stamp = () => sql`${nowIso()}`;

describe("the credentials migration set", () => {
  it("stores and returns a row round-trip", async () => {
    await suite.db.execute(sql`
      insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
      values ('round.trip', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1, ${stamp()})`);
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from tenant_credentials where purpose = 'round.trip'`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a second row for the same purpose", async () => {
    await suite.db.execute(sql`
      insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
      values ('dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1, ${stamp()})`);
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1, ${stamp()})`),
    );
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  });

  it("rejects a key_version below 1", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('bad.version', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 0, ${stamp()})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenant_credentials_key_version_ck/);
  });

  it("rejects an iv that is not 12 bytes", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('bad.iv', ${OK.ciphertext}, ${Buffer.alloc(8, 1)}, ${OK.authTag}, 1, ${stamp()})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenant_credentials_iv_len_ck/);
  });

  it("rejects a truncated auth tag", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('bad.tag', ${OK.ciphertext}, ${OK.iv}, ${Buffer.alloc(12, 2)}, 1, ${stamp()})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenant_credentials_auth_tag_len_ck/);
  });

  it("rejects an empty purpose", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1, ${stamp()})`),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenant_credentials_purpose_ck/);
  });

  it("carries no tenant column and keys each row by purpose alone", async () => {
    // The `where pk > 0` filter is what carries the word "alone" — a second key column would come
    // back as a second row and fail the `toEqual`.
    const result = await suite.db.execute<{ column_name: string }>(sql`
      select name as column_name from pragma_table_info('tenant_credentials')
      where pk > 0 order by pk`);
    expect(result.rows).toEqual([{ column_name: "purpose" }]);
    const tenantColumn = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from pragma_table_info('tenant_credentials')
      where name = 'tenant_id'`);
    expect(tenantColumn.rows[0]!.n).toBe(0);
  });
});
