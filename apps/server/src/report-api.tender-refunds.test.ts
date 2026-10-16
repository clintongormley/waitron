import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  CORE_MIGRATIONS,
  invoiceSeries,
  locations,
  saleLines,
  saleSettlements,
  sales,
  tenderRefunds,
  tenders,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { hashPin, IDENTITY_MIGRATIONS, persons, startManagementSession } from "@waitron/identity";
import { PAYMENTS_MIGRATIONS, payments } from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { locationId as brandLocationId } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { mountReportApi } from "./report-api.js";

const suite = useVenueDb({
  migrations: [CORE_MIGRATIONS, IDENTITY_MIGRATIONS, PAYMENTS_MIGRATIONS],
});
const DAY1 = "2026-08-04T10:00:00.000Z";
const DAY2 = "2026-08-05T10:00:00.000Z";
const PIN_HASH = hashPin("1234");
let nodeId: NodeId;
let locationId: string;
let soldOn: string;
let returnedOn: string;
let saleId: string;
let tenderId: string;
let paymentId: string;
let cookie: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(DAY2));
  const db = suite.db;
  await seedTenant(db);
  const [place] = await db
    .insert(locations)
    .values({
      name: "Returns",
      invoiceLocales: ["es-ES"],
      operationDescription: "Meals",
      dayCutover: "05:00:00",
    })
    .returning();
  locationId = place!.id;
  nodeId = await seedNode(db, brandLocationId(locationId));
  soldOn = (await seedDevice(db, { locationId, label: "Sale till" })).deviceId;
  returnedOn = (await seedDevice(db, { locationId, label: "Refund till" })).deviceId;
  const [series] = await db.insert(invoiceSeries).values({ nodeId, code: "R" }).returning();
  saleId = randomUUID();
  tenderId = randomUUID();
  const [order] = await db
    .insert(workingOrders)
    .values({
      source: "device",
      deviceId: soldOn,
      nodeId,
      locationId,
      orderNumber: 1,
    })
    .returning();
  await db.insert(sales).values({
    id: saleId,
    source: "device",
    deviceId: soldOn,
    nodeId,
    seriesId: series!.id,
    invoiceNumber: 1,
    issuedAt: DAY1,
    issuedOffsetMinutes: 120,
    total: 10000,
    vatBreakdown: [{ rate: "21.00", base: "82.64", tax: "17.36" }],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "fake",
    fiscalState: "recorded",
  });
  await db.insert(saleLines).values({
    saleId,
    lineNo: 1,
    name: "Meal",
    descriptions: { "es-ES": "Comida" },
    quantity: 1000,
    unitPrice: 8264,
    vatRate: 2100,
    lineTotal: 8264,
  });
  await db.insert(tenders).values({
    id: tenderId,
    saleId,
    method: "card",
    amount: 10725,
    tipAmount: 725,
    settledAt: DAY1,
  });
  await db.insert(saleSettlements).values({ saleId, settledAt: DAY1 });
  const [payment] = await db
    .insert(payments)
    .values({
      saleId,
      workingOrderId: order!.id,
      source: "device",
      deviceId: soldOn,
      provider: "fake",
      paymentRef: saleId,
      state: "captured",
      amount: 10725,
    })
    .returning();
  paymentId = payment!.id;
  const session = await withTransaction(db, async (tx) => {
    const [person] = await tx
      .insert(persons)
      .values({ displayName: "Manager", role: "manager", pinHash: PIN_HASH })
      .returning();
    return startManagementSession(tx, { personId: person!.id });
  });
  cookie = `${MANAGEMENT_COOKIE}=${session.token}`;
});
afterEach(() => vi.useRealTimers());

function app(onNode = nodeId) {
  const instance = new Hono();
  mountReportApi(
    instance,
    { db: suite.db, cfg: { nodeId: onNode, locationId }, venueLocale: "es-ES" },
    () => {},
  );
  return instance;
}
async function get(path: string, onNode = nodeId) {
  const response = await app(onNode).request(`/management-api/reports/${path}`, {
    headers: { cookie },
  });
  expect(response.status).toBe(200);
  return response.json();
}
async function refund(state: "completed" | "pending" | "failed", refundNode = nodeId) {
  const id = randomUUID();
  await suite.db.insert(tenderRefunds).values({
    id,
    saleId,
    tenderId,
    submissionId: randomUUID(),
    fingerprint: id,
    appliedAmount: 10000,
    tipAmount: 725,
    reason: "Returning the correct charge",
    requestedBy: randomUUID(),
    authorizedBy: randomUUID(),
    source: "device",
    deviceId: returnedOn,
    nodeId: refundNode,
    locationId,
    method: "card",
    provider: "fake",
    providerPaymentRef: saleId,
    state,
    createdAt: DAY1,
    completedAt: state === "completed" ? DAY2 : null,
    failedAt: state === "failed" ? DAY2 : null,
    providerRefundRef: state === "completed" ? id : null,
    providerStatus: state === "completed" ? "completed" : null,
  });
  if (state === "completed")
    await suite.db.insert(paymentRefunds).values({
      paymentId,
      provider: "fake",
      paymentRef: saleId,
      amount: 10725,
      state: "succeeded",
      providerRefundRef: id,
      createdAt: DAY2,
    });
}

it("publishes a named negative cash-up once despite the provider evidence, preserving the invoice-day response", async () => {
  const before = await get("daily-close?businessDay=2026-08-04");
  await refund("completed");
  const day = await get("daily-close?businessDay=2026-08-05");
  expect(day).toEqual({
    businessDay: "2026-08-05",
    vat: { byRate: [], baseTotal: "0.00", taxTotal: "0.00", grossTotal: "0.00" },
    cash: {
      byOrigin: [
        {
          source: "device",
          deviceId: returnedOn,
          deviceName: "Refund till",
          byMethod: [{ method: "card", amount: "-107.25", tip: "-7.25" }],
          cashTakings: "0.00",
        },
      ],
      tenderTotal: "-107.25",
      tipTotal: "-7.25",
    },
    counts: { sales: 0, corrections: 0, voids: 0 },
    topSellers: [],
  });
  expect(await get("daily-close?businessDay=2026-08-04")).toEqual(before);
  expect(before).toMatchObject({
    vat: { grossTotal: "100.00", taxTotal: "17.36" },
    cash: { tenderTotal: "107.25", tipTotal: "7.25" },
    counts: { sales: 1, corrections: 0, voids: 0 },
  });
  const period = await get("period?from=2026-08-04&to=2026-08-05");
  expect(period.vat).toEqual({
    byRate: [{ rate: "21.00", base: "82.64", tax: "17.36" }],
    baseTotal: "82.64",
    taxTotal: "17.36",
    grossTotal: "100.00",
  });
});

it("scopes the daily report by the refund node and includes it once in the venue overview", async () => {
  const other = await seedNode(suite.db, brandLocationId(locationId));
  await refund("completed", other);
  expect((await get("daily-close?businessDay=2026-08-05")).cash).toEqual({
    byOrigin: [],
    tenderTotal: "0.00",
    tipTotal: "0.00",
  });
  expect((await get("daily-close?businessDay=2026-08-05", other)).cash.tenderTotal).toBe("-107.25");
  const overview = await get("overview");
  expect(overview.takings).toEqual({
    tenderTotal: "-107.25",
    tipTotal: "-7.25",
    grossTotal: "0.00",
  });
  expect(overview.counts).toEqual({ sales: 0, corrections: 0, voids: 0 });
});

it.each(["pending", "failed"] as const)(
  "keeps a %s refund out of daily and overview totals",
  async (state) => {
    await refund(state);
    expect((await get("daily-close?businessDay=2026-08-05")).cash).toEqual({
      byOrigin: [],
      tenderTotal: "0.00",
      tipTotal: "0.00",
    });
    expect((await get("overview")).takings).toEqual({
      tenderTotal: "0.00",
      tipTotal: "0.00",
      grossTotal: "0.00",
    });
  },
);
