import { locationId as brandLocationId, tenantId as brandTenantId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { withTenant } from "../tenancy.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { asAppUser } from "../testing/roles.js";
import { seedNode } from "../testing/seed.js";
import { saleLines, saleSettlements, sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * Checks settlement schema shape, coverage on settlement, the post-settlement tender guard,
 * immutability and tender constraints. The behavioural matrix below pins each guard's refusal.
 */

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

describeEachTarget("sale settlements — schema shape", (target) => {
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

// Behavioural guard matrix, proved by deletion (design §7); see the matrix header this file
// carried before the baseline squash in its git history.
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
// sales.node_id is NOT NULL; recordSale writes this node.
let nodeA = "";

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: TENANT_A, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" });
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
 * Writes a sale, one line and the given tenders, returning its id. Coverage is checked on
 * sale_settlements INSERT, so this fixture can stage a shortfall before declaring settlement.
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
        // The filed per-rate desglose; `[]` — this file stages mis-summed
        // settlements, not the breakdown, and the column just needs a valid NOT NULL jsonb array.
        vatBreakdown: [],
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
    const saleId = await recordSale(db, "70.00", [{ method: "cash", amount: "50.00" }]);
    const error = await captureError(() =>
      db.insert(saleSettlements).values({ tenantId: TENANT_A, saleId, settledAt: AT }),
    );
    // P0001 is the default PL/pgSQL RAISE code. Pin it and the coverage message so a privilege
    // denial (42501) or CHECK failure (23514) cannot pass as a coverage refusal.
    expect(pgErrorCode(error)).toBe("P0001");
    expect(pgErrorMessage(error)).toMatch(
      /tenders for sale .* but sale\.total \+ corrections \+ tips is/,
    );
  });
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
