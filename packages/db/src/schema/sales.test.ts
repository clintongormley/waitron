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
import { saleLines, sales, tenders } from "./sales.js";
import { locations, tenants, tills } from "./tenants.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const LOCATION_A = "aaaaaaaa-0000-4000-8000-000000000001";
const LOCATION_B = "bbbbbbbb-0000-4000-8000-000000000001";
const TILL_A1 = "aaaaaaaa-1111-4000-8000-000000000001";
const TILL_B1 = "bbbbbbbb-1111-4000-8000-000000000001";
const AT = "2026-07-20T19:20:30+00:00";

// Since the node-id rekey (2026-08-03) both invoice_series and sales carry a NOT NULL node_id;
// sales keeps till_id too, and adds the composite (tenant_id, node_id) → nodes FK. seed() creates
// one node per tenant so a sale's node shares its tenant (the composite FK), and saleValues()
// defaults to tenant A's node.
let seriesA = "";
let seriesB = "";
let nodeA = "";
let nodeB = "";

async function rows<T>(db: Database, query: ReturnType<typeof sql>): Promise<T[]> {
  const result = (await db.execute(query)) as unknown as { rows: T[] } | T[];
  return Array.isArray(result) ? result : result.rows;
}

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
    { id: TILL_B1, tenantId: TENANT_B, locationId: LOCATION_B, name: "B1" },
  ]);
  nodeA = await seedNode(db, brandTenantId(TENANT_A), brandLocationId(LOCATION_A));
  nodeB = await seedNode(db, brandTenantId(TENANT_B), brandLocationId(LOCATION_B));
  const [a] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_A, nodeId: nodeA, code: "FA", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  const [b] = await db
    .insert(invoiceSeries)
    .values({ tenantId: TENANT_B, nodeId: nodeB, code: "FB", purpose: "standard" })
    .returning({ id: invoiceSeries.id });
  seriesA = a.id;
  seriesB = b.id;
}

function saleValues(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT_A,
    tillId: TILL_A1,
    nodeId: nodeA,
    seriesId: seriesA,
    invoiceNumber: 1,
    issuedAt: AT,
    issuedOffsetMinutes: 120,
    total: "1.00",
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
 * Since migration 0012 the tender-coverage check no longer fires at sale COMMIT
 * (both deferred constraint triggers were dropped); it runs when settlement is
 * DECLARED, on the `sale_settlements` INSERT, tested in sale-settlements.test.ts.
 * So a sale written here can stand legitimately uncovered — an unsettled sale is
 * a valid steady state under invoice-first (design §3). The default tender is
 * coherent anyway (amount = total, no tip) so callers can settle it if they
 * need to; each tender carries its own `tip_amount` (design §9.2), defaulted to
 * "0.00".
 */
async function recordCompleteSale(
  db: Database,
  overrides: Record<string, unknown> = {},
  tenderRows: { method: "cash" | "card"; amount: string; tipAmount?: string }[] = [
    { method: "card", amount: "1.00" },
  ],
): Promise<string> {
  return db.transaction(async (tx) => {
    const [sale] = await tx.insert(sales).values(saleValues(overrides)).returning({ id: sales.id });
    await tx.insert(saleLines).values({
      tenantId: (overrides.tenantId as string) ?? TENANT_A,
      saleId: sale.id,
      lineNo: 1,
      descriptions: { es: "Café solo", ca: "Cafè sol" },
      quantity: "1.000",
      unitPrice: "1.00",
      vatRate: "10.00",
      lineTotal: "1.00",
    });
    await tx.insert(tenders).values(
      tenderRows.map((t) => ({
        tenantId: (overrides.tenantId as string) ?? TENANT_A,
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

// NOTE on fixtures: unlike series.test.ts/orders.test.ts, beforeEach here does
// NOT `truncate table tenants cascade` before seeding. target.create() (see
// testing/harness.ts) already returns a freshly migrated database with no
// rows, so the truncate was a no-op in those files. Here it would not be a
// no-op: TRUNCATE ... CASCADE fires the BEFORE TRUNCATE statement trigger on
// every table it cascades into, not only the table named in the statement —
// verified live against PGlite — and sales/sale_lines/tenders are reachable by
// cascade from tenants (via till_id/tenant_id). Keeping the truncate would
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
    // Since 0012 the sale drops to one number: `total`. The tip moved to
    // `tenders.tip_amount` (attributed to the payer who left it) and
    // amount_charged is derived, never stored (design §3). Here a €1.00 sale is
    // paid with a €1.50 tender carrying a €0.50 tip — three still-distinct
    // figures, but only `total` lives on the sale.
    const id = await recordCompleteSale(db, {}, [
      { method: "card", amount: "1.50", tipAmount: "0.50" },
    ]);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.total).toBe("1.00");
    const [tender] = await db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(tender.amount).toBe("1.50");
    expect(tender.tipAmount).toBe("0.50");
  });

  it("rejects a duplicate invoice number within a series", async () => {
    // findings §1: records are identified by issuer + serie&número + date, and
    // AEAT returns error 3000 on a duplicate. The database refuses first.
    await recordCompleteSale(db);
    const error = await captureError(() => recordCompleteSale(db));
    expect(pgErrorMessage(error)).toMatch(/duplicate key value/);
  });

  it("permits the same invoice number in two different series", async () => {
    const [other] = await db
      .insert(invoiceSeries)
      .values({ tenantId: TENANT_A, nodeId: nodeA, code: "RA", purpose: "rectificative" })
      .returning({ id: invoiceSeries.id });
    await recordCompleteSale(db);
    const second = await recordCompleteSale(db, { seriesId: other.id });
    expect(second).toBeTruthy();
  });

  it("stores every monetary column as numeric(12, 2)", async () => {
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
      expect(col.data_type).toBe("numeric");
      expect(col.numeric_precision).toBe(12);
      expect(col.numeric_scale).toBe(2);
    }
  });

  it("sums line totals exactly, with no float drift", async () => {
    // 0.10, 0.20 and 0.70 are not exactly representable in binary64. This
    // test's actual bite, though, is not the drift value itself: verified
    // live, the failure under a double-precision mutation of these columns
    // is `expected '1' to be '1.00'`, not '0.9999999999999999', and a
    // "vacuous" fixture (e.g. 0.25/0.25/0.50, chosen to sum exactly under
    // either type) fails identically. The mechanism is that
    // `sum(...)::text` on numeric(12, 2) always renders at scale 2 ("1.00"),
    // while float8's `::text` output never pads to a fixed scale regardless
    // of whether the underlying arithmetic drifted — so this assertion is an
    // exact-format string match, fixture-independent, and it is that format
    // difference doing the work here, not binary64 summation error.
    const id = await db.transaction(async (tx) => {
      const [sale] = await tx
        .insert(sales)
        .values(saleValues({ total: "1.00" }))
        .returning({ id: sales.id });
      await tx.insert(saleLines).values(
        ["0.10", "0.20", "0.70"].map((amount, i) => ({
          tenantId: TENANT_A,
          saleId: sale.id,
          lineNo: i + 1,
          // Not "Línea"/"Línia": "linea" is on english-only.ts's guarded
          // Spanish wordlist (SPANISH_WORDS), so that literal fails this
          // package's own English-only build. "Café solo"/"Cafè sol" is the
          // placeholder description this file already uses elsewhere.
          descriptions: { es: "Café solo", ca: "Cafè sol" },
          quantity: "1.000",
          unitPrice: amount,
          vatRate: "10.00",
          lineTotal: amount,
        })),
      );
      await tx.insert(tenders).values({
        tenantId: TENANT_A,
        saleId: sale.id,
        method: "cash",
        amount: "1.00",
        settledAt: AT,
      });
      return sale.id;
    });

    const [summed] = await rows<{ total: string }>(
      db,
      sql`select sum(line_total)::text as total from sale_lines where sale_id = ${id}::uuid`,
    );
    expect(summed.total).toBe("1.00");
  });

  it("returns monetary values as strings, not JS numbers", async () => {
    // node-postgres renders numeric as a string precisely so no value passes
    // through binary64. A registered type parser that "helpfully" converts to
    // Number would reintroduce the drift with nothing else changing.
    const id = await recordCompleteSale(db, {}, [
      { method: "card", amount: "1.50", tipAmount: "0.50" },
    ]);
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(typeof row.total).toBe("string");
    // The tender's amount and tip_amount are numeric(12, 2) too — the same
    // parser path, checked here so a registered Number-coercing parser on any
    // of the three surfaces is caught.
    const [tender] = await db.select().from(tenders).where(eq(tenders.saleId, id));
    expect(typeof tender.amount).toBe("string");
    expect(typeof tender.tipAmount).toBe("string");
  });

  it("stores issued_at with its offset alongside", async () => {
    // UTC plus offset, never a formatted local time. The offset is what makes
    // a receipt reprinted from another timezone still read 21:20.
    const id = await recordCompleteSale(db, { issuedOffsetMinutes: 120 });
    const [row] = await db.select().from(sales).where(eq(sales.id, id));
    expect(row.issuedOffsetMinutes).toBe(120);
  });

  it("requires a node_id referencing nodes", async () => {
    // Node-id rekey (2026-08-03, plan Task 4 §5): sales.node_id is now NOT NULL with a composite
    // tenant-consistent (tenant_id, node_id) → nodes FK — the node that chained the sale (#33).
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
        sql`insert into sales (
               tenant_id, till_id, series_id, invoice_number, issued_at, issued_offset_minutes,
               total, locale, invoice_locales, fiscal_backend, fiscal_state
             ) values (
               ${TENANT_A}, ${TILL_A1}, ${seriesA}, 2, ${AT}, 120,
               '1.00', 'es', array['es', 'ca']::text[], 'verifactu', 'recorded'
             )`,
      ),
    );
    expect(pgErrorMessage(error)).toMatch(/null value in column "node_id"/);
  });

  it("rejects a node_id that does not exist with a foreign-key violation", async () => {
    // The composite FK guarantees referential existence: a node id with no `nodes` row is refused.
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
    // one the customer took, and rectificativas inherit the ORIGINAL list.
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
      { method: "cash", amount: "1.00" },
      { method: "card", amount: "0.50" },
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
      db
        .insert(tenders)
        .values({ tenantId: TENANT_A, saleId: id, method: "cash", amount: "0.00", settledAt: AT }),
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
        tenantId: TENANT_A,
        saleId: id,
        method: "cash",
        amount: "-10.00",
        settledAt: AT,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
  });

  it("accepts a positive-amount tender", async () => {
    const id = await recordCompleteSale(db);
    const [inserted] = await db
      .insert(tenders)
      .values({ tenantId: TENANT_A, saleId: id, method: "cash", amount: "10.00", settledAt: AT })
      .returning();
    expect(inserted.amount).toBe("10.00");
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
        tenantId: TENANT_A,
        saleId: id,
        method: "card",
        amount: "10.00",
        tipAmount: "15.00",
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
        tenantId: TENANT_A,
        saleId: id,
        method: "card",
        amount: "10.00",
        tipAmount: "10.00",
        settledAt: AT,
      })
      .returning();
    expect(inserted.tipAmount).toBe("10.00");
  });

  it("rejects a negative tip", async () => {
    const id = await recordCompleteSale(db);
    const error = await captureError(() =>
      db.insert(tenders).values({
        tenantId: TENANT_A,
        saleId: id,
        method: "card",
        amount: "10.00",
        tipAmount: "-1.00",
        settledAt: AT,
      }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/tenders_tip_amount_ck/);
  });

  it("owns the tender-coverage check with a role that cannot itself be filtered by tenant isolation", async () => {
    // sales_assert_tenders_cover is SECURITY DEFINER, but that alone does not
    // stop it going fail-OPEN: FORCE ROW LEVEL SECURITY (0005_sales.sql)
    // subjects the function's OWNER to the tenant-isolation policy too, so an
    // ordinary non-superuser owner would find the sale row invisible the
    // moment app.tenant_id is cleared, read `sale_total` as NULL, take the
    // early RETURN, and let a mis-summed settlement be declared complete —
    // verified live against a genuine non-superuser, non-BYPASSRLS owner while
    // fixing this. Since 0012 the function fires on the sale_settlements INSERT,
    // not at sale COMMIT; the FUNCTIONAL fail-open reproduction now lives in
    // sale-settlements.test.ts ("still refuses a mis-summed settlement when
    // app.tenant_id is cleared"). This test pins the STRUCTURE that makes that
    // one trustworthy.
    //
    // The actual guarantee is this introspection: the function's owner,
    // sales_coverage_checker, is itself neither a superuser nor BYPASSRLS —
    // it relies on a role-scoped permissive SELECT policy instead (asserted
    // below) — which is what makes the functional test below trustworthy
    // rather than accidentally green because the test harness's own
    // migration owner happens to be a superuser (see testing/roles.ts: this
    // harness's connections are superuser and bypass RLS unconditionally,
    // which is exactly why a bare functional check is not enough on its own
    // here).
    const [owner] = await rows<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      db,
      sql`select r.rolname, r.rolsuper, r.rolbypassrls
            from pg_proc p
            join pg_roles r on r.oid = p.proowner
           where p.proname = 'sales_assert_tenders_cover'`,
    );
    expect(owner.rolname).toBe("sales_coverage_checker");
    expect(owner.rolsuper).toBe(false);
    expect(owner.rolbypassrls).toBe(false);

    // Existence is not correctness. A policy named right, on the right
    // table, scoped to the right role and command, still renders nothing
    // visible if its predicate is wrong — asserting only that the two
    // policies exist (as this test did before) would pass identically
    // whether their USING clause is `true` or `false`. The functional proof
    // that the predicate does its job — flipping `USING (true)` to
    // `USING (false)` in 0005_sales.sql makes a cleared-tenant settlement
    // sail through — lives in sale-settlements.test.ts, where the coverage
    // function actually fires. This test pins the STRUCTURE so that a future
    // change cannot silently weaken the predicate: read `qual` (the USING
    // expression, as Postgres renders it) directly, alongside `cmd` and
    // `roles`, and pin all three by value rather than by filtering for them in
    // the WHERE clause — a filter can only ever prove "some row happens to
    // satisfy this", not "this is the row's actual shape".
    const policies = await rows<{ tablename: string; cmd: string; roles: string[]; qual: string }>(
      db,
      // roles::text[] is deliberate: pg_policies.roles is name[] (oid 1003),
      // and node-postgres has no built-in array parser registered for that
      // oid — it comes back as the literal '{sales_coverage_checker}',
      // unparsed. Casting to text[] (oid 1009, which node-postgres does
      // parse) gets a real JS string array from both drivers.
      sql`select tablename, cmd, roles::text[] as roles, qual from pg_policies
           where policyname in ('sales_coverage_check_bypass', 'tenders_coverage_check_bypass')
           order by tablename`,
    );
    expect(policies).toEqual([
      { tablename: "sales", cmd: "SELECT", roles: ["sales_coverage_checker"], qual: "true" },
      { tablename: "tenders", cmd: "SELECT", roles: ["sales_coverage_checker"], qual: "true" },
    ]);
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

  it("refuses to update a sale's total as the app role", async () => {
    // Never run this as the owner. The owner bypasses RLS, can disable the
    // trigger, and here would also hold table-wide UPDATE — a green result
    // proving nothing whatsoever.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(sales).set({ total: "999.00" }).where(eq(sales.id, saleId));
      }),
    );
    expect(pgErrorMessage(error)).toMatch(
      /permission denied for table sales|column "total" of relation "sales"/,
    );
  });

  it("refuses to delete a sale as the app role", async () => {
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.delete(sales).where(eq(sales.id, saleId));
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table sales/);
  });

  it("refuses to truncate sales as the app role", async () => {
    // A row trigger does not fire on TRUNCATE, so TRUNCATE walks straight
    // through an immutability trigger unless it is separately stopped. The
    // app role has no TRUNCATE privilege at all, so this fails on privilege
    // grounds before the statement trigger is ever reached — see "stops the
    // owner truncating any of the three tables" below for the trigger itself.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.execute(sql`truncate table sales cascade`);
      }),
    );
    expect(pgErrorMessage(error)).toMatch(/permission denied for table sales/);
  });

  it("refuses to update or delete a sale line as the app role", async () => {
    const update = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(saleLines).set({ lineTotal: "999.00" });
      }),
    );
    expect(pgErrorMessage(update)).toMatch(/permission denied for table sale_lines/);

    const remove = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.delete(saleLines);
      }),
    );
    expect(pgErrorMessage(remove)).toMatch(/permission denied for table sale_lines/);
  });

  it("refuses to update or delete a tender as the app role", async () => {
    const update = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(tenders).set({ amount: "999.00" });
      }),
    );
    expect(pgErrorMessage(update)).toMatch(/permission denied for table tenders/);

    const remove = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.delete(tenders);
      }),
    );
    expect(pgErrorMessage(remove)).toMatch(/permission denied for table tenders/);
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
      db.update(sales).set({ total: "999.00" }).where(eq(sales.id, saleId)),
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

  it("hides another tenant's sale from the app role", async () => {
    await recordCompleteSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      nodeId: nodeB,
      seriesId: seriesB,
      invoiceLocales: ["es"],
      locale: "es",
    });
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales);
    });
    expect(visible).toHaveLength(1);
    expect(visible[0].id).toBe(saleId);
  });

  it("hides another tenant's sale line from the app role", async () => {
    // M1 (whole-branch review): sale_lines carries ENABLE + FORCE ROW LEVEL
    // SECURITY plus a tenant_isolation policy (immutability.test.ts's
    // auto-discovered flag guard asserts both booleans are set), but a
    // too-permissive predicate — `USING (true)`, or a mistyped column — would
    // pass that flag-level check while leaking every tenant's lines across
    // the app role. Only a functional read, from a second tenant's row set,
    // proves the predicate itself is doing the filtering. Mirrors "hides
    // another tenant's sale from the app role" immediately above.
    await recordCompleteSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      nodeId: nodeB,
      seriesId: seriesB,
      invoiceLocales: ["es"],
      locale: "es",
    });
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: saleLines.id }).from(saleLines);
    });
    expect(visible).toHaveLength(1);
  });

  it("hides another tenant's tender from the app role", async () => {
    // Same gap, same fix, on tenders — see the sale_lines test immediately
    // above for the full rationale.
    await recordCompleteSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      nodeId: nodeB,
      seriesId: seriesB,
      invoiceLocales: ["es"],
      locale: "es",
    });
    const visible = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: tenders.id }).from(tenders);
    });
    expect(visible).toHaveLength(1);
  });

  it("carries no reference to a catalogue on sale_lines", async () => {
    const cols = await rows<{ column_name: string }>(
      db,
      sql`select column_name from information_schema.columns where table_name = 'sale_lines'`,
    );
    const offenders = cols
      .map((c) => c.column_name)
      .filter((n) => /(product|item|catalogue|catalog|menu|sku|variant)_id$/i.test(n));
    expect(offenders).toEqual([]);
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

  it("refuses an UPDATE of fiscal_state as the app role", async () => {
    // MUST run as app_user. As the owner this would be caught by the trigger
    // instead, which proves nothing about the control: the owner can
    // ALTER TABLE ... DISABLE TRIGGER, and the application is never the owner.
    // 42501 insufficient_privilege is the assertion that matters here.
    //
    // The message is asserted too, not just the code: 42501 is also what an
    // RLS WITH CHECK violation raises ("new row violates row-level security
    // policy"), so the code alone cannot tell a privilege denial from an RLS
    // rejection. Only the message text distinguishes them — the same
    // precedent immutability.test.ts already follows for its own privilege
    // tests.
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        await tx.update(sales).set({ fiscalState: "not_applicable" }).where(eq(sales.id, saleId));
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
    expect(pgErrorMessage(error)).toMatch(/permission denied for table sales/);

    const [row] = await db.select().from(sales).where(eq(sales.id, saleId));
    expect(row.fiscalState).toBe("recorded");
  });

  it("holds no submission state, so there is nothing on it to advance", async () => {
    // Spec §3 puts submission state on the envios sidecar precisely because it
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

  it("refuses to change fiscal_backend as the app role", async () => {
    // Both the code and the message are asserted, and the message names the
    // table: a bare `/permission denied/` would match a denial on ANY table,
    // proving nothing specific to sales, and 42501 alone cannot distinguish a
    // privilege denial from an RLS WITH CHECK violation (see "refuses an
    // UPDATE of fiscal_state as the app role" above).
    const error = await captureError(() =>
      withTenant(db, TENANT_A, async (tx) => {
        await asAppUser(tx);
        return tx.update(sales).set({ fiscalBackend: "other" }).where(eq(sales.id, saleId));
      }),
    );
    expect(pgErrorCode(error)).toBe("42501");
    expect(pgErrorMessage(error)).toMatch(/permission denied for table sales/);
  });
});

/**
 * The rectificativa link (migration 0013). `corrects_sale_id` is the generic-layer
 * projection of "this sale corrects that one" — nullable, tenant-consistent FK back onto
 * `sales`, NOT unique (a sale may be corrected more than once), and it is what relaxes
 * `sales_total_ck` to permit the negative total a rectificativa por diferencias carries
 * (docs/superpowers/plans/2026-08-02-rectificativas.md §2.1).
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
    total: string;
    correctsSaleId: string | null;
    invoiceNumber: number;
    tenantId?: string;
    tillId?: string;
    nodeId?: string;
    seriesId?: string;
    invoiceLocales?: string[];
  }): Promise<{ id: string }[]> {
    const tenantId = opts.tenantId ?? TENANT_A;
    const tillId = opts.tillId ?? TILL_A1;
    // node_id is NOT NULL since the rekey; these correctives are all tenant A, so nodeA is the
    // tenant-consistent node for the composite FK.
    const nodeId = opts.nodeId ?? nodeA;
    const seriesId = opts.seriesId ?? seriesA;
    const locales = opts.invoiceLocales ?? ["es", "ca"];
    const localesArray = sql`array[${sql.join(
      locales.map((l) => sql`${l}`),
      sql`, `,
    )}]::text[]`;
    return rows<{ id: string }>(
      db,
      sql`insert into sales (
             tenant_id, till_id, node_id, series_id, invoice_number, issued_at,
             issued_offset_minutes, total, locale, invoice_locales, fiscal_backend, fiscal_state,
             corrects_sale_id
           ) values (
             ${tenantId}, ${tillId}, ${nodeId}, ${seriesId}, ${opts.invoiceNumber}, ${AT}, 120,
             ${opts.total}, 'es', ${localesArray}, 'verifactu', 'recorded',
             ${opts.correctsSaleId}
           ) returning id`,
    );
  }

  it("accepts a corrective sale carrying a negative total when the link is set", async () => {
    // Load-bearing: record-sale passes `total` straight into the fiscal record's ImporteTotal,
    // which the huella hashes, so `sales.total` must hold the negative value the corrective
    // needs (findings §10.2, plan §2.1).
    //
    // PROVEN BY DELETION (manual, recorded in this task's report): with the migration's
    // `sales_total_ck` reduced back to `${t.total} >= 0` (the pre-0013 form), this exact insert
    // is rejected with 23514/sales_total_ck. The `OR corrects_sale_id IS NOT NULL` clause is
    // what admits it — the guard is doing the work, not the FK or the column add.
    const inserted = await insertSale({
      total: "-1.00",
      correctsSaleId: originalSaleId,
      invoiceNumber: 2,
    });
    expect(inserted).toHaveLength(1);
    const [row] = await db.select().from(sales).where(eq(sales.id, inserted[0].id));
    expect(row.total).toBe("-1.00");
    expect(row.correctsSaleId).toBe(originalSaleId);
  });

  it("rejects an ordinary sale carrying a negative total", async () => {
    // Negative control: with no corrective link, the relaxed check still rejects a negative
    // total exactly as the original `total >= 0` did. An ordinary sale is never negative.
    const error = await captureError(() =>
      insertSale({ total: "-1.00", correctsSaleId: null, invoiceNumber: 2 }),
    );
    expect(pgErrorCode(error)).toBe("23514");
    expect(pgErrorMessage(error)).toMatch(/sales_total_ck/);
  });

  it("still accepts a corrective sale with a positive total", async () => {
    // The link relaxes the sign; it does not force it. A corrective may be positive.
    const inserted = await insertSale({
      total: "1.00",
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
    // NOT unique, unlike sale_voids_sale_id_key: successive rectificativas against one sale are
    // legitimate (plan §2.1). Two correctives pointing at the same original both land.
    await insertSale({ total: "-1.00", correctsSaleId: originalSaleId, invoiceNumber: 2 });
    const second = await insertSale({
      total: "-0.50",
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
        total: "-1.00",
        correctsSaleId: "99999999-9999-4999-8999-999999999999",
        invoiceNumber: 2,
      }),
    );
    // Foreign key violation — the composite (tenant_id, corrects_sale_id) FK onto sales.
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("rejects a corrective link to another tenant's sale", async () => {
    // The FK is composite and tenant-consistent, mirroring sale_lines_sale_fk: a corrective may
    // only point at a sale of its OWN tenant. Tenant A cannot link to tenant B's sale even
    // though that id exists.
    const otherTenantSale = await recordCompleteSale(db, {
      tenantId: TENANT_B,
      tillId: TILL_B1,
      nodeId: nodeB,
      seriesId: seriesB,
      invoiceLocales: ["es"],
      locale: "es",
    });
    const error = await captureError(() =>
      insertSale({ total: "-1.00", correctsSaleId: otherTenantSale, invoiceNumber: 2 }),
    );
    expect(pgErrorCode(error)).toBe("23503");
  });

  it("keeps a corrective sale scoped to its tenant under the app role", async () => {
    // RLS still scopes `sales` after the column add. Insert a corrective for tenant A; the app
    // role sees it only under tenant A's app.tenant_id, never tenant B's. Runs against real
    // Postgres too via describeEachTarget (PGlite is superuser and would bypass FORCE RLS, so a
    // PGlite-only pass here would be a false pass — CLAUDE.md §4).
    const corrective = await insertSale({
      total: "-1.00",
      correctsSaleId: originalSaleId,
      invoiceNumber: 2,
    });
    const visibleToA = await withTenant(db, TENANT_A, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales).where(eq(sales.id, corrective[0].id));
    });
    expect(visibleToA).toHaveLength(1);

    const visibleToB = await withTenant(db, TENANT_B, async (tx) => {
      await asAppUser(tx);
      return tx.select({ id: sales.id }).from(sales).where(eq(sales.id, corrective[0].id));
    });
    expect(visibleToB).toHaveLength(0);
  });
});
