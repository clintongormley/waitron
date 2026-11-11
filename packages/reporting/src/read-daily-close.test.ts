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
    .values({ name: "Dining", tradingName: "Dining" })
    .returning();
  const pending = await seedOpenOrder(suite.db, venue, 1);
  await seedBillPayment(
    suite.db,
    { workingOrderId: pending.orderId, deviceId: venue.deviceId },
    { method: "cash", applied: "100.00", state: "received", at },
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
  await seedTender(suite.db, { saleId: first }, { method: "cash", amount: "11.00", settledAt: at });
  await settleOrder(suite.db, sold.orderId, at);
  await withTransaction(suite.db, (tx) =>
    recordDailyClose(tx, {
      ...day,
      nodeId: venue.nodeId,
      closedBy: "counter",
      cashCounts: [
        { deviceId: venue.deviceId, openingFloat: "0.00", payouts: "0.00", countedCash: "111.00" },
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
    { method: "card", amount: "22.00", settledAt: at },
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
    { method: "cash", amount: "5.00", settledAt: at },
  );
  const read = () =>
    withTransaction(suite.db, (tx) =>
      readDailyClose(tx, { ...day, nodeIds: [venue.nodeId, other.nodeId] }),
    );
  const mixed = await read();
  expect(mixed.cash.tenderTotal).toBe("138.00");
  expect(mixed.cash.byOrigin).toEqual([
    {
      source: "demo_seed",
      deviceId: null,
      byMethod: [{ method: "cash", amount: "5.00", tip: "0.00" }],
      cashTakings: "5.00",
    },
    {
      source: "device",
      deviceId: venue.deviceId,
      byMethod: [
        { method: "card", amount: "22.00", tip: "0.00" },
        { method: "cash", amount: "111.00", tip: "0.00" },
      ],
      cashTakings: "111.00",
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
      byMethod: [{ method: "cash", amount: "105.00", tip: "0.00" }],
      billsClosed: { count: 0, total: "0.00" },
    },
    {
      departmentId: department!.id,
      departmentName: "Dining",
      active: true,
      byMethod: [
        { method: "card", amount: "22.00", tip: "0.00" },
        { method: "cash", amount: "11.00", tip: "0.00" },
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
