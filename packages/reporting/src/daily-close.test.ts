import { beforeEach, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  departments,
  saleReceiptHeaders,
  invoiceSeries,
  saleLines,
  saleSettlements,
  sales,
  tenders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedSale,
  seedTender,
  seedVenueWithSeries,
  seedBillPayment,
  seedBillRefund,
  seedOpenOrder,
  settleOrder,
  seedVenueDevice,
} from "../test/fixtures.js";
import type { SeededVenue } from "../test/fixtures.js";
import { seedRefundableSale, seedTenderRefund } from "../test/tender-refund-fixtures.js";
import { computeDailyClose } from "./daily-close.js";
import type { DailyCloseInput } from "./types.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
let venue: SeededVenue;
beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
});
function input(overrides: Partial<DailyCloseInput> = {}): DailyCloseInput {
  return {
    cutoverChanges: [],
    nodeIds: [venue.nodeId],
    businessDay: "2026-08-04",
    timeZone: "Europe/Madrid",
    dayCutover: "05:00",
    ...overrides,
  };
}
function run(i: DailyCloseInput) {
  return withTransaction(suite.db, async (tx) => {
    return computeDailyClose(tx, i);
  });
}

describe("computeDailyClose", () => {
  it("groups takings and closed bills by recorded department, moving an uninvoiced payment out of Unallocated", async () => {
    const [restaurant, bar] = await suite.db
      .insert(departments)
      .values([
        { name: "Restaurant", tradingName: "Restaurant" },
        { name: "Bar", tradingName: "Bar", active: false },
      ])
      .returning();
    const at = "2026-08-04T10:00:00.000Z";
    const bill = await seedOpenOrder(suite.db, venue, 1);
    const payment = await seedBillPayment(
      suite.db,
      { workingOrderId: bill.orderId, deviceId: venue.deviceId },
      { method: "cash", applied: "40.00", tip: "2.00", state: "received", at },
    );
    await seedBillRefund(
      suite.db,
      { billPaymentId: payment, deviceId: venue.deviceId },
      { applied: "5.00", state: "completed", at },
    );
    expect((await run(input())).departmentTakings).toEqual([
      {
        departmentId: null,
        departmentName: null,
        active: null,
        byMethod: [{ method: "cash", amount: "37.00", tip: "2.00" }],
        billsClosed: { count: 0, total: "0.00" },
      },
    ]);

    const sale = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      workingOrderId: bill.orderId,
      issuedAt: at,
      total: "100.00",
      lines: [{ vatRate: "10.00", lineTotal: "100.00" }],
    });
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: sale,
      departmentId: restaurant!.id,
      tradingName: "Restaurant",
      printTradingName: true,
    });
    await settleOrder(suite.db, bill.orderId, at);
    // The tender mirrors the payment; it must not count a second time.
    await seedTender(
      suite.db,
      { saleId: sale },
      {
        method: "cash",
        amount: "42.00",
        tipAmount: "2.00",
        settledAt: at,
        billPaymentId: payment,
      },
    );
    await seedTender(
      suite.db,
      { saleId: sale },
      { method: "transfer", amount: "65.00", settledAt: at },
    );
    const otherDevice = await seedVenueDevice(suite.db, venue.locationId);
    const direct = await seedRefundableSale(
      suite.db,
      { ...venue, deviceId: otherDevice },
      {
        method: "card",
        applied: "20.00",
        tip: "1.00",
        at: "2026-08-03T10:00:00.000Z",
        invoiceNumber: 2,
      },
    );
    await suite.db.insert(saleReceiptHeaders).values({
      saleId: direct.saleId,
      departmentId: bar!.id,
      tradingName: "Bar",
      printTradingName: false,
    });
    await seedTenderRefund(suite.db, direct, {
      applied: "5.00",
      tip: "0.00",
      state: "completed",
      createdAt: at,
      at,
    });
    const unallocated = await seedSale(suite.db, venue, {
      invoiceNumber: 3,
      issuedAt: at,
      total: "3.00",
      lines: [{ vatRate: "10.00", lineTotal: "3.00" }],
    });
    await seedTender(
      suite.db,
      { saleId: unallocated },
      { method: "cash", amount: "3.00", settledAt: at },
    );
    const close = await run(input());
    expect(close.departmentTakings).toEqual(
      expect.arrayContaining([
        {
          departmentId: restaurant!.id,
          departmentName: "Restaurant",
          active: true,
          byMethod: [
            { method: "cash", amount: "37.00", tip: "2.00" },
            { method: "transfer", amount: "65.00", tip: "0.00" },
          ],
          billsClosed: { count: 1, total: "100.00" },
        },
        {
          departmentId: bar!.id,
          departmentName: "Bar",
          active: false,
          byMethod: [{ method: "card", amount: "-5.00", tip: "0.00" }],
          billsClosed: { count: 0, total: "0.00" },
        },
        {
          departmentId: null,
          departmentName: null,
          active: null,
          byMethod: [{ method: "cash", amount: "3.00", tip: "0.00" }],
          billsClosed: { count: 0, total: "0.00" },
        },
      ]),
    );
    expect(close.departmentTakings).toHaveLength(3);
    expect(close.cash.tenderTotal).toBe("100.00");
  });

  it("keeps a settled department bill even when no money moves on its closing day", async () => {
    const [department] = await suite.db
      .insert(departments)
      .values({ name: "Dining", tradingName: "Dining" })
      .returning();
    const { orderId } = await seedOpenOrder(suite.db, venue, 1);
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      workingOrderId: orderId,
      issuedAt: "2026-08-03T10:00:00.000Z",
      total: "10.00",
      lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
    });
    await suite.db.insert(saleReceiptHeaders).values({
      saleId,
      departmentId: department!.id,
      tradingName: "Dining",
      printTradingName: true,
    });
    await settleOrder(suite.db, orderId, "2026-08-04T10:00:00.000Z");
    expect((await run(input())).departmentTakings).toEqual([
      {
        departmentId: department!.id,
        departmentName: "Dining",
        active: true,
        byMethod: [],
        billsClosed: { count: 1, total: "10.00" },
      },
    ]);
  });

  it("returns money on a later day without changing invoice VAT, counts or stored sale facts", async () => {
    const paid = await seedRefundableSale(suite.db, venue, {
      method: "cash",
      applied: "121.00",
      tip: "4.00",
      at: "2026-08-04T10:00:00.000Z",
      invoiceNumber: 1,
      vatRate: "21.00",
      base: "100.00",
    });
    const facts = async () => ({
      sales: await suite.db.select().from(sales),
      lines: await suite.db.select().from(saleLines),
      tenders: await suite.db.select().from(tenders),
      settlements: await suite.db.select().from(saleSettlements),
      series: await suite.db.select().from(invoiceSeries),
    });
    const original = await facts();
    const invoiceDay = await run(input());
    await seedTenderRefund(suite.db, paid, {
      applied: "121.00",
      tip: "4.00",
      state: "completed",
      createdAt: "2026-08-04T11:00:00.000Z",
      at: "2026-08-05T10:00:00.000Z",
    });
    expect(await run(input())).toEqual(invoiceDay);
    expect(invoiceDay.vat).toEqual({
      byRate: [{ rate: "21.00", base: "100.00", tax: "21.00" }],
      baseTotal: "100.00",
      taxTotal: "21.00",
      grossTotal: "121.00",
    });
    expect(invoiceDay.counts).toEqual({ sales: 1, corrections: 0, voids: 0 });
    const refundDay = await run(input({ businessDay: "2026-08-05" }));
    expect(refundDay.cash).toEqual({
      byOrigin: [
        {
          source: "device",
          deviceId: venue.deviceId,
          byMethod: [{ method: "cash", amount: "-125.00", tip: "-4.00" }],
          cashTakings: "-125.00",
        },
      ],
      tenderTotal: "-125.00",
      tipTotal: "-4.00",
    });
    expect(refundDay.vat).toEqual({
      byRate: [],
      baseTotal: "0.00",
      taxTotal: "0.00",
      grossTotal: "0.00",
    });
    expect(refundDay.counts).toEqual({ sales: 0, corrections: 0, voids: 0 });
    expect(await facts()).toEqual(original);
  });

  it("validates inputs before touching the database", async () => {
    await expect(run(input({ timeZone: "Nowhere/Nope" }))).rejects.toThrow(/time zone/i);
    await expect(run(input({ dayCutover: "5:00" }))).rejects.toThrow(/cutover/i);
    await expect(run(input({ businessDay: "04/08/2026" }))).rejects.toThrow(/business day/i);
  });

  it("splits an invoice-first sale: VAT on the issuance day, cash on the settlement day", async () => {
    // Issued 2026-08-04 noon local; settled 2026-08-05 noon local.
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    const settled = new Date("2026-08-05T10:00:00Z").toISOString();
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "card", amount: "121.00", settledAt: settled },
    );

    const day4 = await run(input({ businessDay: "2026-08-04" }));
    expect(day4.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
    expect(day4.cash.byOrigin).toEqual([]); // not settled on the 4th

    const day5 = await run(input({ businessDay: "2026-08-05" }));
    expect(day5.vat.byRate).toEqual([]); // not issued on the 5th
    expect(day5.cash.byOrigin).toHaveLength(1);
    expect(day5.cash.tenderTotal).toBe("121.00");
  });

  it("Mode-I straddling the day_cutover: VAT on the placing day, cash on the settlement day", async () => {
    // Both instants fall on the SAME calendar date, 2026-08-05, an hour apart, so a wrong anchor
    // fails visibly where two instants a day apart could agree by coincidence.
    //   issued  2026-08-05T02:30:00.000Z = 04:30 Europe/Madrid (CEST, +02:00) — BEFORE the 05:00
    //     cutover, so business day 2026-08-04.
    //   settled 2026-08-05T03:30:00.000Z = 05:30 Europe/Madrid — AFTER the cutover, so 2026-08-05.
    const issued = "2026-08-05T02:30:00.000Z";
    const settled = "2026-08-05T03:30:00.000Z";
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "card", amount: "121.00", settledAt: settled },
    );

    const day4 = await run(
      input({
        cutoverChanges: [],
        businessDay: "2026-08-04",
        dayCutover: "05:00",
        timeZone: "Europe/Madrid",
      }),
    );
    expect(day4.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]); // VAT on the placing day
    expect(day4.cash.byOrigin).toEqual([]); // no cash yet — not settled until D2

    const day5 = await run(
      input({
        cutoverChanges: [],
        businessDay: "2026-08-05",
        dayCutover: "05:00",
        timeZone: "Europe/Madrid",
      }),
    );
    expect(day5.vat.byRate).toEqual([]); // no VAT on the settlement day — it was already booked on D1
    expect(day5.cash.byOrigin).toHaveLength(1); // the cash lands here
    expect(day5.cash.tenderTotal).toBe("121.00");
  });

  it("assembles all three sections and echoes the request identity", async () => {
    const issued = new Date("2026-08-04T10:00:00Z").toISOString();
    const saleId = await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    await seedTender(
      suite.db,
      { saleId },
      { method: "cash", amount: "121.00", tipAmount: "0.00", settledAt: issued },
    );
    const close = await run(input());
    expect(close).toMatchObject({
      nodeId: venue.nodeId,
      businessDay: "2026-08-04",
      timeZone: "Europe/Madrid",
      counts: { sales: 1, corrections: 0, voids: 0 },
    });
    expect(close.vat.grossTotal).toBe("121.00");
    expect(close.cash.byOrigin[0]!.cashTakings).toBe("121.00");
  });

  it("handles the spring-forward DST day without shifting the bucket", async () => {
    // 2026-03-29 is the EU spring-forward (02:00→03:00). A 12:00-local sale is unambiguous.
    const issued = new Date("2026-03-29T10:00:00Z").toISOString(); // 12:00 CEST after the jump
    await seedSale(suite.db, venue, {
      invoiceNumber: 1,
      issuedAt: issued,
      total: "121.00",
      lines: [{ vatRate: "21.00", lineTotal: "100.00" }],
    });
    const close = await run(input({ businessDay: "2026-03-29" }));
    expect(close.vat.byRate).toEqual([{ rate: "21.00", base: "100.00", tax: "21.00" }]);
  });
});
