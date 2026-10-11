import { randomUUID } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPayments,
  devices,
  invoiceSeries,
  printJobs,
  sales,
  withTransaction,
} from "@waitron/db";
import type { Transaction } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, sessions } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { createPrinter } from "@waitron/printing";
import { applyVenue, planVenue } from "@waitron/provisioning";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import {
  takeBillPayment,
  takeReaderBillPayment,
  type BillPaymentRequest,
} from "./bill-payments.js";
import { deploymentEnvironment } from "./config.js";
import { deleteDevice, disableDevice } from "./device-delete.js";
import { ALL_MODULES } from "./modules.js";
import { createTable } from "./testing/live-table.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import { openPartyTab } from "./testing/serve-line.js";
import { deviceRequestCfg, openTillSession } from "./testing/session-device.js";
import type { DeviceRequestConfig } from "./till-config.js";
import "./errors.js";

// The retained fixture runs synchronous work across cases; let the venue watchdog tick between them.
afterEach(() => yieldTurn());

const LOCALE = "es-ES";
const OPERATOR = "cccccccc-0000-4000-8000-000000000002";

const suite = useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provision(db);
  },
});

let backend: FiscalBackend;
let clock: TrustedClock;

interface Venue {
  cfg: DeviceRequestConfig;
  offers: ZoneOffers;
  cana: string;
}
let venue: Venue;

async function provision(db: typeof suite.db): Promise<Venue> {
  clock = {
    now: () => {
      const instant = new Date();
      return {
        instant,
        offsetMinutes: -instant.getTimezoneOffset(),
        confident: true,
        confidence: "anchored",
        anchorAgeSeconds: 0,
      };
    },
    anchor: () => {
      throw new Error("bill-payments.signed-in.test: anchor() is not used");
    },
    currentAnchor: () => null,
  };
  backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const provisioned = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "62000001M",
        legalName: "Pagos SL",
        taxpayerDomicile: "Calle Fiscal 8, 28013 Madrid",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Restaurante",
          addressLine1: "Calle Mayor 1",
          addressLine2: null,
          postalCode: "28013",
          city: "Madrid",
          province: "Madrid",
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Administradora",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  const cfg = await deviceRequestCfg(db, {
    nodeId: brandNodeId(provisioned.nodeId),
    seriesId: brandSeriesId(provisioned.seriesIds[0]!),
    locationId: brandLocationId(provisioned.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  });
  return withTransaction(db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Carta" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    const cana = await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Caña",
      customerName: { [LOCALE]: "Caña de cerveza" },
      kitchenName: "CANA",
      pricingUnit: "each",
      unitPrice: "3.00",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, provisioned.locationId, cat.id);
    return { cfg, offers: await offerProducts(tx, cfg, { zone: "tables" }), cana: cana.id };
  });
}

const inTx = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withTransaction(suite.db, fn);
const fiscal = () => ({ db: suite.db, backend, clock });

interface Till {
  cfg: DeviceRequestConfig;
  operator: { personId: string; sessionId: string };
  printerId: string;
}

/** A till of the case's own, printing receipts and slips and opening the drawer on a printer of its
 * own, with OPERATOR signed in on it. */
async function freshTill(): Promise<Till> {
  const cfg = await deviceRequestCfg(suite.db, venue.cfg);
  const printer = await inTx((tx) =>
    createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: `Recibos ${randomUUID().slice(0, 8)}`,
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: true,
      },
    ),
  );
  await suite.db
    .update(devices)
    .set({
      receiptPrinterId: printer.id,
      paymentSlipPrinterId: printer.id,
      cashDrawerPrinterId: printer.id,
    })
    .where(eq(devices.id, cfg.origin.deviceId));
  const sessionId = await openTillSession(suite.db, {
    deviceId: cfg.origin.deviceId,
    personId: OPERATOR,
  });
  return { cfg, operator: { personId: OPERATOR, sessionId }, printerId: printer.id };
}

/** A fresh €3.00 bill at a fresh table. */
async function bill(): Promise<string> {
  return inTx(async (tx) => {
    const table = await createTable(tx, venue.cfg, {
      label: `M-${randomUUID().slice(0, 8)}`,
      zoneId: venue.offers.zoneId,
    });
    const { tabId } = await openPartyTab(tx, venue.cfg, {
      tableId: table.id,
      lines: [{ menuItemId: venue.offers.offerFor(venue.cana), quantity: "1" }],
    });
    return tabId;
  });
}

/** The whole €3.00 bill, in cash or on a card. */
function wholeBill(method: "cash" | "card"): BillPaymentRequest {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount: "3.00",
    method,
    ...(method === "cash" ? { tendered: "3.00" } : { externalRef: "op-1" }),
    applied: "3.00",
    tip: "0.00",
  };
}

async function disable(deviceId: string): Promise<void> {
  await inTx((tx) => disableDevice(tx, deviceId));
}

/** Switched off with no Disable: its sessions stay open. */
async function switchOffOutOfBand(deviceId: string): Promise<void> {
  await suite.db.update(devices).set({ active: false }).where(eq(devices.id, deviceId));
}

/** What a payment of `billId` from `till` writes: its bill payment, a provider payment, the
 * invoice, the series' next number, and the jobs on the till's printer. */
async function writes(billId: string, till: Till) {
  return inTx(async (tx) => ({
    billPayments: await tx
      .select({ id: billPayments.id, state: billPayments.state })
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, billId)),
    payments: await tx
      .select({ id: payments.id })
      .from(payments)
      .where(eq(payments.workingOrderId, billId)),
    sales: await tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    nextNumber: (
      await tx
        .select({ nextNumber: invoiceSeries.nextNumber })
        .from(invoiceSeries)
        .where(eq(invoiceSeries.id, till.cfg.seriesId))
    )[0]!.nextNumber,
    jobs: await tx
      .select({ kind: printJobs.kind })
      .from(printJobs)
      .where(eq(printJobs.printerId, till.printerId)),
  }));
}

function expectNothingWritten(
  before: Awaited<ReturnType<typeof writes>>,
  after: Awaited<ReturnType<typeof writes>>,
) {
  expect(after).toEqual({ ...before, billPayments: [], payments: [], sales: [], jobs: [] });
}

describe("a bill payment re-checks the device and the sign-in inside its write", () => {
  it("control: an active till with its operator signed in pays, issues the invoice and prints", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);

    const result = await takeBillPayment(
      fiscal(),
      till.cfg,
      billId,
      wholeBill("cash"),
      till.operator,
    );

    expect(result.outcome).toBe("received");
    const after = await writes(billId, till);
    expect(after.billPayments).toMatchObject([{ state: "received" }]);
    expect(after.sales).toHaveLength(1);
    expect(after.nextNumber).toBe(before.nextNumber + 1);
    expect(after.jobs.length).toBeGreaterThan(0);
  });

  it("control: a hand-keyed card from an active till records its provider payment and prints", async () => {
    const till = await freshTill();
    const billId = await bill();

    await takeBillPayment(fiscal(), till.cfg, billId, wholeBill("card"), till.operator);

    const after = await writes(billId, till);
    expect(after.payments).toHaveLength(1);
    expect(after.sales).toHaveLength(1);
    expect(after.jobs.length).toBeGreaterThan(0);
  });

  it("refuses cash session.required once the till is Disabled after the sign-in, writing nothing", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);
    await disable(till.cfg.origin.deviceId);

    await expect
      .soft(takeBillPayment(fiscal(), till.cfg, billId, wholeBill("cash"), till.operator))
      .rejects.toMatchObject({ code: "session.required" });
    expectNothingWritten(before, await writes(billId, till));
  });

  it("refuses cash device.unauthorized on a till switched off with its sign-in left open, writing nothing", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);
    await switchOffOutOfBand(till.cfg.origin.deviceId);

    await expect
      .soft(takeBillPayment(fiscal(), till.cfg, billId, wholeBill("cash"), till.operator))
      .rejects.toMatchObject({ code: "device.unauthorized" });
    expectNothingWritten(before, await writes(billId, till));
  });

  it("refuses a hand-keyed card session.required once the till is deleted, writing nothing", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);
    await inTx((tx) => deleteDevice(tx, venue.cfg, till.cfg.origin.deviceId));

    await expect
      .soft(takeBillPayment(fiscal(), till.cfg, billId, wholeBill("card"), till.operator))
      .rejects.toMatchObject({ code: "session.required" });
    // Delete clears the till's printer choices, so no job could be queued either way.
    const after = await writes(billId, till);
    expect({ ...after, jobs: undefined }).toEqual({
      ...before,
      billPayments: [],
      payments: [],
      sales: [],
      jobs: undefined,
    });
  });

  it("refuses cash session.required once the operator has signed out on an active till, writing nothing", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);
    await suite.db
      .update(sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(sessions.id, till.operator.sessionId));

    await expect
      .soft(takeBillPayment(fiscal(), till.cfg, billId, wholeBill("cash"), till.operator))
      .rejects.toMatchObject({ code: "session.required" });
    expectNothingWritten(before, await writes(billId, till));
  });

  it("refuses cash session.required on a till Disabled and switched back on, whose sign-in the Disable ended", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);
    await disable(till.cfg.origin.deviceId);
    await suite.db
      .update(devices)
      .set({ active: true })
      .where(eq(devices.id, till.cfg.origin.deviceId));

    await expect
      .soft(takeBillPayment(fiscal(), till.cfg, billId, wholeBill("cash"), till.operator))
      .rejects.toMatchObject({ code: "session.required" });
    expectNothingWritten(before, await writes(billId, till));
  });

  it("refuses a reader card device.unauthorized on a till switched off, before the reader is asked", async () => {
    const till = await freshTill();
    const billId = await bill();
    const before = await writes(billId, till);
    const provider = new FakePaymentProvider(suite.db);
    await switchOffOutOfBand(till.cfg.origin.deviceId);

    await expect
      .soft(
        takeReaderBillPayment(
          { ...fiscal(), provider },
          till.cfg,
          billId,
          { ...wholeBill("card"), entry: "reader", externalRef: undefined },
          till.operator,
        ),
      )
      .rejects.toMatchObject({ code: "device.unauthorized" });
    expect(provider.collectCalls).toEqual([]);
    expectNothingWritten(before, await writes(billId, till));
  });

  it("refuses a retry device.unauthorized once the till is switched off, leaving the first payment as it was", async () => {
    const till = await freshTill();
    const billId = await bill();
    const request = wholeBill("cash");
    await takeBillPayment(fiscal(), till.cfg, billId, request, till.operator);
    const taken = await writes(billId, till);
    expect(taken.billPayments).toMatchObject([{ state: "received" }]);
    await switchOffOutOfBand(till.cfg.origin.deviceId);

    await expect
      .soft(takeBillPayment(fiscal(), till.cfg, billId, request, till.operator))
      .rejects.toMatchObject({ code: "device.unauthorized" });
    expect(await writes(billId, till)).toEqual(taken);
  });

  it("still completes a card already at the reader when the till is Disabled while it is held", async () => {
    const till = await freshTill();
    const billId = await bill();
    const provider = new FakePaymentProvider(suite.db);
    const release = provider.holdNextCollect();

    const answer = takeReaderBillPayment(
      { ...fiscal(), provider },
      till.cfg,
      billId,
      { ...wholeBill("card"), entry: "reader", externalRef: undefined },
      till.operator,
    );
    await vi.waitFor(() => expect(provider.collectCalls).toHaveLength(1));
    await disable(till.cfg.origin.deviceId);
    release();

    expect(await answer).toMatchObject({ outcome: "received" });
    const after = await writes(billId, till);
    expect(after.billPayments).toMatchObject([{ state: "received" }]);
    expect(after.sales).toHaveLength(1);
  });

  /** Disables the till, which ends `till`'s sign-in, switches it back on and signs OPERATOR in again. */
  async function signBackIn(till: Till): Promise<Till["operator"]> {
    await disable(till.cfg.origin.deviceId);
    await suite.db
      .update(devices)
      .set({ active: true })
      .where(eq(devices.id, till.cfg.origin.deviceId));
    const sessionId = await openTillSession(suite.db, {
      deviceId: till.cfg.origin.deviceId,
      personId: OPERATOR,
    });
    return { personId: OPERATOR, sessionId };
  }

  it("answers a cash retry under a new sign-in after a Disable with the first payment, writing nothing", async () => {
    const till = await freshTill();
    const billId = await bill();
    const request = wholeBill("cash");
    const first = await takeBillPayment(fiscal(), till.cfg, billId, request, till.operator);
    const taken = await writes(billId, till);
    expect(taken.billPayments).toMatchObject([{ state: "received" }]);
    expect(taken.sales).toHaveLength(1);
    const operator = await signBackIn(till);

    const retry = await takeBillPayment(fiscal(), till.cfg, billId, request, operator);

    expect(retry.outcome).toBe("received");
    expect(retry.payment.id).toBe(first.payment.id);
    expect(await writes(billId, till)).toEqual(taken);
  });

  it("answers a reader card retry under a new sign-in after a Disable with the first payment, asking the reader once", async () => {
    const till = await freshTill();
    const billId = await bill();
    const provider = new FakePaymentProvider(suite.db);
    const request = { ...wholeBill("card"), entry: "reader" as const, externalRef: undefined };
    const first = await takeReaderBillPayment(
      { ...fiscal(), provider },
      till.cfg,
      billId,
      request,
      till.operator,
    );
    const taken = await writes(billId, till);
    expect(taken.billPayments).toMatchObject([{ state: "received" }]);
    expect(taken.sales).toHaveLength(1);
    const operator = await signBackIn(till);

    const retry = await takeReaderBillPayment(
      { ...fiscal(), provider },
      till.cfg,
      billId,
      request,
      operator,
    );

    expect(retry.outcome).toBe("received");
    expect(retry.payment.id).toBe(first.payment.id);
    expect(provider.collectCalls).toHaveLength(1);
    expect(await writes(billId, till)).toEqual(taken);
  });
});
