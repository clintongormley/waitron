import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants, tills } from "./tenants.js";
import { incidents } from "./incidents.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B = "bbbbbbbb-1111-4000-8000-000000000001";
const DETECTED_AT = "2026-07-21T10:00:00+00:00";

/**
 * Both drivers expose `.rows`, but the pglite driver returns its own Results object rather than
 * node-postgres's QueryResult. Normalising here keeps the introspection tests identical across
 * targets, mirroring series.test.ts's/orders.test.ts's identical helper.
 */
async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/** Seeds as owner, deliberately: RLS has nothing to say about the fixture. */
async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, country: "ES", taxId: "B11111111", legalName: "Fixture Tenant B" },
  ]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      tenantId: TENANT_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
    {
      id: LOCATION_B,
      tenantId: TENANT_B,
      name: "Fixture Location B",
      invoiceLocales: ["es"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([
    { id: TILL_A, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_B, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
}

/**
 * This file exists because of a structural gap the mechanical guard in `../immutability.test.ts`
 * cannot see: that guard discovers its targets by finding every table carrying a
 * `reject_mutation()` trigger, and `incidents` correctly has none — it is mutable, not
 * append-only. Its cross-tenant isolation and its column-scoped grant therefore have no other
 * test asserting them, which is the same gap `invoice_series` (`series.test.ts`) and
 * `working_order_lines` (`orders.test.ts`) already close for themselves the same way: a direct
 * test in this package, rather than reliance on the generic trigger-discovery sweep.
 */
describeEachTarget("incidents schema", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("hides another tenant's incidents from the app role", async () => {
    // No WHERE clause anywhere in this query — if the test scoped the read itself, it would pass
    // with RLS switched off. Teeth check performed manually during development: stripping the
    // `ALTER TABLE incidents ENABLE/FORCE ROW LEVEL SECURITY` lines from the privileges migration
    // makes this test fail (tenant B's row leaks through), confirming the guard bites.
    await db.insert(incidents).values([
      {
        tenantId: TENANT_A,
        tillId: TILL_A,
        code: "chain.verification_failed",
        severity: "error",
        detectedAt: DETECTED_AT,
      },
      {
        tenantId: TENANT_B,
        tillId: TILL_B,
        code: "chain.verification_failed",
        severity: "error",
        detectedAt: DETECTED_AT,
      },
    ]);

    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ tenantId: incidents.tenantId }).from(incidents);
    });

    expect(visible).toHaveLength(1);
    expect(visible[0]?.tenantId).toBe(TENANT_A);
  });

  it("requires ENABLE and FORCE ROW LEVEL SECURITY", async () => {
    // Silently inert without ENABLE, proven repeatedly this plan (immutability.test.ts's own
    // identical introspection query for the trigger-bearing tables). incidents carries no
    // reject_mutation trigger, so it never appears in that discovery sweep — asserted directly
    // here instead.
    const found = await rows<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      db,
      sql`select relrowsecurity, relforcerowsecurity from pg_class where relname = 'incidents'`,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.relrowsecurity).toBe(true);
    expect(found[0]?.relforcerowsecurity).toBe(true);
  });

  it("permits SELECT and INSERT from the app role", async () => {
    // The positive control every rejection test below needs: a REVOKE ALL with no
    // corresponding GRANT would satisfy every rejection assertion in this file for the wrong
    // reason.
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.insert(incidents).values({
          tenantId: TENANT_A,
          tillId: TILL_A,
          code: "clock.degraded",
          severity: "warning",
          detectedAt: DETECTED_AT,
        });
      }),
    ).resolves.not.toThrow();

    const [row] = await db.select().from(incidents);
    expect(row?.code).toBe("clock.degraded");
  });

  it("grants the app role UPDATE on acknowledged_at and acknowledged_by, and no other column", async () => {
    // The one relaxation of Task 5's blanket-revocation convention this table carries, scoped to
    // exactly two columns. Asserted by introspection so a column added later is caught without
    // anyone remembering to extend a hand-written list.
    const granted = await rows<{ column_name: string }>(
      db,
      sql`
        select column_name from information_schema.column_privileges
        where table_name = 'incidents'
          and grantee = 'app_user'
          and privilege_type = 'UPDATE'
        order by column_name
      `,
    );
    expect(granted.map((r) => r.column_name)).toEqual(["acknowledged_at", "acknowledged_by"]);
  });

  it("refuses to rewrite code or severity as the app role", async () => {
    const [row] = await db
      .insert(incidents)
      .values({
        tenantId: TENANT_A,
        tillId: TILL_A,
        code: "chain.verification_failed",
        severity: "error",
        detectedAt: DETECTED_AT,
      })
      .returning({ id: incidents.id });

    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx
          .update(incidents)
          .set({ code: "nothing.happened" })
          .where(eq(incidents.id, row!.id));
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table incidents/);
  });

  it("permits acknowledging an incident as the app role", async () => {
    // The counterpart to the rejection above, and the reason a till can acknowledge an incident
    // at all.
    const [row] = await db
      .insert(incidents)
      .values({
        tenantId: TENANT_A,
        tillId: TILL_A,
        code: "chain.verification_failed",
        severity: "error",
        detectedAt: DETECTED_AT,
      })
      .returning({ id: incidents.id });

    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx
          .update(incidents)
          .set({ acknowledgedAt: new Date().toISOString() })
          .where(eq(incidents.id, row!.id));
      }),
    ).resolves.not.toThrow();
  });
});
