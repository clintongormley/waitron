import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { useTemplateDb } from "./testing/lifecycle.js";

// Real Postgres, not PGlite: this asserts the object-privilege GRANT on `mirror_config`, and "an
// object-privilege GRANT PostgreSQL accepted is not one that did anything" (CLAUDE.md §3) — the
// command tag lies, so the ACL is read back BOTH directions. PGlite runs every connection as a
// superuser and would answer these `has_table_privilege` probes the same regardless of the real
// grant, so a PGlite pass would be a false pass. `mirror_config` carries no tenant_id and no RLS, so
// there is no policy to exercise; the one thing real Postgres is needed for here is the grant.
describe("mirror_config grants", () => {
  // A clone of the shared container's `core` template — the migrated cluster that ran 0071, which
  // GRANTs SELECT to app_user and nothing else. Docker is required (the package globalSetup fails
  // loudly without it).
  const suite = useTemplateDb({ template: "core" });

  it("app_user holds SELECT on mirror_config and NOT INSERT/UPDATE/DELETE (owner-only write)", async () => {
    // has_table_privilege reads pg_class.relacl regardless of the connected role, so the admin
    // connection is the authoritative reader. app_user MUST hold SELECT (mirror boot reads the
    // config on the app pool) and MUST NOT hold any write — the config is written owner-role at
    // adopt time only.
    const rows = await suite.admin.execute<{
      sel: boolean;
      ins: boolean;
      upd: boolean;
      del: boolean;
    }>(sql`
      select
        has_table_privilege('app_user', 'mirror_config', 'SELECT') as sel,
        has_table_privilege('app_user', 'mirror_config', 'INSERT') as ins,
        has_table_privilege('app_user', 'mirror_config', 'UPDATE') as upd,
        has_table_privilege('app_user', 'mirror_config', 'DELETE') as del
    `);
    expect(rows.rows[0]).toEqual({ sel: true, ins: false, upd: false, del: false });
  });
});
