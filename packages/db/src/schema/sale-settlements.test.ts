import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { COVERAGE_REFUSAL, POST_SETTLEMENT_REFUSAL } from "../trigger-refusals.js";
import { TRIGGER_ABORT } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { withTransaction } from "../tenancy.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { saleLines, saleSettlements, sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * Checks settlement schema shape, coverage on settlement, the post-settlement tender guard,
 * immutability and tender constraints. The behavioural matrix below pins each guard's refusal.
 *
 * LOSSES, from the storage swap:
 *  - the TRUNCATE case is deleted. SQLite has no `TRUNCATE` statement at all, and no trigger event
 *    for `DROP TABLE`, so the statement-level guard that blocked a table-wide wipe has no
 *    counterpart (`packages/store/src/append-only.ts` states this in its own words). A caller that
 *    can issue DDL can still empty this table, and nothing refuses it.
 *  - the shape assertions read the catalogue differently. `pg_trigger`, `pg_constraint` and
 *    `information_schema` are replaced by `sqlite_master` and the `pragma_*` tables, and the
 *    append-only pair is now `sale_settlements_append_only_update`/`_delete` — the triggers
 *    `@waitron/store` installs from a set's `appendOnlyTables` list — rather than a per-table
 *    `enforce_immutability`/`block_truncate` pair the migration wrote.
 *  - each refusal is now its trigger's own `RAISE(ABORT, …)` text, not a SQLSTATE. The coverage
 *    refusal in particular used to NAME the two amounts that did not match; it is a fixed sentence
 *    here (`packages/db/src/trigger-refusals.ts`), so a failing settlement no longer says by how
 *    much it was short.
 */

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
// sales.node_id is NOT NULL; recordSale writes this node.
let nodeA = "";

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" });
  await db.insert(locations).values({
    id: LOCATION_A,
    name: "Fixture Location A",
    invoiceLocales: ["es", "ca"],
    operationDescription: "Hostelería",
  });
  await db.insert(tills).values({ id: TILL_A1, locationId: LOCATION_A, name: "A1" });
  nodeA = await seedNode(db, brandLocationId(LOCATION_A));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a!.id;
}

/**
 * Writes a sale, one line and the given tenders, returning its id. Coverage is checked on
 * sale_settlements INSERT, so this fixture can stage a shortfall before declaring settlement.
 */
async function recordSale(
  db: Database,
  total: number,
  tenderRows: { method: "cash" | "card"; amount: number; tipAmount?: number }[],
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const [sale] = await tx
      .insert(sales)
      .values({
        tillId: TILL_A1,
        nodeId: nodeA,
        seriesId: seriesA,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 120,
        total,
        // The filed per-rate VAT breakdown; `[]` — this file stages mis-summed settlements, not the
        // breakdown, and the column just needs a valid NOT NULL array.
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es", "ca"],
        fiscalBackend: "verifactu",
        fiscalState: "recorded",
      })
      .returning({ id: sales.id });
    await tx.insert(saleLines).values({
      saleId: sale!.id,
      lineNo: 1,
      name: "Café solo",
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      quantity: 1000,
      unitPrice: total,
      vatRate: 1000,
      lineTotal: total,
    });
    await tx.insert(tenders).values(
      tenderRows.map((t) => ({
        saleId: sale!.id,
        method: t.method,
        amount: t.amount,
        tipAmount: t.tipAmount ?? 0,
        settledAt: AT,
      })),
    );
    return sale!.id;
  });
}

describe("sale settlements — schema shape", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  /** A table's stored `CREATE TABLE` text — where SQLite keeps its CHECK constraint names. */
  const ddlOf = (table: string): string =>
    suite.db.all<{ sql: string }>(
      sql`select sql from sqlite_master where type = 'table' and name = ${table}`,
    )[0]!.sql;

  const triggersOn = (table: string): string[] =>
    suite.db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'trigger' and tbl_name = ${table}
             order by name`,
      )
      .map((row) => row.name);

  it("tenders gains tip_amount and its tightened/new check constraints", () => {
    const cols = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('tenders') where name = 'tip_amount'`,
    );
    expect(cols).toHaveLength(1);

    // SQLite has no `pg_constraint`: a named CHECK lives only in the table's own `CREATE TABLE`
    // text, so the names are read out of that.
    const ddl = ddlOf("tenders");
    expect(ddl).toContain(`CONSTRAINT "tenders_amount_ck"`);
    expect(ddl).toContain(`CONSTRAINT "tenders_tip_amount_ck"`);
  });

  it("sale_settlements exists, is append-only, and sales lost tip_amount/amount_charged", () => {
    const settlements = suite.db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'table' and name = 'sale_settlements'`,
    );
    expect(settlements).toHaveLength(1);

    // Append-only: the pair `@waitron/store` installs for every table a module declared
    // `appendOnly()`. There is no third, TRUNCATE-blocking trigger — see this file's header.
    expect(triggersOn("sale_settlements")).toEqual([
      "sale_settlements_append_only_delete",
      "sale_settlements_append_only_update",
      "sale_settlements_check_coverage",
    ]);

    const dropped = suite.db.all<{ name: string }>(
      sql`select name from pragma_table_info('sales')
           where name in ('tip_amount', 'amount_charged')`,
    );
    expect(dropped).toEqual([]);
  });

  it("the deferred coverage triggers are gone and the new ones exist", () => {
    const named = suite.db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'trigger'
             and name in ('sales_check_tender_coverage', 'tenders_check_tender_coverage',
                          'sale_settlements_check_coverage', 'tenders_reject_post_settlement')
             order by name`,
      )
      .map((row) => row.name);
    expect(named).toEqual(["sale_settlements_check_coverage", "tenders_reject_post_settlement"]);
  });
});

describe("sale settlements — coverage on the settlement INSERT", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seed(suite.db);
  });

  it("accepts a settlement whose tenders sum to total plus tips", async () => {
    // €70 sale, paid €75 of which €5 is tip: sum(amount) 75 = total 70 + tips 5. The negative
    // control for the coverage guard — with or without the trigger, this must succeed, so a
    // deletion that made the mis-summed case pass could not accidentally make THIS one start
    // failing.
    const saleId = await recordSale(suite.db, 7000, [
      { method: "card", amount: 7500, tipAmount: 500 },
    ]);
    const [row] = await suite.db
      .insert(saleSettlements)
      .values({ saleId, settledAt: AT })
      .returning();
    expect(row!.saleId).toBe(saleId);
  });

  it("refuses a settlement whose tenders do not sum to total plus tips", async () => {
    const saleId = await recordSale(suite.db, 7000, [{ method: "cash", amount: 5000 }]);
    const error = await captureError(() =>
      suite.db.insert(saleSettlements).values({ saleId, settledAt: AT }),
    );
    // The class AND the words, so a CHECK failure or a foreign-key refusal cannot pass as a
    // coverage refusal: `RAISE(ABORT, …)` shares its result code with `ON DELETE RESTRICT`
    // (`packages/db/src/sql-state.ts`), and only the text separates the two.
    expect(isRefusal(error, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(error)).toBe(COVERAGE_REFUSAL);
  });
});

describe("sale settlements — append-only", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let settlementId = "";

  beforeEach(async () => {
    await seed(suite.db);
    // A covered sale, so the settlement INSERT passes coverage and lands.
    const saleId = await recordSale(suite.db, 1000, [{ method: "card", amount: 1000 }]);
    const [row] = await suite.db
      .insert(saleSettlements)
      .values({ saleId, settledAt: AT })
      .returning({ id: saleSettlements.id });
    settlementId = row!.id;
  });

  it("refuses to UPDATE a settlement, via the trigger backstop", async () => {
    const error = await captureError(() =>
      suite.db
        .update(saleSettlements)
        .set({ settledAt: "2026-07-21T19:20:30+00:00" })
        .where(eq(saleSettlements.id, settlementId)),
    );
    expect(isRefusal(error, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(error)).toBe("sale_settlements is append-only");
  });

  it("refuses to DELETE a settlement, via the trigger backstop", async () => {
    const error = await captureError(() =>
      suite.db.delete(saleSettlements).where(eq(saleSettlements.id, settlementId)),
    );
    expect(isRefusal(error, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(error)).toBe("sale_settlements is append-only");
  });
});

describe("sale settlements — no tender after settlement", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let saleId = "";

  beforeEach(async () => {
    await seed(suite.db);
    saleId = await recordSale(suite.db, 1000, [{ method: "card", amount: 1000 }]);
    await suite.db.insert(saleSettlements).values({ saleId, settledAt: AT });
  });

  it("rejects a tender inserted after the sale is settled", async () => {
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        tx.insert(tenders).values({ saleId, method: "cash", amount: 500, settledAt: AT }),
      ),
    );
    expect(isRefusal(error, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(error)).toBe(POST_SETTLEMENT_REFUSAL);
  });
});
