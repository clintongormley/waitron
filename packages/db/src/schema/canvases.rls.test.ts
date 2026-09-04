import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

// Real Postgres, not PGlite: this suite proves canvases' tenant-isolation policy as the
// NON-OWNER app role. It writes and reads under withTenant + asAppUser, so the INSERT exercises the
// table-level GRANT (0089) and the WITH CHECK half of canvases_tenant_isolation, and the
// SELECT exercises the USING half. PGlite connects as a superuser that bypasses FORCE ROW LEVEL
// SECURITY and the policy, so the same assertions there would be a false pass (CLAUDE.md §4). The
// FORCE flag itself is proven by the fiscal-verifactu `inmutabilidad` metadata scan, which is the
// only guard that can see it — as the owner is a superuser in this harness, removing FORCE leaves
// this behavioural suite green. Mirrors tenant-themes.rls.test.ts. canvases is DELETABLE (canvases
// come and go), so this suite also proves the DELETE grant, which the replace-in-place config tables
// (tenant_themes / tenant_receipts) deliberately lack.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("canvases under real row-level security", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
  });

  it("isolates a tenant's canvas: the owner reads its rows, another tenant sees none", async () => {
    // Write tenant A's canvas as the app role under A's GUC (the grant + the policy's WITH CHECK),
    // then read it back under the same GUC (the grant + the policy's USING). Raw SQL so the RED phase
    // fails on `relation "canvases" does not exist` — the real cause — rather than a drizzle
    // schema mismatch.
    const own = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into canvases (tenant_id, name, definition)
        values (${TENANT_A}, 'Front counter', '{}'::jsonb)`);
      const result = await tx.execute<{ tenant_id: string; name: string }>(
        sql`select tenant_id, name from canvases`,
      );
      return result.rows;
    });
    // The positive read is load-bearing: without it, B's empty result below could equally mean the
    // app role has no access to the table at all — hiding nothing is not hiding something.
    expect(own).toEqual([{ tenant_id: TENANT_A, name: "Front counter" }]);

    // The SAME app role, holding the SAME SELECT grant, scoped to tenant B, sees NONE of A's row —
    // the USING predicate filters it out.
    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ tenant_id: string }>(sql`select tenant_id from canvases`);
    });
    expect(seenByB.rows).toEqual([]);
  });

  it("lets the app role UPDATE and DELETE its own tenant's canvases (the full grant)", async () => {
    // canvases carries GRANT SELECT, INSERT, UPDATE, DELETE — canvases are mutable AND
    // deletable, unlike the replace-in-place config tables (tenant_themes, no DELETE). Exercise UPDATE
    // then DELETE as the app role under
    // its own GUC so both the grant verbs and the policy's USING+WITH CHECK are on the path.
    const tenantId = "33333333-3333-4333-8333-333333333333";
    await suite.admin.insert(tenants).values({
      id: tenantId,
      country: "ES",
      taxId: "B22222222",
      legalName: "Fixture Tenant C",
    });
    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into canvases (tenant_id, name, definition)
        values (${tenantId}, 'Bar', '{"v":1}'::jsonb)`);
      await tx.execute(
        sql`update canvases set definition = '{"v":2}'::jsonb where tenant_id = ${tenantId}`,
      );
      const updated = await tx.execute<{ definition: unknown }>(
        sql`select definition from canvases where tenant_id = ${tenantId}`,
      );
      expect(updated.rows).toEqual([{ definition: { v: 2 } }]);
      await tx.execute(sql`delete from canvases where tenant_id = ${tenantId}`);
      const after = await tx.execute<{ n: number }>(
        sql`select count(*)::int as n from canvases where tenant_id = ${tenantId}`,
      );
      expect(after.rows).toEqual([{ n: 0 }]);
    });
  });

  it("refuses an INSERT carrying another tenant's id — the WITH CHECK half of the policy", async () => {
    // Under A's GUC the app role attempts to write a row stamped with tenant B's id; tenant B EXISTS
    // (seeded), so the FK is satisfied and the only thing that can reject the write is the policy's
    // WITH CHECK (tenant_id = current_tenant_id() → B = A → false). SQLSTATE 42501: new row violates
    // row-level security policy. Deleting the WITH CHECK clause from 0089 lets this write land.
    const error = await captureError(() =>
      withTenant(suite.admin, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`
          insert into canvases (tenant_id, name, definition)
          values (${TENANT_B}, 'Sneaky', '{}'::jsonb)`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("proves the isolation predicate is load-bearing: neutralise it and A's row leaks to B", async () => {
    // Prove-by-deletion (CLAUDE.md §4). Dropping the policy would NOT leak — PostgreSQL default-denies
    // an RLS-enabled table with no policy, so the app role would then read ZERO rows (its own
    // included). The mutation that actually LEAKS is neutralising the USING predicate to `true`,
    // which is exactly what a wrong policy looks like. Seed A's row, confirm B sees none under the
    // real predicate, swap the predicate to `true` as the owner, watch B read A's row, then restore.
    // try/finally guarantees the real predicate is back even if an assertion throws, so later tests
    // in this shared suite are unaffected.
    const leakA = "44444444-4444-4444-8444-444444444444";
    const leakB = "55555555-5555-4555-8555-555555555555";
    await suite.admin.insert(tenants).values([
      { id: leakA, country: "ES", taxId: "B33333333", legalName: "Fixture Tenant D" },
      { id: leakB, country: "ES", taxId: "B44444444", legalName: "Fixture Tenant E" },
    ]);
    await withTenant(suite.admin, leakA, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into canvases (tenant_id, name, definition)
        values (${leakA}, 'Isolated', '{}'::jsonb)`);
    });
    const isolated = await withTenant(suite.admin, leakB, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ tenant_id: string }>(
        sql`select tenant_id from canvases where tenant_id = ${leakA}`,
      );
    });
    expect(isolated.rows).toEqual([]); // the real predicate isolates A from B

    try {
      // Neutralise the policy predicate as the owner. This is the "deletion" — the isolation logic
      // is gone, replaced by a policy that admits every row.
      await suite.admin.execute(sql`
        alter policy canvases_tenant_isolation on canvases
        using (true) with check (true)`);
      const leaked = await withTenant(suite.admin, leakB, async (tx) => {
        await asAppUser(tx);
        return tx.execute<{ tenant_id: string }>(
          sql`select tenant_id from canvases where tenant_id = ${leakA}`,
        );
      });
      expect(leaked.rows).toEqual([{ tenant_id: leakA }]); // B now reads A's row — the leak
    } finally {
      // Restore the real tenant-isolation predicate for the rest of the suite.
      await suite.admin.execute(sql`
        alter policy canvases_tenant_isolation on canvases
        using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())`);
    }
  });
});
