import { locationId as brandLocationId } from "@waitron/shared";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import {
  CHECK_VIOLATION,
  FOREIGN_KEY_VIOLATION,
  NOT_NULL_VIOLATION,
  TRIGGER_ABORT,
  UNIQUE_VIOLATION,
} from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { withTransaction } from "../tenancy.js";
import { captureError, engineErrorMessage } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { saleLines, sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * What this file does NOT check:
 *  - a table-wide wipe: there is no trigger event for `DROP TABLE`, so nothing refuses a caller
 *    that can issue DDL (`packages/store/src/append-only.ts`).
 *  - a money column's WIDTH: `pragma table_info` reports only the declared word, so the money case
 *    shows an integer rather than a decimal, not how wide the integer is.
 *  - a catalogue foreign key's NAME on `sale_lines`: SQLite stores none, so the catalogue case
 *    matches the key's column.
 */

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

let seriesA = "";
let nodeA = "";

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
  seriesA = a!.id;
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
    // `[]`: these fixtures do not exercise the breakdown; record-sale.test.ts checks its content.
    vatBreakdown: [] as { rate: string; base: string; tax: string }[],
    locale: "es",
    invoiceLocales: ["es", "ca"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded" as const,
    ...overrides,
  };
}

/**
 * Writes a sale — header, lines and tenders — in one transaction.
 *
 * Tender coverage is checked only when settlement is declared (sale-settlements.test.ts), so a
 * sale written here may stand uncovered. The default tender is coherent anyway (amount = total, no
 * tip) so callers can settle it if they need to.
 */
async function recordCompleteSale(
  db: Database,
  overrides: Record<string, unknown> = {},
  tenderRows: { method: "cash" | "card"; amount: number; tipAmount?: number }[] = [
    { method: "card", amount: 100 },
  ],
): Promise<string> {
  return withTransaction(db, async (tx) => {
    const [sale] = await tx.insert(sales).values(saleValues(overrides)).returning({ id: sales.id });
    await tx.insert(saleLines).values({
      saleId: sale!.id,
      lineNo: 1,
      name: "Café solo",
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      // One unit and a 10.00% rate, counted in whole thousandths and whole basis points.
      quantity: 1000,
      unitPrice: 100,
      vatRate: 1000,
      lineTotal: 100,
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

/** A table's stored `CREATE TABLE` text — where SQLite keeps its CHECK constraints and their
 * names. */
function ddlOf(db: Database, table: string): string {
  return db.all<{ sql: string }>(
    sql`select sql from sqlite_master where type = 'table' and name = ${table}`,
  )[0]!.sql;
}

function columnsOf(db: Database, table: string): { name: string; type: string; notnull: number }[] {
  return db.all<{ name: string; type: string; notnull: number }>(
    sql.raw(`select name, type, "notnull" from pragma_table_info('${table}')`),
  );
}

describe("sales — the commercial record", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seed(suite.db);
  });

  it("keeps total as the sale's only money, with the tip on the tender", async () => {
    // A €1.00 sale paid with a €1.50 tender carrying a €0.50 tip — three distinct figures, so the
    // sale's total cannot be mistaken for either tender value.
    const id = await recordCompleteSale(suite.db, {}, [
      { method: "card", amount: 150, tipAmount: 50 },
    ]);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.total).toBe(100);
    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(tender!.amount).toBe(150);
    expect(tender!.tipAmount).toBe(50);
  });

  it("rejects a duplicate invoice number within a series", async () => {
    // AEAT refuses a duplicate record; the database refuses first.
    await recordCompleteSale(suite.db);
    const error = await captureError(() => recordCompleteSale(suite.db));
    expect(isRefusal(error, UNIQUE_VIOLATION)).toBe(true);
  });

  it("permits the same invoice number in two different series", async () => {
    const [other] = await suite.db
      .insert(invoiceSeries)
      .values({ nodeId: nodeA, code: "RA", purpose: "rectificative" })
      .returning({ id: invoiceSeries.id });
    await recordCompleteSale(suite.db);
    const second = await recordCompleteSale(suite.db, { seriesId: other!.id });
    expect(second).toBeTruthy();
  });

  it("stores every monetary column as an integer, a whole count of cents", () => {
    const wanted: [string, string][] = [
      ["sales", "total"],
      ["sale_lines", "unit_price"],
      ["sale_lines", "line_total"],
      ["tenders", "amount"],
      ["tenders", "tip_amount"],
    ];
    for (const [table, column] of wanted) {
      const col = columnsOf(suite.db, table).find((c) => c.name === column);
      expect(col, `${table}.${column} must exist`).toBeDefined();
      expect(col!.type).toBe("INTEGER");
    }
  });

  it("stores vat_breakdown as a NOT NULL column", () => {
    // NOT NULL is what makes every sale-creating path populate it. `json` is a Drizzle read/write
    // mode, not a column type, so the stored type cannot tell this column from a plain text one.
    const col = columnsOf(suite.db, "sales").find((c) => c.name === "vat_breakdown");
    expect(col).toEqual({ name: "vat_breakdown", type: "TEXT", notnull: 1 });
  });

  it("sums line totals exactly, with no float drift", async () => {
    // On integer columns this asserts only that the database sums cents.
    const id = await withTransaction(suite.db, async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values(saleValues({ total: 100 }))
        .returning({ id: sales.id });
      await tx.insert(saleLines).values(
        [10, 20, 70].map((amount, i) => ({
          saleId: sale!.id,
          lineNo: i + 1,
          name: "Café solo",
          // Not `Línea`/`Línia`: `linea` is on english-only.ts's guarded Spanish wordlist
          // (SPANISH_WORDS), so that literal fails this package's own English-only build.
          descriptions: { es: "Café solo", ca: "Cafè sol" },
          quantity: 1000,
          unitPrice: amount,
          vatRate: 1000,
          lineTotal: amount,
        })),
      );
      await tx.insert(tenders).values({
        saleId: sale!.id,
        method: "cash",
        amount: 100,
        settledAt: AT,
      });
      return sale!.id;
    });

    const [summed] = suite.db.all<{ total: string }>(
      sql`select cast(sum(line_total) as text) as total from sale_lines where sale_id = ${id}`,
    );
    expect(summed!.total).toBe("100");
  });

  it("returns money and the two scaled counts beside it as JS numbers", async () => {
    const id = await recordCompleteSale(suite.db, {}, [
      { method: "card", amount: 150, tipAmount: 50 },
    ]);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(typeof row!.total).toBe("number");
    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(typeof tender!.amount).toBe("number");
    expect(typeof tender!.tipAmount).toBe("number");
    const [line] = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, id));
    expect(typeof line!.quantity).toBe("number");
    expect(typeof line!.vatRate).toBe("number");
  });

  it("stores issued_at with its offset alongside", async () => {
    // The offset is what makes a receipt reprinted from another timezone still read 21:20.
    const id = await recordCompleteSale(suite.db, { issuedOffsetMinutes: 120 });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.issuedOffsetMinutes).toBe(120);
  });

  it("requires a node_id referencing nodes", async () => {
    const col = columnsOf(suite.db, "sales").find((c) => c.name === "node_id");
    expect(col!.notnull).toBe(1);
    const plainId = await recordCompleteSale(suite.db);
    const [plain] = await suite.db.select().from(sales).where(eq(sales.id, plainId));
    expect(plain!.nodeId).toBe(nodeA);
    // Raw SQL because the drizzle insert type requires node_id. `id` is stated because it is a
    // `$defaultFn` column Drizzle fills client-side, and omitting it would be refused NOT NULL on
    // the WRONG column.
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) =>
        tx.run(
          sql`insert into sales (id, till_id, series_id, invoice_number, issued_at,
                 issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
                 fiscal_backend, fiscal_state)
               values ('sale-no-node', ${TILL_A1}, ${seriesA}, 2, ${AT}, 120,
                 100, '[]', 'es', '["es","ca"]', 'verifactu', 'recorded')`,
        ),
      ),
    );
    expect(isRefusal(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toBe("NOT NULL constraint failed: sales.node_id");
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    const error = await captureError(() =>
      suite.db.insert(sales).values(
        saleValues({
          invoiceNumber: 2,
          nodeId: "99999999-9999-4999-8999-999999999999",
        }),
      ),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

describe("sales — locale snapshot", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seed(suite.db);
  });

  it("snapshots the ordered invoice_locales as at issuance", async () => {
    const id = await recordCompleteSale(suite.db);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.invoiceLocales).toEqual(["es", "ca"]);
  });

  it("does not change an existing sale when locations.invoice_locales changes", async () => {
    // A receipt reprinted a year later must read identically to the one the customer took, and
    // corrective invoices inherit the ORIGINAL list.
    const id = await recordCompleteSale(suite.db);
    await suite.db
      .update(locations)
      .set({ invoiceLocales: ["en"] })
      .where(eq(locations.id, LOCATION_A));
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.invoiceLocales).toEqual(["es", "ca"]);
    expect(row!.locale).toBe("es");
  });

  it("preserves locale order, not just membership", async () => {
    // Both languages render on the same invoice in this order.
    const id = await recordCompleteSale(suite.db, { invoiceLocales: ["ca", "es"], locale: "ca" });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects a locale that is not in the snapshot", async () => {
    const error = await captureError(() => recordCompleteSale(suite.db, { locale: "en" }));
    expect(engineErrorMessage(error)).toMatch(/sales_locale_member_ck/);
  });

  it("rejects more than two invoice locales", async () => {
    const error = await captureError(() =>
      recordCompleteSale(suite.db, { invoiceLocales: ["es", "ca", "en"] }),
    );
    expect(engineErrorMessage(error)).toMatch(/sales_invoice_locales_ck/);
  });
});

describe("sales — tender coverage", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seed(suite.db);
  });

  it("accepts a split tender across two rows", async () => {
    // No coverage check at tender INSERT, so this only asserts both rows land.
    const id = await recordCompleteSale(suite.db, {}, [
      { method: "cash", amount: 100 },
      { method: "card", amount: 50 },
    ]);
    const found = await suite.db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(found).toHaveLength(2);
  });

  // tenders_amount_ck. The sale these hang off is unsettled, so the post-settlement tender guard
  // never fires; the CHECK is what rejects.
  it("rejects a zero-amount tender", async () => {
    const id = await recordCompleteSale(suite.db);
    // amount 0 with the default tip 0 passes tenders_tip_amount_ck (0 <= 0), so tenders_amount_ck
    // is the only constraint that can fire here.
    const error = await captureError(() =>
      suite.db.insert(tenders).values({ saleId: id, method: "cash", amount: 0, settledAt: AT }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenders_amount_ck/);
  });

  it("rejects a negative-amount tender", async () => {
    const id = await recordCompleteSale(suite.db);
    // Only the CLASS is pinned, NOT the constraint name: a negative amount violates both
    // tenders_amount_ck and tenders_tip_amount_ck, and which name the engine reports is not
    // guaranteed. The zero case above is the one that isolates tenders_amount_ck.
    const error = await captureError(() =>
      suite.db.insert(tenders).values({
        saleId: id,
        method: "cash",
        amount: -1000,
        settledAt: AT,
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
  });

  it("accepts a positive-amount tender", async () => {
    const id = await recordCompleteSale(suite.db);
    const [inserted] = await suite.db
      .insert(tenders)
      .values({ saleId: id, method: "cash", amount: 1000, settledAt: AT })
      .returning();
    expect(inserted!.amount).toBe(1000);
  });

  // tenders_tip_amount_ck: the tip is PART of the amount, never on top.
  it("rejects a tender whose tip exceeds its amount", async () => {
    const id = await recordCompleteSale(suite.db);
    // amount 10 > 0 passes tenders_amount_ck, so tenders_tip_amount_ck is the only constraint that
    // can fire — the name is safe to pin here.
    const error = await captureError(() =>
      suite.db.insert(tenders).values({
        saleId: id,
        method: "card",
        amount: 1000,
        tipAmount: 1500,
        settledAt: AT,
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
  });

  it("accepts a tender whose tip equals its amount", async () => {
    const id = await recordCompleteSale(suite.db);
    const [inserted] = await suite.db
      .insert(tenders)
      .values({
        saleId: id,
        method: "card",
        amount: 1000,
        tipAmount: 1000,
        settledAt: AT,
      })
      .returning();
    expect(inserted!.tipAmount).toBe(1000);
  });

  it("rejects a negative tip", async () => {
    const id = await recordCompleteSale(suite.db);
    const error = await captureError(() =>
      suite.db.insert(tenders).values({
        saleId: id,
        method: "card",
        amount: 1000,
        tipAmount: -100,
        settledAt: AT,
      }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
  });
});

describe("sales — immutability", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let saleId = "";

  beforeEach(async () => {
    await seed(suite.db);
    saleId = await recordCompleteSale(suite.db);
  });

  it("refuses an UPDATE and a DELETE, via the append-only trigger", async () => {
    const update = await captureError(() =>
      suite.db.update(sales).set({ total: 99900 }).where(eq(sales.id, saleId)),
    );
    expect(isRefusal(update, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(update)).toBe("sales is append-only");

    const remove = await captureError(() => suite.db.delete(sales).where(eq(sales.id, saleId)));
    expect(isRefusal(remove, TRIGGER_ABORT)).toBe(true);
    expect(engineErrorMessage(remove)).toBe("sales is append-only");
  });

  it("records what was sold as plain ids, never as a live catalogue link", () => {
    // These ids record what was sold and from which menu (sales classification spec §3). They are
    // values: no foreign key may point any of them at the catalogue. `menu_version_id` is one of
    // them too, but its name falls outside the pattern.
    const catalogueShapedIds = columnsOf(suite.db, "sale_lines")
      .map((c) => c.name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(n));
    expect(catalogueShapedIds.sort()).toEqual(["menu_id", "parent_product_id", "product_id"]);

    const foreignKeys = suite.db.all<{ from: string }>(
      sql.raw(`select "from" from pragma_foreign_key_list('sale_lines')`),
    );
    const catalogueForeignKeys = foreignKeys.filter((key) =>
      /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(key.from),
    );
    expect(catalogueForeignKeys).toEqual([]);
    // Whatever a new column is named, the only keys are the line's own sale and parent line.
    expect(foreignKeys.map((key) => key.from).sort()).toEqual(["parent_line_id", "sale_id"]);
  });
});

describe("sales — fiscal_state", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let saleId = "";

  beforeEach(async () => {
    await seed(suite.db);
    saleId = await recordCompleteSale(suite.db);
  });

  it("records fiscal_backend and fiscal_state in the same transaction as the sale", async () => {
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, saleId));
    expect(row!.fiscalBackend).toBe("verifactu");
    // The state AT ISSUANCE: the legally-required record exists locally, regardless of whether
    // anything has been sent anywhere.
    expect(row!.fiscalState).toBe("recorded");
  });

  it("holds no submission state, so there is nothing on it to advance", () => {
    // Submission state mutates and this table cannot be updated. Matches column NAMES only, so a
    // submission column under an unrelated name passes.
    const offenders = columnsOf(suite.db, "sales")
      .map((c) => c.name)
      .filter((n) => /(sent|submitted|acked|acknowledged|attempt|retry|csv|error)/i.test(n));
    expect(offenders).toEqual([]);
  });

  it("permits exactly two fiscal_state values", async () => {
    // Issuance classifications, not lifecycle stages: a third value is how this column drifts
    // back into being a submission state machine.
    expect(ddlOf(suite.db, "sales")).toContain(
      `CONSTRAINT "sales_fiscal_state_ck" CHECK("sales"."fiscal_state" in ('recorded', 'not_applicable'))`,
    );
    const notApplicable = await recordCompleteSale(suite.db, {
      invoiceNumber: 2,
      fiscalState: "not_applicable",
    });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, notApplicable));
    expect(row!.fiscalState).toBe("not_applicable");
    // Raw SQL, because the column's TypeScript type admits only the two.
    const error = await captureError(() =>
      withTransaction(suite.db, async (tx) =>
        tx.run(
          sql`insert into sales (id, till_id, node_id, series_id, invoice_number, issued_at,
                 issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
                 fiscal_backend, fiscal_state)
               values ('sale-third-state', ${TILL_A1}, ${nodeA}, ${seriesA}, 3, ${AT}, 120,
                 100, '[]', 'es', '["es","ca"]', 'verifactu', 'submitted')`,
        ),
      ),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/sales_fiscal_state_ck/);
  });
});

/**
 * A corrective sale is written header-only here (no tenders): the refund is a separate payments
 * action and `tenders_amount_ck` forbids a negative tender anyway.
 */
describe("sales — corrective link and negative total", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let originalSaleId = "";
  let rawSeq = 0;

  beforeEach(async () => {
    await seed(suite.db);
    originalSaleId = await recordCompleteSale(suite.db);
  });

  // `id` is supplied because it is a `$defaultFn` column Drizzle fills client-side.
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
    const nodeId = opts.nodeId ?? nodeA;
    const seriesId = opts.seriesId ?? seriesA;
    const locales = JSON.stringify(opts.invoiceLocales ?? ["es", "ca"]);
    rawSeq += 1;
    return withTransaction(suite.db, (tx) =>
      Promise.resolve(
        tx.all<{ id: string }>(
          sql`insert into sales (id, till_id, node_id, series_id, invoice_number, issued_at,
                 issued_offset_minutes, total, vat_breakdown, locale, invoice_locales,
                 fiscal_backend, fiscal_state, corrects_sale_id)
               values (${`raw-sale-${rawSeq}`}, ${tillId}, ${nodeId}, ${seriesId},
                 ${opts.invoiceNumber}, ${AT}, 120, ${opts.total}, '[]', 'es', ${locales},
                 'verifactu', 'recorded', ${opts.correctsSaleId})
               returning id`,
        ),
      ),
    );
  }

  it("accepts a corrective sale carrying a negative total when the link is set", async () => {
    const inserted = await insertSale({
      total: -100,
      correctsSaleId: originalSaleId,
      invoiceNumber: 2,
    });
    expect(inserted).toHaveLength(1);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, inserted[0]!.id));
    expect(row!.total).toBe(-100);
    expect(row!.correctsSaleId).toBe(originalSaleId);
  });

  it("rejects an ordinary sale carrying a negative total", async () => {
    // Negative control: with no corrective link, a negative total is still refused.
    const error = await captureError(() =>
      insertSale({ total: -100, correctsSaleId: null, invoiceNumber: 2 }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(engineErrorMessage(error)).toMatch(/sales_total_ck/);
  });

  it("still accepts a corrective sale with a positive total", async () => {
    // The link relaxes the sign; it does not force it.
    const inserted = await insertSale({
      total: 100,
      correctsSaleId: originalSaleId,
      invoiceNumber: 2,
    });
    expect(inserted).toHaveLength(1);
  });

  it("leaves corrects_sale_id null on an ordinary sale", async () => {
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, originalSaleId));
    expect(row!.correctsSaleId).toBeNull();
  });

  it("allows a sale to be corrected more than once", async () => {
    // NOT unique, unlike sale_voids_sale_id_key: successive corrective invoices are legitimate.
    await insertSale({ total: -100, correctsSaleId: originalSaleId, invoiceNumber: 2 });
    const second = await insertSale({
      total: -50,
      correctsSaleId: originalSaleId,
      invoiceNumber: 3,
    });
    expect(second).toHaveLength(1);
    const linked = suite.db.all<{ n: number }>(
      sql`select cast(count(*) as int) as n from sales where corrects_sale_id = ${originalSaleId}`,
    );
    expect(linked[0]!.n).toBe(2);
  });

  it("rejects a corrective link to a sale that does not exist", async () => {
    const error = await captureError(() =>
      insertSale({
        total: -100,
        correctsSaleId: "99999999-9999-4999-8999-999999999999",
        invoiceNumber: 2,
      }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

/**
 * The "carries no catalogue identifier" test above is weaker than its name: it matches
 * sale_lines' column NAMES against a regex, so a catalogue reference added under a name that does
 * not end in one of those words is invisible to it.
 */
describe("sale_lines — parent line self-link", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let saleId = "";
  let rawLineSeq = 0;

  beforeEach(async () => {
    await seed(suite.db);
    // One top-level line, line_no 1 — the parent candidate.
    saleId = await recordCompleteSale(suite.db);
  });

  async function insertLine(opts: {
    saleId: string;
    lineNo: number;
    parentLineId: string | null;
    descriptions?: string;
  }): Promise<{ id: string }[]> {
    const descriptions = opts.descriptions ?? '{"es":"Café solo","ca":"Cafè sol"}';
    rawLineSeq += 1;
    return withTransaction(suite.db, (tx) =>
      Promise.resolve(
        tx.all<{ id: string }>(
          sql`insert into sale_lines (id, sale_id, line_no, name, descriptions, quantity,
                 unit_price, vat_rate, line_total, parent_line_id)
               values (${`raw-line-${rawLineSeq}`}, ${opts.saleId}, ${opts.lineNo}, 'Café solo',
                 ${descriptions}, 1000, 100, 1000, 100, ${opts.parentLineId})
               returning id`,
        ),
      ),
    );
  }

  it("links a child line to its parent line", async () => {
    const [parent] = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    const [child] = await insertLine({ saleId, lineNo: 2, parentLineId: parent!.id });
    const [row] = suite.db.all<{
      parent_line_id: string;
      quantity: string;
      vat_rate: string;
    }>(
      // The counts are read back to pin the raw helper's scales: a quantity of one written as `1`
      // stores one thousandth and a 10.00% rate written as `10` a hundredth of a percent, and no
      // CHECK refuses either. Cast to text so the assertion does not turn on how the driver
      // renders the integer.
      sql`select parent_line_id, cast(quantity as text) as quantity,
                 cast(vat_rate as text) as vat_rate
            from sale_lines where id = ${child!.id}`,
    );
    expect(row!.parent_line_id).toBe(parent!.id);
    expect(row!.quantity).toBe("1000");
    expect(row!.vat_rate).toBe("1000");
  });

  it("leaves parent_line_id null on a top-level line", async () => {
    const [row] = suite.db.all<{ parent_line_id: string | null }>(
      sql`select parent_line_id from sale_lines where sale_id = ${saleId} and line_no = 1`,
    );
    expect(row!.parent_line_id).toBeNull();
  });
});
