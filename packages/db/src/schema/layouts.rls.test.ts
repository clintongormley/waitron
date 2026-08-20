import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

// Real Postgres, not PGlite: this suite proves till_layouts' tenant-isolation policy as the NON-OWNER
// app role. It writes and reads under withTenant + asAppUser, so the INSERT exercises the table-level
// GRANT (0036) and the WITH CHECK half of till_layouts_tenant_isolation, and the SELECT exercises the
// USING half. PGlite connects as a superuser that bypasses FORCE ROW LEVEL SECURITY and the policy, so
// the same assertions there would be a false pass (CLAUDE.md §4). The FORCE flag itself is proven by
// the fiscal-verifactu `inmutabilidad` metadata scan, which is the only guard that can see it — as the
// owner is a superuser in this harness, removing FORCE leaves this behavioural suite green (the same
// reason sessions' 0003 records for its own FORCE line). Mirrors catalogue.rls.test.ts.

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("till_layouts under real row-level security", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
    ]);
  });

  it("isolates a tenant's layout: the owning tenant reads its row, another tenant sees none", async () => {
    // Write tenant A's one row as the app role under A's GUC (the grant + the policy's WITH CHECK),
    // then read it back under the same GUC (the grant + the policy's USING). Raw SQL so the RED phase
    // fails on `relation "till_layouts" does not exist` — the real cause — rather than a drizzle
    // schema mismatch.
    const own = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into till_layouts (tenant_id, definition, receipt)
        values (${TENANT_A}, '[]'::jsonb, '{}'::jsonb)`);
      const result = await tx.execute<{ tenant_id: string }>(
        sql`select tenant_id from till_layouts`,
      );
      return result.rows;
    });
    // The positive read is load-bearing: without it, B's empty result below could equally mean the
    // app role has no access to the table at all — hiding nothing is not hiding something.
    expect(own).toEqual([{ tenant_id: TENANT_A }]);

    // The SAME app role, holding the SAME SELECT grant, scoped to tenant B, sees NONE of A's row —
    // the USING predicate filters it out. Drops to a false read if asAppUser is removed: a superuser
    // bypasses the policy and would see A's row from B's GUC.
    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ tenant_id: string }>(sql`select tenant_id from till_layouts`);
    });
    expect(seenByB.rows).toEqual([]);
  });

  it("refuses an INSERT carrying another tenant's id — the WITH CHECK half of the policy", async () => {
    // The negative the sibling management_sessions.rls / sessions.rls suites lack. Under A's GUC the
    // app role attempts to write a row stamped with tenant B's id; tenant B EXISTS (seeded), so the
    // FK is satisfied and the only thing that can reject the write is the policy's WITH CHECK
    // (tenant_id = current_tenant_id() → B = A → false). SQLSTATE 42501: new row violates row-level
    // security policy. Deleting the WITH CHECK clause from 0036 lets this write land, so this is the
    // assertion that guards it.
    const error = await captureError(() =>
      withTenant(suite.admin, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`
          insert into till_layouts (tenant_id, definition, receipt)
          values (${TENANT_B}, '[]'::jsonb, '{}'::jsonb)`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });
});
