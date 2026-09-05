import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { SPANISH_WORDS, findSpanish } from "../english-only.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
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

// A series is keyed on its NODE since the node-id rekey (2026-08-03): invoice_series dropped
// till_id and now carries a NOT NULL node_id. seed() creates two nodes for tenant A (so the
// per-node uniqueness tests have a second node to collide against) and one for tenant B. The tills
// stay seeded — sales still ring on a till — but nothing in invoice_series references them.
let nodeA1 = "";
let nodeA2 = "";
let nodeB1 = "";

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
    { id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" },
    { id: TILL_A2, tenantId: TENANT_A, locationId: LOCATION_A, name: "A2" },
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
  nodeA1 = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  nodeA2 = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  nodeB1 = await seedNode(db, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
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

  it("holds several series on one node", async () => {
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard", nextNumber: 1 },
      { tenantId: TENANT_A, nodeId: nodeA1, code: "RA", purpose: "rectificative", nextNumber: 1 },
    ]);
    const found = await db
      .select({ code: invoiceSeries.code })
      .from(invoiceSeries)
      .where(eq(invoiceSeries.nodeId, nodeA1));
    expect(found.map((r) => r.code).sort()).toEqual(["FA", "RA"]);
  });

  it("rejects a duplicate code on the same node", async () => {
    // Not `.rejects.toThrow(/pattern/)`: drizzle-orm@0.45.2 wraps every failed
    // query in a DrizzleQueryError whose own `.message` is
    // `Failed query: <sql>` — the real Postgres text lives on `.cause`
    // (see tenancy.test.ts's `rejectsWithCauseMatching` for the same finding).
    // `toThrow` only reads `.message`, so it would pass against any rejection
    // at all, not specifically this one.
    await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard" });
    const error = await captureError(() =>
      db
        .insert(invoiceSeries)
        .values({ tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard" }),
    );
    expect(pgErrorMessage(error)).toMatch(/duplicate key value/);
  });

  it("permits the same code on two different nodes", async () => {
    // Series codes are a per-node numbering concern (node-id rekey, 2026-08-03). Two nodes in one
    // venue both running series "FA" is normal, and their numbers are independent.
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard" },
      { tenantId: TENANT_A, nodeId: nodeA2, code: "FA", purpose: "standard" },
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
        .values({ tenantId: TENANT_A, nodeId: nodeA1, code: "XX", purpose: "invented" }),
    );
    expect(pgErrorMessage(error)).toMatch(/invoice_series_purpose_ck/);
  });

  it("has no column relating a series to a chain, and exactly the columns it has today", async () => {
    // Findings §1: series is a numbering concern, the chain is a device concern. A column named for
    // chain position here would be the first step towards per-series chaining, which AEAT art. 7.c)
    // forbids outright.
    //
    // The chain terms are the regime-neutral English ones. Fiscal's own Spanish terms are fiscal's to
    // declare (its module's `vocabulary` seat), not this package's to know — the tree guard
    // (scripts/english-only.test.ts) catches a Spanish column NAME in this package's schema source
    // with the assembled set, and `SPANISH_WORDS` here is only the base list this package can
    // legitimately see. What the exact-column pin adds is the case neither reaches: a column added by
    // hand-written SQL in drizzle/, which no source scan sees. A new column is a deliberate edit here.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'invoice_series'`,
    );
    const names = cols.map((c) => c.column_name).sort();
    const offenders = names.filter(
      (n) =>
        /chain|hash|previous|link|sequence/i.test(n) || findSpanish(n, SPANISH_WORDS).length > 0,
    );
    expect(offenders).toEqual([]);
    expect(names).toEqual(["code", "id", "next_number", "node_id", "purpose", "tenant_id"]);
  });

  it("carries a NOT NULL node_id column referencing nodes", async () => {
    // Node-id rekey (2026-08-03): node_id is now NOT NULL — a series is OWNED by a node (its SIF).
    // This supersedes Task 3's scaffolding assertion that the column was nullable. Raw SQL for the
    // inserts so a mis-migrated run fails on the real cause rather than a drizzle column-object error
    // — the same reason sales.test.ts's corrective-link tests use a raw insert.
    const node = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
    const meta = await rows<{ is_nullable: string }>(
      db,
      sql`select is_nullable from information_schema.columns
           where table_name = 'invoice_series' and column_name = 'node_id'`,
    );
    expect(meta).toEqual([{ is_nullable: "NO" }]);
    // Accepts a valid node id.
    const withNode = await rows<{ node_id: string | null }>(
      db,
      sql`insert into invoice_series (tenant_id, node_id, code)
           values (${TENANT_A}, ${node}, 'FN') returning node_id`,
    );
    expect(withNode).toEqual([{ node_id: node }]);
    // And a row WITHOUT it is now refused (NOT NULL), the flip Task 4 introduces.
    const error = await captureError(() =>
      db.execute(sql`insert into invoice_series (tenant_id, code) values (${TENANT_A}, 'FM')`),
    );
    expect(pgErrorMessage(error)).toMatch(/null value in column "node_id"|not-null/i);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // The composite (tenant_id, node_id) FK guarantees referential existence too: a node id with
    // no `nodes` row is refused.
    const error = await captureError(() =>
      db.execute(
        sql`insert into invoice_series (tenant_id, node_id, code)
             values (${TENANT_A}, '99999999-9999-4999-8999-999999999999', 'FX')`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/violates foreign key constraint/);
  });

  it("rejects a node_id belonging to another tenant with a foreign-key violation", async () => {
    // The composite (tenant_id, node_id) → nodes(tenant_id, id) FK bites: nodeB1 EXISTS but under
    // TENANT_B, so the (TENANT_A, nodeB1) pair has no matching parent row and the insert is
    // rejected 23503. node_id here is NOT NULL, so this composite FK ALWAYS checks — the strongest
    // tenant-consistency, and the fiscally load-bearing one (the series↔node guard reads
    // series.node_id). This is what a plain single-column node_id FK could NOT enforce — it would
    // have accepted the cross-tenant node because the id exists in `nodes`. Mirrors `sales_node_fk`
    // / `working_orders_node_fk` / `payments_node_fk`.
    const error = await captureError(() =>
      db.execute(
        sql`insert into invoice_series (tenant_id, node_id, code)
             values (${TENANT_A}, ${nodeB1}, 'FX')`,
      ),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("has no unique constraint on (tenant_id, node_id) alone", async () => {
    // The subtle coupling: a unique index on the pair would silently reimpose
    // one series per node, which is the thing N-series-from-day-one exists to
    // avoid (node-id rekey, 2026-08-03: the pair moved from till to node). It
    // reads as a harmless index, so only a test catches it.
    const found = await rows<{ indexdef: string }>(
      db,
      sql`select indexdef from pg_indexes where tablename = 'invoice_series'`,
    );
    const pairOnly = found.filter(
      (i) => /UNIQUE/i.test(i.indexdef) && /\(tenant_id, node_id\)/.test(i.indexdef),
    );
    expect(pairOnly).toEqual([]);
  });

  it("hides another tenant's series from the app role", async () => {
    await db.insert(invoiceSeries).values([
      { tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard" },
      { tenantId: TENANT_B, nodeId: nodeB1, code: "FB", purpose: "standard" },
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
    // let the application retarget a series at another node, which the audit
    // trail assumes is stable.
    const [series] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard" })
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
      .values({ tenantId: TENANT_A, nodeId: nodeA1, code: "FA", purpose: "standard" })
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
