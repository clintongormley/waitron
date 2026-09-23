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
import { isPgError } from "../unique-violation.js";
import { withTransaction } from "../tenancy.js";
import { captureError, pgErrorMessage } from "../testing/errors.js";
import { seedNode } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { saleLines, sales, tenders } from "./sales.js";
import { invoiceSeries } from "./series.js";
import { locations, tenants, tills } from "./tenants.js";

/**
 * FOUR LOSSES, from the storage swap:
 *  - the TRUNCATE case is deleted. SQLite has no `TRUNCATE` statement and no trigger event for
 *    `DROP TABLE`, so the statement-level guards that blocked a table-wide wipe of
 *    sales/sale_lines/tenders have no counterpart at all
 *    (`packages/store/src/append-only.ts` states this in its own words). Nothing now refuses a
 *    caller that can issue DDL.
 *  - the money-column case can no longer say a money column is SIXTY-FOUR BITS wide. PostgreSQL
 *    reported `bigint`, precision 64, scale 0; SQLite has one integer type and `pragma table_info`
 *    reports the declared word, so a column narrowed to four bytes would be invisible here. The
 *    part that survives — that it is an integer and not a decimal — is what the case still asserts.
 *  - the fiscal_state case read `pg_enum`. There is no enum TYPE here; the labels live in a CHECK
 *    (`packages/db/src/schema/columns.ts`'s `enumType`/`enumCheck`), so the set is established by
 *    writing each label and refusing a third, and the constraint's own text is read as the
 *    enumeration.
 *  - `sale_lines.variant_id`'s foreign-key absence was read out of `information_schema`'s three
 *    constraint views by COLUMN. `pragma foreign_key_list` answers the same question, but SQLite
 *    stores no constraint NAME, so nothing here could name the key if one appeared.
 */

const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Since the node-id rekey (2026-08-03) both invoice_series and sales carry a NOT NULL node_id;
// sales keeps till_id too, and adds the (node_id) → nodes FK. seed() creates one node, and
// saleValues() defaults to it.
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
    // The filed per-rate breakdown. `[]` here because these fixtures do not exercise the
    // breakdown — the column is just NOT NULL and must carry a valid array; the tests that DO care
    // about its content are record-sale.test.ts (the equality-to-filed proof) and the column
    // assertion below.
    vatBreakdown: [] as { rate: string; base: string; tax: string }[],
    locale: "es",
    invoiceLocales: ["es", "ca"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded" as const,
    ...overrides,
  };
}

/**
 * Writes a sale — header, lines and tenders — in one transaction. Every test that needs a sale on
 * disk goes through here.
 *
 * Tender coverage is checked when settlement is declared, on the `sale_settlements` INSERT, tested
 * in sale-settlements.test.ts. So a sale written here can stand legitimately uncovered — an
 * unsettled sale is a valid steady state under invoice-first (design §3). The default tender is
 * coherent anyway (amount = total, no tip) so callers can settle it if they need to; each tender
 * carries its own `tip_amount` (design §9.2), defaulted to zero.
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
      // One unit and a 10.00% rate, counted in whole thousandths and whole basis points
      // (`quantity()` and `rate()` in packages/db/src/schema/columns.ts).
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
 * names. There is no `pg_constraint` to ask instead. */
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
    // The sale carries one money value: `total`. The tip belongs to `tenders.tip_amount`
    // (attributed to the payer who left it) and amount_charged is derived, never stored
    // (design §3). Here a €1.00 sale is paid with a €1.50 tender carrying a €0.50 tip — three
    // still-distinct figures, but only `total` lives on the sale.
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
    // findings §1: records are identified by issuer + series & number + date, and AEAT returns
    // error 3000 on a duplicate. The database refuses first.
    await recordCompleteSale(suite.db);
    const error = await captureError(() => recordCompleteSale(suite.db));
    expect(isPgError(error, UNIQUE_VIOLATION)).toBe(true);
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
      // A money column counts whole cents (`money()` in packages/db/src/schema/columns.ts), so a
      // column that slipped back to a decimal type fails here. See this file's header for what
      // this reading can no longer say.
      // `pragma table_info` reports the type in the CASE the DDL declared it, not normalised.
      expect(col!.type).toBe("INTEGER");
    }
  });

  it("stores vat_breakdown as a NOT NULL column", () => {
    // vat_breakdown: the filed per-rate breakdown ({rate, base, tax}[]), a queryable copy of what
    // the hash-chained record carries, so reporting can compute an exact VAT summary without a
    // cross-boundary join (spec 8a). NOT NULL is the forcing function that made every
    // sale-creating path populate it, so the nullability is pinned here. The stored TYPE is `text`
    // on this engine — `json` is a Drizzle read/write mode, not a column type
    // (`packages/db/src/schema/columns.ts`), so no reading of the catalogue separates this column
    // from a plain one.
    const col = columnsOf(suite.db, "sales").find((c) => c.name === "vat_breakdown");
    expect(col).toEqual({ name: "vat_breakdown", type: "TEXT", notnull: 1 });
  });

  it("sums line totals exactly, with no float drift", async () => {
    // Three lines of 10, 20 and 70 cents summing to 100. What this asserted before the money
    // columns became integers was a FORMAT difference; on an integer column that bite is GONE, so
    // this now asserts only that the database sums cents.
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
    // Three scales, one read mapping. Money counts whole cents, a quantity whole thousandths and
    // a rate whole basis points, and every one arrives from the driver as a JS number.
    const id = await recordCompleteSale(suite.db, {}, [
      { method: "card", amount: 150, tipAmount: 50 },
    ]);
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(typeof row!.total).toBe("number");
    // The tender's amount and tip_amount are money too — the same driver path, checked here so a
    // mapping that reverts any of the three surfaces to a string is caught.
    const [tender] = await suite.db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(typeof tender!.amount).toBe("number");
    expect(typeof tender!.tipAmount).toBe("number");
    // The two non-money scales on the sale line, each read through its own column helper.
    const [line] = await suite.db.select().from(saleLines).where(eq(saleLines.saleId, id));
    expect(typeof line!.quantity).toBe("number");
    expect(typeof line!.vatRate).toBe("number");
  });

  it("stores issued_at with its offset alongside", async () => {
    // UTC plus offset, never a formatted local time. The offset is what makes a receipt reprinted
    // from another timezone still read 21:20.
    const id = await recordCompleteSale(suite.db, { issuedOffsetMinutes: 120 });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.issuedOffsetMinutes).toBe(120);
  });

  it("requires a node_id referencing nodes", async () => {
    // Node-id rekey (2026-08-03, plan Task 4 §5): sales.node_id is NOT NULL with a
    // (node_id) → nodes FK — the node that chained the sale (#33). till_id stays (where the sale
    // rang); this is the node beside it.
    const col = columnsOf(suite.db, "sales").find((c) => c.name === "node_id");
    expect(col!.notnull).toBe(1);
    // A sale carries its node_id ...
    const plainId = await recordCompleteSale(suite.db);
    const [plain] = await suite.db.select().from(sales).where(eq(sales.id, plainId));
    expect(plain!.nodeId).toBe(nodeA);
    // ... and a sale with no node_id is refused (NOT NULL). Raw SQL because the drizzle `sales`
    // insert type requires node_id, so the omission can only be expressed at the SQL layer. `id`
    // is stated because it is a `$defaultFn` column Drizzle fills client-side, and omitting it
    // would be refused NOT NULL on the WRONG column.
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
    expect(isPgError(error, NOT_NULL_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toBe("NOT NULL constraint failed: sales.node_id");
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // The FK guarantees referential existence: a node id with no `nodes` row is refused.
    const error = await captureError(() =>
      suite.db.insert(sales).values(
        saleValues({
          invoiceNumber: 2,
          nodeId: "99999999-9999-4999-8999-999999999999",
        }),
      ),
    );
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(true);
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
    // Spec §9: a receipt reprinted a year later must read identically to the one the customer
    // took, and corrective invoices inherit the ORIGINAL list. Reading through locations at print
    // time would break both.
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
    // Two locales means both languages on the same invoice rendered in that order. A set-valued
    // snapshot would render Catalan first half the time.
    const id = await recordCompleteSale(suite.db, { invoiceLocales: ["ca", "es"], locale: "ca" });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, id));
    expect(row!.invoiceLocales).toEqual(["ca", "es"]);
  });

  it("rejects a locale that is not in the snapshot", async () => {
    const error = await captureError(() => recordCompleteSale(suite.db, { locale: "en" }));
    // SQLite reports a named CHECK as `CHECK constraint failed: <name>`, so the constraint the
    // PostgreSQL version named is still the thing this asserts.
    expect(pgErrorMessage(error)).toMatch(/sales_locale_member_ck/);
  });

  it("rejects more than two invoice locales", async () => {
    const error = await captureError(() =>
      recordCompleteSale(suite.db, { invoiceLocales: ["es", "ca", "en"] }),
    );
    expect(pgErrorMessage(error)).toMatch(/sales_invoice_locales_ck/);
  });
});

describe("sales — tender coverage", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

  beforeEach(async () => {
    await seed(suite.db);
  });

  it("accepts a split tender across two rows", async () => {
    // Since 0012 there is no coverage check at tender INSERT — a sale may sit legitimately
    // part-tendered until settlement is declared (design §3), so this only asserts both rows land.
    const id = await recordCompleteSale(suite.db, {}, [
      { method: "cash", amount: 100 },
      { method: "card", amount: 50 },
    ]);
    const found = await suite.db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(found).toHaveLength(2);
  });

  // tenders_amount_ck (design §7 deletion matrix). This constraint had NO test at all before 0012
  // tightened it from `amount <> 0` to `amount > 0`, in either direction — so both boundaries get
  // one. The sale these hang off is unsettled, so the post-settlement tender guard never fires;
  // the CHECK is what rejects.
  it("rejects a zero-amount tender", async () => {
    const id = await recordCompleteSale(suite.db);
    // amount 0 with the default tip 0 passes tenders_tip_amount_ck (0 <= 0), so tenders_amount_ck
    // is the only constraint that can fire here.
    const error = await captureError(() =>
      suite.db.insert(tenders).values({ saleId: id, method: "cash", amount: 0, settledAt: AT }),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenders_amount_ck/);
  });

  it("rejects a negative-amount tender", async () => {
    const id = await recordCompleteSale(suite.db);
    // Only the CLASS is pinned, deliberately, NOT the constraint name: a negative amount violates
    // BOTH checks at once — tenders_amount_ck (`> 0`) and tenders_tip_amount_ck (`tip <= amount`,
    // which no tip >= 0 can satisfy when amount < 0) — and which name the engine reports is not
    // guaranteed. So this proves "a negative tender is refused", jointly enforced; the zero case
    // above is the one that isolates tenders_amount_ck.
    const error = await captureError(() =>
      suite.db.insert(tenders).values({
        saleId: id,
        method: "cash",
        amount: -1000,
        settledAt: AT,
      }),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
  });

  it("accepts a positive-amount tender", async () => {
    const id = await recordCompleteSale(suite.db);
    const [inserted] = await suite.db
      .insert(tenders)
      .values({ saleId: id, method: "cash", amount: 1000, settledAt: AT })
      .returning();
    expect(inserted!.amount).toBe(1000);
  });

  // tenders_tip_amount_ck (design §7 deletion matrix): the tip is PART of the amount, never on top
  // (`0 <= tip_amount <= amount`), because the terminal is sent one final figure (design §4).
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
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
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
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
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
    // On PostgreSQL the grants stopped the application and the trigger stopped the owner, and this
    // case was the only one that distinguished them. SQLite has neither roles nor grants, so there
    // is one layer and this is it.
    const update = await captureError(() =>
      suite.db.update(sales).set({ total: 99900 }).where(eq(sales.id, saleId)),
    );
    expect(isPgError(update, TRIGGER_ABORT)).toBe(true);
    expect(pgErrorMessage(update)).toBe("sales is append-only");

    const remove = await captureError(() => suite.db.delete(sales).where(eq(sales.id, saleId)));
    expect(isPgError(remove, TRIGGER_ABORT)).toBe(true);
    expect(pgErrorMessage(remove)).toBe("sales is append-only");
  });

  it("carries only the chosen variant snapshot identifier, with no live catalogue link", () => {
    const catalogueShapedIds = columnsOf(suite.db, "sale_lines")
      .map((c) => c.name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(n));
    expect(catalogueShapedIds).toEqual(["variant_id"]);

    const variantForeignKeys = suite.db
      .all<{ from: string }>(sql.raw(`select "from" from pragma_foreign_key_list('sale_lines')`))
      .filter((key) => key.from === "variant_id");
    expect(variantForeignKeys).toEqual([]);
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
    // The state AT ISSUANCE: the legally-required record exists locally, which in Spain is the
    // point at which the sale is compliant, regardless of whether anything has been sent anywhere.
    expect(row!.fiscalState).toBe("recorded");
  });

  it("holds no submission state, so there is nothing on it to advance", () => {
    // Spec §3 puts submission state on the `envios` sidecar precisely because it mutates
    // constantly and this table cannot be updated. A column named for sending, acknowledging or
    // retrying reappearing here is the regression this test exists to catch.
    const offenders = columnsOf(suite.db, "sales")
      .map((c) => c.name)
      .filter((n) => /(sent|submitted|acked|acknowledged|attempt|retry|csv|error)/i.test(n));
    expect(offenders).toEqual([]);
  });

  it("permits exactly two fiscal_state values", async () => {
    // recorded | not_applicable — issuance classifications, not lifecycle stages. A third value
    // arriving is how this column drifts back into being a submission state machine.
    //
    // The enumeration is a CHECK, not a type: its text is read here, and both labels are then
    // WRITTEN so the constraint is shown to admit each and refuse a third.
    expect(ddlOf(suite.db, "sales")).toContain(
      `CONSTRAINT "sales_fiscal_state_ck" CHECK("sales"."fiscal_state" in ('recorded', 'not_applicable'))`,
    );
    const notApplicable = await recordCompleteSale(suite.db, {
      invoiceNumber: 2,
      fiscalState: "not_applicable",
    });
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, notApplicable));
    expect(row!.fiscalState).toBe("not_applicable");
    // A third label is refused. Raw SQL, because the column's TypeScript type admits only the two.
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
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
    expect(pgErrorMessage(error)).toMatch(/sales_fiscal_state_ck/);
  });
});

/**
 * The corrective-invoice link. `corrects_sale_id` is the generic-layer projection of "this sale
 * corrects that one" — a nullable FK back onto `sales`, NOT unique (a sale may be corrected more
 * than once), and it is what relaxes `sales_total_ck` to permit the negative total a
 * `rectificativa por diferencias` carries
 * (`docs/superpowers/plans/2026-08-02-rectificativas.md` §2.1).
 *
 * A corrective sale is written header-only here (no tenders): the refund is a separate payments
 * action and `tenders_amount_ck` (`amount > 0`) forbids a negative tender anyway, so an unsettled
 * corrective is the steady state.
 */
describe("sales — corrective link and negative total", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let originalSaleId = "";
  let rawSeq = 0;

  beforeEach(async () => {
    await seed(suite.db);
    // An ordinary sale to be corrected. invoice_number 1 in seriesA.
    originalSaleId = await recordCompleteSale(suite.db);
  });

  // Raw insert of a corrective (or ordinary) sale HEADER — deliberately not the drizzle `sales`
  // object, so a RED phase fails on the real cause (a missing column, i.e. the migration is
  // absent) rather than on a TypeScript compile error. `id` is supplied for the reason every raw
  // insert in this file supplies it: it is a `$defaultFn` column Drizzle fills client-side.
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
    // record-sale passes `total` straight into the fiscal record's `ImporteTotal`, which the
    // fiscal fingerprint hashes, so `sales.total` must hold the negative value the corrective
    // needs (findings §10.2, plan §2.1).
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
    // Negative control: with no corrective link, the relaxed check still rejects a negative total
    // exactly as the original `total >= 0` did. An ordinary sale is never negative.
    const error = await captureError(() =>
      insertSale({ total: -100, correctsSaleId: null, invoiceNumber: 2 }),
    );
    expect(isPgError(error, CHECK_VIOLATION)).toBe(true);
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
    const [row] = await suite.db.select().from(sales).where(eq(sales.id, originalSaleId));
    expect(row!.correctsSaleId).toBeNull();
  });

  it("allows a sale to be corrected more than once", async () => {
    // NOT unique, unlike sale_voids_sale_id_key: successive corrective invoices against one sale
    // are legitimate (plan §2.1). Two correctives pointing at the same original both land.
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
    // Foreign key violation — the (corrects_sale_id) FK onto sales.
    expect(isPgError(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });
});

/**
 * The sale_line → parent sale_line self-link (ordering modifiers, Task 2). `parent_line_id` is
 * presentation/reporting metadata ONLY — `backend.recordSale` is handed the sale's own header
 * fields and never `sale_lines` at all (the twelve are named at
 * `packages/core/src/record-sale.ts:389-408`), so this column never reaches the fiscal fingerprint
 * (design §4). An extras pick files as its own child line pointing at the dish line it belongs to;
 * a top-level line leaves it NULL.
 *
 * The (parent_line_id) → sale_lines(id) FK keeps the link referential (mirrors sale_lines_sale_fk);
 * a NULL parent satisfies it, so ordinary lines are untouched. sale_lines carries NO reference to
 * any extras or options table: the one catalogue-shaped id a filed line keeps is `variant_id`, the
 * snapshot of the chosen variant, and it carries no foreign key back to the catalogue — everything
 * else the line holds is frozen names. The "carries only the chosen variant snapshot identifier"
 * test above guards that, and is weaker than its name: it matches sale_lines' column NAMES against
 * a regex, so a catalogue reference added under a name that does not end in one of those words is
 * invisible to it.
 */
describe("sale_lines — parent line self-link", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let saleId = "";
  let rawLineSeq = 0;

  beforeEach(async () => {
    await seed(suite.db);
    // A sale with one (top-level) line, line_no 1 — the parent candidate.
    saleId = await recordCompleteSale(suite.db);
  });

  // Raw insert so a RED phase fails on the missing column/constraint, not a TypeScript compile
  // error against the drizzle `saleLines` type (the corrects-link block above does the same).
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
      // The counts are read back so the raw helper above is pinned: a quantity of one written as
      // `1` stores one thousandth and a 10.00% rate written as `10` a hundredth of a percent, and
      // `sale_lines_quantity_ck` and `sale_lines_vat_rate_ck` (sales.ts) refuse neither. Cast to
      // text so the assertion does not turn on how the driver renders the integer.
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
