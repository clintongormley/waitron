import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureError, pgErrorCode } from "../testing/errors.js";
import { useTemplateDb } from "../testing/lifecycle.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { tenants } from "./tenants.js";

// Real Postgres, not PGlite: this suite proves tenant_receipts' tenant-isolation policy as the
// NON-OWNER app role. It writes and reads under withTenant + asAppUser, so the INSERT exercises the
// table-level GRANT (0104) and the WITH CHECK half of tenant_receipts_tenant_isolation, and the SELECT
// exercises the USING half. PGlite connects as a superuser that bypasses FORCE ROW LEVEL SECURITY and
// the policy, so the same assertions there would be a false pass (CLAUDE.md §4). The FORCE flag itself
// is proven by the fiscal-verifactu `inmutabilidad` metadata scan, which is the only guard that can
// see it. Mirrors tenant-themes.rls.test.ts (tenant_themes): ONE row per tenant (tenant_id PK), MUTABLE
// config replaced in place — grants SELECT/INSERT/UPDATE, no DELETE.

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("tenant_receipts under real row-level security", () => {
  const suite = useTemplateDb({ template: "core" });

  beforeAll(async () => {
    await suite.admin.insert(tenants).values([
      { id: TENANT_A, country: "ES", taxId: "B90000000", legalName: "Fixture Tenant A" },
      { id: TENANT_B, country: "ES", taxId: "B91111111", legalName: "Fixture Tenant B" },
    ]);
  });

  it("isolates a tenant's receipt: the owner reads its row, another tenant sees none", async () => {
    // Write tenant A's one row as the app role under A's GUC (the grant + the policy's WITH CHECK),
    // then read it back under the same GUC (the grant + the policy's USING). Raw SQL so the RED phase
    // fails on `relation "tenant_receipts" does not exist` — the real cause — rather than a drizzle
    // schema mismatch.
    const own = await withTenant(suite.admin, TENANT_A, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into tenant_receipts (tenant_id, receipt)
        values (${TENANT_A}, '{"headerSubtitle":"Hola"}'::jsonb)`);
      const result = await tx.execute<{ tenant_id: string }>(
        sql`select tenant_id from tenant_receipts`,
      );
      return result.rows;
    });
    // The positive read is load-bearing: without it, B's empty result below could equally mean the
    // app role has no access to the table at all — hiding nothing is not hiding something.
    expect(own).toEqual([{ tenant_id: TENANT_A }]);

    // The SAME app role, holding the SAME SELECT grant, scoped to tenant B, sees NONE of A's row —
    // the USING predicate filters it out.
    const seenByB = await withTenant(suite.admin, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ tenant_id: string }>(sql`select tenant_id from tenant_receipts`);
    });
    expect(seenByB.rows).toEqual([]);
  });

  it("lets the app role UPDATE its own tenant's receipt in place (INSERT then UPDATE grant)", async () => {
    // tenant_receipts carries GRANT SELECT, INSERT, UPDATE — config replaced in place, no DELETE (the
    // tenant_themes shape). Insert then update as the app role under its own GUC so the grant verbs and
    // the policy's USING+WITH CHECK are on the path.
    const tenantId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await suite.admin.insert(tenants).values({
      id: tenantId,
      country: "ES",
      taxId: "B92222222",
      legalName: "Fixture Tenant C",
    });
    await withTenant(suite.admin, tenantId, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into tenant_receipts (tenant_id, receipt)
        values (${tenantId}, '{"footerMessage":"Gracias"}'::jsonb)`);
      await tx.execute(
        sql`update tenant_receipts set receipt = '{"footerMessage":"Adios"}'::jsonb where tenant_id = ${tenantId}`,
      );
      const updated = await tx.execute<{ receipt: unknown }>(
        sql`select receipt from tenant_receipts where tenant_id = ${tenantId}`,
      );
      expect(updated.rows).toEqual([{ receipt: { footerMessage: "Adios" } }]);
    });
  });

  it("refuses an INSERT carrying another tenant's id — the WITH CHECK half of the policy", async () => {
    // Under A's GUC the app role attempts to write a row stamped with tenant B's id; tenant B EXISTS
    // (seeded), so the FK is satisfied and the only thing that can reject the write is the policy's
    // WITH CHECK (tenant_id = current_tenant_id() → B = A → false). SQLSTATE 42501: new row violates
    // row-level security policy. Deleting the WITH CHECK clause from 0104 lets this write land.
    const error = await captureError(() =>
      withTenant(suite.admin, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.execute(sql`
          insert into tenant_receipts (tenant_id, receipt)
          values (${TENANT_B}, '{}'::jsonb)`);
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
  });

  it("proves the isolation predicate is load-bearing: neutralise it and A's row leaks to B", async () => {
    // Prove-by-deletion (CLAUDE.md §4). Dropping the policy would NOT leak — PostgreSQL default-denies
    // an RLS-enabled table with no policy, so the app role would then read ZERO rows (its own
    // included). The mutation that actually LEAKS is neutralising the USING predicate to `true`, which
    // is exactly what a wrong policy looks like. Seed A's row, confirm B sees none under the real
    // predicate, swap the predicate to `true` as the owner, watch B read A's row, then restore.
    // try/finally guarantees the real predicate is back even if an assertion throws.
    const leakA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const leakB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    await suite.admin.insert(tenants).values([
      { id: leakA, country: "ES", taxId: "B93333333", legalName: "Fixture Tenant D" },
      { id: leakB, country: "ES", taxId: "B94444444", legalName: "Fixture Tenant E" },
    ]);
    await withTenant(suite.admin, leakA, async (tx) => {
      await asAppUser(tx);
      await tx.execute(sql`
        insert into tenant_receipts (tenant_id, receipt) values (${leakA}, '{}'::jsonb)`);
    });
    const isolated = await withTenant(suite.admin, leakB, async (tx) => {
      await asAppUser(tx);
      return tx.execute<{ tenant_id: string }>(
        sql`select tenant_id from tenant_receipts where tenant_id = ${leakA}`,
      );
    });
    expect(isolated.rows).toEqual([]); // the real predicate isolates A from B

    try {
      await suite.admin.execute(sql`
        alter policy tenant_receipts_tenant_isolation on tenant_receipts
        using (true) with check (true)`);
      const leaked = await withTenant(suite.admin, leakB, async (tx) => {
        await asAppUser(tx);
        return tx.execute<{ tenant_id: string }>(
          sql`select tenant_id from tenant_receipts where tenant_id = ${leakA}`,
        );
      });
      expect(leaked.rows).toEqual([{ tenant_id: leakA }]); // B now reads A's row — the leak
    } finally {
      await suite.admin.execute(sql`
        alter policy tenant_receipts_tenant_isolation on tenant_receipts
        using (tenant_id = current_tenant_id()) with check (tenant_id = current_tenant_id())`);
    }
  });
});
