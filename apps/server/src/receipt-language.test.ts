import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  deviceProfiles,
  devices,
  locations,
  printJobs,
  printers,
  sales,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createCatalogue, createCategory, createProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin, persons } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { insertCapturedPayment, SimulatorPaymentProvider } from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import { decimal } from "@waitron/shared";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { deploymentEnvironment } from "./config.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import { loadTillConfig } from "./till-config.js";
import type { DeviceRequestConfig } from "./till-config.js";
import { payWorkingOrderIntegrated, printSaleReceipt } from "./till-sale.js";
import { createOpenOrder, parkOrder, placeOrder } from "./working-order.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { printedCommands, printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { seedSessionDevice, deviceRequestCfg } from "./testing/session-device.js";
import { SESSION_COOKIE } from "./till-session.js";
import "./errors.js";

// A receipt, and a copy that names no language, is printed in its location's saved language (the
// first entry of `locations.invoice_locales`), read when the sale is filed — never in
// `WAITRON_TILL_LOCALE`.
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
      WAITRON_TILL_SERIES_ID: venue.seriesIds[0]!,
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
        capabilities: ["open-cash-drawer", "take-cash"],
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
  // Every device prints its receipts on the one printer.
  await withTransaction(db, (tx) => tx.update(devices).set({ receiptPrinterId: printerId }));
  return {
    app,
    cfg,
    session: `${SESSION_COOKIE}=${session.token}`,
    till: `${tillSession}; ${deviceCookie}`,
    menuItemId,
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

/** True when a printed line is the label alone or the label followed by its value. */
const startsWith = (lines: string[], label: string) =>
  lines.some((line) => line === label || line.startsWith(`${label} `));

describe("a receipt follows its location's saved language", () => {
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
    for (const label of ["Factura", "Data", "IVA", "Efectiu", "Canvi"]) {
      expect(startsWith(receipt!, label), label).toBe(true);
    }
    expect(receipt!.find((line) => line.startsWith("Data "))).toContain("d’oct.");
    expect(startsWith(receipt!, "Fecha")).toBe(false);
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
    expect(receipt!.find((line) => line.startsWith("Data "))).not.toContain("d’oct.");
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
      { "es-ES": "CLIENT-ES Pan con tomate", "ca-ES": "CLIENT-CA Pa amb tomàquet" },
    ]);
    const [receipt] = await takePrinted(suite.db);
    expect(startsWith(receipt!, "Fecha")).toBe(true);
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

describe("a bill paid in parts and an unpaid invoice file the location's language", () => {
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
      offerProducts(tx, venue.cfg, { zone: "counter", serviceMode: "ticket_then_pay" }),
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
    expect(startsWith(receipt, "Data"), "Data").toBe(true);
    expect(startsWith(receipt, "Fecha")).toBe(false);
  });
});

describe("a card-reader sale files and prints in the location's language", () => {
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
  /** A Barcelona venue saved as Catalan whose receipt printer has a cash drawer, and one cash sale. */
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
    for (const label of ["Factura", "Fecha", "IVA", "Efectivo", "Cambio"]) {
      expect(startsWith(spanish, label), label).toBe(true);
    }
    expect(spanish).toContain("DUPLICADO");
    for (const label of ["Data", "Efectiu", "Canvi", "Comanda", "DUPLICAT"]) {
      expect(startsWith(spanish, label), label).toBe(false);
    }
    // The dish name is the one the sale was filed with, not the Spanish one the product also has.
    expect(spanish.some((line) => line.includes("CLIENT-CA Pa amb tomàquet"))).toBe(true);
    expect(spanish.some((line) => line.includes("CLIENT-ES"))).toBe(false);

    // Line by line, only the copy marking and the fixed words differ.
    const withoutMark = spanish.filter((line) => line !== "DUPLICADO");
    expect(withoutMark).toHaveLength(catalan.length);
    const differing = catalan.flatMap((line, i) =>
      line === withoutMark[i] ? [] : [[line.split(/\s+/)[0], withoutMark[i]!.split(/\s+/)[0]]],
    );
    expect(differing).toEqual([
      ["Comanda", "Pedido"],
      ["Data", "Fecha"],
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
      expect(startsWith(receipt, "Data"), "Data").toBe(true);
      expect(receipt).toContain("DUPLICAT");
    }
  });

  it.each([["en-GB"], [5], [null], [["es-ES"]]])(
    "refuses a language %j outside the pack's receipt languages, printing nothing",
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

  it("offers the till the pack's receipt languages", async () => {
    const v = await venueWith(suite.db, ["ca-ES"], BARCELONA);
    const res = await v.app.request("/api/till", { headers: { cookie: v.till } });
    expect(((await res.json()) as { receiptLanguages?: string[] }).receiptLanguages).toEqual([
      "es-ES",
      "ca-ES",
      "gl-ES",
      "eu-ES",
    ]);
  });
});
