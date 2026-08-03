import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { findSpanish } from "../english-only.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { asAppUser } from "../testing/roles.js";
import { describeEachTarget } from "../testing/harness.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { locations, tenants, tills } from "./tenants.js";
import { invoiceSeries } from "./series.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_A2 = "aaaaaaaa-1111-4000-8000-000000000002";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";

/**
 * Both drivers expose `.rows`, but the pglite driver returns its own Results
 * object rather than node-postgres's QueryResult. Normalising here keeps the
 * introspection tests identical across targets instead of forking on driver.
 */
async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

/** Seeds as owner, deliberately: RLS has nothing to say about the fixture. */
async function seed(db: Database): Promise<void> {
  await db.insert(tenants).values([
    { id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" },
    { id: TENANT_B, nif: "B11111111", legalName: "Fixture Tenant B" },
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
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_A2, tenantId: TENANT_A, locationId: LOCATION_A, name: "A2" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
}

describeEachTarget("invoice_series schema", (target) => {
  let db: Database;

  beforeEach(async () => {
    // No truncate before seed(): target.create() already returns a freshly
    // migrated, empty database per test (see allocate-number.test.ts's
    // beforeEach for why the truncate that used to run here was always a
    // no-op, and why Task 8 made it an active problem rather than harmless
    // boilerplate).
    db = await target.create();
    await seed(db);
  });

  // This package's convention (see tenancy.test.ts): without it, a pg Pool
  // per test is left open when the postgres target's container stops at
  // describe-level teardown, and it surfaces as an unhandled FATAL 57P01
  // rejection rather than a test failure.
  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("holds several series on one till", async () => {
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard", nextNumber: 1 },
      { tenantId: TENANT_A, tillId: TILL_A1, code: "RA", purpose: "rectificative", nextNumber: 1 },
    ]);
    const found = await db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.tillId, TILL_A1));
    expect(found.map((r) => r.code).sort()).toEqual(["FA", "RA"]);
  });

  it("rejects a duplicate code on the same till", async () => {
    // Not `.rejects.toThrow(/pattern/)`: drizzle-orm@0.45.2 wraps every failed
    // query in a DrizzleQueryError whose own `.message` is
    // `Failed query: <sql>` — the real Postgres text lives on `.cause`
    // (see tenancy.test.ts's `rejectsWithCauseMatching` for the same finding).
    // `toThrow` only reads `.message`, so it would pass against any rejection
    // at all, not specifically this one.
    await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" });
    const error = await captureError(() =>
      db
        .insert(invoiceSeries)
        .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" }),
    );
    expect(pgErrorMessage(error)).toMatch(/duplicate key value/);
  });

  it("permits the same code on two different tills", async () => {
    // Series codes are a per-till numbering concern. Two tills in one venue
    // both running series "FA" is normal, and their numbers are independent.
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" },
      { tenantId: TENANT_A, tillId: TILL_A2, code: "FA", purpose: "standard" },
    ]);
    const found = await db.select({ id: invoiceSeries.id }).from(invoiceSeries);
    expect(found).toHaveLength(2);
  });

  it("rejects a purpose outside the permitted set", async () => {
    // Same wrapper issue as the duplicate-code test above: match the
    // unwrapped Postgres message, not the DrizzleQueryError's own.
    const error = await captureError(() =>
      db
        .insert(invoiceSeries)
        .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "XX", purpose: "invented" }),
    );
    expect(pgErrorMessage(error)).toMatch(/invoice_series_purpose_ck/);
  });

  it("has no column relating a series to a chain", async () => {
    // Findings §1: series is a numbering concern, the chain is a device
    // concern. A column named for chain position here would be the first step
    // towards per-series chaining, which AEAT art. 7.c) forbids outright.
    //
    // The Spanish half of this check reuses english-only.ts's own
    // `findSpanish` (Task 3) rather than a hand-picked regex of Spanish roots
    // written out here: the words that check exists to police
    // ("cadena", "secuencia", "huella", "registro" among them) are exactly
    // the words that guard's own suite scans every file in this package for,
    // this file included — writing them out again as a literal regex would
    // fail this package's own English-only build. Reusing the canonical list
    // also means it cannot drift from the one `english-only.test.ts` proves
    // against real Spanish source.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'invoice_series'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /chain/i.test(n) || findSpanish(n).length > 0);
    expect(offenders).toEqual([]);
  });

  it("carries a nullable node_id column referencing nodes", async () => {
    // Node rekey scaffolding (Task 3): node_id is added NULLABLE with a plain FK to `nodes`.
    // Nothing writes it yet; a later task populates it and flips (sales, registros) NOT NULL.
    // Raw SQL for the inserts so a pre-migration run fails on the real cause ("column node_id
    // does not exist") rather than a drizzle column-object error — the same reason
    // sales.test.ts's corrective-link tests use a raw insertSale().
    const node = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const meta = await rows<{ is_nullable: string }>(
      db,
      sql`select is_nullable from information_schema.columns
           where table_name = 'invoice_series' and column_name = 'node_id'`,
    );
    expect(meta).toEqual([{ is_nullable: "YES" }]);
    // Accepts a valid node id.
    const withNode = await rows<{ node_id: string | null }>(
      db,
      sql`insert into invoice_series (tenant_id, till_id, code, node_id)
           values (${TENANT_A}, ${TILL_A1}, 'FN', ${node}) returning node_id`,
    );
    expect(withNode).toEqual([{ node_id: node }]);
    // And a row inserts fine WITHOUT it (nullable).
    const withoutNode = await rows<{ node_id: string | null }>(
      db,
      sql`insert into invoice_series (tenant_id, till_id, code)
           values (${TENANT_A}, ${TILL_A1}, 'FM') returning node_id`,
    );
    expect(withoutNode).toEqual([{ node_id: null }]);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // The plain FK guarantees referential existence: a node id with no `nodes` row is refused.
    const error = await captureError(() =>
      db.execute(
        sql`insert into invoice_series (tenant_id, till_id, code, node_id)
             values (${TENANT_A}, ${TILL_A1}, 'FX', '99999999-9999-4999-8999-999999999999')`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/violates foreign key constraint/);
  });

  it("has no unique constraint on (tenant_id, till_id) alone", async () => {
    // The subtle coupling: a unique index on the pair would silently reimpose
    // one series per till, which is the thing N-series-from-day-one exists to
    // avoid. It reads as a harmless index, so only a test catches it.
    const found = await rows<{ indexdef: string }>(
      db,
      sql`select indexdef from pg_indexes where tablename = 'invoice_series'`,
    );
    const pairOnly = found.filter(
      (i) => /UNIQUE/i.test(i.indexdef) && /\(tenant_id, till_id\)/.test(i.indexdef),
    );
    expect(pairOnly).toEqual([]);
  });

  it("hides another tenant's series from the app role", async () => {
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" },
      { tenantId: TENANT_B, tillId: TILL_B1, code: "FB", purpose: "standard" },
    ]);
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ code: invoiceSeries.code }).from(invoiceSeries);
    });
    expect(visible.map((r) => r.code)).toEqual(["FA"]);
  });

  it("grants the app role UPDATE on next_number and on no other column", async () => {
    // The one relaxation of Task 5's blanket revocation in this plan, and it
    // is scoped to a single column. Asserted by introspection rather than by
    // trying each column in turn: a new column added later is caught by this
    // test without anyone remembering to extend a list.
    // `db.execute()` returns `{ rows }`, never the row array itself (see
    // client.ts's `SharedQueryResultHKT` and the `rows()` helper above) — a
    // bare `.map()` on the result throws `TypeError: ... is not a function`
    // rather than silently misreporting, which is why this uses the same
    // helper the other introspection tests in this file already do.
    const granted = await rows<{ column_name: string }>(
      db,
      sql`
        select column_name from information_schema.column_privileges
        where table_name = 'invoice_series'
          and grantee = 'app_user'
          and privilege_type = 'UPDATE'
        order by column_name
      `,
    );
    expect(granted.map((r) => r.column_name)).toEqual(["next_number"]);
  });

  it("refuses an UPDATE of any other column as the app role", async () => {
    // next_number moves; the series' identity does not. A blanket UPDATE would
    // let the application retarget a series at another till, which the audit
    // trail assumes is stable.
    const [series] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    // Same wrapper issue: match the unwrapped Postgres message.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(invoiceSeries).set({ code: "ZZ" }).where(eq(invoiceSeries.id, series.id));
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table invoice_series/);
  });

  it("permits an UPDATE of next_number as the app role", async () => {
    // The counterpart to the test above, and the reason allocation can run
    // outside the owner role at all.
    const [series] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, tillId: TILL_A1, code: "FA", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    await expect(
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx
          .update(invoiceSeries)
          .set({ nextNumber: 9999 })
          .where(eq(invoiceSeries.id, series.id));
      }),
    ).resolves.not.toThrow();
  });
});
