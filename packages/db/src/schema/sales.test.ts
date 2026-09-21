// Real PostgreSQL: checks node-postgres monetary decoding alongside the PGlite driver.
import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { Database } from "../client.js";
import { captureError, pgErrorCode, pgErrorMessage } from "../testing/errors.js";
import { describeEachTarget } from "../testing/harness.js";
import { seedNode } from "../testing/seed.js";
import { saleLines, sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Since the node-id rekey (2026-08-03) both invoice_series and sales carry a NOT NULL node_id;
// sales keeps till_id too, and adds the (node_id) → nodes FK. seed() creates one node, and
// saleValues() defaults to it.
let seriesA = "";
let nodeA = "";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

async function seed(db: Database): Promise<void> {
  await db
    .insert(tenants)
    .values([{ id: 1, country: "ES", taxId: "B00000000", legalName: "Fixture Tenant A" }]);
  await db.insert(locations).values([
    {
      id: LOCATION_A,
      name: "Fixture Location A",
      invoiceLocales: ["es", "ca"],
      operationDescription: "Hostelería",
    },
  ]);
  await db.insert(tills).values([{ id: TILL_A1, locationId: LOCATION_A, name: "A1" }]);
  nodeA = await seedNode(db, brandLocationId(LOCATION_A));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
}

function saleValues(overrides: Record<string, unknown> = {}) {
  return {
    tillId: TILL_A1,
    nodeId: nodeA,
    seriesId: seriesA,
    invoiceNumber: 1,
    issuedAt: AT,
    issuedOffsetMinutes: 120,
    total: 100,
    // The filed per-rate breakdown. `[]` here because these fixtures do not exercise
    // the breakdown — the column is just NOT NULL and must carry a valid jsonb array; the tests that
    // DO care about its content are record-sale.test.ts (the equality-to-filed proof) and the
    // information_schema column assertion below.
    vatBreakdown: [] as { rate: string; base: string; tax: string }[],
    locale: "es",
    invoiceLocales: ["es", "ca"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded" as const,
    ...overrides,
  };
}

/**
 * Writes a sale — header, lines and tenders — in one transaction. Every test
 * that needs a sale on disk goes through here.
 *
 * Tender coverage is checked when settlement is declared, on the `sale_settlements`
 * INSERT, tested in sale-settlements.test.ts.
 * So a sale written here can stand legitimately uncovered — an unsettled sale is
 * a valid steady state under invoice-first (design §3). The default tender is
 * coherent anyway (amount = total, no tip) so callers can settle it if they
 * need to; each tender carries its own `tip_amount` (design §9.2), defaulted to
 * zero.
 */
async function recordCompleteSale(
  db: Database,
  overrides: Record<string, unknown> = {},
  tenderRows: { method: "cash" | "card"; amount: number; tipAmount?: number }[] = [
    { method: "card", amount: 100 },
  ],
): Promise<string> {
  return db.transaction(async (tx) => {
    const [sale] = await tx.insert(sales).values(saleValues(overrides)).returning({ id: sales.id });
    await tx.insert(saleLines).values({
      saleId: sale.id,
      lineNo: 1,
      name: "Café solo",
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      // One unit and a 10.00% rate, counted in whole thousandths and whole basis points
      // (`quantity()` and `rate()` in packages/db/src/schema/columns.ts).
      quantity: 1000,
      unitPrice: 100,
      vatRate: 1000,
      lineTotal: 100,
    });
    await tx.insert(tenders).values(
      tenderRows.map((t) => ({
        saleId: sale.id,
        method: t.method,
        amount: t.amount,
        tipAmount: t.tipAmount ?? 0,
        settledAt: AT,
      })),
    );
    return sale.id;
  });
}

// NOTE on fixtures: unlike series.test.ts/orders.test.ts, beforeEach here does
// NOT `truncate table tenants cascade` before seeding. target.create() (see
// testing/harness.ts) already returns a freshly migrated database with no
// rows, so the truncate was a no-op in those files. Here it would not be a
// no-op: TRUNCATE ... CASCADE fires the BEFORE TRUNCATE statement trigger on
// every table it cascades into, not only the table named in the statement —
// verified live against PGlite — and sales/sale_lines/tenders are reachable by
// cascade from tenants (via till_id). Keeping the truncate would
// make sales_block_truncate/sale_lines_block_truncate/tenders_block_truncate
// reject the fixture setup itself on every single test in this file.
describeEachTarget("sales — the commercial record", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("keeps total as the sale's only money, with the tip on the tender", async () => {
    // The sale carries one money value: `total`. The tip belongs to
    // `tenders.tip_amount` (attributed to the payer who left it) and
    // amount_charged is derived, never stored (design §3). Here a €1.00 sale is
    // paid with a €1.50 tender carrying a €0.50 tip — three still-distinct
    // figures, but only `total` lives on the sale.
    const id = await recordCompleteSale(db, {}, [{ method: "card", amount: 150, tipAmount: 50 }]);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.total).toBe(100);
    const [tender] = await db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(tender.amount).toBe(150);
    expect(tender.tipAmount).toBe(50);
  });

  it("rejects a duplicate invoice number within a series", async () => {
    // findings §1: records are identified by issuer + series & number + date, and
    // AEAT returns error 3000 on a duplicate. The database refuses first.
    await recordCompleteSale(db);
    const error = await captureError(() => recordCompleteSale(db));
    expect(pgErrorMessage(error)).toMatch(/duplicate key value/);
  });

  it("permits the same invoice number in two different series", async () => {
    const [other] = await db
      .insert(invoiceSeries)
      .values({ nodeId: nodeA, code: "RA", purpose: "rectificative" })
      .returning({ id: invoiceSeries.id });
    await recordCompleteSale(db);
    const second = await recordCompleteSale(db, { seriesId: other.id });
    expect(second).toBeTruthy();
  });

  it("stores every monetary column as integer, a whole count of cents", async () => {
    const cols = await rows<{
      table_name: string;
      column_name: string;
      data_type: string;
      numeric_precision: number;
      numeric_scale: number;
    }>(
      db,
      sql`select table_name, column_name, data_type, numeric_precision, numeric_scale
            from information_schema.columns
           where (table_name = 'sales' and column_name = 'total')
              or (table_name = 'sale_lines' and column_name in ('unit_price', 'line_total'))
              or (table_name = 'tenders' and column_name in ('amount', 'tip_amount'))`,
    );
    expect(cols).toHaveLength(5);
    for (const col of cols) {
      // A money column counts whole cents (`money()` in packages/db/src/schema/columns.ts):
      // PostgreSQL reports `bigint` as precision 64, scale 0, so a column that slipped back to
      // numeric(12, 2) fails all three, and one narrowed to a four-byte integer fails the
      // precision.
      expect(col.data_type).toBe("bigint");
      expect(col.numeric_precision).toBe(64);
      expect(col.numeric_scale).toBe(0);
    }
  });

  it("stores vat_breakdown as a NOT NULL jsonb column", async () => {
    // vat_breakdown: the filed per-rate breakdown ({rate, base, tax}[]), a queryable copy of what the
    // hash-chained record carries, so reporting can compute an exact VAT summary without a
    // cross-boundary join (spec 8a). NOT NULL is load-bearing — it is the forcing function that made
    // every sale-creating path populate it — so both the type AND the nullability are pinned here.
    const [meta] = await rows<{ data_type: string; is_nullable: string }>(
      db,
      sql`select data_type, is_nullable from information_schema.columns
           where table_name = 'sales' and column_name = 'vat_breakdown'`,
    );
    expect(meta).toEqual({ data_type: "jsonb", is_nullable: "NO" });
  });

  it("sums line totals exactly, with no float drift", async () => {
    // Three lines of 10, 20 and 70 cents summing to 100. What this asserted before the money
    // columns became integers was a FORMAT difference: `sum(...)::text` on numeric(12, 2) always
    // rendered at scale 2 ("1.00") where float8 never pads, so a double-precision mutation of
    // these columns failed with `expected '1' to be '1.00'`. On an integer column that bite is
    // GONE — 10 + 20 + 70 sums to 100 and renders "100" under a float8 mutation too — so this
    // now asserts only that the database sums cents, and would not catch that mutation.
    const id = await db.transaction(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values(saleValues({ total: 100 }))
        .returning({ id: sales.id });
      await tx.insert(saleLines).values(
        [10, 20, 70].map((amount, i) => ({
          saleId: sale.id,
          lineNo: i + 1,
          name: "Café solo",
          // Not `Línea`/`Línia`: `linea` is on english-only.ts's guarded
          // Spanish wordlist (SPANISH_WORDS), so that literal fails this
          // package's own English-only build. "Café solo"/"Cafè sol" is the
          // placeholder description this file already uses elsewhere.
          descriptions: { es: "Café solo", ca: "Cafè sol" },
          quantity: 1000,
          unitPrice: amount,
          vatRate: 1000,
          lineTotal: amount,
        })),
      );
      await tx.insert(tenders).values({
        saleId: sale.id,
        method: "cash",
        amount: 100,
        settledAt: AT,
      });
      return sale.id;
    });

    const [summed] = await rows<{ total: string }>(
      db,
      sql`select sum(line_total)::text as total from sale_lines where sale_id = ${id}::uuid`,
    );
    expect(summed.total).toBe("100");
  });

  it("returns money and the two scaled counts beside it as JS numbers", async () => {
    // Three scales, one read mapping. Money counts whole cents, a quantity whole thousandths and
    // a rate whole basis points, and every one arrives from the driver as a JS number — so a
    // column that slipped back to `numeric`, which the driver renders as a STRING, fails here.
    // That is the same rendering the two line assertions below relied on before this change,
    // when they read the other way round.
    //
    // The second half this test used to carry has nowhere left to live. It said that `quantity`
    // and `vat_rate` arrived as STRINGS because a decimal rendered as text is a decimal that
    // never passed through a float — and scanned on 2026-09-21, no column in any package's latest
    // snapshot under `drizzle/meta` is `numeric`, `double precision` or `real` any more. That
    // reading is of drizzle's GENERATED snapshots, so a column added by hand-written migration
    // SQL alone would not appear in it. What keeps a count exact now is the integer-digit bound
    // its converter enforces on the way in (`packages/shared/src/scales.ts` and `cents.ts`),
    // which holds every stored count inside the integers a double represents exactly. A raw-SQL
    // write goes around those converters, and nothing checks that.
    const id = await recordCompleteSale(db, {}, [{ method: "card", amount: 150, tipAmount: 50 }]);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(typeof row.total).toBe("number");
    // The tender's amount and tip_amount are money too — the same driver path, checked here so a
    // mapping that reverts any of the three surfaces to a decimal string is caught.
    const [tender] = await db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(typeof tender.amount).toBe("number");
    expect(typeof tender.tipAmount).toBe("number");
    // The two non-money scales on the sale line, each read through its own column helper.
    const [line] = await db.select().from(saleLines).where(eq(saleLines.saleId, id));
    expect(typeof line.quantity).toBe("number");
    expect(typeof line.vatRate).toBe("number");
  });

  it("stores issued_at with its offset alongside", async () => {
    // UTC plus offset, never a formatted local time. The offset is what makes
    // a receipt reprinted from another timezone still read 21:20.
    const id = await recordCompleteSale(db, { issuedOffsetMinutes: 120 });
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.issuedOffsetMinutes).toBe(120);
  });

  it("requires a node_id referencing nodes", async () => {
    // Node-id rekey (2026-08-03, plan Task 4 §5): sales.node_id is NOT NULL with a
    // (node_id) → nodes FK — the node that chained the sale (#33).
    // till_id stays (where the sale rang); this is the node beside it. (This test was the Task-3
    // scaffolding assertion that node_id was NULLABLE; the completed rekey inverts it — see this
    // task's report.)
    const meta = await rows<{ is_nullable: string }>(
      db,
      sql`select is_nullable from information_schema.columns
           where table_name = 'sales' and column_name = 'node_id'`,
    );
    expect(meta).toEqual([{ is_nullable: "NO" }]);
    // A sale carries its node_id ...
    const plainId = await recordCompleteSale(db);
    const [plain] = await db.select().from(sales).where(eq(sales.id, plainId));
    expect(plain.nodeId).toBe(nodeA);
    // ... and a sale with no node_id is refused (NOT NULL). Raw SQL because the drizzle `sales`
    // insert type requires node_id, so the omission can only be expressed at the SQL layer.
    const error = await captureError(() =>
      db.execute(
        sql`insert into sales (till_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state) values (${TILL_A1}, ${seriesA}, 2, ${AT}, 120,
               100, '[]'::jsonb, 'es', array['es', 'ca']::text[], 'verifactu', 'recorded'
             )`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/null value in column "node_id"/);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // The FK guarantees referential existence: a node id with no `nodes` row is refused.
    const error = await captureError(() =>
      db.insert(sales).values(
        saleValues({
          invoiceNumber: 2,
          nodeId: "99999999-9999-4999-8999-999999999999",
        }),
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/violates foreign key constraint/);
  });
});

describeEachTarget("sales — locale snapshot", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("snapshots the ordered invoice_locales as at issuance", async () => {
    const id = await recordCompleteSale(db);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.invoiceLocales).toEqual(["es", "ca"]);
  });

  it("does not change an existing sale when locations.invoice_locales changes", async () => {
    // Spec §9: a receipt reprinted a year later must read identically to the
    // one the customer took, and corrective invoices inherit the ORIGINAL list.
    // Reading through locations at print time would break both.
    const id = await recordCompleteSale(db);
    await db
      .update(locations)
      .set({ invoiceLocales: ["en"] })
      .where(eq(locations.id, LOCATION_A));
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.invoiceLocales).toEqual(["es", "ca"]);
    expect(row.locale).toBe("es");
  });

  it("preserves locale order, not just membership", async () => {
    // Two locales means both languages on the same invoice rendered in that
    // order. A set-valued snapshot would render Catalan first half the time.
    const id = await recordCompleteSale(db, { invoiceLocales: ["ca", "es"], locale: "ca" });
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects a locale that is not in the snapshot", async () => {
    const error = await captureError(() => recordCompleteSale(db, { locale: "en" }));
    expect(pgErrorMessage(error)).toMatch(/sales_locale_member_ck/);
  });

  it("rejects more than two invoice locales", async () => {
    const error = await captureError(() =>
      recordCompleteSale(db, { invoiceLocales: ["es", "ca", "en"] }),
    );
    expect(pgErrorMessage(error)).toMatch(/sales_invoice_locales_ck/);
  });
});

describeEachTarget("sales — tender coverage", (target) => {
  let db: Database;

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("accepts a split tender across two rows", async () => {
    // Since 0012 there is no coverage check at tender INSERT — a sale may sit
    // legitimately part-tendered until settlement is declared (design §3), so
    // this only asserts both rows land. Whether they SUM correctly is the
    // sale_settlements coverage trigger's job, proved in sale-settlements.test.ts.
    const id = await recordCompleteSale(db, {}, [
      { method: "cash", amount: 100 },
      { method: "card", amount: 50 },
    ]);
    const found = await db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(found).toHaveLength(2);
  });

  // tenders_amount_ck (design §7 deletion matrix). This constraint had NO test
  // at all before 0012 tightened it from `amount <> 0` to `amount > 0`, in
  // either direction — so both boundaries get one, making the tightening a
  // visible behaviour change rather than an untested edit. The sale these hang
  // off is unsettled, so the post-settlement tender guard (WT002) never fires;
  // the CHECK is what rejects, asserted on SQLSTATE 23514.
  it("rejects a zero-amount tender", async () => {
    const id = await recordCompleteSale(db);
    // amount 0 with the default tip 0 passes tenders_tip_amount_ck (0 <= 0), so
    // tenders_amount_ck is the only constraint that can fire here — deleting it
    // is what lets a zero tender through (proved by deletion locally).
    const error = await captureError(() =>
      db.insert(tenders).values({ saleId: id, method: "cash", amount: 0, settledAt: AT }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenders_amount_ck/);
  });

  it("rejects a negative-amount tender", async () => {
    const id = await recordCompleteSale(db);
    // Only SQLSTATE is pinned, deliberately, NOT the constraint name: a negative
    // amount violates BOTH checks at once — tenders_amount_ck (`> 0`) and
    // tenders_tip_amount_ck (`tip <= amount`, which no tip >= 0 can satisfy when
    // amount < 0) — and which name Postgres reports is not guaranteed. So this
    // proves "a negative tender is refused", jointly enforced; the zero case
    // above is the one that isolates tenders_amount_ck under deletion.
    const error = await captureError(() =>
      db.insert(tenders).values({
        saleId: id,
        method: "cash",
        amount: -1000,
        settledAt: AT,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
  });

  it("accepts a positive-amount tender", async () => {
    const id = await recordCompleteSale(db);
    const [inserted] = await db
      .insert(tenders)
      .values({ saleId: id, method: "cash", amount: 1000, settledAt: AT })
      .returning();
    expect(inserted.amount).toBe(1000);
  });

  // tenders_tip_amount_ck (design §7 deletion matrix): the tip is PART of the
  // amount, never on top (`0 <= tip_amount <= amount`), because the terminal is
  // sent one final figure (design §4). New in 0012.
  it("rejects a tender whose tip exceeds its amount", async () => {
    const id = await recordCompleteSale(db);
    // amount 10 > 0 passes tenders_amount_ck, so tenders_tip_amount_ck is the
    // only constraint that can fire — the name is safe to pin here.
    const error = await captureError(() =>
      db.insert(tenders).values({
        saleId: id,
        method: "card",
        amount: 1000,
        tipAmount: 1500,
        settledAt: AT,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
  });

  it("accepts a tender whose tip equals its amount", async () => {
    const id = await recordCompleteSale(db);
    const [inserted] = await db
      .insert(tenders)
      .values({
        saleId: id,
        method: "card",
        amount: 1000,
        tipAmount: 1000,
        settledAt: AT,
      })
      .returning();
    expect(inserted.tipAmount).toBe(1000);
  });

  it("rejects a negative tip", async () => {
    const id = await recordCompleteSale(db);
    const error = await captureError(() =>
      db.insert(tenders).values({
        saleId: id,
        method: "card",
        amount: 1000,
        tipAmount: -100,
        settledAt: AT,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
  });
});

describeEachTarget("sales — immutability as the app role", (target) => {
  let db: Database;
  let saleId = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    saleId = await recordCompleteSale(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("stops the owner too, via the trigger backstop", async () => {
    // The grants stop the application; the trigger stops the owner. Both are
    // needed, and only this test distinguishes them — every app-role test
    // above would still pass with no trigger at all.
    //
    // Asserted on SQLSTATE WT001 rather than on the message, because the
    // message comes from the shared reject_mutation() and improving its
    // wording must not turn this red. Task 5 makes the same argument.
    const update = await captureError(() =>
      db.update(sales).set({ total: 99900 }).where(eq(sales.id, saleId)),
    );
    expect(pgErrorCode(update)).toBe("WT001");
    expect(pgErrorMessage(update)).toMatch(/sales is append-only: UPDATE is not permitted/);

    const remove = await captureError(() => db.delete(sales).where(eq(sales.id, saleId)));
    expect(pgErrorCode(remove)).toBe("WT001");
  });

  it("stops the owner truncating any of the three tables", async () => {
    // Closes the hole Step 6 used to leave open: the app role has no TRUNCATE
    // privilege, so without an owner-path test the statement triggers are
    // shadowed by the grant and nothing covers them.
    //
    // CASCADE, not a bare TRUNCATE: sale_lines and tenders each hold a foreign
    // key onto sales, and Postgres refuses to TRUNCATE a table that is
    // referenced by a foreign key from a table not named in the same
    // statement — verified live: a bare `truncate table sales` raises "cannot
    // truncate a table referenced in a foreign key constraint" and never
    // reaches sales_block_truncate at all, regardless of whether sale_lines
    // holds any rows. CASCADE folds sale_lines and tenders into the same
    // TRUNCATE, whose own BEFORE TRUNCATE triggers then also fire — one of
    // the three tables' triggers raises first, so the assertion checks the
    // generic pattern and WT001 rather than which table's name appears.
    // CASCADE is a no-op for sale_lines/tenders themselves: nothing
    // references either of them, so nothing is added to their truncate set.
    for (const table of ["sales", "sale_lines", "tenders"] as const) {
      const error = await captureError(() =>
        db.execute(sql`truncate table ${sql.identifier(table)} cascade`),
      );
      expect(pgErrorCode(error)).toBe("WT001");
      expect(pgErrorMessage(error)).toMatch(/TRUNCATE is not permitted/);
    }
  });

  it("carries only the chosen variant snapshot identifier, with no live catalogue link", async () => {
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'sale_lines'`,
    );
    const catalogueShapedIds = cols
      .map((c) => c.column_name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(n));
    expect(catalogueShapedIds).toEqual(["variant_id"]);

    const variantForeignKeys = await rows<{ foreign_table: string }>(
      db,
      sql`select ccu.table_name as foreign_table
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_schema = tc.constraint_schema
           and kcu.constraint_name = tc.constraint_name
          join information_schema.constraint_column_usage ccu
            on ccu.constraint_schema = tc.constraint_schema
           and ccu.constraint_name = tc.constraint_name
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_name = 'sale_lines'
            and kcu.column_name = 'variant_id'`,
    );
    expect(variantForeignKeys).toEqual([]);
  });
});

describeEachTarget("sales — fiscal_state", (target) => {
  let db: Database;
  let saleId = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    saleId = await recordCompleteSale(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  it("records fiscal_backend and fiscal_state in the same transaction as the sale", async () => {
    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row.fiscalBackend).toBe("verifactu");
    // The state AT ISSUANCE: the legally-required record exists locally, which
    // in Spain is the point at which the sale is compliant, regardless of
    // whether anything has been sent anywhere yet.
    expect(row.fiscalState).toBe("recorded");
  });

  it("holds no submission state, so there is nothing on it to advance", async () => {
    // Spec §3 puts submission state on the `envios` sidecar precisely because it
    // mutates constantly and this table cannot be updated. A column named for
    // sending, acknowledging or retrying reappearing here is the regression
    // this test exists to catch — it would have to be mutable, and nothing
    // here is.
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'sales'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /(sent|submitted|acked|acknowledged|attempt|retry|csv|error)/i.test(n));
    expect(offenders).toEqual([]);
  });

  it("permits exactly two fiscal_state values", async () => {
    // recorded | not_applicable — issuance classifications, not lifecycle
    // stages. A third value arriving is how this column drifts back into being
    // a submission state machine.
    const values = await rows<{ enumlabel: string }>(
      db,
      sql`select enumlabel from pg_enum e
          join pg_type t on t.oid = e.enumtypid
          where t.typname = 'fiscal_state' order by enumlabel`,
    );
    expect(values.map((v) => v.enumlabel)).toEqual(["not_applicable", "recorded"]);
  });
});

/**
 * The corrective-invoice link. `corrects_sale_id` is the generic-layer
 * projection of "this sale corrects that one" — a nullable FK back onto
 * `sales`, NOT unique (a sale may be corrected more than once), and it is what relaxes
 * `sales_total_ck` to permit the negative total a `rectificativa por diferencias` carries
 * (`docs/superpowers/plans/2026-08-02-rectificativas.md` §2.1).
 *
 * A corrective sale is written header-only here (no tenders): the refund is a separate
 * payments action and `tenders_amount_ck` (`amount > 0`) forbids a negative tender anyway,
 * so an unsettled corrective is the steady state.
 */
describeEachTarget("sales — corrective link and negative total", (target) => {
  let db: Database;
  let originalSaleId = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    // An ordinary sale to be corrected. invoice_number 1 in seriesA.
    originalSaleId = await recordCompleteSale(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  // Raw insert of a corrective (or ordinary) sale HEADER — deliberately not the drizzle
  // `sales` object, so the RED phase fails on the real cause ("column corrects_sale_id does
  // not exist", i.e. the migration is absent) rather than on a TypeScript compile error.
  async function insertSale(opts: {
    total: number;
    correctsSaleId: string | null;
    invoiceNumber: number;
    tillId?: string;
    nodeId?: string;
    seriesId?: string;
    invoiceLocales?: string[];
  }): Promise<{ id: string }[]> {
    const tillId = opts.tillId ?? TILL_A1;
    // node_id is NOT NULL since the rekey.
    const nodeId = opts.nodeId ?? nodeA;
    const seriesId = opts.seriesId ?? seriesA;
    const locales = opts.invoiceLocales ?? ["es", "ca"];
    const localesArray = sql`array[${sql.join(
      locales.map((l) => sql`${l}`),
      sql`, `,
    )}]::text[]`;
    return rows<{ id: string }>(
      db,
      sql`insert into sales (till_id, node_id, series_id, invoice_number, issued_at, issued_offset_minutes, total, vat_breakdown, locale, invoice_locales, fiscal_backend, fiscal_state, corrects_sale_id) values (${tillId}, ${nodeId}, ${seriesId}, ${opts.invoiceNumber}, ${AT}, 120,
             ${opts.total}, '[]'::jsonb, 'es', ${localesArray}, 'verifactu', 'recorded',
             ${opts.correctsSaleId}
           ) returning id`,
    );
  }

  it("accepts a corrective sale carrying a negative total when the link is set", async () => {
    // Load-bearing: record-sale passes `total` straight into the fiscal record's `ImporteTotal`,
    // which the fiscal fingerprint hashes, so `sales.total` must hold the negative value the corrective
    // needs (findings §10.2, plan §2.1).
    //
    // PROVEN BY DELETION (manual, recorded in this task's report): with the migration's
    // `sales_total_ck` reduced back to `${t.total} >= 0` (the pre-0013 form), this exact insert
    // is rejected with 23514/sales_total_ck. The `OR corrects_sale_id IS NOT NULL` clause is
    // what admits it — the guard is doing the work, not the FK or the column add.
    const inserted = await insertSale({
      total: -100,
      correctsSaleId: originalSaleId,
      invoiceNumber: 2,
    });
    expect(inserted).toHaveLength(1);
    const [row] = await db.select().from(sales).where(eq(sales.id, inserted[0].id));
    expect(row.total).toBe(-100);
    expect(row.correctsSaleId).toBe(originalSaleId);
  });

  it("rejects an ordinary sale carrying a negative total", async () => {
    // Negative control: with no corrective link, the relaxed check still rejects a negative
    // total exactly as the original `total >= 0` did. An ordinary sale is never negative.
    const error = await captureError(() =>
      insertSale({ total: -100, correctsSaleId: null, invoiceNumber: 2 }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/sales_total_ck/);
  });

  it("still accepts a corrective sale with a positive total", async () => {
    // The link relaxes the sign; it does not force it. A corrective may be positive.
    const inserted = await insertSale({
      total: 100,
      correctsSaleId: originalSaleId,
      invoiceNumber: 2,
    });
    expect(inserted).toHaveLength(1);
  });

  it("leaves corrects_sale_id null on an ordinary sale", async () => {
    // The ordinary write path is unchanged: `recordCompleteSale` sets no link.
    const [row] = await db.select().from(sales).where(eq(sales.id, originalSaleId));
    expect(row.correctsSaleId).toBeNull();
  });

  it("allows a sale to be corrected more than once", async () => {
    // NOT unique, unlike sale_voids_sale_id_key: successive corrective invoices against one sale are
    // legitimate (plan §2.1). Two correctives pointing at the same original both land.
    await insertSale({ total: -100, correctsSaleId: originalSaleId, invoiceNumber: 2 });
    const second = await insertSale({
      total: -50,
      correctsSaleId: originalSaleId,
      invoiceNumber: 3,
    });
    expect(second).toHaveLength(1);
    const linked = await rows<{ n: number }>(
      db,
      sql`select count(*)::int as n from sales where corrects_sale_id = ${originalSaleId}::uuid`,
    );
    expect(linked[0].n).toBe(2);
  });

  it("rejects a corrective link to a sale that does not exist", async () => {
    const error = await captureError(() =>
      insertSale({
        total: -100,
        correctsSaleId: "99999999-9999-4999-8999-999999999999",
        invoiceNumber: 2,
      }),
    );
    // Foreign key violation — the (corrects_sale_id) FK onto sales.
    expect(pgErrorCode(error)).toBe("23503");
  });
});

/**
 * The sale_line → parent sale_line self-link (ordering modifiers, Task 2). `parent_line_id` is
 * presentation/reporting metadata ONLY — `backend.recordSale` is handed the sale's own header
 * fields and never `sale_lines` at all (the twelve are named at
 * `packages/core/src/record-sale.ts:389-408`), so this column never reaches the fiscal fingerprint
 * (design §4). An extras
 * pick files as its own child line pointing at the dish line it belongs to; a top-level line leaves
 * it NULL.
 *
 * The (parent_line_id) → sale_lines(id) FK keeps the link referential (mirrors sale_lines_sale_fk);
 * MATCH SIMPLE means a NULL parent satisfies it, so ordinary lines are untouched. sale_lines carries
 * NO reference to any extras or options table: the one catalogue-shaped id a filed line keeps is
 * `variant_id`, the snapshot of the chosen variant, and it carries no foreign key back to the
 * catalogue — everything else the line holds is frozen names. The
 * "carries only the chosen variant snapshot identifier" test above guards that, and is weaker than
 * its name: it matches sale_lines' column NAMES against a regex, so a catalogue reference added
 * under a name that does not end in one of those words is invisible to it.
 */
describeEachTarget("sale_lines — parent line self-link", (target) => {
  let db: Database;
  let saleId = "";

  beforeEach(async () => {
    db = await target.create();
    await seed(db);
    // A sale with one (top-level) line, line_no 1 — the parent candidate.
    saleId = await recordCompleteSale(db);
  });

  afterEach(async () => {
    if (db !== undefined) await db.close();
  });

  // Raw insert so the RED phase fails on the missing column/constraint, not a TypeScript compile
  // error against the drizzle `saleLines` type (the corrects-link block above does the same).
  async function insertLine(opts: {
    saleId: string;
    lineNo: number;
    parentLineId: string | null;
    descriptions?: string;
  }): Promise<{ id: string }[]> {
    const descriptions = opts.descriptions ?? '{"es":"Café solo","ca":"Cafè sol"}';
    return rows<{ id: string }>(
      db,
      sql`insert into sale_lines (sale_id, line_no, name, descriptions, quantity, unit_price, vat_rate, line_total, parent_line_id) values (${opts.saleId}, ${opts.lineNo}, 'Café solo', ${descriptions}::jsonb, 1000, 100,
             1000, 100, ${opts.parentLineId}
           ) returning id`,
    );
  }

  it("links a child line to its parent line", async () => {
    const [parent] = await db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    const [child] = await insertLine({ saleId, lineNo: 2, parentLineId: parent.id });
    const [row] = await rows<{ parent_line_id: string; quantity: string; vat_rate: string }>(
      db,
      // The counts are read back so the raw helper above is pinned: a quantity of one written as
      // `1` stores one thousandth and a 10.00% rate written as `10` a hundredth of a percent,
      // and `sale_lines_quantity_ck` and `sale_lines_vat_rate_ck` (sales.ts) refuse neither. Cast
      // to text so the assertion does not turn on how the driver renders each integer width.
      sql`select parent_line_id, quantity::text as quantity, vat_rate::text as vat_rate
            from sale_lines where id = ${child.id}::uuid`,
    );
    expect(row.parent_line_id).toBe(parent.id);
    expect(row.quantity).toBe("1000");
    expect(row.vat_rate).toBe("1000");
  });

  it("leaves parent_line_id null on a top-level line", async () => {
    const [row] = await rows<{ parent_line_id: string | null }>(
      db,
      sql`select parent_line_id from sale_lines where sale_id = ${saleId}::uuid and line_no = 1`,
    );
    expect(row.parent_line_id).toBeNull();
  });
});
