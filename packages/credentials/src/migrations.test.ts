import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, captureError, pgErrorCode, pgErrorMessage } from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { seedTenant } from "@waitron/db/testing/seed.js";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";

let tenantId: string;

const suite = usePgliteDb({
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  migrations: [CORE_MIGRATIONS, CREDENTIALS_MIGRATIONS],
  setup: async (db) => {
    tenantId = await seedTenant(db);
  },
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
      insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
      values (${tenantId}, 'round.trip', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const rows = await suite.db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials
      where tenant_id = ${tenantId} and purpose = 'round.trip'`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a second row for the same (tenant, purpose)", async () => {
    await suite.db.execute(sql`
      insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
      values (${tenantId}, 'dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23505"); // unique_violation
  });

  it("rejects a key_version below 1", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.version', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 0)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_key_version_ck/);
  });

  it("rejects an iv that is not 12 bytes", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.iv', ${OK.ciphertext}, ${Buffer.alloc(8, 1)}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_iv_len_ck/);
  });

  it("rejects a truncated auth tag", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.tag', ${OK.ciphertext}, ${OK.iv}, ${Buffer.alloc(12, 2)}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_auth_tag_len_ck/);
  });

  it("rejects an empty purpose", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, '', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_purpose_ck/);
  });

  it("rejects a row whose tenant does not exist", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (gen_random_uuid(), 'orphan', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
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
