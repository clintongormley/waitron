import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client.js";
import { checkFailed, refusalOn, triggerRaised } from "../constraint-target.js";
import { CORE_MIGRATIONS } from "../migrations.js";
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from "../sql-state.js";
import { isRefusal } from "../unique-violation.js";
import { captureError } from "../testing/errors.js";
import { seedDevice, seedNode, seedPerson, seedVenue, seedWorkingOrder } from "../testing/seed.js";
import { useVenueDb } from "../testing/venue-db.js";
import { billAdvances } from "./bill-advances.js";
import { billPayments } from "./bill-payments.js";
import { saleLines, sales } from "./sales.js";
import { invoiceSeries } from "./series.js";

const PERSON = "cccccccc-0000-4000-8000-000000000001";
const AT = "2026-11-20T12:00:00.000Z";

describe("bill_advances and a sale line's advance columns", () => {
  const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  let db: Database;
  let deviceId: string;
  let nodeId: string;
  let seriesId: string;
  let billId: string;
  let paymentId: string;
  let nextInvoice = 0;

  async function sale(total: number): Promise<string> {
    nextInvoice += 1;
    const [row] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId,
        seriesId,
        invoiceNumber: nextInvoice,
        issuedAt: AT,
        issuedOffsetMinutes: 0,
        total,
        vatBreakdown: [],
        locale: "es",
        invoiceLocales: ["es"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning({ id: sales.id });
    return row!.id;
  }

  function line(
    saleId: string,
    lineNo: number,
    advance: Pick<typeof saleLines.$inferInsert, "advanceRole" | "deductsSaleId">,
  ) {
    return db.insert(saleLines).values({
      saleId,
      lineNo,
      name: "Advance",
      descriptions: { es: "Anticipo" },
      quantity: 1000,
      unitPrice: 4545,
      vatRate: 1000,
      lineTotal: 4545,
      ...advance,
    });
  }

  beforeEach(async () => {
    db = suite.db;
    await seedPerson(db, { id: PERSON, displayName: "Cashier" });
    await seedVenue(db, { name: "Advances", invoiceLocales: ["es"] });
    nodeId = await seedNode(db);
    ({ deviceId } = await seedDevice(db));
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "AD", purpose: "standard" })
      .returning({ id: invoiceSeries.id });
    seriesId = series!.id;
    billId = (
      await seedWorkingOrder(db, {
        source: "dashboard",
        deviceId: null,
        nodeId,
        orderNumber: 1,
        status: "open",
        openedAt: AT,
      })
    ).id;
    const [payment] = await db
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: "submission-1",
        fingerprint: "fingerprint",
        kind: "contribution",
        method: "cash",
        applied: 5000,
        tendered: 5000,
        state: "received",
        receivedAt: AT,
        requestedBy: PERSON,
        source: "device",
        deviceId,
      })
      .returning({ id: billPayments.id });
    paymentId = payment!.id;
  });

  it("refuses a second advance for the same bill payment", async () => {
    await db.insert(billAdvances).values({
      workingOrderId: billId,
      advanceSaleId: await sale(5000),
      billPaymentId: paymentId,
    });
    const again = await captureError(async () =>
      db.insert(billAdvances).values({
        workingOrderId: billId,
        advanceSaleId: await sale(5000),
        billPaymentId: paymentId,
      }),
    );
    expect(
      refusalOn(again, UNIQUE_VIOLATION, { table: "bill_advances", columns: ["bill_payment_id"] }),
    ).toBe(true);
    // Several advances may name no bill payment.
    await db
      .insert(billAdvances)
      .values({ workingOrderId: billId, advanceSaleId: await sale(1000), billPaymentId: null });
    await db
      .insert(billAdvances)
      .values({ workingOrderId: billId, advanceSaleId: await sale(1000), billPaymentId: null });
    const sameSale = await sale(1000);
    await db
      .insert(billAdvances)
      .values({ workingOrderId: billId, advanceSaleId: sameSale, billPaymentId: null });
    const twice = await captureError(() =>
      db
        .insert(billAdvances)
        .values({ workingOrderId: billId, advanceSaleId: sameSale, billPaymentId: null }),
    );
    expect(
      refusalOn(twice, UNIQUE_VIOLATION, { table: "bill_advances", columns: ["advance_sale_id"] }),
    ).toBe(true);
  });

  it("refuses an update and a delete", async () => {
    const [written] = await db
      .insert(billAdvances)
      .values({ workingOrderId: billId, advanceSaleId: await sale(5000), billPaymentId: paymentId })
      .returning({ id: billAdvances.id });
    const raised = "bill_advances is append-only";
    const update = await captureError(() =>
      db.run(sql`update bill_advances set bill_payment_id = null where id = ${written!.id}`),
    );
    expect(triggerRaised(update, raised)).toBe(true);
    const remove = await captureError(() =>
      db.run(sql`delete from bill_advances where id = ${written!.id}`),
    );
    expect(triggerRaised(remove, raised)).toBe(true);
    expect(await db.select().from(billAdvances).where(eq(billAdvances.id, written!.id))).toEqual([
      expect.objectContaining({ billPaymentId: paymentId }),
    ]);
  });

  it("a deduction line must name the sale it deducts, and only a deduction line may", async () => {
    const advance = await sale(5000);
    const rest = await sale(5000);
    const unnamed = await captureError(() =>
      line(rest, 1, { advanceRole: "deduction", deductsSaleId: null }),
    );
    expect(checkFailed(unnamed, "sale_lines_advance_ck")).toBe(true);
    const onAdvance = await captureError(() =>
      line(rest, 2, { advanceRole: "payment_on_account", deductsSaleId: advance }),
    );
    expect(checkFailed(onAdvance, "sale_lines_advance_ck")).toBe(true);
    const onDish = await captureError(() =>
      line(rest, 3, { advanceRole: null, deductsSaleId: advance }),
    );
    expect(checkFailed(onDish, "sale_lines_advance_ck")).toBe(true);
    const unknownRole = await captureError(() =>
      db.run(
        sql`insert into sale_lines (id, sale_id, line_no, name, descriptions, quantity, unit_price, vat_rate, line_total, advance_role) values ('x', ${rest}, 4, 'A', '{}', 1000, 1, 1000, 1, 'deposit')`,
      ),
    );
    expect(checkFailed(unknownRole, "sale_lines_advance_role_ck")).toBe(true);
    await line(advance, 1, { advanceRole: "payment_on_account", deductsSaleId: null });
    await line(rest, 5, { advanceRole: "deduction", deductsSaleId: advance });
    expect(
      await db
        .select({ advanceRole: saleLines.advanceRole, deductsSaleId: saleLines.deductsSaleId })
        .from(saleLines)
        .orderBy(saleLines.lineNo, saleLines.saleId),
    ).toEqual(
      expect.arrayContaining([
        { advanceRole: "payment_on_account", deductsSaleId: null },
        { advanceRole: "deduction", deductsSaleId: advance },
      ]),
    );
  });

  it("refuses a deduction line naming a sale that does not exist", async () => {
    const rest = await sale(5000);
    const error = await captureError(() =>
      line(rest, 1, {
        advanceRole: "deduction",
        deductsSaleId: "dddddddd-0000-4000-8000-000000000001",
      }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    expect(await db.select().from(saleLines).where(eq(saleLines.saleId, rest))).toEqual([]);
  });

  it.each([
    ["bill_advances", "working_order_id", "bill_advances_working_order_idx"],
    ["sale_lines", "deducts_sale_id", "sale_lines_deducts_sale_idx"],
  ])("indexes %s by %s", (table, column, name) => {
    const rows = db.all<{ name: string; column: string }>(
      sql.raw(`select il.name as name, ii.name as "column"
        from pragma_index_list('${table}') il, pragma_index_info(il.name) ii`),
    );
    expect(rows).toContainEqual({ name, column });
  });
});
