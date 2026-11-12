import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { CORE_MIGRATIONS, departments, saleReceiptHeaders, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  seedBillPayment,
  seedNodeAndSeries,
  seedOpenOrder,
  seedSale,
  seedTender,
  seedVenueWithSeries,
  settleOrder,
} from "../test/fixtures.js";
import { readDailyClose } from "./read-daily-close.js";
import { recordDailyClose } from "./record-daily-close.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS], timeoutMs: 60_000 });
const day = {
  businessDay: "2026-08-04",
  timeZone: "Europe/Madrid",
  dayCutover: "05:00",
  cutoverChanges: [],
};
const at = "2026-08-04T10:00:00.000Z";

it("combines frozen and live nodes without reassigning frozen payments after invoicing", async () => {
  const venue = await seedVenueWithSeries(suite.db);
  const other = { ...venue, ...(await seedNodeAndSeries(suite.db, venue)) };
  const [department] = await suite.db
    .insert(departments)
    .values({ id: "ffffffff-0000-4000-8000-000000000001", name: "Dining", tradingName: "Dining" })
    .returning();
  const pending = await seedOpenOrder(suite.db, venue, 1);
  await seedBillPayment(
    suite.db,
    { workingOrderId: pending.orderId, deviceId: venue.deviceId },
    { method: "cash", applied: "100.00", tip: "2.00", state: "received", at },
  );
  const sold = await seedOpenOrder(suite.db, venue, 2);
  const first = await seedSale(suite.db, venue, {
    invoiceNumber: 1,
    workingOrderId: sold.orderId,
    issuedAt: at,
    total: "11.00",
    lines: [{ vatRate: "10.00", lineTotal: "10.00" }],
  });
  await suite.db.insert(saleReceiptHeaders).values({
    saleId: first,
    departmentId: department!.id,
    tradingName: "Dining",
    printTradingName: true,
  });
  await seedTender(
    suite.db,
    { saleId: first },
    { method: "cash", amount: "12.00", tipAmount: "1.00", settledAt: at },
  );
  await settleOrder(suite.db, sold.orderId, at);
  await withTransaction(suite.db, (tx) =>
    recordDailyClose(tx, {
      ...day,
      nodeId: venue.nodeId,
      closedBy: "counter",
      cashCounts: [
        { deviceId: venue.deviceId, openingFloat: "0.00", payouts: "0.00", countedCash: "114.00" },
      ],
    }),
  );

  const invoiced = await seedSale(suite.db, venue, {
    invoiceNumber: 2,
    workingOrderId: pending.orderId,
    issuedAt: "2026-08-05T10:00:00.000Z",
    total: "100.00",
    lines: [{ vatRate: "0.00", lineTotal: "100.00" }],
  });
  await suite.db.insert(saleReceiptHeaders).values({
    saleId: invoiced,
    departmentId: department!.id,
    tradingName: "Dining",
    printTradingName: true,
  });
  const otherBill = await seedOpenOrder(suite.db, other, 3);
  const second = await seedSale(suite.db, other, {
    invoiceNumber: 1,
    workingOrderId: otherBill.orderId,
    issuedAt: at,
    total: "22.00",
    lines: [{ vatRate: "10.00", lineTotal: "20.00" }],
  });
  await suite.db.insert(saleReceiptHeaders).values({
    saleId: second,
    departmentId: department!.id,
    tradingName: "Dining",
    printTradingName: true,
  });
  await seedTender(
    suite.db,
    { saleId: second },
    { method: "card", amount: "24.00", tipAmount: "2.00", settledAt: at },
  );
  await settleOrder(suite.db, otherBill.orderId, at);
  const jobSale = await seedSale(suite.db, other, {
    invoiceNumber: 2,
    source: "demo_seed",
    issuedAt: at,
    total: "5.00",
    lines: [{ vatRate: "0.00", lineTotal: "5.00" }],
  });
  await seedTender(
    suite.db,
    { saleId: jobSale },
    { method: "cash", amount: "6.00", tipAmount: "1.00", settledAt: at },
  );
  const [bar] = await suite.db
    .insert(departments)
    .values({ id: "00000000-0000-4000-8000-000000000001", name: "Bar", tradingName: "Bar" })
    .returning();
  const settledLater = await seedOpenOrder(suite.db, other, 4);
  const earlier = await seedSale(suite.db, other, {
    invoiceNumber: 3,
    workingOrderId: settledLater.orderId,
    issuedAt: "2026-08-03T10:00:00.000Z",
    total: "1.00",
    lines: [{ vatRate: "0.00", lineTotal: "1.00" }],
  });
  await suite.db
    .insert(saleReceiptHeaders)
    .values({ saleId: earlier, departmentId: bar!.id, tradingName: "Bar", printTradingName: true });
  await settleOrder(suite.db, settledLater.orderId, at);
  const read = () =>
    withTransaction(suite.db, (tx) =>
      readDailyClose(tx, { ...day, nodeIds: [venue.nodeId, other.nodeId] }),
    );
  const mixed = await read();
  expect(mixed.cash.tenderTotal).toBe("144.00");
  expect(mixed.cash.tipTotal).toBe("6.00");
  expect(mixed.cash.byOrigin).toEqual([
    {
      source: "demo_seed",
      deviceId: null,
      byMethod: [{ method: "cash", amount: "6.00", tip: "1.00" }],
      cashTakings: "6.00",
    },
    {
      source: "device",
      deviceId: venue.deviceId,
      byMethod: [
        { method: "card", amount: "24.00", tip: "2.00" },
        { method: "cash", amount: "114.00", tip: "3.00" },
      ],
      cashTakings: "114.00",
    },
  ]);
  expect(mixed.vat).toEqual({
    byRate: [
      { rate: "0.00", base: "5.00", tax: "0.00" },
      { rate: "10.00", base: "30.00", tax: "3.00" },
    ],
    baseTotal: "35.00",
    taxTotal: "3.00",
    grossTotal: "38.00",
  });
  expect(mixed.counts).toEqual({ sales: 3, corrections: 0, voids: 0 });
  expect(mixed.departmentTakings).toEqual([
    {
      departmentId: null,
      departmentName: null,
      active: null,
      byMethod: [{ method: "cash", amount: "108.00", tip: "3.00" }],
      billsClosed: { count: 0, total: "0.00" },
    },
    {
      departmentId: bar!.id,
      departmentName: "Bar",
      active: true,
      byMethod: [],
      billsClosed: { count: 1, total: "1.00" },
    },
    {
      departmentId: department!.id,
      departmentName: "Dining",
      active: true,
      byMethod: [
        { method: "card", amount: "24.00", tip: "2.00" },
        { method: "cash", amount: "12.00", tip: "1.00" },
      ],
      billsClosed: { count: 2, total: "33.00" },
    },
  ]);
  await withTransaction(suite.db, (tx) =>
    recordDailyClose(tx, { ...day, nodeId: other.nodeId, closedBy: "counter", cashCounts: [] }),
  );
  await suite.db
    .update(departments)
    .set({ name: "New dining", active: false })
    .where(eq(departments.id, department!.id));
  expect(await read()).toEqual(mixed);
});
