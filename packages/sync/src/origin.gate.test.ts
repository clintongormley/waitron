import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { withTenant, type Database } from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
import { seedTenant } from "@waitron/db/testing/seed.js";

// Real Postgres, not PGlite: capture runs under FORCE ROW LEVEL SECURITY as the non-superuser app
// role, which PGlite (superuser) bypasses — a false pass here (CLAUDE.md §4). Unlike capture.gate,
// which drives capture through a LOCAL withTenantNode copy of the helper, this suite drives it
// through the PRODUCTION `withTenant` from @waitron/db, so it is the test that proves Task 5's
// wiring — that the real helper's optional node id reaches `app.node_id` and lands in
// `sync_log.origin_id`.
// The deployment role app_login — a non-superuser, non-BYPASSRLS LOGIN member of app_user, so FORCE
// RLS applies to it — is now created once in src/testing/global-setup.ts and shared across the gate
// suites: a shared cluster is one cluster, so a per-file `create role` would collide on the second.
// Reached below with `postgres.pg.connectAs("app_login", "app_pw")`.
const postgres = useTemplateDb({ template: "manifest" });

// A producing node's id, and the all-zero uuid capture defaults origin to when app.node_id is unset.
const NODE_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ZERO = "00000000-0000-0000-0000-000000000000";

/** Seeds a tenant plus the one FK parent a `products` row needs (a catalogue), as the superuser. */
async function seedTenantWithCatalogue(admin: Database): Promise<{
  tenantId: string;
  catalogueId: string;
}> {
  const tenantId = await seedTenant(admin);
  const cat = await admin.execute<{ id: string }>(
    sql`insert into catalogues (tenant_id, name) values (${tenantId}, 'Deli') returning id`,
  );
  return { tenantId, catalogueId: cat.rows[0]!.id };
}

describe("withTenant threads app.node_id into sync_log.origin_id", () => {
  it("stamps origin_id with the supplied node id (4-arg), and defaults to all-zero on the plain form", async () => {
    // Failing case: the production `withTenant` does NOT set app.node_id, so a locally-originated
    // write lands in sync_log with the all-zero origin even when a node id was supplied — origin
    // attribution is silently lost (before Task 5 wired the 4th arg the extra param is ignored at
    // runtime, so the node-aware write captures ZERO exactly like the plain one). Control in the
    // other direction: the plain 3-arg withTenant leaves origin_id at the all-zero default, so the
    // two paths VISIBLY differ (NODE_A vs ZERO) — a measurement where both answers look alike would
    // measure nothing (CLAUDE.md §1).
    const aware = await seedTenantWithCatalogue(postgres.admin);
    const plain = await seedTenantWithCatalogue(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");

    const insertProduct = (tenantId: string, catalogueId: string) =>
      sql`insert into products
            (tenant_id, catalogue_id, descriptions, pricing_unit, unit_price, vat_class)
          values (${tenantId}, ${catalogueId}, '{"en":"Coffee"}'::jsonb, 'each', '1.00', 'general')`;

    const originFor = async (tenantId: string): Promise<{ n: string; origin: string | null }> => {
      const r = await postgres.admin.execute<{ n: string; origin: string | null }>(
        sql`select count(*)::text as n, max(origin_id::text) as origin
            from sync_log where table_name = 'products' and tenant_id = ${tenantId}`,
      );
      return r.rows[0]!;
    };

    try {
      // Node-aware: the real 4-arg withTenant carries NODE_A into app.node_id.
      await withTenant(
        probe,
        aware.tenantId,
        (tx) => tx.execute(insertProduct(aware.tenantId, aware.catalogueId)),
        { nodeId: NODE_A },
      );
      // Plain 3-arg: no node id supplied → capture falls back to the all-zero origin.
      await withTenant(probe, plain.tenantId, (tx) =>
        tx.execute(insertProduct(plain.tenantId, plain.catalogueId)),
      );

      const awareRow = await originFor(aware.tenantId);
      const plainRow = await originFor(plain.tenantId);

      expect(awareRow.n).toBe("1"); // captured exactly once
      expect(awareRow.origin).toBe(NODE_A); // the node-aware helper stamped the origin
      expect(plainRow.n).toBe("1");
      expect(plainRow.origin).toBe(ZERO); // the plain helper left the all-zero default
      expect(awareRow.origin).not.toBe(plainRow.origin); // the two paths visibly differ
    } finally {
      await probe.close();
    }
  });

  it("stamps a persons write's origin_id with the node id (4-arg), all-zero on the plain form", async () => {
    const awareT = await seedTenant(postgres.admin);
    const plainT = await seedTenant(postgres.admin);
    const probe = await postgres.pg.connectAs("app_login", "app_pw");
    const insertPerson = (t: string) =>
      sql`insert into persons (tenant_id, display_name, pin_hash, role)
          values (${t}, 'Ada', 'hash', 'staff')`;
    const originFor = async (t: string) => {
      const r = await postgres.admin.execute<{ n: string; origin: string | null }>(
        sql`select count(*)::text as n, max(origin_id::text) as origin
            from sync_log where table_name = 'persons' and tenant_id = ${t}`,
      );
      return r.rows[0]!;
    };
    try {
      await withTenant(probe, awareT, (tx) => tx.execute(insertPerson(awareT)), { nodeId: NODE_A });
      await withTenant(probe, plainT, (tx) => tx.execute(insertPerson(plainT)));
      const aware = await originFor(awareT);
      const plain = await originFor(plainT);
      expect(aware.origin).toBe(NODE_A);
      expect(plain.origin).toBe(ZERO);
      expect(aware.origin).not.toBe(plain.origin); // the two paths visibly differ (CLAUDE.md §1)
    } finally {
      await probe.close();
    }
  });
});
