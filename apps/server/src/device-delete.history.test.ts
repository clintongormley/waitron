import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  billPaymentRefunds,
  billPayments,
  deviceProfiles,
  printers,
  withTransaction,
  workingOrders,
  type Transaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { listOpenIncidents, recordIncident, recordSale } from "@waitron/core";
import { loadKeyRing } from "@waitron/credentials";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { setProfilePrinterLists } from "@waitron/layouts";
import { cardReaders, payments, setProfileReaderList } from "@waitron/payments";
import { AppError, deviceOrigin } from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { deleteDevice } from "./device-delete.js";
import type { Logger } from "./logger.js";
import { mountPaymentsApi } from "./payments-api.js";
import { mountReportApi } from "./report-api.js";
import { parkOrder } from "./working-order.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { setupVenue, type Venue } from "./testing/venue-fixtures.js";
import { offerProducts } from "./testing/zone-offers.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const noopLog: Logger = () => {};
// Midday UTC, clear of the venue's 05:00 Madrid cutover, so the business day is the date.
const BUSINESS_DAY = "2026-10-09";
const SOLD_AT = new Date(`${BUSINESS_DAY}T12:00:00.000Z`);
const NOW = new Date("2026-10-10T10:00:00.000Z");
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

const clock: TrustedClock = {
  now: () => ({
    instant: SOLD_AT,
    offsetMinutes: 0,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("Unused anchor");
  },
  currentAnchor: () => null,
};

let backend: FiscalBackend;

beforeAll(() => {
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("resolveClient must never be called")),
  });
});

const inTx = <T>(run: (tx: Transaction) => Promise<T>) => withTransaction(suite.db, run);

type Rows = Record<string, unknown>[];

/** Every row naming `deviceId` — its own `devices` row and each row whose `device_id` is it —
 *  keyed by table. */
async function rowsOf(deviceId: string): Promise<Record<string, Rows>> {
  const tables = await suite.db.execute<{ name: string }>(
    sql`select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  );
  const out: Record<string, Rows> = {};
  for (const { name } of tables.rows) {
    const rows = (await suite.db.execute(sql`select * from ${sql.identifier(name)}`)).rows as Rows;
    const mine = rows.filter((row) =>
      name === "devices" ? row.id === deviceId : row.device_id === deviceId,
    );
    if (mine.length > 0) out[name] = mine;
  }
  return out;
}

/** "Bar till" on the "Tills" profile with a cash sale and an incident, then deleted. */
async function seedDeleted() {
  const venue = await setupVenue(suite.db);
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: "Tills", formFactor: "till", capabilities: [] })
    .returning({ id: deviceProfiles.id });
  const barTill = (
    await enrolDeviceForTest(suite.db, venue.cfg, { name: "Bar till", profileId: profile!.id })
  ).deviceId;
  const sale = await inTx((tx) =>
    recordSale(tx, backend, {
      origin: deviceOrigin(barTill),
      nodeId: venue.cfg.nodeId,
      seriesId: venue.seriesId,
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      total: "1.00",
      lines: [
        {
          lineNo: 1,
          name: "Café",
          descriptions: { "es-ES": "Café" },
          quantity: "1",
          unitPrice: "1.00",
          vatRate: "0",
          lineTotal: "1.00",
        },
      ],
      clock,
      settlement: {
        kind: "immediate",
        tenders: [{ method: "cash", amount: "1.00", tipAmount: "0.00", settledAt: SOLD_AT }],
      },
    }),
  );
  await inTx((tx) =>
    recordIncident(tx, {
      origin: deviceOrigin(barTill),
      saleId: sale.saleId,
      error: new AppError("device.not_found", { deviceId: barTill }),
      severity: "warning",
      detectedAt: SOLD_AT,
    }),
  );
  await inTx((tx) => deleteDevice(tx, venue.cfg, barTill, NOW));
  return { venue, profileId: profile!.id, barTill };
}

async function openOrder(venue: Venue): Promise<string> {
  const orderId = randomUUID();
  const offers = await inTx((tx) => offerProducts(tx, venue.cfg));
  await parkOrder({ db: suite.db }, venue.cfg, {
    id: orderId,
    zoneId: offers.zoneId,
    lines: offers.toOfferLines([{ productId: venue.cafeId, quantity: "1" }]),
    label: "Mesa 1",
  });
  return orderId;
}

async function billPayment(orderId: string, deviceId: string, state: "pending" | "received") {
  const [row] = await suite.db
    .insert(billPayments)
    .values({
      workingOrderId: orderId,
      submissionId: randomUUID(),
      fingerprint: "f",
      kind: "contribution",
      method: "card",
      applied: 150,
      state,
      receivedAt: state === "received" ? new Date().toISOString() : null,
      requestedBy: OPERATOR,
      source: "device",
      deviceId,
    })
    .returning({ id: billPayments.id });
  return row!.id;
}

function paymentsApp(venue: Venue): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.db,
      backend,
      clock,
      cfg: venue.cfg,
      ring: loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      }),
      environment: "preproduction",
      pool: {
        get: () => Promise.reject(new Error("no card provider is used")),
        evict: () => {},
      },
      providers: [],
    },
    noopLog,
  );
  return app;
}

async function getJson(app: Hono, path: string, cookie: string) {
  const res = await app.request(path, { headers: { cookie } });
  expect(res.status, path).toBe(200);
  return (await res.json()) as unknown;
}

describe("a deleted device's history", () => {
  it("still names the device on the alerts list and in the cash-up report", async () => {
    const { venue, barTill } = await seedDeleted();

    const incidents = await inTx((tx) => listOpenIncidents(tx));
    expect(incidents.filter((row) => row.deviceId === barTill)).toEqual([
      expect.objectContaining({ deviceId: barTill, deviceName: "Bar till" }),
    ]);

    const app = new Hono();
    mountReportApi(app, { db: suite.db, cfg: venue.cfg, venueLocale: "es-ES" }, noopLog);
    const close = (await getJson(
      app,
      `/management-api/reports/daily-close?businessDay=${BUSINESS_DAY}`,
      venue.managerCookie,
    )) as { cash: { byOrigin: { deviceId: string | null; deviceName: string }[] } };
    expect(close.cash.byOrigin).toEqual([
      expect.objectContaining({ deviceId: barTill, deviceName: "Bar till" }),
    ]);
  });

  it("backstop: written straight into the database, each stuck payment list names the deleted device", async () => {
    const { venue, barTill } = await seedDeleted();

    const cardOrder = await openOrder(venue);
    await suite.db
      .update(workingOrders)
      .set({ paymentAttemptAt: NOW.toISOString() })
      .where(eq(workingOrders.id, cardOrder));
    const [card] = await suite.db
      .insert(payments)
      .values({
        workingOrderId: cardOrder,
        source: "device",
        deviceId: barTill,
        provider: "stripe",
        paymentRef: randomUUID(),
        amount: 150,
        state: "attempting",
      })
      .returning({ id: payments.id });
    const pending = await billPayment(await openOrder(venue), barTill, "pending");
    const received = await billPayment(await openOrder(venue), barTill, "received");
    const [refund] = await suite.db
      .insert(billPaymentRefunds)
      .values({
        billPaymentId: received,
        submissionId: randomUUID(),
        fingerprint: "f",
        appliedAmount: 100,
        reason: "error",
        authorizedBy: OPERATOR,
        requestedBy: OPERATOR,
        source: "device",
        deviceId: barTill,
        state: "pending",
      })
      .returning({ id: billPaymentRefunds.id });

    const app = paymentsApp(venue);
    const cookie = venue.managerCookie;
    const stuck = (await getJson(app, "/management-api/payments/stuck", cookie)) as Rows;
    expect(stuck.map((row) => row.paymentId)).toEqual([card!.id]);
    expect(stuck[0]).toMatchObject({ deviceId: barTill, deviceName: "Bar till" });
    const bills = (await getJson(app, "/management-api/payments/bill-payments", cookie)) as Rows;
    expect(bills.map((row) => row.billPaymentId)).toEqual([pending]);
    expect(bills[0]).toMatchObject({ deviceId: barTill, deviceName: "Bar till" });
    const refunds = (await getJson(app, "/management-api/payments/bill-refunds", cookie)) as Rows;
    expect(refunds.map((row) => row.refundId)).toEqual([refund!.id]);
    expect(refunds[0]).toMatchObject({ deviceId: barTill, deviceName: "Bar till" });
  });

  it("a profile save after the delete leaves the deleted device's row and every row naming it unchanged", async () => {
    const { venue, profileId, barTill } = await seedDeleted();
    const printer = async (name: string) =>
      (
        await suite.db
          .insert(printers)
          .values({
            locationId: venue.cfg.locationId,
            name,
            transport: "network_tcp",
            host: `${name.toLowerCase().replaceAll(" ", "-")}.test`,
            hasCashDrawer: true,
          })
          .returning({ id: printers.id })
      )[0]!.id;
    const reader = async (name: string) =>
      (
        await suite.db
          .insert(cardReaders)
          .values({ provider: "stripe", providerRef: randomUUID(), name })
          .returning({ id: cardReaders.id })
      )[0]!.id;
    const [p1, p2] = [await printer("Counter P"), await printer("Bar P")];
    const [r1, r2] = [await reader("Reader R"), await reader("Reader S")];
    const lists = (id: string) => ({
      receiptPrinterIds: [id],
      paymentSlipPrinterIds: [id],
      cashDrawerPrinterIds: [id],
      receiptPrinterDefaultId: id,
      paymentSlipPrinterDefaultId: id,
      cashDrawerPrinterDefaultId: id,
      invoicePrinterIds: [],
      invoicePrinterDefaultId: null,
    });
    await inTx((tx) => setProfilePrinterLists(tx, profileId, lists(p1)));
    await inTx((tx) =>
      setProfileReaderList(tx, profileId, { readerIds: [r1], defaultReaderId: r1 }),
    );
    const before = await rowsOf(barTill);
    expect(before.devices).toHaveLength(1);

    await inTx((tx) => setProfilePrinterLists(tx, profileId, lists(p2)));
    expect(
      await inTx((tx) =>
        setProfileReaderList(tx, profileId, { readerIds: [r2], defaultReaderId: r2 }),
      ),
    ).toEqual({ ok: true });

    expect(await rowsOf(barTill)).toEqual(before);
  });
});
