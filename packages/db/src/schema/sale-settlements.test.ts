import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { withTenant } from "../tenancy.js";
import { invoiceSeries } from "./series.js";
import { saleLines, saleSettlements, sales, tenders } from "./sales.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * Task 1 is the DDL alone: this suite proves migration 0012 APPLIES and leaves
 * the schema in the shape the later tasks build on. It is deliberately a
 * shape/apply smoke test — every runtime behaviour of the new guards (coverage
 * on settlement, the post-settlement tender guard, sale_settlements
 * immutability, the tightened tender checks) is Task 2's behavioural matrix,
 * proved by deletion as design §7 requires.
 *
 * Real Postgres is the load-bearing target here: 0012 replaces the coverage
 * function body through a `SET ROLE sales_coverage_checker` ownership dance, and
 * a migration that fails that dance fails to apply at all. describeEachTarget
 * runs this against both PGlite and, when Docker is present, real PostgreSQL —
 * the run that matters for the role mechanics.
 */

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

describeEachTarget("sale settlements — schema shape after 0012", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("tenders gains tip_amount and its tightened/new check constraints", async () => {
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
            where table_name = 'tenders' and column_name = 'tip_amount'`,
    );
    expect(cols).toHaveLength(1);

    const checks = await rows<{ conname: string }>(
      db,
      sql`select conname from pg_constraint
            where conrelid = 'tenders'::regclass and contype = 'c'
              and conname in ('tenders_amount_ck', 'tenders_tip_amount_ck')
            order by conname`,
    );
    expect(checks.map((c) => c.conname)).toEqual(["tenders_amount_ck", "tenders_tip_amount_ck"]);
  });

  it("sale_settlements exists, is append-only, and sales lost tip_amount/amount_charged", async () => {
    const settlements = await rows<{ one: number }>(
      db,
      sql`select 1 as one from information_schema.tables where table_name = 'sale_settlements'`,
    );
    expect(settlements).toHaveLength(1);

    // Append-only: the immutability + TRUNCATE triggers must both be present.
    const guards = await rows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger
            where tgrelid = 'sale_settlements'::regclass
              and tgname in ('sale_settlements_enforce_immutability',
                             'sale_settlements_block_truncate')
            order by tgname`,
    );
    expect(guards.map((g) => g.tgname)).toEqual([
      "sale_settlements_block_truncate",
      "sale_settlements_enforce_immutability",
    ]);

    const dropped = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns
            where table_name = 'sales' and column_name in ('tip_amount', 'amount_charged')`,
    );
    expect(dropped).toEqual([]);
  });

  it("the deferred coverage triggers are gone and the new ones exist", async () => {
    const trigs = await rows<{ tgname: string }>(
      db,
      sql`select tgname from pg_trigger
            where tgname in ('sales_check_tender_coverage', 'tenders_check_tender_coverage',
                             'sale_settlements_check_coverage', 'tenders_reject_post_settlement')
            order by tgname`,
    );
    expect(trigs.map((r) => r.tgname)).toEqual([
      "sale_settlements_check_coverage",
      "tenders_reject_post_settlement",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Behavioural guard matrix (design §7 deletion table). Each guard below was
// proved by deletion LOCALLY — comment it out of 0012, watch the case fail for
// the claimed SQLSTATE, restore — before this file was committed; that
// experiment mutates the migration and is never committed. The migration on
// disk is intact.
//
// Real Postgres is the load-bearing target for the coverage guard: its function
// is SECURITY DEFINER owned by the non-superuser, non-BYPASSRLS
// sales_coverage_checker, and the cleared-tenant fail-open case can only be
// shown as a non-superuser. PGlite is a superuser on one backend, so that case
// is a false pass there and is gated to the postgres target (design §7,
// testing/harness.ts).
// ---------------------------------------------------------------------------

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
// sales.node_id is NOT NULL since the node-id rekey (2026-08-03); recordSale writes this node.
let nodeA = "";

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: TENANT_A, nif: "B00000000", legalName: "Fixture Tenant A" });
  await db.insert(locations).values({
    id: LOCATION_A,
    tenantId: TENANT_A,
    name: "Fixture Location A",
    invoiceLocales: ["es", "ca"],
    operationDescription: "Hostelería",
  });
  await db
    .insert(tills)
    .values({ id: TILL_A1, tenantId: TENANT_A, locationId: LOCATION_A, name: "A1" });
  nodeA = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_A, nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
}

/**
 * Writes a sale + one line + the given tenders, returning its id. Since 0012
 * there is no coverage check at tender INSERT (both deferred constraint triggers
 * were dropped), so the tenders here need NOT sum to anything — which is exactly
 * what lets these tests stage a mis-summed sale and only discover it at the
 * sale_settlements INSERT, where the check now lives.
 */
async function recordSale(
  db: Database,
  total: string,
  tenderRows: { method: "cash" | "card"; amount: string; tipAmount?: string }[],
): Promise<string> {
  return db.transaction(async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        tenantId: TENANT_A,
        tillId: TILL_A1,
        nodeId: nodeA,
        seriesId: seriesA,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 120,
        total,
        locale: "es",
        invoiceLocales: ["es", "ca"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      })
      .returning({ id: sales.id });
    await tx.insert(saleLines).values({
      tenantId: TENANT_A,
      saleId: sale.id,
      lineNo: 1,
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      quantity: "1.000",
      unitPrice: total,
      vatRate: "10.00",
      lineTotal: total,
    });
    await tx.insert(tenders).values(
      tenderRows.map((t) => ({
        tenantId: TENANT_A,
        saleId: sale.id,
        method: t.method,
        amount: t.amount,
        tipAmount: t.tipAmount ?? "0.00",
        settledAt: AT,
      })),
    );
    return sale.id;
  });
}

describeEachTarget("sale settlements — coverage on the settlement INSERT", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("accepts a settlement whose tenders sum to total plus tips", async () => {
    // €70 sale, paid €75 of which €5 is tip: sum(amount) 75 = total 70 + tips 5.
    // The negative control for the coverage guard — with or without the trigger,
    // this must succeed, so a deletion that made the mis-summed case pass could
    // not accidentally make THIS one start failing.
    const saleId = await recordSale(db, "70.00", [
      { method: "card", amount: "75.00", tipAmount: "5.00" },
    ]);
    const [row] = await db
      .insert(saleSettlements)
      .values({ tenantId: TENANT_A, saleId, settledAt: AT })
      .returning();
    expect(row.saleId).toBe(saleId);
  });

  it("refuses a settlement whose tenders do not sum to total plus tips", async () => {
    // €70 sale, only €50 tendered — mis-summed. Under invoice-first the shortfall
    // is legitimate until completeness is DECLARED, so it is caught here, on the
    // sale_settlements INSERT, not at sale COMMIT. The coverage RAISE carries no
    // custom ERRCODE, so the message is its interface (there is no dedicated
    // SQLSTATE to assert); a wrong-reason failure — an RLS 42501, a 23514 — would
    // not carry this text.
    const saleId = await recordSale(db, "70.00", [{ method: "cash", amount: "50.00" }]);
    const error = await captureError(() =>
      db.insert(saleSettlements).values({ tenantId: TENANT_A, saleId, settledAt: AT }),
    );
    // P0001 is plpgsql's default raise_exception code (the RAISE carries no
    // custom ERRCODE); pinning it as well as the message rules out a wrong-reason
    // failure (an RLS 42501, a 23514) whose text merely failed to match.
    expect(pgErrorCode(error)).toBe("P0001");
    expect(pgErrorMessage(error)).toMatch(/tenders for sale .* but sale\.total \+ tips is/);
  });

  it.runIf(target.name === "postgres")(
    "still refuses a mis-summed settlement when app.tenant_id is cleared before the insert",
    async () => {
      // The load-bearing test (design §7). sales_assert_tenders_cover is SECURITY
      // DEFINER owned by the non-superuser sales_coverage_checker, and reaches its
      // rows through role-scoped `USING (true)` bypass policies on sales/tenders
      // — NOT through app.tenant_id. So even with the tenant context gone (a
      // pooled-connection reset, a bug elsewhere), the check still sees the rows,
      // still sums them, and still fires. Were the bypass policies absent, the
      // cleared tenant would hide the sale row, `sale_total` would read NULL, the
      // early RETURN would be taken, and a mis-summed settlement would be declared
      // complete — fail-OPEN. Proved locally: flipping the sales bypass policy to
      // `USING (false)` in 0005_sales.sql makes exactly this test accept the
      // mis-summed settlement.
      //
      // Gated to the postgres target per design §7 — real Postgres as a genuine
      // non-superuser is the authoritative target for RLS under SECURITY DEFINER,
      // and it is where the fail-open hole was originally found. (Measured while
      // writing this: PGlite reproduces the mechanism too — the SECURITY DEFINER
      // role-switch subjects even PGlite's superuser connection to RLS as the
      // non-super owner, so the same bypass flip flips the pglite run as well —
      // but the design pins the real target, and the "refuses …" case above
      // already exercises this bypass path on BOTH targets, inserting with no
      // tenant set.)
      const saleId = await recordSale(db, "70.00", [{ method: "cash", amount: "50.00" }]);
      const error = await captureError(() =>
        db.transaction(async (tx) => {
          await tx.execute(sql`select set_config('app.tenant_id', '', true)`);
          await tx.insert(saleSettlements).values({ tenantId: TENANT_A, saleId, settledAt: AT });
        }),
      );
      expect(pgErrorCode(error)).toBe("P0001");
      expect(pgErrorMessage(error)).toMatch(/tenders for sale .* but sale\.total \+ tips is/);
    },
  );
});

describeEachTarget("sale settlements — append-only", (target) => {
  let db: Database;
  let settlementId = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    // A covered sale, so the settlement INSERT passes coverage and lands.
    const saleId = await recordSale(db, "10.00", [{ method: "card", amount: "10.00" }]);
    const [row] = await db
      .insert(saleSettlements)
      .values({ tenantId: TENANT_A, saleId, settledAt: AT })
      .returning({ id: saleSettlements.id });
    settlementId = row.id;
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("refuses to UPDATE a settlement, via the trigger backstop", async () => {
    // Owner path, asserted on SQLSTATE WT001 not wording: the message comes from
    // the shared reject_mutation() and improving it must not turn this red. The
    // app role has no UPDATE grant at all, so only the owner-path trigger covers
    // this — mirrors sales.test.ts's "stops the owner too, via the trigger backstop".
    const error = await captureError(() =>
      db
        .update(saleSettlements)
        .set({ settledAt: "2026-07-21T19:20:30+00:00" })
        .where(eq(saleSettlements.id, settlementId)),
    );
    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(
      /sale_settlements is append-only: UPDATE is not permitted/,
    );
  });

  it("refuses to DELETE a settlement, via the trigger backstop", async () => {
    const error = await captureError(() =>
      db.delete(saleSettlements).where(eq(saleSettlements.id, settlementId)),
    );
    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(
      /sale_settlements is append-only: DELETE is not permitted/,
    );
  });

  it("refuses to TRUNCATE sale_settlements, via the statement trigger", async () => {
    // Nothing references sale_settlements by a foreign key, so a bare TRUNCATE
    // reaches the BEFORE TRUNCATE statement trigger directly — no CASCADE needed,
    // unlike the sales/sale_lines/tenders trio in sales.test.ts.
    const error = await captureError(() => db.execute(sql`truncate table sale_settlements`));
    expect(pgErrorCode(error)).toBe("WT001");
    expect(pgErrorMessage(error)).toMatch(
      /sale_settlements is append-only: TRUNCATE is not permitted/,
    );
  });
});

describeEachTarget("sale settlements — no tender after settlement", (target) => {
  let db: Database;
  let saleId = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    saleId = await recordSale(db, "10.00", [{ method: "card", amount: "10.00" }]);
    await db.insert(saleSettlements).values({ tenantId: TENANT_A, saleId, settledAt: AT });
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("rejects a tender inserted after the sale is settled", async () => {
    // tenders_reject_post_settlement (WT002). A point-in-time coverage check
    // invites a later tender that would change the sum, so once a sale_settlements
    // row exists no further tender is admitted (design §5). Run as the deployment
    // role with the tenant set — the trigger is invoker-rights precisely because
    // during a real tender INSERT app.tenant_id is set (the tender's own RLS WITH
    // CHECK requires it), which is what makes the same-tenant settlement row
    // visible to the guard's EXISTS. Asserted on SQLSTATE WT002, not wording.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx
          .insert(tenders)
          .values({ tenantId: TENANT_A, saleId, method: "cash", amount: "5.00", settledAt: AT });
      }),
    );
    expect(pgErrorCode(error)).toBe("WT002");
  });
});
