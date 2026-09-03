import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { locationId as brandLocationId } from "@waitron/shared";
import type { Database } from "./client.js";
import { readMembershipTrustSet, setNodePublicKey } from "./node-identity.js";
import { captureError, pgErrorCode, pgErrorMessage } from "./testing/errors.js";
import { useTemplateDb } from "./testing/lifecycle.js";
import { seedNode, seedTenant } from "./testing/seed.js";

// Real Postgres, not PGlite: this asserts the COLUMN-level grant on `nodes.public_key` (CLAUDE.md §3 —
// the command tag lies, so the ACL is read back BOTH directions) and that the read rides the app role
// while the write is fenced to the owner. PGlite runs every connection as a superuser and bypasses
// FORCE ROW LEVEL SECURITY, so it would answer the `has_column_privilege` probe the same regardless of
// the real grant AND could never observe the app-role UPDATE refusal — a PGlite pass would be a false
// pass. The null-filter/round-trip logic is the PGlite suite (node-identity.test.ts); the grant + RLS
// enforcement is the one thing real Postgres is needed for here.

// app_only_login is the cluster LOGIN role `in role app_user` created once in the shared container's
// global-setup; connecting AS it exercises the real non-superuser grant (a bare `set role` would not,
// since the container's default user is a superuser). Password is the shared fixture password.
const APP_LOGIN = "app_only_login";
const APP_PASSWORD = "provisioner_suite_password";

// No seedLocation helper exists (only seedTenant/seedNode — see seed.test.ts), so build the location
// the node FKs first, on the owner connection.
async function seedTenantNode(admin: Database): Promise<{ tenantId: string; nodeId: string }> {
  const tenant = await seedTenant(admin);
  const loc = await admin.execute<{ id: string }>(sql`
    insert into locations (tenant_id, name, invoice_locales, operation_description)
    values (${tenant}, 'Test location', ARRAY['es']::text[], 'Restaurant') returning id`);
  const node = await seedNode(admin, tenant, brandLocationId(loc.rows[0]!.id));
  return { tenantId: tenant, nodeId: node };
}

describe("nodes.public_key grants (membership trust anchor)", () => {
  const suite = useTemplateDb({ template: "core" });

  it("app_user holds SELECT and NOT UPDATE on nodes.public_key (trust read is app-role, writes owner-role)", async () => {
    // has_column_privilege reads the ACL regardless of the connected role, so the admin connection is
    // the authoritative reader. app_user MUST hold SELECT on the column (boot reads the trust set on
    // the app pool) and MUST NOT hold UPDATE — the key is stamped owner-role at provision only. This
    // fails if the `nodes` grant is ever widened to include UPDATE (CLAUDE.md §3, never widen a grant).
    const rows = await suite.admin.execute<{ sel: boolean; upd: boolean }>(sql`
      select
        has_column_privilege('app_user', 'nodes', 'public_key', 'SELECT') as sel,
        has_column_privilege('app_user', 'nodes', 'public_key', 'UPDATE') as upd
    `);
    expect(rows.rows[0]).toEqual({ sel: true, upd: false });
  });

  it("readMembershipTrustSet works on the app pool; setNodePublicKey does not (owner-only)", async () => {
    // Seed + stamp on the owner (superuser) connection, then prove the split on a genuine app-role
    // connection: the trust read is legitimate on the app pool (so Task 4's boot read is), and the
    // write is refused because app_user holds no UPDATE.
    const { tenantId, nodeId } = await seedTenantNode(suite.admin);
    await setNodePublicKey(suite.admin, tenantId, nodeId, "APP_POOL_KEY");

    const appDb = await suite.pg.connectAs(APP_LOGIN, APP_PASSWORD);
    try {
      // SELECT: app_user holds it, and withTenant's tenant GUC scopes the FORCE-RLS read to this
      // tenant's one keyed node.
      expect(await readMembershipTrustSet(appDb, tenantId)).toEqual({ [nodeId]: "APP_POOL_KEY" });

      // UPDATE: refused at the table/column privilege check. 42501 is insufficient_privilege — but an
      // RLS WITH CHECK refusal is ALSO 42501 (provisioner-role.rls.test.ts's receipt), so assert the
      // message too: the grant failure reads "permission denied for table nodes", an RLS refusal would
      // read "new row violates row-level security policy". This is what fails if UPDATE is ever granted.
      const error = await captureError(() =>
        setNodePublicKey(appDb, tenantId, nodeId, "APP_POOL_OVERWRITE"),
      );
      expect(pgErrorCode(error)).toBe("42501");
      expect(pgErrorMessage(error)).toMatch(/permission denied for table/);
    } finally {
      await appDb.close();
    }
  });
});
