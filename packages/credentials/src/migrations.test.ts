import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";

const suite = useVenueDb({
  resetPerTest: false,
  // Core first — the credentials baseline references `tenants`. Ordering across packages is the
  // runtime's job and nothing enforces it, so it is explicit here.
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
});

/** A well-formed row body, so each test below varies exactly one thing. */
const OK = {
  ciphertext: Buffer.from("sealed"),
  iv: Buffer.alloc(12, 1),
  authTag: Buffer.alloc(16, 2),
};

describe("the credentials migration set", () => {
  it("stores and returns a row round-trip", async () => {
    await suite.db.execute(sql`
      insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
      values ('round.trip', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials where purpose = 'round.trip'`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a second row for the same purpose", async () => {
    await suite.db.execute(sql`
      insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
      values ('dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
        values ('dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23505"); // unique_violation
  });

  it("rejects a key_version below 1", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
        values ('bad.version', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 0)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_key_version_ck/);
  });

  it("rejects an iv that is not 12 bytes", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
        values ('bad.iv', ${OK.ciphertext}, ${Buffer.alloc(8, 1)}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_iv_len_ck/);
  });

  it("rejects a truncated auth tag", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
        values ('bad.tag', ${OK.ciphertext}, ${OK.iv}, ${Buffer.alloc(12, 2)}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_auth_tag_len_ck/);
  });

  it("rejects an empty purpose", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version)
        values ('', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_purpose_ck/);
  });

  it("carries no tenant column and keys each row by purpose alone", async () => {
    const result = await suite.db.execute<{ column_name: string }>(sql`
      select a.attname as column_name
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
      where c.conname = 'tenant_credentials_pk'`);
    expect(result.rows).toEqual([{ column_name: "purpose" }]);
    const tenantColumn = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from information_schema.columns
      where table_name = 'tenant_credentials' and column_name = 'tenant_id'`);
    expect(tenantColumn.rows[0]!.n).toBe(0);
  });
});

/**
 * The enumeration function pins its search path and grants EXECUTE to app_user while revoking
 * PUBLIC's default EXECUTE. Functional cases are in credentials.test.ts.
 */
describe("credential_tenants enumeration seam", () => {
  it("names EXECUTE to app_user only — PUBLIC's default grant was revoked", async () => {
    // Check the app role grant and the absence of PUBLIC's default EXECUTE grant independently.
    // aclexplode grantee 0 denotes PUBLIC.
    const [exec] = (
      await suite.db.execute<{ app_user_exec: boolean; public_exec: boolean }>(sql`
        select
          has_function_privilege('app_user', 'credential_tenants(text)', 'EXECUTE') as app_user_exec,
          exists (
            select 1 from pg_proc p, aclexplode(p.proacl) acl
            where p.proname = 'credential_tenants'
              and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
          ) as public_exec
      `)
    ).rows;
    expect(exec).toEqual({ app_user_exec: true, public_exec: false });
  });

  it("pins search_path to pg_catalog, public", async () => {
    const result = await suite.db.execute<{ proconfig: string[] | null }>(sql`
      select proconfig from pg_proc where proname = 'credential_tenants'
    `);
    expect(result.rows).toEqual([{ proconfig: ["search_path=pg_catalog, public"] }]);
  });
});
