import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, tenders, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedBillPayment,
  seedBillRefund,
  seedOpenOrder,
  seedSale,
  seedTender,
  seedTill,
  seedVenue,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { computeCashUp } from "./cash-up.js";
import type { CashUp, DailyCloseInput, TenderMethod } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
const DAY = "2026-08-04";
const settledNoon = new Date("2026-08-04T10:00:00Z").toISOString();

beforeEach(async () => {
  venue = await seedVenue(suite.db);
});
function run(overrides: Partial<DailyCloseInput> = {}): Promise<CashUp> {
  const input: DailyCloseInput = {
    nodeId: venue.nodeId,
    businessDay: DAY,
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
  return withTransaction(suite.db, async (tx) => {
    return computeCashUp(tx, input);
  });
}
// Helper: a settled sale with tenders. Returns nothing; each test seeds its own.
async function saleWithTenders(
  inv: number,
  tenderRows: Array<{
    method: TenderMethod;
    amount: string;
    tipAmount?: string;
    settledAt: string;
  }>,
): Promise<void> {
  const saleId = await seedSale(suite.db, venue, {
    invoiceNumber: inv,
    issuedAt: settledNoon,
    total: "100.00",
    lines: [{ vatRate: "21.00", lineTotal: "82.64" }],
  });
  for (const t of tenderRows) await seedTender(suite.db, { saleId }, t);
}

describe("computeCashUp", () => {
  it("cashTakings counts only cash-method amounts, incl. cash tips", async () => {
    await saleWithTenders(1, [
      { method: "cash", amount: "50.00", tipAmount: "5.00", settledAt: settledNoon },
      { method: "card", amount: "70.00", tipAmount: "0.00", settledAt: settledNoon },
    ]);
    const cash = await run();
    expect(cash.byTill).toHaveLength(1);
    expect(cash.byTill[0]!.cashTakings).toBe("50.00");
    expect(cash.byTill[0]!.byMethod).toEqual([
      { method: "card", amount: "70.00", tip: "0.00" },
      { method: "cash", amount: "50.00", tip: "5.00" },
    ]);
    expect(cash).toMatchObject({ tenderTotal: "120.00", tipTotal: "5.00" });
  });

  it("breaks down by till", async () => {
    const till2 = await seedTill(suite.db, venue.locationId);
    await saleWithTenders(1, [{ method: "cash", amount: "30.00", settledAt: settledNoon }]);
    const s2 = await seedSale(
      suite.db,
      { ...venue, tillId: till2 },
      {
        invoiceNumber: 2,
        issuedAt: settledNoon,
        total: "40.00",
        lines: [{ vatRate: "10.00", lineTotal: "36.36" }],
      },
    );
    await seedTender(
      suite.db,
      { saleId: s2 },
      { method: "card", amount: "40.00", settledAt: settledNoon },
    );
    const cash = await run();
    expect(cash.byTill.map((t) => t.tillId).sort()).toEqual([venue.tillId, till2].sort());
    expect(cash).toMatchObject({ tenderTotal: "70.00", tipTotal: "0.00" });
  });

  it("buckets by settlement day + cutover: a 01:30-local tender belongs to the prior day", async () => {
    await saleWithTenders(1, [
      {
        method: "cash",
        amount: "10.00",
        settledAt: new Date("2026-08-03T23:30:00Z").toISOString(),
      },
    ]);
    expect((await run({ businessDay: "2026-08-04" })).byTill).toEqual([]);
    expect((await run({ businessDay: "2026-08-03" })).byTill).toHaveLength(1);
  });

  it("returns zeros for an empty day", async () => {
    expect(await run()).toEqual({ byTill: [], tenderTotal: "0.00", tipTotal: "0.00" });
  });

  it("reads the money columns as counts of whole cents, summed then converted once", async () => {
    // Written as INTEGERS, past `seedTender`'s conversion, so this pins what the column holds.
    // 12345 + 5 = 12350 cents is 123.50, and 250 + 0 = 250 cents is 2.50; a query that read the
    // column as euros would report "12350.00" and "250.00". Through the table definition because
    // `tenders.id` comes from a JavaScript `$defaultFn` that a raw INSERT never reaches.
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: settledNoon,
      total: "123.50",
      lines: [{ vatRate: "21.00", lineTotal: "102.07" }],
    });
    await suite.db.insert(tenders).values([
      { saleId, method: "cash", amount: 12345, tipAmount: 250, settledAt: settledNoon },
      { saleId, method: "cash", amount: 5, tipAmount: 0, settledAt: settledNoon },
    ]);
    const cash = await run();
    expect(cash.byTill[0]!.byMethod).toEqual([{ method: "cash", amount: "123.50", tip: "2.50" }]);
    expect(cash.byTill[0]!.cashTakings).toBe("123.50");
    expect(cash).toMatchObject({ tenderTotal: "123.50", tipTotal: "2.50" });
  });

  it("excludes another node's tenders", async () => {
    const other = await seedVenue(suite.db);
    const s = await seedSale(suite.db, other, {
      invoiceNumber: 1,
      issuedAt: settledNoon,
      total: "10.00",
      lines: [{ vatRate: "21.00", lineTotal: "8.26" }],
    });
    await seedTender(
      suite.db,
      { saleId: s },
      { method: "cash", amount: "10.00", settledAt: settledNoon },
    );
    expect((await run()).byTill).toEqual([]);
  });
});

// Money taken against a bill before its invoice (bill payments design §9a): counted on the day and
// till it moved, never again when the invoice's tenders are written.
describe("computeCashUp — bill payments and their refunds", () => {
  const day1Noon = "2026-08-04T10:00:00.000Z";
  const day2Noon = "2026-08-05T10:00:00.000Z";
  let orderNo = 0;

  async function openBill(on: SeededVenue = venue): Promise<string> {
    orderNo += 1;
    return (await seedOpenOrder(suite.db, on, orderNo)).orderId;
  }

  it("counts a received payment on its own till and day as applied plus tip, never the change", async () => {
    const tillB = await seedTill(suite.db, venue.locationId);
    const bill = await openBill();
    // €60.00 handed over for €50.00 applied and a €5.00 tip: €5.00 change went back to the payer.
    await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      {
        method: "cash",
        applied: "50.00",
        tip: "5.00",
        tendered: "60.00",
        state: "received",
        at: day1Noon,
      },
    );
    await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: tillB },
      { method: "card", applied: "30.00", state: "received", at: day1Noon },
    );

    const cash = await run();

    expect(cash).toEqual({
      byTill: [
        {
          tillId: venue.tillId,
          byMethod: [{ method: "cash", amount: "55.00", tip: "5.00" }],
          cashTakings: "55.00",
        },
        {
          tillId: tillB,
          byMethod: [{ method: "card", amount: "30.00", tip: "0.00" }],
          cashTakings: "0.00",
        },
      ].sort((a, b) => Number(a.tillId > b.tillId) - Number(a.tillId < b.tillId)),
      tenderTotal: "85.00",
      tipTotal: "5.00",
    });
  });

  it("counts the invoice's tenders from bill payments on no day, and a walk-up sale's tender once", async () => {
    // Design §8 tests 24 and 26: €50.00 cash on till A on day 1 and €70.00 card on till B on day 2
    // against one €120.00 bill; the invoice is issued on day 2 at till B, with one tender per
    // payment settled when its money moved. A walk-up cash sale on till B on day 2 sits beside it.
    const tillB = await seedTill(suite.db, venue.locationId);
    const bill = await openBill();
    const cashPayment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "cash", applied: "50.00", state: "received", at: day1Noon },
    );
    const cardPayment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: tillB },
      { method: "card", applied: "70.00", state: "received", at: day2Noon },
    );
    const invoice = await seedSale(
      suite.db,
      { ...venue, tillId: tillB },
      {
        invoiceNumber: 1,
        issuedAt: day2Noon,
        total: "120.00",
        lines: [{ vatRate: "10.00", lineTotal: "109.09" }],
      },
    );
    await seedTender(
      suite.db,
      { saleId: invoice },
      { method: "cash", amount: "50.00", settledAt: day1Noon, billPaymentId: cashPayment },
    );
    await seedTender(
      suite.db,
      { saleId: invoice },
      { method: "card", amount: "70.00", settledAt: day2Noon, billPaymentId: cardPayment },
    );
    const walkUp = await seedSale(
      suite.db,
      { ...venue, tillId: tillB },
      {
        invoiceNumber: 2,
        issuedAt: day2Noon,
        total: "8.00",
        lines: [{ vatRate: "10.00", lineTotal: "7.27" }],
      },
    );
    await seedTender(
      suite.db,
      { saleId: walkUp },
      { method: "cash", amount: "8.00", settledAt: day2Noon },
    );

    // A double count would put day 1's €50.00 on the SALE's till, B, so the whole day is asserted.
    expect(await run({ businessDay: "2026-08-04" })).toEqual({
      byTill: [
        {
          tillId: venue.tillId,
          byMethod: [{ method: "cash", amount: "50.00", tip: "0.00" }],
          cashTakings: "50.00",
        },
      ],
      tenderTotal: "50.00",
      tipTotal: "0.00",
    });
    expect(await run({ businessDay: "2026-08-05" })).toEqual({
      byTill: [
        {
          tillId: tillB,
          byMethod: [
            { method: "card", amount: "70.00", tip: "0.00" },
            { method: "cash", amount: "8.00", tip: "0.00" },
          ],
          cashTakings: "8.00",
        },
      ],
      tenderTotal: "78.00",
      tipTotal: "0.00",
    });
  });

  it("subtracts a completed refund on its own till and day, under its payment's method", async () => {
    // Design §8 test 25, and a whole card payment given back with its tip.
    const tillB = await seedTill(suite.db, venue.locationId);
    const bill = await openBill();
    const cashPayment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "cash", applied: "50.00", state: "received", at: day1Noon },
    );
    const cardPayment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "card", applied: "30.00", tip: "3.00", state: "received", at: day1Noon },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: cashPayment, tillId: tillB },
      { applied: "20.00", state: "completed", at: day2Noon },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: cardPayment, tillId: tillB },
      { applied: "30.00", tip: "3.00", state: "completed", at: day2Noon },
    );

    expect(await run({ businessDay: "2026-08-04" })).toEqual({
      byTill: [
        {
          tillId: venue.tillId,
          byMethod: [
            { method: "card", amount: "33.00", tip: "3.00" },
            { method: "cash", amount: "50.00", tip: "0.00" },
          ],
          cashTakings: "50.00",
        },
      ],
      tenderTotal: "83.00",
      tipTotal: "3.00",
    });
    expect(await run({ businessDay: "2026-08-05" })).toEqual({
      byTill: [
        {
          tillId: tillB,
          byMethod: [
            { method: "card", amount: "-33.00", tip: "-3.00" },
            { method: "cash", amount: "-20.00", tip: "0.00" },
          ],
          cashTakings: "-20.00",
        },
      ],
      tenderTotal: "-53.00",
      tipTotal: "-3.00",
    });
  });

  it("keeps a till's cash line when what it took and gave back nets to zero", async () => {
    // Design §8 test 27: the line is how the close knows the drawer moved.
    const bill = await openBill();
    const payment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "cash", applied: "50.00", state: "received", at: day1Noon },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: payment, tillId: venue.tillId },
      { applied: "50.00", state: "completed", at: day1Noon },
    );

    expect(await run()).toEqual({
      byTill: [
        {
          tillId: venue.tillId,
          byMethod: [{ method: "cash", amount: "0.00", tip: "0.00" }],
          cashTakings: "0.00",
        },
      ],
      tenderTotal: "0.00",
      tipTotal: "0.00",
    });
  });

  it("counts no payment or refund whose money has not moved", async () => {
    const bill = await openBill();
    await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "card", applied: "10.00", state: "pending" },
    );
    await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "card", applied: "11.00", state: "failed", at: day1Noon },
    );
    // Accepted, then declined by the card network: it keeps its `received_at`, but no money came.
    await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "card", applied: "12.00", state: "declined", at: day1Noon },
    );
    const received = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: venue.tillId },
      { method: "card", applied: "40.00", state: "received", at: day1Noon },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: received, tillId: venue.tillId },
      { applied: "5.00", state: "pending" },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: received, tillId: venue.tillId },
      { applied: "6.00", state: "failed", at: day1Noon },
    );

    expect((await run()).byTill).toEqual([
      {
        tillId: venue.tillId,
        byMethod: [{ method: "card", amount: "40.00", tip: "0.00" }],
        cashTakings: "0.00",
      },
    ]);
  });

  it("scopes a payment and its refund to a node through their bill", async () => {
    const other = await seedVenue(suite.db);
    const bill = await openBill(other);
    const payment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill, tillId: other.tillId },
      { method: "cash", applied: "25.00", state: "received", at: day1Noon },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: payment, tillId: other.tillId },
      { applied: "5.00", state: "completed", at: day1Noon },
    );

    expect((await run()).byTill).toEqual([]);
    expect((await run({ nodeId: other.nodeId })).tenderTotal).toBe("20.00");
    expect((await run({ nodeId: undefined })).byTill).toEqual([
      {
        tillId: other.tillId,
        byMethod: [{ method: "cash", amount: "20.00", tip: "0.00" }],
        cashTakings: "20.00",
      },
    ]);
  });
});
