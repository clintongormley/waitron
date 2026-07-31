import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  captureError,
  createPgliteDb,
  pgErrorCode,
  pgErrorMessage,
  runMigrations,
  type Database,
} from "@waitron/db";
import { CREDENTIALS_MIGRATIONS } from "./migrations.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

let db: Database;
let tenantId: string;

beforeAll(async () => {
  db = await createPgliteDb();
  // Core first — the tenants foreign key. Ordering across packages is the runtime's job and
  // nothing enforces it, so it is explicit here.
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, CREDENTIALS_MIGRATIONS);
  tenantId = await seedTenant(db);
});

afterAll(async () => {
  if (db !== undefined) await db.close();
});

/** A well-formed row body, so each test below varies exactly one thing. */
const OK = {
  ciphertext: Buffer.from("sealed"),
  iv: Buffer.alloc(12, 1),
  authTag: Buffer.alloc(16, 2),
};

describe("the credentials migration set", () => {
  it("creates tenant_credentials with row-level security forced", async () => {
    const result = await db.execute<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(sql`
      select relrowsecurity, relforcerowsecurity
        from pg_class where relname = 'tenant_credentials'`);
    expect(result.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("stores and returns a row round-trip", async () => {
    await db.execute(sql`
      insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
      values (${tenantId}, 'round.trip', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const rows = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from tenant_credentials
      where tenant_id = ${tenantId} and purpose = 'round.trip'`);
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("rejects a second row for the same (tenant, purpose)", async () => {
    await db.execute(sql`
      insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
      values (${tenantId}, 'dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`);
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'dup.purpose', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23505"); // unique_violation
  });

  it("rejects a key_version below 1", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.version', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 0)`),
    );
    expect(pgErrorCode(error)).toBe("23514"); // check_violation
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_key_version_ck/);
  });

  it("rejects an iv that is not 12 bytes", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.iv', ${OK.ciphertext}, ${Buffer.alloc(8, 1)}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_iv_len_ck/);
  });

  it("rejects a truncated auth tag", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, 'bad.tag', ${OK.ciphertext}, ${OK.iv}, ${Buffer.alloc(12, 2)}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_auth_tag_len_ck/);
  });

  it("rejects an empty purpose", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (${tenantId}, '', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenant_credentials_purpose_ck/);
  });

  it("rejects a row whose tenant does not exist", async () => {
    const error = await captureError(() =>
      db.execute(sql`
        insert into tenant_credentials (tenant_id, purpose, ciphertext, iv, auth_tag, key_version)
        values (gen_random_uuid(), 'orphan', ${OK.ciphertext}, ${OK.iv}, ${OK.authTag}, 1)`),
    );
    expect(pgErrorCode(error)).toBe("23503"); // foreign_key_violation
  });
});

/**
 * The `credential_tenants` SECURITY DEFINER seam (migration 0002), catalog properties asserted BY
 * VALUE — the RLS suite (`credentials.rls.test.ts`) proves the seam behaves correctly under real
 * Postgres, functionally; this proves WHY, structurally, on PGlite (no Docker needed), so a silent
 * regression to any one guard turns a specific assertion red instead of nothing at all. Mirrors
 * `packages/fiscal-verifactu/src/migrations.test.ts`'s "envios drainer enumeration seam" block,
 * which is migration 0002's own precedent (its doc comment names it directly) — extended here with
 * the properties that precedent did not itself cover: the pinned `search_path`, the bootstrap
 * grants' full reversal, and the pre-existing-LOGIN-role refusal.
 */
describe("credential_tenants enumeration seam (migration 0002)", () => {
  it("owns the function with a SECURITY DEFINER, non-superuser, non-BYPASSRLS role, with search_path pinned", async () => {
    // Ownership is the load-bearing property: SECURITY DEFINER runs with the OWNER's privileges, so
    // if the owner were superuser (both harnesses' migrator IS superuser) the function would bypass
    // FORCE ROW LEVEL SECURITY outright rather than crossing tenants through the one narrow
    // USING(true) policy scoped to credentials_enumerator. rolbypassrls is checked for the same
    // reason 0005_sales.sql's precedent checks it: a BYPASSRLS owner would make the permissive
    // policy irrelevant, reaching the same unrestricted-bypass outcome by a different route.
    // proconfig pins search_path to `pg_catalog, public` — an unset search_path inside a SECURITY
    // DEFINER function is a classic injection vector (a caller-controlled schema earlier on the
    // path could shadow a catalog function).
    const [fn] = (
      await db.execute<{
        prosecdef: boolean;
        rolname: string;
        rolsuper: boolean;
        rolbypassrls: boolean;
        proconfig: string[] | null;
      }>(sql`
        select p.prosecdef, r.rolname, r.rolsuper, r.rolbypassrls, p.proconfig
        from pg_proc p join pg_roles r on r.oid = p.proowner
        where p.proname = 'credential_tenants'
      `)
    ).rows;
    expect(fn).toEqual({
      prosecdef: true,
      rolname: "credentials_enumerator",
      rolsuper: false,
      rolbypassrls: false,
      proconfig: ["search_path=pg_catalog, public"],
    });
  });

  it("names EXECUTE to app_user only — PUBLIC's default grant was revoked", async () => {
    // aclexplode's grantee 0 is the sentinel for PUBLIC (same idiom as fiscal-verifactu's
    // envios_tenants_with_work test). Without the REVOKE, every role in the cluster could call the
    // cross-tenant enumeration, not just the one intended caller.
    const [exec] = (
      await db.execute<{ app_user_exec: boolean; public_exec: boolean }>(sql`
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

  it("scopes the permissive enumeration policy to the enumerator role, SELECT-only, USING(true)", async () => {
    // Existence is not correctness: read cmd/roles/qual BY VALUE. This is the additive permissive
    // policy the SECURITY DEFINER function sees rows through, ORed with
    // tenant_credentials_tenant_isolation for every other role. Flipping USING(true) to
    // USING(false) here would silently turn the whole seam back into a zero-row no-op.
    const policies = (
      await db.execute<{ policyname: string; cmd: string; roles: string[]; qual: string }>(sql`
        select policyname, cmd, roles::text[] as roles, qual from pg_policies
        where tablename = 'tenant_credentials' and policyname = 'credentials_enumerator_lookup'
      `)
    ).rows;
    expect(policies).toEqual([
      {
        policyname: "credentials_enumerator_lookup",
        cmd: "SELECT",
        roles: ["credentials_enumerator"],
        qual: "true",
      },
    ]);
  });

  it("leaves no standing privilege from the ownership-reassignment bootstrap", async () => {
    // The migration grants CREATE on schema public and membership in credentials_enumerator to
    // CURRENT_USER SOLELY so ALTER FUNCTION ... OWNER TO can run, then revokes both immediately.
    // Either revoke going missing would leave a standing privilege nothing in this task's other
    // tests would notice: the ownership and EXECUTE-grant tests above only look at the FUNCTION's
    // final state, not at what the migrating role itself was left holding.
    const members = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_auth_members m
        join pg_roles r on r.oid = m.roleid
        where r.rolname = 'credentials_enumerator'
      `)
    ).rows[0]!;
    expect(members.n).toBe(0);

    const createGrant = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int as n from pg_namespace n, aclexplode(n.nspacl) acl
        join pg_roles r on r.oid = acl.grantee
        where n.nspname = 'public'
          and r.rolname = 'credentials_enumerator'
          and acl.privilege_type = 'CREATE'
      `)
    ).rows[0]!;
    expect(createGrant.n).toBe(0);
  });

  it("refuses to reuse a pre-existing credentials_enumerator role that has LOGIN", async () => {
    // The DO block's ELSIF fires only when the role already exists AND rolcanlogin — an input no
    // other test in this file, or in credentials.rls.test.ts, ever supplies (both harnesses always
    // start from a role-free database). Simulated here by creating the LOGIN role by hand, on a
    // FRESH database, before letting migration 0002 run against it.
    const fresh = await createPgliteDb();
    await runMigrations(fresh, CORE_MIGRATIONS);
    await fresh.execute(sql`create role credentials_enumerator login password 'x'`);
    const error = await captureError(() => runMigrations(fresh, CREDENTIALS_MIGRATIONS));
    expect(pgErrorMessage(error)).toMatch(
      /credentials_enumerator already exists with LOGIN — refusing to reuse it/,
    );
    await fresh.close();
  });
});
