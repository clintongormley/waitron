import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  deviceProfiles,
  devices,
  invoiceDeliveries,
  invoiceSeries,
  pagePrinters,
  printAgents,
  printJobs,
  printers,
  tenants,
  withTransaction,
} from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { createPrinter, enqueuePrintJob } from "@waitron/printing";
import { recordSale } from "@waitron/core";
import { CAPABILITY_FLAGS } from "@waitron/layouts";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  jobOrigin,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import { mountTillApi } from "./till-api.js";
import type { TillConfig } from "./till-config.js";
import { createOpenOrder } from "./working-order.js";
import { enrolDeviceForTest } from "./testing/enrol.js";
import { offerProducts } from "./testing/zone-offers.js";
import { readInvoiceDeliveries } from "./invoice-delivery-status.js";
import {
  claimInvoicePagePrint,
  renewInvoicePagePrint,
  reportInvoicePagePrint,
  type PagePrintJob,
} from "./invoice-page-print.js";
import { DEVICE_COOKIE } from "./device-session.js";
import { departmentReceipts, departments } from "@waitron/venue-service";
import { claimInvoiceDelivery } from "./invoice-delivery.js";
import { runInvoiceEmailPass } from "./invoice-email-worker.js";
import type { ReceiptDocumentInput } from "./receipt-document.js";

// The till's invoice delivery routes over HTTP, against synthetic full invoices written through the
// core (public F1 issuance stays disabled).
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
const clock: TrustedClock = {
  now: () => ({
    instant: new Date(),
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

beforeAll(() => {
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () => Promise.reject(new Error("recordSale never submits")),
  });
});

interface Venue {
  /** Whether the till's mail transport check answers available; true unless a case says. */
  email: { transport: boolean | Error };
  logged: unknown[][];
  cfg: TillConfig;
  scriptCfg: TillConfig & { origin: ReturnType<typeof jobOrigin> };
  app: Hono;
  cookie: string;
  menuItemId: string;
  zoneId: string;
  staffId: string;
  agentId: string;
  receiptPrinterId: string;
  officeId: string;
}

let nifCounter = 0;
const NO_DRAWER = CAPABILITY_FLAGS.filter((flag) => flag !== "open-cash-drawer");

async function venue(): Promise<Venue> {
  nifCounter += 1;
  const result = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nifWithControlLetter(65_000_000 + nifCounter),
        legalName: "Deli Facturas SL",
        location: {
          name: "Sala principal",
          fiscalTerritory: "ES-common",
          invoiceLocales: [LOCALE],
          operationDescription: "Venta en establecimiento",
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
    { db: suite.db, modules: ALL_MODULES },
  );
  const cfg: TillConfig = {
    nodeId: brandNodeId(result.nodeId),
    locationId: brandLocationId(result.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
  const scriptCfg = { ...cfg, origin: jobOrigin("operator_script") };
  const fixtures = await withTransaction(suite.db, async (tx) => {
    await tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
    const catalogue = await createCatalogue(tx, { name: "Delicatessen" });
    const category = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: catalogue.id,
      categoryId: category.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, cfg.locationId, catalogue.id);
    const available = (await listAvailableProducts(tx, cfg.locationId)).products;
    const offers = await offerProducts(tx, scriptCfg, { orderStart: "counter" });
    const [staff] = await tx
      .insert(persons)
      .values({ displayName: "Cajera", pinHash: hashPin("5555"), role: "staff" })
      .returning({ id: persons.id });
    const [agent] = await tx
      .insert(printAgents)
      .values({ locationId: cfg.locationId, name: "Back office agent", tokenHash: "scrypt$x" })
      .returning({ id: printAgents.id });
    const receiptPrinter = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      { name: "Recibos", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    const [office] = await tx
      .insert(pagePrinters)
      .values({
        locationId: cfg.locationId,
        name: "Back office",
        host: "192.0.2.20",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 600,
        agentId: agent!.id,
        invoiceDefault: true,
      })
      .returning({ id: pagePrinters.id });
    const receipt = { email: "facturas@example.test" };
    for (const { id } of await tx
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.locationId, cfg.locationId))) {
      await tx
        .insert(departmentReceipts)
        .values({ departmentId: id, receipt })
        .onConflictDoUpdate({ target: departmentReceipts.departmentId, set: { receipt } });
    }
    return {
      menuItemId: offers.offerFor(available.find((p) => p.pricingUnit === "each")!.id),
      zoneId: offers.zoneId,
      staffId: staff!.id,
      agentId: agent!.id,
      receiptPrinterId: receiptPrinter.id,
      officeId: office!.id,
    };
  });
  const app = new Hono();
  const email: Venue["email"] = { transport: true };
  const logged: unknown[][] = [];
  mountTillApi(
    app,
    {
      db: suite.db,
      backend,
      clock,
      cfg,
      secureCookies: false,
      venueLocale: LOCALE,
      invoiceEmailAvailable: () =>
        email.transport instanceof Error
          ? Promise.reject(email.transport)
          : Promise.resolve(email.transport),
    },
    (...args: unknown[]) => {
      logged.push(args);
    },
  );
  const v = { ...fixtures, email, logged, cfg, scriptCfg, app };
  return { ...v, cookie: await till(v) };
}

let tillCounter = 0;
/** A signed-in staff session on a new till whose profile lists `capabilities`, printing receipts
 * on `receiptPrinterId` (null: no receipt printer). */
async function till(
  v: Pick<Venue, "cfg" | "app" | "staffId" | "receiptPrinterId">,
  capabilities: readonly string[] = NO_DRAWER,
  receiptPrinterId: string | null = v.receiptPrinterId,
): Promise<string> {
  tillCounter += 1;
  const [profile] = await suite.db
    .insert(deviceProfiles)
    .values({ name: `Till profile ${tillCounter}`, formFactor: "till", capabilities })
    .returning({ id: deviceProfiles.id });
  const device = await enrolDeviceForTest(suite.db, v.cfg, {
    name: `Till ${tillCounter}`,
    profileId: profile!.id,
  });
  await suite.db
    .update(devices)
    .set({ receiptPrinterId, paymentSlipPrinterId: receiptPrinterId })
    .where(eq(devices.id, device.deviceId));
  const login = await v.app.request("/api/session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `${DEVICE_COOKIE}=${device.deviceId}.${device.token}`,
    },
    body: JSON.stringify({ personId: v.staffId, pin: "5555" }),
  });
  expect(login.status).toBe(200);
  return login.headers.get("set-cookie")!.split(";")[0]!;
}

/** A synthetic invoice for a new working order; full unless `full` is false. */
async function invoice(v: Venue, full = true): Promise<{ orderId: string; saleId: string }> {
  const orderId = randomUUID();
  return withTransaction(suite.db, async (tx) => {
    const [series] = await tx
      .select()
      .from(invoiceSeries)
      .where(eq(invoiceSeries.purpose, full ? "full" : "standard"));
    await createOpenOrder(
      tx,
      v.scriptCfg,
      orderId,
      [{ menuItemId: v.menuItemId, quantity: "1" }],
      null,
      { zoneId: v.zoneId },
    );
    const sale = await recordSale(tx, backend, {
      origin: jobOrigin("operator_script"),
      nodeId: v.cfg.nodeId,
      seriesId: brandSeriesId(series!.id),
      workingOrderId: brandWorkingOrderId(orderId),
      locale: LOCALE,
      invoiceLocales: [LOCALE],
      counterparty: full ? { taxId: "12345678Z", legalName: "Cliente", countryCode: "ES" } : null,
      recipientAddress: full ? "Calle Cliente 9, Madrid" : null,
      total: "1.50",
      lines: [
        {
          lineNo: 1,
          name: "Agua mineral",
          descriptions: { "es-ES": "Agua mineral" },
          quantity: "1",
          unitPrice: "1.50",
          vatRate: "21",
          lineTotal: "1.50",
        },
      ],
      clock,
      settlement: { kind: "deferred" },
      operatorId: v.staffId,
    });
    return { orderId, saleId: sale.saleId };
  });
}

async function send(
  v: Venue,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  cookie?: string,
) {
  const response = await v.app.request(path, {
    method,
    headers: {
      cookie: cookie ?? v.cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (response.headers.get("content-type")?.includes("json")
      ? JSON.parse(text)
      : text) as Record<string, unknown> | null,
  };
}

const readStatus = (v: Venue, orderId: string, cookie?: string) =>
  send(v, "GET", `/api/sales/${orderId}/deliveries`, undefined, cookie);
const printOnA4 = (v: Venue, orderId: string, requestKey: string = randomUUID(), cookie?: string) =>
  send(v, "POST", `/api/sales/${orderId}/deliveries`, { medium: "a4", requestKey }, cookie);
const toReceipt = (
  v: Venue,
  orderId: string,
  deliveryId: string,
  requestKey: string = randomUUID(),
  cookie?: string,
) =>
  send(
    v,
    "POST",
    `/api/sales/${orderId}/deliveries/${deliveryId}/to-receipt`,
    { requestKey },
    cookie,
  );

const refusal = (status: number, code: string) => ({
  status,
  body: { error: expect.objectContaining({ code }) },
});

async function deliveryRows(saleId: string) {
  return suite.db
    .select()
    .from(invoiceDeliveries)
    .where(eq(invoiceDeliveries.saleId, saleId))
    .orderBy(invoiceDeliveries.generation);
}

async function jobsOf(saleId: string) {
  return suite.db
    .select()
    .from(printJobs)
    .where(eq(printJobs.saleId, saleId))
    .orderBy(sql`${printJobs}.rowid`);
}

/** The office printer's agent claims the oldest due A4 delivery. */
async function agentClaims(v: Venue, now = new Date()): Promise<PagePrintJob> {
  const { job } = await withTransaction(suite.db, (tx) =>
    claimInvoicePagePrint(tx, v.agentId, { locationId: v.cfg.locationId }, now),
  );
  return job!;
}

/** The agent claims the A4 delivery and is silent past its lease. */
async function lapsedClaim(v: Venue) {
  const job = await agentClaims(v);
  await suite.db
    .update(invoiceDeliveries)
    .set({ claimedAt: new Date(Date.now() - 61_000).toISOString() })
    .where(eq(invoiceDeliveries.id, job.claim.deliveryId));
}

/** A receipt original for the sale on the venue's receipt printer, set to `set`. */
async function receiptOriginal(
  v: Venue,
  saleId: string,
  set: Partial<typeof printJobs.$inferInsert> = {},
): Promise<string> {
  const job = await withTransaction(suite.db, (tx) =>
    enqueuePrintJob(
      tx,
      { locationId: v.cfg.locationId },
      v.receiptPrinterId,
      new Uint8Array([27, 64]),
      "document",
      { saleId, receiptCopy: false },
    ),
  );
  if (Object.keys(set).length > 0) {
    await suite.db.update(printJobs).set(set).where(eq(printJobs.id, job.jobId));
  }
  return job.jobId;
}

const SALE_LOCATION_READ = /from "sales" inner join "nodes"/;
const INVOICE_PRINTER_READ = /from "page_printers"/;
const RECEIPT_ORIGINAL_READ =
  /^select "print_jobs"\."sale_id", .* from "print_jobs" inner join "printers"/;

/** `act`'s answer, and how many statements matching `pattern` the venue database prepared for it. */
async function readsDuring<T>(
  pattern: RegExp,
  act: () => Promise<T>,
): Promise<{ answer: T; reads: number }> {
  const { answer, statements } = await statementsDuring(act);
  return { answer, reads: statements.filter((statement) => pattern.test(statement)).length };
}

/** `act`'s answer, and the SQL of every statement the venue database prepared for it. */
async function statementsDuring<T>(
  act: () => Promise<T>,
): Promise<{ answer: T; statements: string[] }> {
  const session = (
    suite.db as unknown as { session: { prepareQuery: (...args: unknown[]) => unknown } }
  ).session;
  const prepare = session.prepareQuery.bind(session);
  const statements: string[] = [];
  const spy = vi.spyOn(session, "prepareQuery").mockImplementation((...args) => {
    statements.push((args[0] as { sql: string }).sql);
    return prepare(...args);
  });
  try {
    return { answer: await act(), statements };
  } finally {
    spy.mockRestore();
  }
}

describe("GET /api/sales/:id/deliveries", () => {
  it("requires a session and a filed sale", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    const denied = await v.app.request(`/api/sales/${orderId}/deliveries`);
    expect(denied.status).toBe(401);
    for (const id of [randomUUID(), "invalid"]) {
      expect(await readStatus(v, id)).toEqual(refusal(404, "working_order.not_found"));
    }
  });

  it("answers the full invoice's delivery status, and null for a simplified invoice", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const answer = await readStatus(v, orderId);
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual(
      await withTransaction(suite.db, (tx) =>
        readInvoiceDeliveries(tx, saleId, { emailAvailable: true }),
      ),
    );
    expect(answer.body).toMatchObject({
      current: null,
      actions: {
        printOnA4: { printer: { id: v.officeId, name: "Back office" }, designation: "original" },
      },
    });
    const simplified = await invoice(v, false);
    expect(await readStatus(v, simplified.orderId)).toEqual({ status: 200, body: null });
  });

  it("ends a lapsed A4 claim before reading, so the attempt reads uncertain and can be retried", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    const queued = await printOnA4(v, orderId);
    await lapsedClaim(v);
    const answer = await readStatus(v, orderId);
    expect(answer.body).toMatchObject({
      current: { id: queued.body!.id, status: "unknown", failureCode: "timeout" },
      actions: { retryOriginal: { medium: "a4" } },
    });
  });
});

describe("POST /api/sales/:id/deliveries (print on A4)", () => {
  it("requires a session and the device's print-receipt action, writing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const denied = await v.app.request(`/api/sales/${orderId}/deliveries`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ medium: "a4", requestKey: randomUUID() }),
    });
    expect(denied.status).toBe(401);
    const restricted = await till(
      v,
      NO_DRAWER.filter((flag) => flag !== "print-receipt"),
    );
    expect(await printOnA4(v, orderId, randomUUID(), restricted)).toEqual({
      status: 403,
      body: { error: { code: "device.forbidden_action", params: { action: "invoice_delivery" } } },
    });
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it.each([
    ["a missing medium", { requestKey: randomUUID() }, "medium"],
    ["an unknown medium", { medium: "fax", requestKey: randomUUID() }, "medium"],
    ["a missing request key", { medium: "a4" }, "requestKey"],
    ["a request key that is not an id", { medium: "a4", requestKey: "again" }, "requestKey"],
  ])("refuses %s as an invalid request, writing nothing", async (_what, body, field) => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    expect(await send(v, "POST", `/api/sales/${orderId}/deliveries`, body)).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field } } },
    });
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it("queues an original on the location's invoice printer for the signed-in staff member", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const answer = await printOnA4(v, orderId);
    expect(answer.status).toBe(200);
    const [row, ...more] = await deliveryRows(saleId);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      medium: "a4",
      designation: "original",
      status: "queued",
      pagePrinterId: v.officeId,
      personId: v.staffId,
      generation: 1,
    });
    expect(answer.body).toEqual({
      id: row!.id,
      medium: "a4",
      designation: "original",
      status: "queued",
      failureCode: null,
      requestedAt: row!.createdAt,
      at: row!.nextAttemptAt,
      personId: v.staffId,
      printerHold: null,
      lateSuccess: false,
    });
  });

  it("answers a replayed request key with the same row, writing no second one", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const key = randomUUID();
    const first = await printOnA4(v, orderId, key);
    const again = await printOnA4(v, orderId, key);
    expect(again).toEqual(first);
    expect(await deliveryRows(saleId)).toHaveLength(1);
  });

  it("refuses an A4 request whose key already switched to paper, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    const key = randomUUID();
    expect((await toReceipt(v, orderId, a4, key)).status).toBe(200);
    const rows = await deliveryRows(saleId);
    const jobs = await jobsOf(saleId);
    expect(await printOnA4(v, orderId, key)).toEqual({
      status: 409,
      body: { error: { code: "submission.id_reused", params: { submissionId: key } } },
    });
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(await jobsOf(saleId)).toEqual(jobs);
  });

  it("refuses a second attempt while one is active", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await printOnA4(v, orderId);
    const before = await deliveryRows(saleId);
    expect(await printOnA4(v, orderId)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(before);
  });

  it("refuses while a receipt original is still printing, which no delivery row tracks", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await receiptOriginal(v, saleId);
    expect(await printOnA4(v, orderId)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it("refuses a simplified invoice", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v, false);
    expect(await printOnA4(v, orderId)).toEqual(
      refusal(409, "invoice_delivery.full_invoice_required"),
    );
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it("refuses when the location has no invoice printer", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await suite.db.update(pagePrinters).set({ invoiceDefault: false });
    expect(await printOnA4(v, orderId)).toEqual(refusal(409, "invoice_delivery.printer_invalid"));
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it("gives one attempt to two tills racing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const other = await till(v);
    const answers = await Promise.all([
      printOnA4(v, orderId),
      printOnA4(v, orderId, randomUUID(), other),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)).toEqual(
      refusal(409, "invoice_delivery.active"),
    );
    expect(await deliveryRows(saleId)).toHaveLength(1);
  });

  it("prints a duplicate on A4 once a paper original has printed", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await receiptOriginal(v, saleId, { status: "done", attempts: 1 });
    const answer = await printOnA4(v, orderId);
    expect(answer.body).toMatchObject({ medium: "a4", designation: "duplicate", status: "queued" });
  });

  it("makes a paper copy a duplicate once the A4 original has printed", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await printOnA4(v, orderId);
    const job = await agentClaims(v);
    await withTransaction(suite.db, (tx) =>
      reportInvoicePagePrint(tx, job.claim, { status: "sent" }),
    );
    const reprint = await send(v, "POST", `/api/sales/${orderId}/reprint`, {});
    expect(reprint.status).toBe(200);
    const rows = await deliveryRows(saleId);
    expect(rows.map((row) => [row.medium, row.designation, row.status])).toEqual([
      ["a4", "original", "sent"],
      ["receipt", "duplicate", "queued"],
    ]);
  });

  it("prints an original again after an A4 attempt failed", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await printOnA4(v, orderId);
    const job = await agentClaims(v);
    await withTransaction(suite.db, (tx) =>
      reportInvoicePagePrint(tx, job.claim, {
        status: "failed",
        failureCode: "printer_unreachable",
      }),
    );
    const answer = await printOnA4(v, orderId);
    expect(answer.body).toMatchObject({ designation: "original", status: "queued" });
    expect((await deliveryRows(saleId)).map((row) => row.status)).toEqual(["failed", "queued"]);
  });

  it("ends a lapsed A4 claim first, then prints an original again after the uncertain attempt", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await printOnA4(v, orderId);
    await lapsedClaim(v);
    const answer = await printOnA4(v, orderId);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ designation: "original", status: "queued" });
    expect(
      (await deliveryRows(saleId)).map((row) => [row.status, row.failureCode, row.generation]),
    ).toEqual([
      ["unknown", "timeout", 1],
      ["queued", null, 2],
    ]);
  });
});

describe("POST /api/sales/:id/deliveries/:deliveryId/to-receipt (paper instead)", () => {
  async function queuedA4(v: Venue) {
    const sale = await invoice(v);
    const answer = await printOnA4(v, sale.orderId);
    return { ...sale, a4: answer.body!.id as string };
  }

  it("requires a session and the device's print-receipt action, writing nothing", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    const before = await deliveryRows(saleId);
    const denied = await v.app.request(`/api/sales/${orderId}/deliveries/${a4}/to-receipt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestKey: randomUUID() }),
    });
    expect(denied.status).toBe(401);
    const restricted = await till(
      v,
      NO_DRAWER.filter((flag) => flag !== "print-receipt"),
    );
    expect(await toReceipt(v, orderId, a4, randomUUID(), restricted)).toEqual({
      status: 403,
      body: {
        error: {
          code: "device.forbidden_action",
          params: { action: "invoice_delivery_to_receipt" },
        },
      },
    });
    expect(await deliveryRows(saleId)).toEqual(before);
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("refuses a request key that is not an id", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    expect(await toReceipt(v, orderId, a4, "again")).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "requestKey" } } },
    });
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("ends the waiting A4 original as switched and queues a receipt original on the till's printer", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    const key = randomUUID();
    const answer = await toReceipt(v, orderId, a4, key);
    expect(answer.status).toBe(200);
    const [job, ...moreJobs] = await jobsOf(saleId);
    expect(moreJobs).toEqual([]);
    expect(job).toMatchObject({
      printerId: v.receiptPrinterId,
      kind: "document",
      receiptCopy: false,
      status: "queued",
    });
    const rows = await deliveryRows(saleId);
    expect(rows).toEqual([
      expect.objectContaining({
        id: a4,
        medium: "a4",
        status: "failed",
        failureCode: "switched",
        claimedAt: null,
      }),
      expect.objectContaining({
        medium: "receipt",
        designation: "original",
        status: "queued",
        printJobId: job!.id,
        requestKey: key,
        personId: v.staffId,
        generation: 2,
      }),
    ]);
    expect(answer.body).toMatchObject({
      id: rows[1]!.id,
      medium: "receipt",
      designation: "original",
      status: "queued",
    });
  });

  it("resends the sale's existing receipt original rather than adding nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const original = await receiptOriginal(v, saleId, { status: "failed", attempts: 5 });
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    const answer = await toReceipt(v, orderId, a4);
    expect(answer.status).toBe(200);
    const jobs = await jobsOf(saleId);
    expect(jobs).toEqual([
      expect.objectContaining({ id: original, status: "failed" }),
      expect.objectContaining({ resendOf: original, status: "queued", receiptCopy: false }),
    ]);
    const rows = await deliveryRows(saleId);
    expect(rows.map((row) => [row.medium, row.designation, row.status, row.failureCode])).toEqual([
      ["a4", "original", "failed", "switched"],
      ["receipt", "original", "queued", null],
    ]);
    expect(rows[1]).toMatchObject({ printJobId: jobs[1]!.id, generation: 2 });
  });

  it("switches once when two tills race, and the other is refused", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    const other = await till(v);
    let inFlight = 0;
    let mostInFlight = 0;
    const tracked = async (cookie: string) => {
      inFlight += 1;
      mostInFlight = Math.max(mostInFlight, inFlight);
      try {
        return await toReceipt(v, orderId, a4, randomUUID(), cookie);
      } finally {
        inFlight -= 1;
      }
    };
    const answers = await Promise.all([tracked(v.cookie), tracked(other)]);
    expect(mostInFlight).toBe(2);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 200)!.body).toMatchObject({
      medium: "receipt",
      designation: "original",
      status: "queued",
    });
    expect(answers.find((answer) => answer.status === 409)).toEqual(
      refusal(409, "invoice_delivery.active"),
    );
    const rows = await deliveryRows(saleId);
    expect(rows.map((row) => [row.medium, row.status, row.failureCode])).toEqual([
      ["a4", "failed", "switched"],
      ["receipt", "queued", null],
    ]);
    expect((await jobsOf(saleId)).map((job) => job.status)).toEqual(["queued"]);
  });

  it("refuses a switch whose request key already asked for A4, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const key = randomUUID();
    const a4 = (await printOnA4(v, orderId, key)).body!.id as string;
    const rows = await deliveryRows(saleId);
    expect(await toReceipt(v, orderId, a4, key)).toEqual({
      status: 409,
      body: { error: { code: "submission.id_reused", params: { submissionId: key } } },
    });
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(rows[0]).toMatchObject({ id: a4, status: "queued" });
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("answers a replayed switch with the same receipt, queueing nothing more", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    const key = randomUUID();
    const first = await toReceipt(v, orderId, a4, key);
    const jobs = await jobsOf(saleId);
    const again = await toReceipt(v, orderId, a4, key);
    expect(again).toEqual(first);
    expect(await jobsOf(saleId)).toEqual(jobs);
    expect(await deliveryRows(saleId)).toHaveLength(2);
  });

  it("refuses once an agent has claimed the A4, leaving both attempts as they were", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await receiptOriginal(v, saleId, { status: "failed", attempts: 5 });
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    await agentClaims(v);
    const rows = await deliveryRows(saleId);
    const jobs = await jobsOf(saleId);
    expect(await toReceipt(v, orderId, a4)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(await jobsOf(saleId)).toEqual(jobs);
    expect(rows[0]).toMatchObject({ status: "sending" });
  });

  it("refuses Print on A4 and paper instead while the printer holds the A4, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await receiptOriginal(v, saleId, { status: "failed", attempts: 5 });
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    const job = await agentClaims(v);
    expect(
      await withTransaction(suite.db, (tx) => renewInvoicePagePrint(tx, job.claim, "paper_out")),
    ).toBe("renewed");
    expect((await readStatus(v, orderId)).body).toMatchObject({
      current: { id: a4, status: "sending", printerHold: "paper_out" },
      actions: { retryOriginal: null, printOnA4: null, receiptInstead: null },
    });
    const rows = await deliveryRows(saleId);
    const jobs = await jobsOf(saleId);

    expect(await printOnA4(v, orderId)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await toReceipt(v, orderId, a4)).toEqual(refusal(409, "invoice_delivery.active"));

    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(await jobsOf(saleId)).toEqual(jobs);
  });

  it("refuses a waiting A4 row that records a claim, leaving it waiting", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    await suite.db
      .update(invoiceDeliveries)
      .set({ claimedAt: new Date().toISOString() })
      .where(eq(invoiceDeliveries.id, a4));
    const rows = await deliveryRows(saleId);
    expect(await toReceipt(v, orderId, a4)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("refuses when the till has no receipt printer, leaving the A4 waiting", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    const printerless = await till(v, NO_DRAWER, null);
    const rows = await deliveryRows(saleId);
    expect(await toReceipt(v, orderId, a4, randomUUID(), printerless)).toEqual(
      refusal(409, "invoice_delivery.receipt_unavailable"),
    );
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(rows[0]).toMatchObject({ status: "queued" });
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("refuses an attempt this sale does not have", async () => {
    const v = await venue();
    const { orderId } = await queuedA4(v);
    const other = await queuedA4(v);
    for (const id of [randomUUID(), other.a4, "invalid"]) {
      expect(await toReceipt(v, orderId, id)).toEqual(refusal(404, "invoice_delivery.not_found"));
    }
    expect(await jobsOf(other.saleId)).toEqual([]);
  });

  it("refuses a simplified invoice", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v, false);
    expect(await toReceipt(v, orderId, randomUUID())).toEqual(
      refusal(409, "invoice_delivery.full_invoice_required"),
    );
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("refuses a waiting A4 duplicate, which a reprint covers", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await receiptOriginal(v, saleId, { status: "done", attempts: 1 });
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    const jobs = await jobsOf(saleId);
    expect(await toReceipt(v, orderId, a4)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await jobsOf(saleId)).toEqual(jobs);
    expect((await deliveryRows(saleId))[0]).toMatchObject({ status: "queued" });
  });

  it("refuses an A4 attempt that has ended", async () => {
    const v = await venue();
    const { orderId, saleId, a4 } = await queuedA4(v);
    const job = await agentClaims(v);
    await withTransaction(suite.db, (tx) =>
      reportInvoicePagePrint(tx, job.claim, { status: "failed", failureCode: "printer_refused" }),
    );
    expect(await toReceipt(v, orderId, a4)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("refuses when the sale's receipt original cannot be resent, leaving the A4 waiting", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const original = await receiptOriginal(v, saleId, { status: "failed", attempts: 5 });
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    await suite.db
      .update(printers)
      .set({ deletedAt: new Date().toISOString() })
      .where(eq(printers.id, v.receiptPrinterId));
    expect(await toReceipt(v, orderId, a4)).toEqual({
      status: 409,
      body: { error: { code: "print_job.not_resendable", params: { id: original } } },
    });
    expect((await deliveryRows(saleId))[0]).toMatchObject({ id: a4, status: "queued" });
    expect(await jobsOf(saleId)).toHaveLength(1);
  });
});

const CUSTOMER_EMAIL = "cliente.privado@example.test";

const emailIt = (
  v: Venue,
  orderId: string,
  recipient: unknown = CUSTOMER_EMAIL,
  requestKey: string = randomUUID(),
  cookie?: string,
) =>
  send(
    v,
    "POST",
    `/api/sales/${orderId}/deliveries`,
    { medium: "email", recipient, requestKey },
    cookie,
  );

const retry = (
  v: Venue,
  orderId: string,
  deliveryId: string,
  requestKey: string = randomUUID(),
  cookie?: string,
) =>
  send(v, "POST", `/api/sales/${orderId}/deliveries/${deliveryId}/retry`, { requestKey }, cookie);

/** One pass of the email worker, the mail transport answering `outcome` (or throwing). */
async function emailWorkerPass(outcome: "sent" | "failed" | "throws") {
  return runInvoiceEmailPass({
    db: suite.db,
    holder: "server-one",
    now: () => new Date(),
    readDocument: () => Promise.resolve({} as ReceiptDocumentInput),
    send: () =>
      outcome === "throws"
        ? Promise.reject(new Error("connection reset"))
        : Promise.resolve(
            outcome === "sent"
              ? { status: "sent" as const }
              : { status: "failed" as const, failureCode: "transport_failed" as const },
          ),
  });
}

/** An email original to the customer, ended `status` by the email worker. */
async function endedEmail(v: Venue, orderId: string, status: "failed" | "unknown" | "sent") {
  const queued = await emailIt(v, orderId);
  expect(queued.status).toBe(200);
  const id = queued.body!.id as string;
  if (status === "failed") {
    // The worker queues automatic retries until its fifth attempt; this one is the fifth.
    await suite.db
      .update(invoiceDeliveries)
      .set({ attempts: 4 })
      .where(eq(invoiceDeliveries.id, id));
  }
  await emailWorkerPass(status === "unknown" ? "throws" : status);
  const [row] = await suite.db.select().from(invoiceDeliveries).where(eq(invoiceDeliveries.id, id));
  expect(row).toMatchObject({ status });
  return id;
}

describe("POST /api/sales/:id/deliveries (email)", () => {
  it("queues an email original to the address for the signed-in staff member, answering no address", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const answer = await emailIt(v, orderId, `  ${CUSTOMER_EMAIL} `);
    expect(answer.status).toBe(200);
    const [row, ...more] = await deliveryRows(saleId);
    expect(more).toEqual([]);
    expect(row).toMatchObject({
      medium: "email",
      designation: "original",
      status: "queued",
      recipient: CUSTOMER_EMAIL,
      personId: v.staffId,
      generation: 1,
    });
    expect(answer.body).toEqual({
      id: row!.id,
      medium: "email",
      designation: "original",
      status: "queued",
      failureCode: null,
      requestedAt: row!.createdAt,
      at: row!.nextAttemptAt,
      personId: v.staffId,
      printerHold: null,
      lateSuccess: false,
    });
  });

  it.each([
    ["no address", {}],
    ["an empty address", { recipient: "" }],
    ["a malformed address", { recipient: "cliente@" }],
    ["a number", { recipient: 7 }],
  ])("refuses %s as an invalid request, writing nothing", async (_what, recipient) => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const body = { medium: "email", requestKey: randomUUID(), ...recipient };
    expect(await send(v, "POST", `/api/sales/${orderId}/deliveries`, body)).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "recipient" } } },
    });
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it("refuses when no mail server is set up, or the sale's department has no contact, writing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    v.email.transport = false;
    expect(await emailIt(v, orderId)).toEqual(refusal(409, "invoice_delivery.email_unavailable"));
    v.email.transport = true;
    await suite.db.delete(departmentReceipts);
    expect(await emailIt(v, orderId)).toEqual(refusal(409, "invoice_delivery.email_unavailable"));
    expect(await deliveryRows(saleId)).toEqual([]);
  });

  it("answers a replayed request key with the same attempt, and refuses one reused for another address or medium", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const key = randomUUID();
    const first = await emailIt(v, orderId, CUSTOMER_EMAIL, key);
    expect(first.status).toBe(200);
    // Mail turned off since: the replay still answers the attempt it made.
    v.email.transport = false;
    expect(await emailIt(v, orderId, CUSTOMER_EMAIL, key)).toEqual(first);
    const rows = await deliveryRows(saleId);
    expect(rows).toHaveLength(1);
    const reused = {
      status: 409,
      body: { error: { code: "submission.id_reused", params: { submissionId: key } } },
    };
    expect(await emailIt(v, orderId, "otra@example.test", key)).toEqual(reused);
    expect(await printOnA4(v, orderId, key)).toEqual(reused);
    expect(await deliveryRows(saleId)).toEqual(rows);
  });

  it("gives one attempt to two tills racing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const other = await till(v);
    const answers = await Promise.all([
      emailIt(v, orderId),
      emailIt(v, orderId, "otra@example.test", randomUUID(), other),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)).toEqual(
      refusal(409, "invoice_delivery.active"),
    );
    expect(await deliveryRows(saleId)).toHaveLength(1);
  });

  it("refuses while another attempt is active, and a simplified invoice", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    await printOnA4(v, orderId);
    const before = await deliveryRows(saleId);
    expect(await emailIt(v, orderId)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(before);
    const simplified = await invoice(v, false);
    expect(await emailIt(v, simplified.orderId)).toEqual(
      refusal(409, "invoice_delivery.full_invoice_required"),
    );
    expect(await deliveryRows(simplified.saleId)).toEqual([]);
  });

  it("emails a duplicate once the email original was sent, and once a paper original printed", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    await endedEmail(v, orderId, "sent");
    expect((await emailIt(v, orderId)).body).toMatchObject({
      designation: "duplicate",
      status: "queued",
    });
    const paper = await invoice(v);
    await receiptOriginal(v, paper.saleId, { status: "done", attempts: 1 });
    expect((await emailIt(v, paper.orderId)).body).toMatchObject({ designation: "duplicate" });
  });

  it("offers email in the status only while mail can be sent", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    expect((await readStatus(v, orderId)).body).toMatchObject({
      actions: { email: { designation: "original" } },
    });
    v.email.transport = false;
    expect((await readStatus(v, orderId)).body).toMatchObject({ actions: { email: null } });
    v.email.transport = new Error("credentials unreadable");
    const failing = await readStatus(v, orderId);
    expect(failing.status).toBe(200);
    expect(failing.body).toMatchObject({ actions: { email: null } });
    v.email.transport = true;
    await suite.db.delete(departmentReceipts);
    expect((await readStatus(v, orderId)).body).toMatchObject({ actions: { email: null } });
  });

  it("puts the customer's address in no response and no log line", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const key = randomUUID();
    const answers = [
      await emailIt(v, orderId, CUSTOMER_EMAIL, key),
      await emailIt(v, orderId, CUSTOMER_EMAIL, key),
      await emailIt(v, orderId, "otra@example.test", key),
      await emailIt(v, orderId),
      await readStatus(v, orderId),
    ];
    await emailWorkerPass("throws");
    v.email.transport = new Error("credentials unreadable");
    answers.push(await readStatus(v, orderId));
    // A request does not hide a failed check, as staging an email choice does not.
    answers.push(await retry(v, orderId, answers[0]!.body!.id as string));
    v.email.transport = true;
    const unknownId = answers[0]!.body!.id as string;
    answers.push(await retry(v, orderId, unknownId));
    answers.push(await readStatus(v, orderId));
    expect(answers.map((answer) => answer.status)).toEqual([
      200, 200, 409, 409, 200, 200, 500, 200, 200,
    ]);
    const responses = JSON.stringify(answers);
    const logs = JSON.stringify(v.logged);
    // Controls: each haystack holds what it should, and the address is in the stored rows.
    expect(responses).toContain(unknownId);
    expect(logs).toContain("invoice_delivery.email_check_failed");
    expect(JSON.stringify(await deliveryRows(saleId))).toContain(CUSTOMER_EMAIL);
    expect(responses).not.toContain("cliente.privado");
    expect(responses).not.toContain("otra@");
    expect(logs).not.toContain("cliente.privado");
    expect(logs).not.toContain("otra@");
  });
});

describe("POST /api/sales/:id/deliveries/:deliveryId/retry (email again)", () => {
  it("requires a session and the device's print-receipt action, writing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const failed = await endedEmail(v, orderId, "failed");
    const before = await deliveryRows(saleId);
    const denied = await v.app.request(`/api/sales/${orderId}/deliveries/${failed}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requestKey: randomUUID() }),
    });
    expect(denied.status).toBe(401);
    const restricted = await till(
      v,
      NO_DRAWER.filter((flag) => flag !== "print-receipt"),
    );
    expect(await retry(v, orderId, failed, randomUUID(), restricted)).toEqual({
      status: 403,
      body: {
        error: { code: "device.forbidden_action", params: { action: "invoice_delivery_retry" } },
      },
    });
    expect(await retry(v, orderId, failed, "again")).toEqual({
      status: 400,
      body: { error: { code: "management.request_invalid", params: { field: "requestKey" } } },
    });
    expect(await deliveryRows(saleId)).toEqual(before);
  });

  it.each(["failed", "unknown"] as const)(
    "emails the same address again as the original after one that %s",
    async (status) => {
      const v = await venue();
      const { orderId, saleId } = await invoice(v);
      const ended = await endedEmail(v, orderId, status);
      const other = await till(v);
      const key = randomUUID();
      const answer = await retry(v, orderId, ended, key, other);
      expect(answer.status).toBe(200);
      const rows = await deliveryRows(saleId);
      expect(rows.map((row) => [row.id, row.status])).toEqual([
        [ended, status],
        [answer.body!.id, "queued"],
      ]);
      expect(rows[1]).toMatchObject({
        medium: "email",
        designation: "original",
        recipient: CUSTOMER_EMAIL,
        requestKey: key,
        personId: v.staffId,
        attempts: 0,
        generation: 2,
      });
      expect(answer.body).toMatchObject({
        medium: "email",
        designation: "original",
        status: "queued",
      });
      expect(JSON.stringify(answer.body)).not.toContain(CUSTOMER_EMAIL);
    },
  );

  it("answers a replayed retry with the same attempt, and gives one retry to two tills racing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const failed = await endedEmail(v, orderId, "failed");
    const other = await till(v);
    const key = randomUUID();
    const answers = await Promise.all([
      retry(v, orderId, failed, key),
      retry(v, orderId, failed, randomUUID(), other),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)).toEqual(
      refusal(409, "invoice_delivery.active"),
    );
    const rows = await deliveryRows(saleId);
    expect(rows).toHaveLength(2);
    expect(await retry(v, orderId, failed, rows[1]!.requestKey)).toEqual(
      answers.find((answer) => answer.status === 200),
    );
    expect(await deliveryRows(saleId)).toEqual(rows);
  });

  it("refuses a retry whose request key already emailed the invoice, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const failed = await endedEmail(v, orderId, "failed");
    const key = randomUUID();
    // The same address as the failed email: only the action tells the two requests apart.
    expect((await emailIt(v, orderId, CUSTOMER_EMAIL, key)).status).toBe(200);
    const rows = await deliveryRows(saleId);
    const reused = {
      status: 409,
      body: { error: { code: "submission.id_reused", params: { submissionId: key } } },
    };
    for (const id of [failed, "not-a-delivery"]) {
      expect(await retry(v, orderId, id, key)).toEqual(reused);
    }
    expect(await deliveryRows(saleId)).toEqual(rows);
  });

  it("refuses an email request, or a retry of another attempt, whose key already retried, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const failed = await endedEmail(v, orderId, "failed");
    const key = randomUUID();
    const retried = await retry(v, orderId, failed, key);
    expect(retried.status).toBe(200);
    await suite.db
      .update(invoiceDeliveries)
      .set({ attempts: 4 })
      .where(eq(invoiceDeliveries.saleId, saleId));
    await emailWorkerPass("failed");
    const rows = await deliveryRows(saleId);
    expect(rows.map((row) => row.status)).toEqual(["failed", "failed"]);
    const reused = {
      status: 409,
      body: { error: { code: "submission.id_reused", params: { submissionId: key } } },
    };
    expect(await emailIt(v, orderId, CUSTOMER_EMAIL, key)).toEqual(reused);
    expect(await retry(v, orderId, rows[1]!.id, key)).toEqual(reused);
    expect(await deliveryRows(saleId)).toEqual(rows);
    // The same retry again still answers its attempt.
    expect(await retry(v, orderId, failed, key)).toEqual({
      status: 200,
      body: {
        ...retried.body,
        status: "failed",
        failureCode: "transport_failed",
        at: expect.any(String),
      },
    });
  });

  it("refuses an attempt that is not an ended email the customer may still be waiting for", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const queued = (await emailIt(v, orderId)).body!.id as string;
    expect(await retry(v, orderId, queued)).toEqual(refusal(409, "invoice_delivery.active"));
    await emailWorkerPass("sent");
    // Sent: the original has reached the customer.
    expect(await retry(v, orderId, queued)).toEqual(refusal(409, "invoice_delivery.active"));
    const a4Sale = await invoice(v);
    const a4 = (await printOnA4(v, a4Sale.orderId)).body!.id as string;
    const job = await agentClaims(v);
    await withTransaction(suite.db, (tx) =>
      reportInvoicePagePrint(tx, job.claim, { status: "failed", failureCode: "printer_refused" }),
    );
    expect(await retry(v, a4Sale.orderId, a4)).toEqual(refusal(409, "invoice_delivery.active"));
    for (const id of [randomUUID(), a4, "invalid"]) {
      expect(await retry(v, orderId, id)).toEqual(refusal(404, "invoice_delivery.not_found"));
    }
    expect(await deliveryRows(saleId)).toHaveLength(1);
    expect(await deliveryRows(a4Sale.saleId)).toHaveLength(1);
    const simplified = await invoice(v, false);
    expect(await retry(v, simplified.orderId, randomUUID())).toEqual(
      refusal(409, "invoice_delivery.full_invoice_required"),
    );
  });

  it("refuses an older ended email once a newer attempt has ended", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const first = await endedEmail(v, orderId, "failed");
    expect((await retry(v, orderId, first)).status).toBe(200);
    await suite.db
      .update(invoiceDeliveries)
      .set({ attempts: 4 })
      .where(eq(invoiceDeliveries.saleId, saleId));
    await emailWorkerPass("failed");
    const rows = await deliveryRows(saleId);
    expect(rows.map((row) => row.status)).toEqual(["failed", "failed"]);
    expect(await retry(v, orderId, first)).toEqual(refusal(409, "invoice_delivery.active"));
    expect((await retry(v, orderId, rows[1]!.id)).status).toBe(200);
  });

  it("refuses when mail cannot be sent now, writing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const failed = await endedEmail(v, orderId, "failed");
    const before = await deliveryRows(saleId);
    v.email.transport = false;
    expect(await retry(v, orderId, failed)).toEqual(
      refusal(409, "invoice_delivery.email_unavailable"),
    );
    v.email.transport = true;
    await suite.db.delete(departmentReceipts);
    expect(await retry(v, orderId, failed)).toEqual(
      refusal(409, "invoice_delivery.email_unavailable"),
    );
    expect(await deliveryRows(saleId)).toEqual(before);
  });
});

describe("POST /api/sales/:id/deliveries/:deliveryId/to-receipt (paper instead of email)", () => {
  it("ends a waiting email original as switched and queues a receipt original", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const email = (await emailIt(v, orderId)).body!.id as string;
    const answer = await toReceipt(v, orderId, email);
    expect(answer.status).toBe(200);
    const [job, ...moreJobs] = await jobsOf(saleId);
    expect(moreJobs).toEqual([]);
    expect(job).toMatchObject({
      printerId: v.receiptPrinterId,
      receiptCopy: false,
      status: "queued",
    });
    const rows = await deliveryRows(saleId);
    expect(rows.map((row) => [row.medium, row.designation, row.status, row.failureCode])).toEqual([
      ["email", "original", "failed", "switched"],
      ["receipt", "original", "queued", null],
    ]);
    expect(answer.body).toMatchObject({ id: rows[1]!.id, medium: "receipt" });
    // The worker finds nothing left to send.
    expect(await emailWorkerPass("sent")).toEqual({ processed: false });
  });

  it("refuses paper instead once the worker is sending the email, as for a claimed A4, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const email = (await emailIt(v, orderId)).body!.id as string;
    await withTransaction(suite.db, (tx) => claimInvoiceDelivery(tx, email, "server-one"));
    expect((await readStatus(v, orderId)).body).toMatchObject({
      current: { id: email, status: "sending" },
      actions: { receiptInstead: null },
    });
    const rows = await deliveryRows(saleId);
    expect(await toReceipt(v, orderId, email)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(rows[0]).toMatchObject({ status: "sending", failureCode: null });
    expect(await jobsOf(saleId)).toEqual([]);
  });

  it("switches once when two tills race for a waiting email", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const email = (await emailIt(v, orderId)).body!.id as string;
    const other = await till(v);
    const answers = await Promise.all([
      toReceipt(v, orderId, email),
      toReceipt(v, orderId, email, randomUUID(), other),
    ]);
    expect(answers.map((answer) => answer.status).sort()).toEqual([200, 409]);
    expect(answers.find((answer) => answer.status === 409)).toEqual(
      refusal(409, "invoice_delivery.active"),
    );
    expect((await deliveryRows(saleId)).map((row) => [row.medium, row.status])).toEqual([
      ["email", "failed"],
      ["receipt", "queued"],
    ]);
    expect(await jobsOf(saleId)).toHaveLength(1);
  });

  it("refuses a waiting receipt original, which is already paper", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const email = (await emailIt(v, orderId)).body!.id as string;
    const receipt = (await toReceipt(v, orderId, email)).body!.id as string;
    const rows = await deliveryRows(saleId);
    const jobs = await jobsOf(saleId);
    expect(await toReceipt(v, orderId, receipt)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(await jobsOf(saleId)).toEqual(jobs);
  });

  it("refuses a waiting receipt original whose job can be resent, changing nothing", async () => {
    const v = await venue();
    const { orderId, saleId } = await invoice(v);
    const email = (await emailIt(v, orderId)).body!.id as string;
    const receipt = (await toReceipt(v, orderId, email)).body!.id as string;
    // Forced: the job ended for good while its row still waits, so only the medium keeps it out.
    await suite.db
      .update(printJobs)
      .set({ status: "failed", attempts: 5 })
      .where(eq(printJobs.saleId, saleId));
    const rows = await deliveryRows(saleId);
    const jobs = await jobsOf(saleId);
    expect(rows[1]).toMatchObject({ id: receipt, status: "queued" });
    expect(await toReceipt(v, orderId, receipt)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await deliveryRows(saleId)).toEqual(rows);
    expect(await jobsOf(saleId)).toEqual(jobs);
  });

  it("refuses a waiting email duplicate and an email that has ended", async () => {
    const v = await venue();
    const other = await invoice(v);
    const failed = await endedEmail(v, other.orderId, "failed");
    const { orderId, saleId } = await invoice(v);
    await receiptOriginal(v, saleId, { status: "done", attempts: 1 });
    const duplicate = (await emailIt(v, orderId)).body!.id as string;
    expect(await toReceipt(v, orderId, duplicate)).toEqual(refusal(409, "invoice_delivery.active"));
    expect(await toReceipt(v, other.orderId, failed)).toEqual(
      refusal(409, "invoice_delivery.active"),
    );
    expect(await jobsOf(other.saleId)).toEqual([]);
    expect(await jobsOf(saleId)).toHaveLength(1);
  });
});

describe("what each delivery route reads", () => {
  it("reads the sale's location once for the status", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    const { answer, reads } = await readsDuring(SALE_LOCATION_READ, () => readStatus(v, orderId));
    expect(answer.status).toBe(200);
    expect(reads).toBe(1);
  });

  it("decides an email request from one read of the sale, reading no printer", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    const { answer, statements } = await statementsDuring(() => emailIt(v, orderId));
    expect(answer.status).toBe(200);
    expect(statements.filter((statement) => SALE_LOCATION_READ.test(statement))).toHaveLength(1);
    expect(statements.filter((statement) => INVOICE_PRINTER_READ.test(statement))).toEqual([]);
    expect(statements.filter((statement) => RECEIPT_ORIGINAL_READ.test(statement))).toEqual([]);
  });

  it("reads the invoice printer once to refuse A4, whether one is busy or none is set up", async () => {
    const v = await venue();
    const busy = await invoice(v);
    await printOnA4(v, busy.orderId);
    expect(await readsDuring(INVOICE_PRINTER_READ, () => printOnA4(v, busy.orderId))).toEqual({
      answer: refusal(409, "invoice_delivery.active"),
      reads: 1,
    });
    await suite.db.update(pagePrinters).set({ invoiceDefault: false });
    const none = await invoice(v);
    expect(await readsDuring(INVOICE_PRINTER_READ, () => printOnA4(v, none.orderId))).toEqual({
      answer: refusal(409, "invoice_delivery.printer_invalid"),
      reads: 1,
    });
  });

  it("reads the sale's location once to email again", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    const ended = await endedEmail(v, orderId, "failed");
    const { answer, reads } = await readsDuring(SALE_LOCATION_READ, () => retry(v, orderId, ended));
    expect(answer.status).toBe(200);
    expect(reads).toBe(1);
  });

  it("reads the receipt original once to switch to paper", async () => {
    const v = await venue();
    const { orderId } = await invoice(v);
    const a4 = (await printOnA4(v, orderId)).body!.id as string;
    const { answer, reads } = await readsDuring(RECEIPT_ORIGINAL_READ, () =>
      toReceipt(v, orderId, a4),
    );
    expect(answer.status).toBe(200);
    expect(reads).toBe(1);
  });
});
