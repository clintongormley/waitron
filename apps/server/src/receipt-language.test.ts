import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  billPayments,
  deviceProfiles,
  devices,
  invoiceSeries,
  locations,
  printJobs,
  printers,
  sales,
  tenants,
  withTransaction,
  workingOrders,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  createCatalogue,
  createCategory,
  createOptionList,
  createProduct,
  createUnit,
  writeProductModifiers,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import {
  hashPassword,
  hashPin,
  loginWithPin,
  persons,
  startManagementSession,
} from "@waitron/identity";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment, SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { createAdjustmentReason } from "@waitron/adjustments";
import { recordCorrection } from "@waitron/core";
import { decimal, saleId as brandSaleId, seriesId as brandSeriesId } from "@waitron/shared";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { readInvoiceDocument } from "./invoice-document.js";
import { buildReceiptDocument } from "./receipt-document.js";
import { mountPaymentsApi } from "./payments-api.js";
import { loadTillConfig } from "./till-config.js";
import type { DeviceRequestConfig } from "./till-config.js";
import {
  payWorkingOrderIntegratedOrchestration as payWorkingOrderIntegrated,
  printSaleReceipt,
} from "./till-sale.js";
import { createOpenOrder, parkOrder, placeOrder } from "./working-order.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  statusOf,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { REASONS } from "./testing/adjustment-venue.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { completeBillPayment } from "./bill-payments.js";
import { BASIC_ACTIONS, seedSessionDevice, deviceRequestCfg } from "./testing/session-device.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// 10:24 in Madrid, so a Catalan date reads «2 d’oct. 2026, 10:24».
const AT = new Date("2026-10-02T08:24:00.000Z");
const clock: TrustedClock = {
  now: () => ({
    instant: AT,
    offsetMinutes: 120,
    confident: true,
    confidence: "anchored",
    anchorAgeSeconds: 0,
  }),
  anchor: () => {
    throw new Error("unused");
  },
  currentAnchor: () => null,
};

const BARCELONA = { postalCode: "08001", city: "Barcelona", province: "Barcelona" };
const MADRID = { postalCode: "28013", city: "Madrid", province: "Madrid" };

interface Venue {
  app: Hono;
  cfg: DeviceRequestConfig;
  /** The operator's session on a device allowed every capability, with no device cookie. */
  session: string;
  /** The session plus an enrolled till device, as a sale is sent. */
  till: string;
  menuItemId: string;
  backend: VerifactuBackend;
}

async function venueWith(
  db: Database,
  invoiceLocales: string[],
  place: typeof BARCELONA,
  envLocale?: string,
): Promise<Venue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: "66000001Y",
        legalName: "Idiomes SL",
        location: {
          name: "Sala",
          fiscalTerritory: "ES-common",
          invoiceLocales,
          operationDescription: "Venta en establecimiento",
          addressLine1: "Carrer 1",
          addressLine2: null,
          ...place,
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
        },
        seriesCode: "A",
        rectificativeSeriesCode: "R",
        admin: {
          displayName: "Admin",
          pinHash: hashPin("1234"),
          passwordHash: hashPassword("dashPass123"),
          email: "owner@example.test",
        },
      },
      ALL_MODULES,
    ),
    { db, modules: ALL_MODULES },
  );
  // Built the way boot builds it, from the variables the box sets.
  const cfg = await deviceRequestCfg(suite.db, {
    ...loadTillConfig({
      WAITRON_TILL_NODE_ID: venue.nodeId,

      WAITRON_TILL_LOCATION_ID: venue.locationId,
      ...(envLocale === undefined ? {} : { WAITRON_TILL_LOCALE: envLocale }),
    }),
    simplifiedInvoiceLimit: null,
  });
  const { menuItemId, staffId, profileId, printerId } = await withTransaction(db, async (tx) => {
    await tx.execute(
      sql`insert into content_languages (id, default_language, languages) values (1, 'es', '["es","ca","gl"]')
          on conflict (id) do update set default_language = excluded.default_language, languages = excluded.languages`,
    );
    const menu = await createCatalogue(tx, { name: "Carta" });
    const category = await createCategory(tx, { name: "Tapas" });
    // The staff, customer-facing and kitchen names all differ (docs/developers/products.md).
    const product = await createProduct(tx, {
      catalogueId: menu.id,
      categoryId: category.id,
      name: "STAFF Pan",
      customerName: {
        es: "CLIENT-ES Pan con tomate",
        ca: "CLIENT-CA Pa amb tomàquet",
        gl: "CLIENT-GL Pan con tomate",
      },
      kitchenName: "KITCHEN Pan",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    const offers = await offerProducts(tx, cfg, { productIds: [product.id] });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const { id: printerId } = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: "Recibos",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: false,
      },
    );
    const [profile] = await tx
      .insert(deviceProfiles)
      .values({
        name: "Barra",
        formFactor: "till",
        capabilities: [...BASIC_ACTIONS, "open-cash-drawer", "take-cash"],
      })
      .returning({ id: deviceProfiles.id });
    return {
      menuItemId: offers.offerFor(product.id),
      staffId: staff!.id,
      profileId: profile!.id,
      printerId,
    };
  });
  const backend = new VerifactuBackend({
    clock,
    db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("a sale never submits inline")),
  });
  const app = new Hono();
  mountTillApi(
    app,
    { db, backend, clock, cfg, secureCookies: false, venueLocale: "es-ES" },
    () => {},
  );
  const device = await enrolDeviceForTest(db, cfg, { name: "Barra", profileId });
  const deviceCookie = `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`;
  const login = await app.request("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: deviceCookie },
    body: JSON.stringify({ personId: staffId, pin: "5555" }),
  });
  const tillSession = login.headers.get("set-cookie")!.split(";")[0]!;
  const sessionDeviceId = await seedSessionDevice(db, cfg);
  const session = await withTransaction(db, (tx) =>
    loginWithPin(tx, { deviceId: sessionDeviceId, personId: staffId, pin: "5555" }),
  );
  // Every device prints its receipts on the one printer and opens its drawer.
  await withTransaction(db, (tx) =>
    tx.update(devices).set({ receiptPrinterId: printerId, cashDrawerPrinterId: printerId }),
  );
  return {
    app,
    cfg,
    session: `${SESSION_COOKIE}=${session.token}`,
    till: `${tillSession}; ${deviceCookie}`,
    menuItemId,
    backend,
  };
}

async function sell(
  v: Venue,
  tender: { method: "cash" | "card"; amount: string },
): Promise<{ id: string; status: number; body: { locale?: string } }> {
  const id = randomUUID();
  const res = await v.app.request("/api/sales", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: v.till },
    body: JSON.stringify({
      workingOrderId: id,
      lines: [{ menuItemId: v.menuItemId, quantity: "1" }],
      tender,
    }),
  });
  return { id, status: res.status, body: (await res.json()) as { locale?: string } };
}

/** The receipts printed so far, oldest first, each as its printed lines; then forgets them. */
async function takePrinted(db: Database): Promise<string[][]> {
  const jobs = await withTransaction(db, (tx) =>
    tx.select({ payload: printJobs.payload }).from(printJobs).orderBy(printJobs.createdAt),
  );
  await withTransaction(db, (tx) => tx.delete(printJobs));
  return jobs.map((job) => printedLines(new Uint8Array(job.payload)).map((line) => line.trim()));
}

function saleRow(db: Database, workingOrderId: string) {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ locale: sales.locale, invoiceLocales: sales.invoiceLocales })
      .from(sales)
      .where(eq(sales.workingOrderId, workingOrderId));
    return row;
  });
}

function lineDescriptions(db: Database, workingOrderId: string): Record<string, string>[] {
  return db
    .all<{ descriptions: string }>(
      sql`select sl.descriptions from sale_lines sl join sales s on s.id = sl.sale_id
          where s.working_order_id = ${workingOrderId}`,
    )
    .map((row) => JSON.parse(row.descriptions) as Record<string, string>);
}

async function tillInvoiceLocale(v: Venue): Promise<string | undefined> {
  const res = await v.app.request("/api/till", { headers: { cookie: v.till } });
  return ((await res.json()) as { invoiceLocale?: string }).invoiceLocale;
}

async function tillReceiptLanguages(v: Venue): Promise<string[] | undefined> {
  const res = await v.app.request("/api/till", { headers: { cookie: v.till } });
  return ((await res.json()) as { receiptLanguages?: string[] }).receiptLanguages;
}

/** True when a printed line is the label alone or the label followed by its value. */
const startsWith = (lines: string[], label: string) =>
  lines.some((line) => line === label || line.startsWith(`${label} `));

describe("a receipt follows its location's saved language when its order saves none", () => {
  it("prints a Barcelona location saved as Catalan in Catalan, with WAITRON_TILL_LOCALE unset", async () => {
    const v = await venueWith(suite.db, ["ca-ES"], BARCELONA);
    expect(v.cfg.locale).toBe("es-ES");
    expect(await tillInvoiceLocale(v)).toBe("ca-ES");

    const sale = await sell(v, { method: "cash", amount: "5.00" });
    expect(sale.status).toBe(200);
    expect(sale.body.locale).toBe("ca-ES");
    expect(await saleRow(suite.db, sale.id)).toEqual({
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
    });

    const [receipt] = await takePrinted(suite.db);
    for (const label of ["Factura", "IVA 21% inclòs", "IVA", "Efectiu", "Canvi"]) {
      expect(startsWith(receipt!, label), label).toBe(true);
    }
    expect(receipt!.find((line) => line.startsWith("Comanda "))).toContain("d’oct.");
    expect(startsWith(receipt!, "IVA 21% incluido")).toBe(false);
    expect(startsWith(receipt!, "Efectivo")).toBe(false);
  });

  it("prints a Madrid location saved as Galician in Galician, on the sale and on a later reprint", async () => {
    const v = await venueWith(suite.db, ["gl-ES"], MADRID);
    const sale = await sell(v, { method: "card", amount: "1.50" });
    expect(sale.status).toBe(200);
    expect(sale.body.locale).toBe("gl-ES");

    // A reprint that names no language is in the language the sale was filed in, whatever the
    // location says now.
    await withTransaction(suite.db, (tx) =>
      tx
        .update(locations)
        .set({ invoiceLocales: ["es-ES"] })
        .where(eq(locations.id, v.cfg.locationId)),
    );
    const reprint = await v.app.request(`/api/sales/${sale.id}/reprint`, {
      method: "POST",
      headers: { cookie: v.session },
    });
    expect(reprint.status).toBe(200);

    const [original, duplicate] = await takePrinted(suite.db);
    for (const receipt of [original!, duplicate!]) {
      expect(startsWith(receipt, "IVE"), "IVE").toBe(true);
      expect(startsWith(receipt, "Tarxeta"), "Tarxeta").toBe(true);
      expect(startsWith(receipt, "IVA")).toBe(false);
      expect(startsWith(receipt, "Tarjeta")).toBe(false);
    }
    expect(duplicate).toContain("DUPLICADO");
  });

  it("is not decided by WAITRON_TILL_LOCALE", async () => {
    const v = await venueWith(suite.db, ["gl-ES"], MADRID, "ca-ES");
    expect(v.cfg.locale).toBe("ca-ES");
    expect(await tillInvoiceLocale(v)).toBe("gl-ES");

    const sale = await sell(v, { method: "cash", amount: "5.00" });
    expect(sale.body.locale).toBe("gl-ES");
    expect((await saleRow(suite.db, sale.id))?.locale).toBe("gl-ES");
    const [receipt] = await takePrinted(suite.db);
    expect(startsWith(receipt!, "IVE")).toBe(true);
    expect(
      receipt!.find((line) => line.startsWith("Pedido ") && line.includes("2026")),
    ).not.toContain("d’oct.");
  });

  it("prints a location saved with two languages in the first, and files both", async () => {
    const v = await venueWith(suite.db, ["es-ES", "ca-ES"], BARCELONA);
    expect(await tillInvoiceLocale(v)).toBe("es-ES");

    const sale = await sell(v, { method: "cash", amount: "5.00" });
    expect(sale.body.locale).toBe("es-ES");
    expect(await saleRow(suite.db, sale.id)).toEqual({
      locale: "es-ES",
      invoiceLocales: ["es-ES", "ca-ES"],
    });
    expect(lineDescriptions(suite.db, sale.id)).toEqual([
      { "es-ES": "CLIENT-ES Pan con tomate", "ca-ES": "CLIENT-ES Pan con tomate" },
    ]);
    const [receipt] = await takePrinted(suite.db);
    expect(startsWith(receipt!, "IVA 21% incluido")).toBe(true);
    expect(startsWith(receipt!, "Efectivo")).toBe(true);
    expect(receipt!.some((line) => line.includes("CLIENT-ES Pan con tomate"))).toBe(true);
    expect(receipt!.some((line) => line.includes("CLIENT-CA"))).toBe(false);
  });

  it.each([
    ["es-ES", MADRID],
    ["ca-ES", BARCELONA],
    ["gl-ES", MADRID],
    ["eu-ES", MADRID],
  ] as const)(
    "prints the Veri*Factu legend and the QR caption unchanged on a %s receipt",
    async (locale, place) => {
      const v = await venueWith(suite.db, [locale], place);
      const sale = await sell(v, { method: "cash", amount: "5.00" });
      expect(sale.body.locale).toBe(locale);
      const [receipt] = await takePrinted(suite.db);
      expect(receipt).toContain("VERI*FACTU");
      expect(receipt).toContain("QR tributario:");
    },
  );
});

/** A bill venue whose location is saved as Catalan while its configuration still says Spanish. */
async function catalanBillVenue(): Promise<BillVenue> {
  const venue = await provisionBillVenue(suite.db);
  expect(venue.cfg.locale).toBe("es-ES");
  await inTx(venue, (tx) =>
    tx
      .update(locations)
      .set({ invoiceLocales: ["ca-ES"] })
      .where(eq(locations.id, venue.cfg.locationId)),
  );
  return venue;
}

/** The one customer receipt among the jobs printed so far. */
async function takeReceipt(db: Database): Promise<string[]> {
  const receipts = (await takePrinted(db)).filter((lines) => lines.includes("VERI*FACTU"));
  expect(receipts).toHaveLength(1);
  return receipts[0]!;
}

describe("a bill paid in parts and an unpaid invoice file the location's language when the order saves none", () => {
  function cashContribution(venue: BillVenue, billId: string, amount: string) {
    return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    });
  }

  it("files a bill paid in two parts in Catalan", async () => {
    const venue = await catalanBillVenue();
    const billId = await tabWith(venue, "Tarta", "Caña");

    expect((await cashContribution(venue, billId, "10.00")).status).toBe(200);
    const last = await cashContribution(venue, billId, "11.00");
    expect(last.status).toBe(200);
    expect((last.json.invoice as { locale?: string } | undefined)?.locale).toBe("ca-ES");
    expect(await saleRow(suite.db, billId)).toEqual({
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
    });
  });

  it("files and explicitly prints an unpaid invoice in Catalan", async () => {
    const venue = await catalanBillVenue();
    const { zoneId } = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId,
      operatorId: venue.operatorId,
    });
    await takePrinted(suite.db);
    await placeOrder(deps, venue.cfg, id, venue.operatorId);
    await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
    await printSaleReceipt(deps, venue.cfg, id, false);
    expect(await saleRow(suite.db, id)).toEqual({ locale: "ca-ES", invoiceLocales: ["ca-ES"] });
    const receipt = await takeReceipt(suite.db);
    expect(startsWith(receipt, "IVA 21% inclòs"), "IVA 21% inclòs").toBe(true);
    expect(startsWith(receipt, "IVA 21% incluido")).toBe(false);
  });
});

describe("a card-reader sale files and prints in the location's language when the order saves none", () => {
  async function catalanCounter() {
    const venue = await catalanBillVenue();
    const { zoneId, offerFor } = await inTx(venue, async (tx) => {
      const offers = await offerProducts(tx, venue.cfg, { zone: "counter" });
      return { zoneId: offers.zoneId, offerFor: offers.offerFor };
    });
    const [tarta] = suite.db.all<{ id: string }>(sql`select id from products where name = 'Tarta'`);
    const deps = {
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      provider: new SimulatorPaymentProvider(venue.db),
    };
    await takePrinted(suite.db);
    return { venue, deps, zoneId, menuItemId: offerFor(tarta!.id) };
  }

  it("files and prints a captured card sale in Catalan", async () => {
    const { venue, deps, zoneId, menuItemId } = await catalanCounter();
    const id = randomUUID();

    const out = await payWorkingOrderIntegrated(deps, venue.cfg, {
      id,
      zoneId,
      lines: [{ menuItemId, quantity: "1" }],
      simulationOutcome: "captured",
    });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.locale).toBe("ca-ES");
    expect(await saleRow(suite.db, id)).toEqual({ locale: "ca-ES", invoiceLocales: ["ca-ES"] });
    const receipt = await takeReceipt(suite.db);
    expect(startsWith(receipt, "Targeta"), "Targeta").toBe(true);
    expect(startsWith(receipt, "Tarjeta")).toBe(false);
  });

  it("files and prints in Catalan a card payment captured before a lost response", async () => {
    const { venue, deps, zoneId, menuItemId } = await catalanCounter();
    const id = randomUUID();
    await inTx(venue, async (tx) => {
      await createOpenOrder(tx, venue.cfg, id, [{ menuItemId, quantity: "1" }], null, { zoneId });
      await insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        workingOrderId: id,
        provider: "simulator",
        paymentRef: `sim-ref-${randomUUID()}`,
        amount: decimal("18.00"),
        settledAt: new Date(),
        externalRef: `sim-lost-${randomUUID()}`,
      });
    });

    const out = await payWorkingOrderIntegrated(deps, venue.cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.locale).toBe("ca-ES");
    expect(await saleRow(suite.db, id)).toEqual({ locale: "ca-ES", invoiceLocales: ["ca-ES"] });
    const receipt = await takeReceipt(suite.db);
    expect(startsWith(receipt, "Targeta"), "Targeta").toBe(true);
    expect(startsWith(receipt, "Tarjeta")).toBe(false);
  });
});

/** Every row of these tables, so a reprint that changed one of them is seen. */
const SALE_TABLES = [
  "registros_facturacion",
  "cadenas",
  "envios",
  "invoice_series",
  "sales",
  "sale_lines",
  "tenders",
  "sale_settlements",
  "drawer_opens",
  "working_orders",
  "working_order_lines",
  "receipt_reprints",
] as const;

function saleTables(db: Database): Record<string, unknown[]> {
  return Object.fromEntries(
    SALE_TABLES.map((name) => [name, db.all(sql.raw(`select * from ${name} order by rowid`))]),
  );
}

interface Job {
  kind: string;
  saleId: string | null;
  payload: Uint8Array;
}

/** The jobs printed so far, oldest first; then forgets them. */
async function takeJobs(db: Database): Promise<Job[]> {
  const jobs = await withTransaction(db, (tx) =>
    tx
      .select({ kind: printJobs.kind, saleId: printJobs.saleId, payload: printJobs.payload })
      .from(printJobs)
      .orderBy(printJobs.createdAt),
  );
  await withTransaction(db, (tx) => tx.delete(printJobs));
  return jobs.map((job) => ({ ...job, payload: new Uint8Array(job.payload) }));
}

/** The QR image and the legend after it: the bytes a reprint must carry unchanged. */
function qrAndLegend(payload: Uint8Array): Buffer[] {
  const commands = printedCommands(payload);
  const at = commands.findIndex((c) => c.name === "GS v 0" && c.text === undefined);
  expect(at).toBeGreaterThan(0);
  return commands.slice(at - 1, at + 2).map((c) => Buffer.from(c.bytes));
}

function reprint(v: Venue, saleId: string, body?: unknown): Promise<Response> {
  return Promise.resolve(
    v.app.request(`/api/sales/${saleId}/reprint`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: v.session },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

describe("an issued receipt reprinted in another receipt language", () => {
  /** A Barcelona venue saved as Catalan whose receipt and drawer printer has a cash drawer, and one
   *  cash sale. */
  async function catalanSale() {
    const v = await venueWith(suite.db, ["ca-ES"], BARCELONA);
    await withTransaction(suite.db, (tx) => tx.update(printers).set({ hasCashDrawer: true }));
    const sale = await sell(v, { method: "cash", amount: "5.00" });
    expect(sale.status).toBe(200);
    expect(sale.body.locale).toBe("ca-ES");
    const jobs = await takeJobs(suite.db);
    // The control: this sale did open the drawer, so the reprint's lack of one means something.
    expect(jobs.map((job) => job.kind).sort()).toEqual(["document", "drawer"]);
    const original = jobs.find((job) => job.kind === "document")!;
    return { v, sale, original };
  }

  it("prints Spanish fixed words on a Catalan sale, with its lines, totals, QR and legend, marked as a copy", async () => {
    const { v, sale, original } = await catalanSale();
    const before = saleTables(suite.db);
    expect(before.registros_facturacion).toHaveLength(1);
    expect(before.drawer_opens).toHaveLength(1);

    const answer = await reprint(v, sale.id, { language: "es-ES" });
    expect(answer.status).toBe(200);

    const jobs = await takeJobs(suite.db);
    expect(jobs.map((job) => job.kind)).toEqual(["document"]);
    const copy = jobs[0]!;
    expect(copy.saleId).toBe(original.saleId);
    expect(saleTables(suite.db)).toEqual(before);

    const catalan = printedLines(original.payload).map((line) => line.trim());
    const spanish = printedLines(copy.payload).map((line) => line.trim());
    for (const label of ["Factura", "IVA 21% incluido", "IVA", "Efectivo", "Cambio"]) {
      expect(startsWith(spanish, label), label).toBe(true);
    }
    expect(spanish).toContain("DUPLICADO");
    for (const label of ["IVA 21% inclòs", "Efectiu", "Canvi", "Comanda", "DUPLICAT"]) {
      expect(startsWith(spanish, label), label).toBe(false);
    }
    // The dish name is the one the line stored, in the default content language (Spanish).
    expect(spanish.some((line) => line.includes("CLIENT-ES Pan con tomate"))).toBe(true);
    expect(spanish.some((line) => line.includes("CLIENT-CA"))).toBe(false);

    // Line by line, only the copy marking and the fixed words differ.
    const withoutMark = spanish.filter((line) => line !== "DUPLICADO");
    expect(withoutMark).toHaveLength(catalan.length);
    const differing = catalan.flatMap((line, i) =>
      line === withoutMark[i] ? [] : [[line.split(/\s+/)[0], withoutMark[i]!.split(/\s+/)[0]]],
    );
    expect(differing).toEqual([
      ["Comanda", "Pedido"],
      ["IVA", "IVA"],
      ["Efectiu", "Efectivo"],
      ["Canvi", "Cambio"],
    ]);
    expect(qrAndLegend(copy.payload)).toEqual(qrAndLegend(original.payload));
  });

  it("prints in the language the sale was filed in when the body is empty or names no language", async () => {
    const { v, sale } = await catalanSale();
    for (const body of [{}, { language: undefined }]) {
      expect((await reprint(v, sale.id, body)).status).toBe(200);
    }
    for (const receipt of await takePrinted(suite.db)) {
      expect(startsWith(receipt, "IVA 21% inclòs"), "IVA 21% inclòs").toBe(true);
      expect(receipt).toContain("DUPLICAT");
    }
  });

  // `eu-ES` is a pack receipt language, but Basque is not one of this venue's content languages.
  it.each([["eu-ES"], ["en-GB"], [5], [null], [["es-ES"]]])(
    "refuses a language %j outside the offered receipt languages, printing nothing",
    async (language) => {
      const { v, sale } = await catalanSale();
      const before = saleTables(suite.db);
      const answer = await reprint(v, sale.id, { language });
      expect([answer.status, await answer.json()]).toEqual([
        400,
        { error: { code: "management.request_invalid", params: { field: "language" } } },
      ]);
      expect(await takeJobs(suite.db)).toEqual([]);
      expect(saleTables(suite.db)).toEqual(before);
    },
  );

  it("offers the till the location's receipt language first, then the pack's receipt languages among the content languages", async () => {
    const v = await venueWith(suite.db, ["ca-ES"], BARCELONA);
    expect(await tillReceiptLanguages(v)).toEqual(["ca-ES", "es-ES", "gl-ES"]);
  });

  it("prints a copy in the sale's own language after that language stops being offered", async () => {
    const v = await venueWith(suite.db, ["gl-ES"], MADRID);
    const sale = await sell(v, { method: "cash", amount: "5.00" });
    expect(sale.body.locale).toBe("gl-ES");
    await takePrinted(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(locations)
        .set({ invoiceLocales: ["es-ES"] })
        .where(eq(locations.id, v.cfg.locationId));
      await tx.execute(
        sql`update content_languages set default_language = 'es', languages = '["es","ca"]'`,
      );
    });
    // The control: Galician is no longer offered.
    expect(await tillReceiptLanguages(v)).toEqual(["es-ES", "ca-ES"]);

    expect((await reprint(v, sale.id, { language: "gl-ES" })).status).toBe(200);
    const [copy] = await takePrinted(suite.db);
    expect(startsWith(copy!, "IVE"), "IVE").toBe(true);
    expect(startsWith(copy!, "IVA")).toBe(false);
    expect(copy).toContain("DUPLICADO");
  });
});

/** A dish, its unit and its options answer, worded differently in every content language. */
const GOODS = {
  es: {
    name: "CLIENT-ES Tostada",
    unitName: "ES ración",
    unit: "ES-rac",
    list: "ES Tipo de pan",
    label: "ES Centeno",
  },
  ca: {
    name: "CLIENT-CA Torrada",
    unitName: "CA ració",
    unit: "CA-rac",
    list: "CA Tipus de pa",
    label: "CA Sègol",
  },
  gl: {
    name: "CLIENT-GL Torrada",
    unitName: "GL ración",
    unit: "GL-rac",
    list: "GL Tipo de pan",
    label: "GL Centeo",
  },
  en: {
    name: "CLIENT-EN Toast",
    unitName: "EN portion",
    unit: "EN-por",
    list: "EN Bread",
    label: "EN Rye",
  },
} as const;
type GoodsLanguage = keyof typeof GOODS;

describe("a sale prints its goods in the default content language its lines stored them in, whatever its receipt language", () => {
  /** A Barcelona venue saved as Catalan, with `defaultLanguage` and `languages` as its content
   *  languages, selling a dish whose customer name, unit and options answer are worded in each of
   *  `languages`. */
  async function goodsVenueIn(defaultLanguage: GoodsLanguage, languages: GoodsLanguage[]) {
    const v = await venueWith(suite.db, ["ca-ES"], BARCELONA);
    const wording = (pick: (words: (typeof GOODS)[GoodsLanguage]) => string) =>
      Object.fromEntries(languages.map((language) => [language, pick(GOODS[language])]));
    const goods = await withTransaction(suite.db, async (tx) => {
      await tx.execute(
        sql`update content_languages set default_language = ${defaultLanguage}, languages = ${JSON.stringify(languages)}`,
      );
      const menu = await createCatalogue(tx, { name: "Racions" });
      const unit = await createUnit(
        tx,
        {
          name: wording((words) => words.unitName),
          precision: 0,
          abbreviation: wording((words) => words.unit),
        },
        defaultLanguage,
      );
      const product = await createProduct(tx, {
        catalogueId: menu.id,
        categoryId: null,
        name: "STAFF Torrada",
        customerName: wording((words) => words.name),
        kitchenName: "KITCHEN Torrada",
        unitId: unit.id,
        unitPrice: "2.00",
        vatClass: "general",
      });
      const bread = await createOptionList(
        tx,
        {
          name: "STAFF Pa",
          customerName: wording((words) => words.list),
          kitchenName: "KITCHEN Pa",
          defaultLabelId: null,
          active: true,
          labels: [
            {
              name: "STAFF Segol",
              customerName: wording((words) => words.label),
              kitchenName: "KITCHEN Segol",
              available: true,
            },
          ],
        },
        defaultLanguage,
      );
      await writeProductModifiers(tx, product.id, [{ kind: "options", id: bread.id }]);
      const offers = await offerProducts(tx, v.cfg, { productIds: [product.id] });
      return {
        menuItemId: offers.offerFor(product.id),
        zoneId: offers.zoneId,
        options: [{ listId: bread.id, labelId: bread.labels[0]!.id }],
      };
    });
    return { v, goods };
  }

  /** {@link goodsVenueIn} with Spanish the default among Spanish, Catalan and Galician. */
  async function goodsVenue() {
    const venue = await goodsVenueIn("es", ["es", "ca", "gl"]);
    expect(await tillReceiptLanguages(venue.v)).toEqual(["ca-ES", "es-ES", "gl-ES"]);
    return venue;
  }

  type Goods = Awaited<ReturnType<typeof goodsVenue>>["goods"];

  /** Every printed line, its runs of spaces closed up. */
  const flat = (lines: string[]) => lines.map((line) => line.replace(/\s+/g, " "));

  /** The words of every language but `language`, each of which no printed line may hold. */
  const otherWords = (language: GoodsLanguage) =>
    (Object.keys(GOODS) as GoodsLanguage[])
      .filter((other) => other !== language)
      .flatMap((other) => {
        const words = GOODS[other];
        return [words.name.split(" ")[0]!, words.unit, words.list, words.label];
      });

  /** Two of the dish in `language`'s unit and name, its answer in `language`, and no other
   *  language's goods. */
  function expectGoods(receipt: string[], language: GoodsLanguage): void {
    const lines = flat(receipt);
    const words = GOODS[language];
    expect(startsWith(lines, `2 ${words.unit} ${words.name}`)).toBe(true);
    expect(lines).toContain(`${words.list}: ${words.label}`);
    for (const other of otherWords(language)) {
      expect(
        lines.some((line) => line.includes(other)),
        other,
      ).toBe(false);
    }
  }

  /** The line a Spanish-default venue stores, on the order and on the sale. */
  const SPANISH_LINE = {
    descriptions: { "ca-ES": "CLIENT-ES Tostada" },
    unitName: { es: "ES-rac" },
    optionSnapshots: [
      {
        listName: { es: "STAFF Pa" },
        listCustomerName: { es: "ES Tipo de pan" },
        listKitchenName: "KITCHEN Pa",
        labelName: { es: "STAFF Segol" },
        labelCustomerName: { es: "ES Centeno" },
        labelKitchenName: "KITCHEN Segol",
      },
    ],
  };

  /** The goods stored on an order's lines and on the sale filed from it. */
  function storedGoods(id: string) {
    type Row = { descriptions: string; unit_name: string | null; option_snapshots: string };
    const parse = (rows: Row[]) =>
      rows.map((row) => ({
        descriptions: JSON.parse(row.descriptions) as unknown,
        unitName: row.unit_name === null ? null : (JSON.parse(row.unit_name) as unknown),
        optionSnapshots: JSON.parse(row.option_snapshots) as unknown,
      }));
    return {
      order: parse(
        suite.db.all<Row>(
          sql`select descriptions, unit_name, option_snapshots from working_order_lines
              where working_order_id = ${id}`,
        ),
      ),
      sale: parse(
        suite.db.all<Row>(
          sql`select sl.descriptions, sl.unit_name, sl.option_snapshots from sale_lines sl
              join sales s on s.id = sl.sale_id where s.working_order_id = ${id}`,
        ),
      ),
    };
  }

  async function sellGoods(
    v: Venue,
    goods: Goods,
    extra: Record<string, unknown> = {},
    id: string = randomUUID(),
  ) {
    const res = await v.app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: v.till },
      body: JSON.stringify({
        workingOrderId: id,
        lines: [{ menuItemId: goods.menuItemId, quantity: "2", options: goods.options }],
        tender: { method: "cash", amount: "5.00" },
        ...extra,
      }),
    });
    return {
      id,
      status: res.status,
      body: (await res.json()) as {
        locale?: string;
        namesLocale?: string;
        lines?: { descriptions: unknown; unitName?: unknown; optionSnapshots?: unknown }[];
      },
    };
  }

  const sellChosen = (v: Venue, goods: Goods, id?: string) =>
    sellGoods(v, goods, { receiptLanguage: "es-ES" }, id);

  it("prints the default content language's goods under Catalan fixed words, chosen or not, and stores them once in that language", async () => {
    const { v, goods } = await goodsVenue();

    for (const extra of [{ receiptLanguage: "ca-ES" }, {}]) {
      const sale = await sellGoods(v, goods, extra);

      expect(sale.status).toBe(200);
      expect(sale.body.locale).toBe("ca-ES");
      const [receipt] = await takePrinted(suite.db);
      for (const label of ["IVA 21% inclòs", "Efectiu", "Canvi"]) {
        expect(startsWith(receipt!, label), label).toBe(true);
      }
      expectGoods(receipt!, "es");
      expect(storedGoods(sale.id)).toEqual({ order: [SPANISH_LINE], sale: [SPANISH_LINE] });
    }
  });

  it("prints Spanish fixed words with the default content language's dish name, unit and options answer", async () => {
    const { v, goods } = await goodsVenue();

    const sale = await sellChosen(v, goods);

    expect(sale.status).toBe(200);
    expect(sale.body.locale).toBe("es-ES");
    expect(sale.body.namesLocale).toBe("ca-ES");
    expect(await saleRow(suite.db, sale.id)).toEqual({
      locale: "es-ES",
      invoiceLocales: ["ca-ES", "es-ES"],
    });
    const [receipt] = await takePrinted(suite.db);
    for (const label of ["Factura", "IVA 21% incluido", "IVA", "Efectivo", "Cambio"]) {
      expect(startsWith(receipt!, label), label).toBe(true);
    }
    for (const label of ["IVA 21% inclòs", "Efectiu", "Canvi"]) {
      expect(startsWith(receipt!, label), label).toBe(false);
    }
    expectGoods(receipt!, "es");
  });

  it("prints the default content language's dish name, stored under both keys, when a two-language location's Spanish is chosen", async () => {
    const v = await venueWith(suite.db, ["ca-ES", "es-ES"], BARCELONA);
    const id = randomUUID();

    const res = await v.app.request("/api/sales", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: v.till },
      body: JSON.stringify({
        workingOrderId: id,
        lines: [{ menuItemId: v.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
        receiptLanguage: "es-ES",
      }),
    });

    expect(res.status).toBe(200);
    expect(await saleRow(suite.db, id)).toEqual({
      locale: "es-ES",
      invoiceLocales: ["ca-ES", "es-ES"],
    });
    expect(lineDescriptions(suite.db, id)).toEqual([
      { "ca-ES": "CLIENT-ES Pan con tomate", "es-ES": "CLIENT-ES Pan con tomate" },
    ]);
    const [receipt] = await takePrinted(suite.db);
    for (const label of ["IVA 21% incluido", "Efectivo", "Cambio"]) {
      expect(startsWith(receipt!, label), label).toBe(true);
    }
    expect(startsWith(receipt!, "IVA 21% inclòs")).toBe(false);
    expect(receipt!.some((line) => line.includes("CLIENT-ES Pan con tomate"))).toBe(true);
    expect(receipt!.some((line) => line.includes("CLIENT-CA"))).toBe(false);
  });

  it("prints a Galician copy with the default content language's goods, and answers the names' language on a replay", async () => {
    const { v, goods } = await goodsVenue();
    const sale = await sellChosen(v, goods);
    expect(sale.status).toBe(200);
    await takePrinted(suite.db);

    expect((await reprint(v, sale.id, { language: "gl-ES" })).status).toBe(200);
    const [copy] = await takePrinted(suite.db);
    expect(startsWith(copy!, "IVE"), "IVE").toBe(true);
    expect(copy).toContain("DUPLICADO");
    expect(startsWith(copy!, "IVA")).toBe(false);
    expectGoods(copy!, "es");

    // The same sale sent again answers the ticket read back from the filed sale.
    const replay = await sellChosen(v, goods, sale.id);
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ locale: "es-ES", namesLocale: "ca-ES" });
  });

  // A full invoice cannot be asked for at the counter (`sale.full_invoice_unavailable`), so the
  // order is saved with the choice and paid the way a bill payment is completed.
  it("renders a full invoice's A4 and the till's receipt lines with the default content language's goods under Catalan fixed words", async () => {
    const { v, goods } = await goodsVenue();
    const id = randomUUID();
    const [cashier] = suite.db.all<{ id: string }>(
      sql`select id from persons where display_name = 'Cajera'`,
    );

    const { invoice } = await withTransaction(suite.db, async (tx) => {
      await tx.update(tenants).set({ taxpayerDomicile: "Carrer 1, 08001 Barcelona" });
      await createOpenOrder(
        tx,
        v.cfg,
        id,
        [{ menuItemId: goods.menuItemId, quantity: "2", options: goods.options }],
        null,
        {
          zoneId: goods.zoneId,
          receiptLocale: "ca-ES",
          invoiceChoice: {
            invoiceType: "F1",
            recipient: {
              taxId: "B12345674",
              legalName: "Client SL",
              address: "Calle Mayor 2, 08001 Barcelona, Barcelona, España",
              countryCode: "ES",
            },
            recipientNameMaxLength: v.backend.recipientNameMaxLength,
          },
        },
      );
      const [payment] = await tx
        .insert(billPayments)
        .values({
          workingOrderId: id,
          submissionId: randomUUID(),
          fingerprint: "receipt-language-full-invoice",
          kind: "contribution",
          method: "cash",
          applied: 400,
          tendered: 500,
          state: "pending",
          requestedBy: cashier!.id,
          source: v.cfg.origin.source,
          deviceId: v.cfg.origin.deviceId,
        })
        .returning();
      return completeBillPayment(
        tx,
        { db: suite.db, backend: v.backend, clock },
        v.cfg,
        payment!.id,
        AT,
      );
    });

    expect(invoice?.invoiceType).toBe("F1");
    expect(invoice?.locale).toBe("ca-ES");
    // What the till's on-screen receipt draws.
    expect(
      invoice!.lines.map(({ descriptions, unitName, optionSnapshots }) => ({
        descriptions,
        unitName,
        optionSnapshots,
      })),
    ).toEqual([SPANISH_LINE]);
    expect(storedGoods(id)).toEqual({ order: [SPANISH_LINE], sale: [SPANISH_LINE] });
    const [filed] = suite.db.all<{ id: string }>(
      sql`select id from sales where working_order_id = ${id}`,
    );
    // What the email attaches.
    const document = await withTransaction(suite.db, (tx) =>
      readInvoiceDocument(v.backend, tx, v.cfg, filed!.id),
    );
    expect(document.result.invoiceType).toBe("F1");
    const text = buildReceiptDocument(document).elements.flatMap((element) =>
      element.kind === "text"
        ? [element.text.trim()]
        : element.kind === "amount"
          ? [element.caption]
          : [],
    );
    expect(startsWith(text, "Data"), "Data").toBe(true);
    expect(startsWith(text, "Fecha")).toBe(false);
    expectGoods(text, "es");
  });

  it("reprints a sale's original and a Spanish copy with the goods it stored, after the default content language changes", async () => {
    const { v, goods } = await goodsVenue();
    const sale = await sellGoods(v, goods);
    expect(sale.status).toBe(200);
    await takePrinted(suite.db);

    await withTransaction(suite.db, (tx) =>
      tx.execute(sql`update content_languages set default_language = 'ca'`),
    );
    // The control: a dish sold now stores the Catalan goods.
    expect((await sellGoods(v, goods)).status).toBe(200);
    expectGoods((await takePrinted(suite.db))[0]!, "ca");

    expect((await reprint(v, sale.id)).status).toBe(200);
    const [original] = await takePrinted(suite.db);
    expect(startsWith(original!, "IVA 21% inclòs"), "IVA 21% inclòs").toBe(true);
    expect(original).toContain("DUPLICAT");
    expectGoods(original!, "es");

    expect((await reprint(v, sale.id, { language: "es-ES" })).status).toBe(200);
    const [spanish] = await takePrinted(suite.db);
    expect(startsWith(spanish!, "IVA 21% incluido"), "IVA 21% incluido").toBe(true);
    expect(spanish).toContain("DUPLICADO");
    expectGoods(spanish!, "es");
  });

  it("prints the Catalan goods when Catalan is the default content language, with nothing chosen and with Spanish chosen", async () => {
    const { v, goods } = await goodsVenueIn("ca", ["ca", "es", "gl"]);

    const plain = await sellGoods(v, goods);
    expect([plain.status, plain.body.locale]).toEqual([200, "ca-ES"]);
    const [catalan] = await takePrinted(suite.db);
    const chosen = await sellChosen(v, goods);
    expect([chosen.status, chosen.body.locale]).toEqual([200, "es-ES"]);
    const [spanish] = await takePrinted(suite.db);

    expect(startsWith(catalan!, "IVA 21% inclòs"), "IVA 21% inclòs").toBe(true);
    expectGoods(catalan!, "ca");
    expect(startsWith(spanish!, "IVA 21% incluido"), "IVA 21% incluido").toBe(true);
    expectGoods(spanish!, "ca");
  });

  it("prints the English goods under Catalan or Spanish fixed words when English, which has no receipt language, is the default content language", async () => {
    const { v, goods } = await goodsVenueIn("en", ["en", "es", "ca"]);
    expect(await tillReceiptLanguages(v)).toEqual(["ca-ES", "es-ES"]);

    const plain = await sellGoods(v, goods);
    expect([plain.status, plain.body.locale]).toEqual([200, "ca-ES"]);
    const [catalan] = await takePrinted(suite.db);
    const chosen = await sellChosen(v, goods);
    expect([chosen.status, chosen.body.locale]).toEqual([200, "es-ES"]);
    const [spanish] = await takePrinted(suite.db);

    for (const label of ["IVA 21% inclòs", "Efectiu", "Canvi"]) {
      expect(startsWith(catalan!, label), label).toBe(true);
    }
    expectGoods(catalan!, "en");
    for (const label of ["IVA 21% incluido", "Efectivo", "Cambio"]) {
      expect(startsWith(spanish!, label), label).toBe(true);
    }
    expectGoods(spanish!, "en");
  });
});

describe("the receipt language staff choose is saved on the order", () => {
  /** A Madrid venue saved as Catalan, with Spanish and Catalan content: it offers ca-ES and es-ES. */
  async function choosingVenue(): Promise<BillVenue> {
    const venue = await catalanBillVenue();
    await inTx(venue, async (tx) => {
      await tx.execute(
        sql`insert into content_languages (id, default_language, languages) values (1, 'es', '["es","ca"]')
            on conflict (id) do update set default_language = excluded.default_language, languages = excluded.languages`,
      );
    });
    return venue;
  }

  function orderRow(venue: BillVenue, id: string) {
    return inTx(venue, async (tx) => {
      const [row] = await tx.select().from(workingOrders).where(eq(workingOrders.id, id));
      return row!;
    });
  }

  function choose(venue: BillVenue, id: string, body: Record<string, unknown>) {
    return send(venue.app, venue.cookie, "PUT", `/api/working-orders/${id}/receipt-language`, body);
  }

  async function billOf(venue: BillVenue, billId: string) {
    const { partyId } = await orderRow(venue, billId);
    const read = await send(venue.app, venue.cookie, "GET", `/api/parties/${partyId}/bills`);
    expect(read.status).toBe(200);
    const bills = read.json as unknown as { workingOrderId: string }[];
    return bills.find((bill) => bill.workingOrderId === billId)!;
  }

  /** A counter order parked, and placed when asked, through the working-order functions. */
  async function counterOrder(venue: BillVenue, placed: boolean): Promise<string> {
    const { zoneId } = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const id = randomUUID();
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await parkOrder(deps, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId,
      operatorId: venue.operatorId,
    });
    if (placed) await placeOrder(deps, venue.cfg, id, venue.operatorId);
    return id;
  }

  it("saves Spanish on a party bill, answers the next revision and lists it on the bill", async () => {
    const venue = await choosingVenue();
    const billId = await tabWith(venue, "Tarta");
    const before = await orderRow(venue, billId);
    expect((await billOf(venue, billId)) as object).not.toHaveProperty("receiptLanguage");

    const saved = await choose(venue, billId, { revision: before.revision, language: "es-ES" });

    expect(saved).toEqual({ status: 200, json: { revision: before.revision + 1 } });
    expect(await orderRow(venue, billId)).toEqual({
      ...before,
      receiptLocale: "es-ES",
      revision: before.revision + 1,
    });
    expect(await billOf(venue, billId)).toMatchObject({ receiptLanguage: "es-ES" });
  });

  it("clears the choice when sent null", async () => {
    const venue = await choosingVenue();
    const billId = await tabWith(venue, "Tarta");
    const first = await choose(venue, billId, {
      revision: (await orderRow(venue, billId)).revision,
      language: "es-ES",
    });
    expect(first.status).toBe(200);

    const cleared = await choose(venue, billId, { revision: first.json.revision, language: null });

    expect(cleared).toEqual({
      status: 200,
      json: { revision: (first.json.revision as number) + 1 },
    });
    expect((await orderRow(venue, billId)).receiptLocale).toBeNull();
    expect((await billOf(venue, billId)) as object).not.toHaveProperty("receiptLanguage");
  });

  it("refuses a stale revision, leaving the order as it was", async () => {
    const venue = await choosingVenue();
    const billId = await tabWith(venue, "Tarta");
    const before = await orderRow(venue, billId);

    expect(
      await choose(venue, billId, { revision: before.revision + 5, language: "es-ES" }),
    ).toEqual({
      status: 409,
      json: {
        code: "working_order.out_of_date",
        params: { workingOrderId: billId, revision: before.revision },
      },
    });
    expect(await orderRow(venue, billId)).toEqual(before);
  });

  it("refuses a second till's write sent with the revision it read before the first till's write", async () => {
    const venue = await choosingVenue();
    const billId = await tabWith(venue, "Tarta");
    const { revision: read } = await orderRow(venue, billId);
    const firstTill = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${billId}/receipt-language`,
      { revision: read, language: "es-ES" },
    );
    expect(firstTill).toEqual({ status: 200, json: { revision: read + 1 } });
    const afterFirst = await orderRow(venue, billId);

    const secondTill = await send(
      venue.app,
      venue.cookie2,
      "PUT",
      `/api/working-orders/${billId}/receipt-language`,
      { revision: read, language: "ca-ES" },
    );

    expect(secondTill).toEqual({
      status: 409,
      json: {
        code: "working_order.out_of_date",
        params: { workingOrderId: billId, revision: read + 1 },
      },
    });
    expect(await orderRow(venue, billId)).toEqual(afterFirst);
    expect(afterFirst.receiptLocale).toBe("es-ES");
  });

  it.each([["gl-ES"], ["en-GB"], [5], [["es-ES"]], [undefined]])(
    "refuses %j as the language: not a string, or not an offered receipt language",
    async (language) => {
      const venue = await choosingVenue();
      const billId = await tabWith(venue, "Tarta");
      const before = await orderRow(venue, billId);

      expect(await choose(venue, billId, { revision: before.revision, language })).toEqual({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "language" } },
      });
      expect(await orderRow(venue, billId)).toEqual(before);
    },
  );

  it("refuses a settled bill", async () => {
    const venue = await choosingVenue();
    const billId = await tabWith(venue, "Caña");
    const paid = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "3.00",
        method: "cash",
        tendered: "3.00",
        applied: "3.00",
        tip: "0.00",
      },
    );
    expect(paid.status).toBe(200);
    const before = await orderRow(venue, billId);
    expect(before.status).toBe("settled");

    expect(await choose(venue, billId, { revision: before.revision, language: "es-ES" })).toEqual({
      status: 409,
      json: { code: "working_order.not_open", params: { workingOrderId: billId } },
    });
    expect(await orderRow(venue, billId)).toEqual(before);
  });

  it("refuses a placed order once it has a sale", async () => {
    const venue = await choosingVenue();
    const id = await counterOrder(venue, true);
    const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
    await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
    const before = await orderRow(venue, id);
    expect(before.status).toBe("placed");

    expect(await choose(venue, id, { revision: before.revision, language: "es-ES" })).toEqual({
      status: 409,
      json: { code: "working_order.not_open", params: { workingOrderId: id } },
    });
    expect(await orderRow(venue, id)).toEqual(before);
  });

  it("refuses while a payment of the order is in flight", async () => {
    const venue = await choosingVenue();
    const billId = await tabWith(venue, "Tarta");
    await inTx(venue, (tx) =>
      tx
        .update(workingOrders)
        .set({ paymentAttemptAt: new Date().toISOString() })
        .where(eq(workingOrders.id, billId)),
    );
    const before = await orderRow(venue, billId);

    expect(await choose(venue, billId, { revision: before.revision, language: "es-ES" })).toEqual({
      status: 409,
      json: { code: "order.payment_in_flight", params: { workingOrderId: billId } },
    });
    expect(await orderRow(venue, billId)).toEqual(before);
  });

  it("returns the saved choice when the till retrieves a held or a placed order", async () => {
    const venue = await choosingVenue();
    const held = await counterOrder(venue, false);
    const placed = await counterOrder(venue, true);
    const retrieve = (path: string) => send(venue.app, venue.cookie, "GET", path);
    expect((await retrieve(`/api/working-orders/${held}`)).json).not.toHaveProperty(
      "receiptLanguage",
    );

    for (const id of [held, placed]) {
      const { revision } = await orderRow(venue, id);
      expect((await choose(venue, id, { revision, language: "es-ES" })).status).toBe(200);
    }

    expect((await retrieve(`/api/working-orders/${held}`)).json).toMatchObject({
      id: held,
      receiptLanguage: "es-ES",
    });
    expect((await retrieve(`/api/working-orders/${placed}/placed`)).json).toMatchObject({
      id: placed,
      receiptLanguage: "es-ES",
    });
  });
});

describe("a sale files in the receipt language saved on its order", () => {
  /** What a sale of the order filed: its language, its list, and its lines' names by language. */
  async function filed(venue: BillVenue, id: string) {
    const row = await saleRow(venue.db, id);
    return { ...row, lines: lineDescriptions(venue.db, id) };
  }

  /**
   * A Barcelona venue saved as `locales` with Spanish and Catalan content, whose dishes' customer
   * names differ by language. Its till offers Catalan and Spanish receipts.
   */
  async function barcelonaVenue(locales: string[] = ["ca-ES"]): Promise<BillVenue> {
    const venue = await provisionBillVenue(suite.db);
    await inTx(venue, async (tx) => {
      await tx
        .update(locations)
        .set({ invoiceLocales: locales, province: "Barcelona", city: "Barcelona" })
        .where(eq(locations.id, venue.cfg.locationId));
      await tx.execute(
        sql`insert into content_languages (id, default_language, languages) values (1, 'es', '["es","ca"]')
            on conflict (id) do update set default_language = excluded.default_language, languages = excluded.languages`,
      );
      await tx.execute(
        sql`update products set customer_name = json_object('es', 'ES ' || name, 'ca', 'CA ' || name)`,
      );
      await offerProducts(tx, venue.cfg, { zone: "tables" });
    });
    return venue;
  }

  async function revisionOfOrder(venue: BillVenue, id: string): Promise<number> {
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    );
    return row!.revision;
  }

  /** Saves `language` as the order's receipt language through the till's route. */
  async function choose(venue: BillVenue, id: string, language: string): Promise<void> {
    const saved = await send(
      venue.app,
      venue.cookie,
      "PUT",
      `/api/working-orders/${id}/receipt-language`,
      { revision: await revisionOfOrder(venue, id), language },
    );
    expect(saved.status).toBe(200);
  }

  function cash(venue: BillVenue, billId: string, amount: string, app = venue.app) {
    return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount,
      method: "cash",
      tendered: amount,
      applied: amount,
      tip: "0.00",
    });
  }

  /** A counter order parked with one Tarta, through the working-order functions. */
  async function parkedTarta(venue: BillVenue): Promise<{ id: string; zoneId: string }> {
    const { zoneId } = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    const id = randomUUID();
    await parkOrder({ db: venue.db }, venue.cfg, {
      id,
      lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }],
      zoneId,
      operatorId: venue.operatorId,
    });
    return { id, zoneId };
  }

  const SPANISH = {
    locale: "es-ES",
    invoiceLocales: ["ca-ES", "es-ES"],
    lines: [{ "ca-ES": "ES Tarta" }, { "ca-ES": "ES Caña" }],
  };
  const CATALAN = {
    locale: "ca-ES",
    invoiceLocales: ["ca-ES"],
    lines: [{ "ca-ES": "ES Tarta" }, { "ca-ES": "ES Caña" }],
  };
  const CHOICES = [
    ["es-ES", SPANISH],
    [null, CATALAN],
  ] as const;

  describe.each(CHOICES)("with %s saved", (stored, expected) => {
    async function billWith(venue: BillVenue, ...names: string[]): Promise<string> {
      const billId = await tabWith(venue, ...names);
      if (stored !== null) await choose(venue, billId, stored);
      return billId;
    }

    it("files a bill paid in two parts", async () => {
      const venue = await barcelonaVenue();
      const billId = await billWith(venue, "Tarta", "Caña");

      expect((await cash(venue, billId, "10.00")).status).toBe(200);
      const last = await cash(venue, billId, "11.00");

      expect(last.status).toBe(200);
      expect(await filed(venue, billId)).toEqual(expected);
      expect(last.json.invoice).toMatchObject({ locale: expected.locale, namesLocale: "ca-ES" });
    });

    it("files a bill a discount leaves paid", async () => {
      const venue = await barcelonaVenue();
      const billId = await billWith(venue, "Tarta", "Caña");
      expect((await cash(venue, billId, "18.00")).status).toBe(200);
      const reasonId = await inTx(
        venue,
        async (tx) => (await createAdjustmentReason(tx, REASONS.house)).id,
      );

      const discounted = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/adjustments`,
        {
          submissionId: randomUUID(),
          expectedRevision: await revisionOfOrder(venue, billId),
          lineId: null,
          reasonId,
          action: "discount_amount",
          amount: "3.00",
          note: null,
        },
      );

      expect(discounted.status).toBe(200);
      expect(await statusOf(venue, billId)).toBe("settled");
      expect(await filed(venue, billId)).toEqual(expected);
    });

    it("files a bill a line edit leaves paid", async () => {
      const venue = await barcelonaVenue();
      const billId = await billWith(venue, "Tarta", "Caña");
      const line = (quantity: string) =>
        revisionOfOrder(venue, billId).then((revision) =>
          send(venue.app, venue.cookie, "PUT", `/api/working-orders/${billId}/lines/2`, {
            revision,
            quantity,
          }),
        );
      expect((await line("2")).status).toBe(200);
      expect((await cash(venue, billId, "21.00")).status).toBe(200);

      expect((await line("1")).status).toBe(200);

      expect(await statusOf(venue, billId)).toBe("settled");
      expect(await filed(venue, billId)).toEqual(expected);
    });

    it("files a bill a card the payment loop finishes leaves paid", async () => {
      const venue = await barcelonaVenue();
      const billId = await billWith(venue, "Tarta", "Caña");
      expect((await cash(venue, billId, "18.00")).status).toBe(200);
      venue.card.crashNextCollect("captured");
      const crashed = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${billId}/payments`,
        {
          submissionId: randomUUID(),
          kind: "contribution",
          amount: "3.00",
          method: "card",
          entry: "reader",
          applied: "3.00",
          tip: "0.00",
        },
      );
      expect(crashed.status).toBe(500);
      expect(await statusOf(venue, billId)).toBe("open");

      const pass = await settlePendingBillPayments({
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
      });

      expect(pass).toMatchObject({ received: 1, errors: [] });
      expect(await statusOf(venue, billId)).toBe("settled");
      expect(await filed(venue, billId)).toEqual(expected);
    });

    it("files the invoice of a table that left without paying", async () => {
      const venue = await barcelonaVenue();
      const party = await seatedWith(venue, "Tarta", "Caña");
      if (stored !== null) await choose(venue, party.tabId, stored);
      const [row] = venue.db.all<{ revision: number }>(
        sql`select revision from parties where id = ${party.partyId}`,
      );

      const departed = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/parties/${party.partyId}/unpaid-departure`,
        {
          expectedPartyRevision: row!.revision,
          reason: "Se fueron",
          override: { personId: venue.adminId, pin: "1234" },
        },
      );

      expect(departed.status).toBe(200);
      expect(await filed(venue, party.tabId)).toEqual(expected);
    });

    it("files a parked order paid in cash", async () => {
      const venue = await barcelonaVenue();
      const { id } = await parkedTarta(venue);
      if (stored !== null) await choose(venue, id, stored);

      const paid = await send(venue.app, venue.cookie, "POST", "/api/sales", {
        workingOrderId: id,
        lines: [],
        tender: { method: "cash", amount: "20.00" },
      });

      expect(paid.status).toBe(200);
      expect(paid.json.locale).toBe(expected.locale);
      expect(paid.json.namesLocale).toBe("ca-ES");
      expect(await filed(venue, id)).toEqual({ ...expected, lines: [{ "ca-ES": "ES Tarta" }] });
    });

    it("files a parked order a card reader captures", async () => {
      const venue = await barcelonaVenue();
      const { id } = await parkedTarta(venue);
      if (stored !== null) await choose(venue, id, stored);
      const deps = {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        provider: new SimulatorPaymentProvider(venue.db),
      };

      const out = await payWorkingOrderIntegrated(deps, venue.cfg, {
        id,
        lines: [],
        simulationOutcome: "captured",
      });

      expect(out.outcome).toBe("captured");
      expect(out.outcome === "captured" && out.ticket).toMatchObject({
        locale: expected.locale,
        namesLocale: "ca-ES",
      });
      expect(await filed(venue, id)).toEqual({ ...expected, lines: [{ "ca-ES": "ES Tarta" }] });
    });

    it("files a card payment captured before a lost response", async () => {
      const venue = await barcelonaVenue();
      const { id } = await parkedTarta(venue);
      if (stored !== null) await choose(venue, id, stored);
      await inTx(venue, (tx) =>
        insertCapturedPayment(tx, {
          origin: venue.cfg.origin,
          workingOrderId: id,
          provider: "simulator",
          paymentRef: `sim-ref-${randomUUID()}`,
          amount: decimal("18.00"),
          settledAt: new Date(),
          externalRef: `sim-lost-${randomUUID()}`,
        }),
      );
      const deps = {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        provider: new SimulatorPaymentProvider(venue.db),
      };

      const out = await payWorkingOrderIntegrated(deps, venue.cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      expect(out.outcome === "captured" && out.ticket).toMatchObject({
        locale: expected.locale,
        namesLocale: "ca-ES",
      });
      expect(await filed(venue, id)).toEqual({ ...expected, lines: [{ "ca-ES": "ES Tarta" }] });
    });
  });

  it("keeps a location's two languages as they are when the saved one is among them", async () => {
    const venue = await barcelonaVenue(["ca-ES", "es-ES"]);
    const billId = await tabWith(venue, "Tarta");
    await choose(venue, billId, "es-ES");

    expect((await cash(venue, billId, "18.00")).status).toBe(200);

    expect(await filed(venue, billId)).toEqual({
      locale: "es-ES",
      invoiceLocales: ["ca-ES", "es-ES"],
      lines: [{ "ca-ES": "ES Tarta", "es-ES": "ES Tarta" }],
    });
  });

  it("files the location's own language, saved as the choice, as if nothing were saved", async () => {
    const venue = await barcelonaVenue();
    const billId = await tabWith(venue, "Tarta");
    await choose(venue, billId, "ca-ES");

    expect((await cash(venue, billId, "18.00")).status).toBe(200);

    expect(await filed(venue, billId)).toEqual({
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
      lines: [{ "ca-ES": "ES Tarta" }],
    });
  });

  it("files the location's language, and logs one warning, when the saved one is no longer offered", async () => {
    const venue = await barcelonaVenue();
    const billId = await tabWith(venue, "Tarta");
    await choose(venue, billId, "es-ES");
    venue.db.run(sql`update content_languages set default_language = 'ca', languages = '["ca"]'`);
    const logged: { level: string; event: string; fields: unknown }[] = [];
    const app = new Hono();
    mountTillApi(
      app,
      {
        db: venue.db,
        backend: venue.backend,
        clock: venue.clock,
        cfg: venue.cfg,
        secureCookies: false,
        venueLocale: "es-ES",
        pool: venue.pool,
      },
      (level, event, fields) => logged.push({ level, event, fields }),
    );

    const paid = await cash(venue, billId, "18.00", app);

    expect(paid.status).toBe(200);
    expect(await filed(venue, billId)).toEqual({
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
      lines: [{ "ca-ES": "ES Tarta" }],
    });
    expect(logged.filter((entry) => entry.level === "warn")).toEqual([
      {
        level: "warn",
        event: "receipt_language.not_offered",
        fields: { workingOrderId: billId, language: "es-ES", filedIn: "ca-ES" },
      },
    ]);
  });

  it("files a card the reader has charged in the location's language when the saved one is no longer offered", async () => {
    const venue = await barcelonaVenue();
    const { id } = await parkedTarta(venue);
    await choose(venue, id, "es-ES");
    venue.db.run(sql`update content_languages set default_language = 'ca', languages = '["ca"]'`);
    const deps = {
      db: venue.db,
      backend: venue.backend,
      clock: venue.clock,
      provider: new SimulatorPaymentProvider(venue.db),
    };

    const out = await payWorkingOrderIntegrated(deps, venue.cfg, {
      id,
      lines: [],
      simulationOutcome: "captured",
    });

    expect(out.outcome).toBe("captured");
    expect(await filed(venue, id)).toEqual({
      locale: "ca-ES",
      invoiceLocales: ["ca-ES"],
      lines: [{ "ca-ES": "ES Tarta" }],
    });
  });

  it("files a correction of a Spanish sale in Spanish", async () => {
    const venue = await barcelonaVenue();
    const billId = await tabWith(venue, "Tarta");
    await choose(venue, billId, "es-ES");
    expect((await cash(venue, billId, "18.00")).status).toBe(200);
    const [original] = await inTx(venue, (tx) =>
      tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, billId)),
    );

    await inTx(venue, async (tx) => {
      const [series] = await tx
        .select({ id: invoiceSeries.id })
        .from(invoiceSeries)
        .where(
          and(
            eq(invoiceSeries.nodeId, venue.cfg.nodeId),
            eq(invoiceSeries.purpose, "rectificative"),
          ),
        );
      const session = await loginWithPin(tx, {
        deviceId: venue.deviceId,
        personId: venue.adminId,
        pin: "1234",
      });
      await recordCorrection(tx, venue.backend, {
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
        seriesId: brandSeriesId(series!.id),
        correctsSaleId: brandSaleId(original!.id),
        total: "-2.42",
        lines: [
          {
            lineNo: 1,
            name: "Descuento",
            descriptions: { "ca-ES": "Descompte", "es-ES": "Descuento" },
            quantity: "-1",
            unitPrice: "2.00",
            vatRate: "21.00",
            lineTotal: "-2.00",
          },
        ],
        clock: venue.clock,
        authz: { sessionId: session.id },
      });
    });

    expect(
      venue.db.all(
        sql`select locale, invoice_locales as invoiceLocales from sales where corrects_sale_id = ${original!.id}`,
      ),
    ).toEqual([{ locale: "es-ES", invoiceLocales: '["ca-ES","es-ES"]' }]);
  });

  describe("the language the counter sends with the sale", () => {
    const SPANISH_TARTA = { ...SPANISH, lines: [{ "ca-ES": "ES Tarta" }] };
    const CATALAN_TARTA = { ...CATALAN, lines: [{ "ca-ES": "ES Tarta" }] };
    const CASH = { method: "cash", amount: "20.00" };

    /** A counter basket of one Tarta, in a counter zone. */
    async function counterBasket(venue: BillVenue) {
      const { zoneId } = await inTx(venue, (tx) =>
        offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
      );
      return { zoneId, lines: [{ menuItemId: venue.offerFor("Tarta"), quantity: "1" }] };
    }

    async function orderRow(venue: BillVenue, id: string) {
      const [row] = await inTx(venue, (tx) =>
        tx
          .select({
            status: workingOrders.status,
            revision: workingOrders.revision,
            receiptLocale: workingOrders.receiptLocale,
          })
          .from(workingOrders)
          .where(eq(workingOrders.id, id)),
      );
      return row;
    }

    async function orderInvoiceType(venue: BillVenue, id: string) {
      const [row] = await inTx(venue, (tx) =>
        tx
          .select({ invoiceType: workingOrders.invoiceType })
          .from(workingOrders)
          .where(eq(workingOrders.id, id)),
      );
      return row?.invoiceType;
    }

    function saleCount(venue: BillVenue, id: string): number {
      return venue.db.all(sql`select id from sales where working_order_id = ${id}`).length;
    }

    async function placedTarta(venue: BillVenue): Promise<string> {
      const { id } = await parkedTarta(venue);
      const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
      await placeOrder(deps, venue.cfg, id, venue.operatorId);
      return id;
    }

    /**
     * Starts a card payment of placed order `id` sending `language`, and holds it at the reader
     * until `release` is called.
     */
    async function payHeldAtReader(venue: BillVenue, id: string, language: string) {
      const simulator = new SimulatorPaymentProvider(venue.db);
      const collect = simulator.collect.bind(simulator);
      let atReader!: () => void;
      let release!: () => void;
      const reached = new Promise<void>((resolve) => (atReader = resolve));
      const gate = new Promise<void>((resolve) => (release = resolve));
      simulator.collect = async (params) => {
        atReader();
        await gate;
        return collect(params);
      };
      const pay = payWorkingOrderIntegrated(
        { db: venue.db, backend: venue.backend, clock: venue.clock, provider: simulator },
        venue.cfg,
        { id, lines: [], receiptLanguage: language, simulationOutcome: "captured" },
      );
      await reached;
      return { pay, release };
    }

    describe("a placed order whose card is at the reader keeps its choices until the card resolves", () => {
      const refused = (id: string) => ({
        status: 409,
        json: { code: "order.payment_in_flight", params: { workingOrderId: id } },
      });

      it.each([
        [
          "a saved receipt language",
          (id: string, revision: number) =>
            [
              "PUT",
              `/api/working-orders/${id}/receipt-language`,
              { revision, language: "ca-ES" },
            ] as const,
        ],
        [
          "a saved invoice choice",
          (id: string, revision: number) =>
            [
              "PUT",
              `/api/working-orders/${id}/invoice-choice`,
              {
                revision,
                invoiceType: "F1",
                recipient: {
                  taxId: "B12345674",
                  legalName: "Client SL",
                  address: "Calle Mayor 2, 08001 Barcelona, Barcelona, España",
                  countryCode: "ES",
                },
              },
            ] as const,
        ],
        [
          "the language a second card payment sends",
          (id: string) =>
            ["POST", "/api/pay", { id, lines: [], receiptLanguage: "ca-ES" }] as const,
        ],
        [
          "the language a collect sends",
          (id: string) =>
            [
              "POST",
              `/api/working-orders/${id}/collect`,
              { tender: CASH, receiptLanguage: "ca-ES" },
            ] as const,
        ],
      ] as const)(
        "refuses %s, and files the language the payment started with",
        async (_name, request) => {
          const venue = await barcelonaVenue();
          // A domicile, so a full invoice the request let through would be filed as one.
          await inTx(venue, (tx) =>
            tx.update(tenants).set({ taxpayerDomicile: "Carrer 1, 08001 Barcelona" }),
          );
          const id = await placedTarta(venue);
          await choose(venue, id, "es-ES");
          const { pay, release } = await payHeldAtReader(venue, id, "es-ES");
          const before = await orderRow(venue, id);

          let answer;
          try {
            const [method, path, body] = request(id, before!.revision);
            answer = await send(venue.app, venue.cookie, method, path, body);
          } finally {
            release();
          }
          const result = await pay;

          expect(answer).toEqual(refused(id));
          expect(result.outcome === "captured" && result.ticket.locale).toBe("es-ES");
          expect(saleCount(venue, id)).toBe(1);
          expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
          expect(
            venue.db.all(
              sql`select counterparty_tax_id as taxId from sales where working_order_id = ${id}`,
            ),
          ).toEqual([{ taxId: null }]);
          expect(await orderInvoiceType(venue, id)).toBe("F2");
        },
      );

      it("refuses a saved receipt language while a captured card payment waits to be filed", async () => {
        const venue = await barcelonaVenue();
        const id = await placedTarta(venue);
        await inTx(venue, (tx) =>
          insertCapturedPayment(tx, {
            origin: venue.cfg.origin,
            workingOrderId: id,
            provider: "simulator",
            paymentRef: `sim-ref-${randomUUID()}`,
            amount: decimal("18.00"),
            settledAt: new Date(),
            externalRef: `sim-lost-${randomUUID()}`,
          }),
        );
        const before = await orderRow(venue, id);

        const answer = await send(
          venue.app,
          venue.cookie,
          "PUT",
          `/api/working-orders/${id}/receipt-language`,
          { revision: before!.revision, language: "es-ES" },
        );

        expect(answer).toEqual(refused(id));
        expect(await orderRow(venue, id)).toEqual(before);
      });

      it("takes the language again once the card has resolved", async () => {
        const venue = await barcelonaVenue();
        const id = await placedTarta(venue);
        const declined = await payWorkingOrderIntegrated(
          {
            db: venue.db,
            backend: venue.backend,
            clock: venue.clock,
            provider: new SimulatorPaymentProvider(venue.db),
          },
          venue.cfg,
          { id, lines: [], receiptLanguage: "es-ES", simulationOutcome: "declined" },
        );
        expect(declined.outcome).toBe("declined");

        const { revision } = (await orderRow(venue, id))!;
        const saved = await send(
          venue.app,
          venue.cookie,
          "PUT",
          `/api/working-orders/${id}/receipt-language`,
          { revision, language: "ca-ES" },
        );

        expect(saved).toEqual({ status: 200, json: { revision: revision + 1 } });
      });
    });

    it("stores and files the language a counter cash sale sends", async () => {
      const venue = await barcelonaVenue();
      const id = randomUUID();

      const paid = await send(venue.app, venue.cookie, "POST", "/api/sales", {
        workingOrderId: id,
        ...(await counterBasket(venue)),
        tender: CASH,
        receiptLanguage: "es-ES",
      });

      expect(paid.status).toBe(200);
      expect(paid.json.locale).toBe("es-ES");
      expect((await orderRow(venue, id))?.receiptLocale).toBe("es-ES");
      expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
    });

    it("stores and files the language a counter card payment sends", async () => {
      const venue = await barcelonaVenue();
      const id = randomUUID();

      const paid = await send(venue.app, venue.cookie, "POST", "/api/pay", {
        id,
        ...(await counterBasket(venue)),
        receiptLanguage: "es-ES",
      });

      expect(paid.status).toBe(200);
      expect(paid.json.outcome).toBe("captured");
      expect((await orderRow(venue, id))?.receiptLocale).toBe("es-ES");
      expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
    });

    it.each([
      ["/api/sales", (id: string) => ({ workingOrderId: id, lines: [], tender: CASH })],
      ["/api/pay", (id: string) => ({ id, lines: [] })],
    ] as const)(
      "stores the language sent with %s for a parked order, one revision on, and files it",
      async (path, body) => {
        const venue = await barcelonaVenue();
        const { id } = await parkedTarta(venue);
        const before = await orderRow(venue, id);

        const paid = await send(venue.app, venue.cookie, "POST", path, {
          ...body(id),
          receiptLanguage: "es-ES",
        });

        expect(paid.status).toBe(200);
        expect(await orderRow(venue, id)).toEqual({
          status: "settled",
          revision: before!.revision + 1,
          receiptLocale: "es-ES",
        });
        expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
      },
    );

    it.each([
      ["/api/sales", (id: string) => ({ workingOrderId: id, lines: [], tender: CASH })],
      ["/api/pay", (id: string) => ({ id, lines: [] })],
    ] as const)(
      "writes nothing to a parked order when %s sends no language, or the one already saved",
      async (path, body) => {
        const venue = await barcelonaVenue();
        const bare = (await parkedTarta(venue)).id;
        const saved = (await parkedTarta(venue)).id;
        await choose(venue, saved, "es-ES");
        const bareBefore = await orderRow(venue, bare);
        const savedBefore = await orderRow(venue, saved);

        expect((await send(venue.app, venue.cookie, "POST", path, body(bare))).status).toBe(200);
        const again = await send(venue.app, venue.cookie, "POST", path, {
          ...body(saved),
          receiptLanguage: "es-ES",
        });

        expect(again.status).toBe(200);
        expect(await orderRow(venue, bare)).toEqual({
          status: "settled",
          revision: bareBefore!.revision,
          receiptLocale: null,
        });
        expect(await orderRow(venue, saved)).toEqual({
          status: "settled",
          revision: savedBefore!.revision,
          receiptLocale: "es-ES",
        });
        expect(await filed(venue, bare)).toEqual(CATALAN_TARTA);
        expect(await filed(venue, saved)).toEqual(SPANISH_TARTA);
      },
    );

    it("stores and files the language sent with the collect of a placed order", async () => {
      const venue = await barcelonaVenue();
      const id = await placedTarta(venue);

      const collected = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/collect`,
        { tender: CASH, receiptLanguage: "es-ES" },
      );

      expect(collected.status).toBe(200);
      expect(collected.json.locale).toBe("es-ES");
      expect(collected.json.namesLocale).toBe("ca-ES");
      expect((await orderRow(venue, id))?.receiptLocale).toBe("es-ES");
      expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
    });

    it.each([
      ["collect", (id: string) => [`/api/working-orders/${id}/collect`, { tender: CASH }] as const],
      ["card pay", (id: string) => ["/api/pay", { id, lines: [] }] as const],
    ] as const)(
      "ignores the language sent with the %s of a placed order whose invoice is already issued",
      async (_name, request) => {
        const venue = await barcelonaVenue();
        const id = await placedTarta(venue);
        const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
        await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
        const before = await orderRow(venue, id);
        const [path, body] = request(id);

        const paid = await send(venue.app, venue.cookie, "POST", path, {
          ...body,
          receiptLanguage: "es-ES",
        });

        expect(paid.status).toBe(200);
        expect(await orderRow(venue, id)).toEqual({
          status: "settled",
          revision: before!.revision,
          receiptLocale: null,
        });
        expect(await filed(venue, id)).toEqual(CATALAN_TARTA);
      },
    );

    it("files the language sent with a counter card payment a manager recovers after it stuck", async () => {
      const venue = await barcelonaVenue();
      const id = randomUUID();
      venue.card.crashNextCollect("attempting");

      const stuck = await send(venue.app, venue.cookie, "POST", "/api/pay", {
        id,
        ...(await counterBasket(venue)),
        receiptLanguage: "es-ES",
      });
      expect(stuck.status).toBe(500);
      expect(saleCount(venue, id)).toBe(0);
      expect((await orderRow(venue, id))?.receiptLocale).toBe("es-ES");

      const ring = loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      });
      const managerSid = await inTx(venue, async (tx) => {
        await putCredential(tx, ring, {
          purpose: "payments.stripe",
          value: {
            secretKey: "sk_test_ok",
            webhookSecret: "whsec_x",
            successUrl: "https://x/s",
            cancelUrl: "https://x/c",
          },
        });
        return (await startManagementSession(tx, { personId: venue.adminId })).token;
      });
      const seat = createStripeCardProvider((() => {
        throw new Error("the seat's own Stripe SDK is never built");
      }) as unknown as MakeStripe);
      const management = new Hono();
      mountPaymentsApi(
        management,
        {
          db: venue.db,
          backend: venue.backend,
          clock: venue.clock,
          cfg: venue.cfg,
          ring,
          environment: "preproduction",
          pool: venue.pool,
          providers: [{ ...seat, providerId: venue.card.provider }],
        },
        () => {},
      );
      venue.card.scriptAbandonedAttempt({ outcome: "captured" });
      const [payment] = venue.db.all<{ id: string }>(
        sql`select id from payments where working_order_id = ${id}`,
      );

      const resolved = await send(
        management,
        `${MANAGEMENT_COOKIE}=${managerSid}`,
        "POST",
        `/management-api/payments/stuck/${payment!.id}/resolve`,
      );

      expect(resolved.status).toBe(200);
      expect(resolved.json.outcome).toBe("filed");
      expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
    });

    describe.each([7, {}, ["es-ES"], null])("refuses receiptLanguage %j", (language) => {
      const REFUSED = {
        code: "management.request_invalid",
        params: { field: "receiptLanguage" },
      };

      it("on a counter cash sale, creating and filing nothing", async () => {
        const venue = await barcelonaVenue();
        const id = randomUUID();

        const refused = await send(venue.app, venue.cookie, "POST", "/api/sales", {
          workingOrderId: id,
          ...(await counterBasket(venue)),
          tender: CASH,
          receiptLanguage: language,
        });

        expect(refused.status).toBe(400);
        expect(refused.json).toEqual(REFUSED);
        expect(await orderRow(venue, id)).toBeUndefined();
        expect(saleCount(venue, id)).toBe(0);
      });

      it("on a card payment, before any reader is chosen or asked", async () => {
        const venue = await barcelonaVenue();
        const id = randomUUID();

        const refused = await send(venue.app, venue.cookie, "POST", "/api/pay", {
          id,
          ...(await counterBasket(venue)),
          // A reader that does not exist: choosing it first would answer `reader.not_found`.
          readerId: randomUUID(),
          receiptLanguage: language,
        });

        expect(refused.status).toBe(400);
        expect(refused.json).toEqual(REFUSED);
        expect(venue.card.collectCalls).toEqual([]);
        expect(await orderRow(venue, id)).toBeUndefined();
        expect(saleCount(venue, id)).toBe(0);
      });

      it("on the collect of a placed order, leaving it as it was", async () => {
        const venue = await barcelonaVenue();
        const id = await placedTarta(venue);
        const before = await orderRow(venue, id);

        const refused = await send(
          venue.app,
          venue.cookie,
          "POST",
          `/api/working-orders/${id}/collect`,
          { tender: CASH, receiptLanguage: language },
        );

        expect(refused.status).toBe(400);
        expect(refused.json).toEqual(REFUSED);
        expect(await orderRow(venue, id)).toEqual(before);
        expect(saleCount(venue, id)).toBe(0);
      });
    });

    it("stores a language the location does not offer as sent, and files the sale in Catalan", async () => {
      const venue = await barcelonaVenue();
      const id = randomUUID();

      const paid = await send(venue.app, venue.cookie, "POST", "/api/sales", {
        workingOrderId: id,
        ...(await counterBasket(venue)),
        tender: CASH,
        receiptLanguage: "fr-FR",
      });

      expect(paid.status).toBe(200);
      expect(paid.json.locale).toBe("ca-ES");
      expect((await orderRow(venue, id))?.receiptLocale).toBe("fr-FR");
      expect(await filed(venue, id)).toEqual(CATALAN_TARTA);
    });

    it.each([
      ["/api/sales", (id: string) => ({ workingOrderId: id, tender: CASH })],
      ["/api/pay", (id: string) => ({ id })],
    ] as const)(
      "answers a %s retry of a settled sale sending another language with the stored ticket",
      async (path, body) => {
        const venue = await barcelonaVenue();
        const id = randomUUID();
        const basket = await counterBasket(venue);
        const first = await send(venue.app, venue.cookie, "POST", path, {
          ...body(id),
          ...basket,
          receiptLanguage: "es-ES",
        });
        expect(first.status).toBe(200);
        const settled = await orderRow(venue, id);

        const retry = await send(venue.app, venue.cookie, "POST", path, {
          ...body(id),
          ...basket,
          receiptLanguage: "ca-ES",
        });

        expect(retry.status).toBe(200);
        expect(retry.json).toEqual(first.json);
        expect(await orderRow(venue, id)).toEqual(settled);
        expect(settled?.receiptLocale).toBe("es-ES");
        expect(saleCount(venue, id)).toBe(1);
        expect(await filed(venue, id)).toEqual(SPANISH_TARTA);
      },
    );
  });
});
