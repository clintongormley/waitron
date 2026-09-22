import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  captureError,
  isPgError,
  nowIso,
  pgErrorMessage,
} from "@waitron/db";
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

/**
 * `updated_at`, which every raw insert below now has to supply itself.
 *
 * It takes its value from a JavaScript `$defaultFn` generator (`nowIso`,
 * `./schema/tenant-credentials.ts`), which drizzle runs for a BUILDER insert and never for raw SQL,
 * and the generated DDL declares no SQL DEFAULT for it — so an insert omitting it is refused
 * `NOT NULL constraint failed: tenant_credentials.updated_at`, which is what this suite printed
 * before the change. Same shape as `packages/workforce/src/migrations.test.ts:43-50`. Every insert
 * here stays raw deliberately: what it proves is the constraint the MIGRATION declares, not the
 * values drizzle would send.
 */
const stamp = () => sql`${nowIso()}`;

describe("the credentials migration set", () => {
  it("stores and returns a row round-trip", async () => {
    await suite.db.execute(sql`
      insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
      values ('round.trip', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1, ${stamp()})`);
    // No `::int`: the cast only flattened PostgreSQL's bigint `count` to a JavaScript number, and
    // this engine returns one already — measured on node v26.7.0, `select count(*) as n` over a
    // one-row table gives `{ n: 1 }` with `typeof n === "number"`.
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
    // `23505` was PostgreSQL's SQLSTATE for the whole unique class. This engine reports a numeric
    // extended result code instead and splits the class in two — 2067 for a unique index, 1555 for
    // a primary key — which is why the assertion goes through the shared class rather than one
    // literal (`packages/db/src/sql-state.ts`). Measured on node v26.7.0: a second insert of the
    // same `purpose` into a table with `constraint tenant_credentials_pk primary key (purpose)`
    // arrives as errcode 1555, `UNIQUE constraint failed: tenant_credentials.purpose`.
    expect(isPgError(error, UNIQUE_VIOLATION)).toBe(true);
  });

  it("rejects a key_version below 1", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('bad.version', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 0, ${stamp()})`),
    );
    // `23514` was PostgreSQL's SQLSTATE for a CHECK violation; this engine reports extended result
    // code 275, which `CHECK_VIOLATION` names (`packages/db/src/sql-state.ts`). The constraint NAME
    // is unchanged in the message — measured on node v26.7.0, the refusal reads
    // `CHECK constraint failed: tenant_credentials_key_version_ck` — so the line below stands.
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_key_version_ck/);
  });

  it("rejects an iv that is not 12 bytes", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('bad.iv', ${OK.ciphertext}, ${Buffer.alloc(8, 1)}, ${OK.authTag}, 1, ${stamp()})`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_iv_len_ck/);
  });

  it("rejects a truncated auth tag", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('bad.tag', ${OK.ciphertext}, ${OK.iv}, ${Buffer.alloc(12, 2)}, 1, ${stamp()})`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_auth_tag_len_ck/);
  });

  it("rejects an empty purpose", async () => {
    const error = await captureError(() =>
      suite.db.execute(sql`
        insert into tenant_credentials (purpose, ciphertext, iv, auth_tag, key_version, updated_at)
        values ('', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1, ${stamp()})`),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_purpose_ck/);
  });

  it("carries no tenant column and keys each row by purpose alone", async () => {
    // Both halves asked a PostgreSQL catalogue this engine has no counterpart for — `pg_constraint`
    // joined to `pg_attribute`, and `information_schema.columns`. Neither existed here
    // (`no such table: pg_constraint`, measured through this suite), so the case died on its first
    // statement. `pragma_table_info` answers both: it lists one row per column, with `pk` giving
    // the column's 1-based position in the primary key and 0 for a column outside it. Measured on
    // node v26.7.0 against a table declared with `constraint tenant_credentials_pk primary key
    // (purpose)`: `purpose` reads pk 1 and every other column reads pk 0.
    //
    // The `where pk > 0` filter is what carries the word "alone" — a second key column would come
    // back as a second row and fail the `toEqual`.
    const result = await suite.db.execute<{ column_name: string }>(sql`
      select name as column_name from pragma_table_info('tenant_credentials')
      where pk > 0 order by pk`);
    expect(result.rows).toEqual([{ column_name: "purpose" }]);
    // The same pragma for the column's absence, with no `::int`: this engine returns `count(*)` as
    // a JavaScript number already.
    const tenantColumn = await suite.db.execute<{ n: number }>(sql`
      select count(*) as n from pragma_table_info('tenant_credentials')
      where name = 'tenant_id'`);
    expect(tenantColumn.rows[0]!.n).toBe(0);
  });
});

/**
 * **Both cases here outlived their subject and neither can pass.** They ask a PostgreSQL catalogue
 * (`has_function_privilege`, `pg_proc`) about `credential_tenants(text)` — a function this branch's
 * regeneration dropped, and one this engine could not hold anyway: SQLite defines no SQL functions,
 * has no catalogue to ask, and has no roles for a grant to name
 * (`packages/db/src/testing/roles.ts`). The `search_path` pin has no counterpart either: there is
 * one file and no schema to resolve against.
 *
 * What the function DID, `credentialProvisioned` now does as an ordinary query, and the functional
 * cases in `credentials.test.ts` are what hold it — the purpose filter, and the `tenants` half the
 * old SQL carried by selecting `id FROM tenants`.
 *
 * Left rather than deleted: deciding what a PostgreSQL-catalogue suite becomes on this engine is
 * the branch's own sweep, not a side effect of replacing one function.
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
