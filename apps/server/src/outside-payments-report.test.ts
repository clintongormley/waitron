import { beforeEach, expect, it } from "vitest";
import { Hono } from "hono";
import { CORE_MIGRATIONS, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedBusinessDay, seedWorkingOrder, seedNode } from "@waitron/db/testing/seed.js";
import {
  seedVenueWithSeries,
  seedSale,
  type SeededVenue,
} from "@waitron/reporting/test/fixtures.js";
import { PAYMENTS_MIGRATIONS } from "@waitron/payments";
import { payments } from "@waitron/payments/src/schema/payments.js";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { fixturePinHash } from "./testing/known-secret-hashes.js";
import { mountReportApi } from "./report-api.js";
import { listAccountantExport } from "./accountant-export.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });
let venue: SeededVenue;
let cookie: string;
let app: Hono;
beforeEach(async () => {
  venue = await seedVenueWithSeries(suite.db);
  await seedBusinessDay(suite.db, { timeZone: "Europe/Madrid", dayCutover: "05:00" });
  const [person] = await seedPersons(suite.db, {
    displayName: "Manager",
    role: "manager",
    pinHash: fixturePinHash("1234"),
  });
  const session = await withTransaction(suite.db, (tx) =>
    startManagementSession(tx, { personId: person!.id }),
  );
  cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  app = new Hono();
  mountReportApi(
    app,
    { db: suite.db, cfg: { nodeId: venue.nodeId }, venueLocale: "en-GB" },
    () => {},
  );
});

async function payment(
  at: string,
  extra: Partial<typeof payments.$inferInsert> = {},
  orderNumber = 77,
) {
  const order = await seedWorkingOrder(suite.db, {
    source: "device",
    deviceId: venue.deviceId,
    orderNumber,
  });
  const [row] = await suite.db
    .insert(payments)
    .values({
      workingOrderId: order.id,
      source: "device",
      deviceId: venue.deviceId,
      nodeId: venue.nodeId,
      provider: "manual",
      paymentRef: order.id,
      amount: 1234,
      state: "captured",
      settledAt: at,
      externalProvider: "other",
      externalMachine: "Backup & 001",
      externalRef: "00042",
      ...extra,
    })
    .returning();
  return row!;
}

it("lists each manual payment once on its box's business day, with current state and only successful refunds", async () => {
  const saleId = await seedSale(suite.db, venue, {
    invoiceNumber: 1,
    issuedAt: "2026-11-03T12:00:00.000Z",
    total: "12.34",
    lines: [{ vatRate: "0.00", lineTotal: "12.34" }],
  });
  const included = await payment("2026-11-04T03:59:59.999Z", {
    state: "partially_refunded",
    saleId,
  });
  await suite.db.insert(paymentRefunds).values([
    {
      paymentId: included.id,
      provider: "manual",
      paymentRef: "r1",
      amount: 101,
      state: "succeeded",
    },
    {
      paymentId: included.id,
      provider: "manual",
      paymentRef: "r2",
      amount: 202,
      state: "succeeded",
    },
    { paymentId: included.id, provider: "manual", paymentRef: "r3", amount: 400, state: "failed" },
  ]);
  const older = await payment(
    "2026-11-03T04:00:00.000Z",
    {
      externalProvider: null,
      externalMachine: null,
      externalRef: null,
    },
    88,
  );
  await payment("2026-11-03T03:59:59.999Z");
  await payment("2026-11-04T04:00:00.000Z");
  await payment("2026-11-03T12:00:00.000Z", { nodeId: await seedNode(suite.db) });
  await payment("2026-11-03T12:00:00.000Z", { provider: "integrated" });
  const response = await app.request("/management-api/reports/daily-close?businessDay=2026-11-03", {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data.timeZone).toBe("Europe/Madrid");
  expect(data.outsidePayments).toEqual([
    {
      id: older.id,
      workingOrderId: older.workingOrderId,
      orderNumber: 88,
      saleId: null,
      invoiceNumber: null,
      nodeId: venue.nodeId,
      amount: "12.34",
      settledAt: older.settledAt,
      externalProvider: null,
      externalMachine: null,
      externalRef: null,
      state: "captured",
      refunded: "0.00",
    },
    {
      id: included.id,
      workingOrderId: included.workingOrderId,
      orderNumber: 77,
      saleId,
      invoiceNumber: "A/1",
      nodeId: venue.nodeId,
      amount: "12.34",
      settledAt: included.settledAt,
      externalProvider: "other",
      externalMachine: "Backup & 001",
      externalRef: "00042",
      state: "partially_refunded",
      refunded: "3.03",
    },
  ]);
  expect(data.cash.tenderTotal).toBe("0.00");
});

it("selects workbook payments across boxes by venue civil dates, including uninvoiced payments", async () => {
  const first = await payment("2026-11-02T23:00:00.000Z", {
    externalProvider: "connected_account",
  });
  const last = await payment("2026-11-03T22:59:59.999Z", { nodeId: await seedNode(suite.db) });
  await payment("2026-11-02T22:59:59.999Z");
  await payment("2026-11-03T23:00:00.000Z");
  const result = await withTransaction(suite.db, (tx) =>
    listAccountantExport(tx, { from: "2026-11-03", to: "2026-11-03" }),
  );
  expect(result.outsidePayments).toEqual([
    expect.objectContaining({ id: first.id }),
    expect.objectContaining({ id: last.id }),
  ]);
  expect(result.outsidePayments[0]).toMatchObject({
    externalProvider: "connected_account",
    saleId: null,
  });
});
