import { recordSale } from "@waitron/core";
import { reserveInvoiceDelivery } from "./invoice-delivery.js";
import { reserveStagedInvoiceDelivery } from "./invoice-choice-delivery.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { listInvoicePrinter } from "./testing/invoice-printer.js";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prepareImage, uploadImage, saveImage, renderRendition } from "@waitron/media";
import { drawLogoRasters } from "./receipt-logo.js";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import type { Transaction } from "@waitron/db";
import * as receiptTicket from "./receipt-ticket.js";
import { VENUE_SERVICE } from "./modules.js";
import {
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  diningTables,
  drawerOpens,
  invoiceDeliveries,
  invoiceSeries,
  tenders,
  locations,
  pagePrinters,
  workingOrders,
  nowIso,
  partyTables,
  printerHolders,
  printers,
  printJobs,
  readTenant,
  saleReceiptGuests,
  sales,
  tenantReceipts,
  tenants,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  departmentSalePolicies,
  departments,
  zoneSalePolicies,
  zoneServicePolicies,
  saleReceiptHeaders,
  departmentReceipts,
  createDepartment,
} from "@waitron/venue-service";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
  contentLanguages,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, persons } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  createPrinter,
  deactivatePrinter,
  MAX_DELIVERY_ATTEMPTS,
  resendPrintJob,
  updatePrinter,
} from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { NetworkTcpTransport, UsbTransport } from "@waitron/print-agent";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  deviceOrigin,
  workingOrderId as brandWorkingOrderId,
  jobOrigin,
  type ReceiptLogoRasters,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { OrderFlow, TillConfig, DeviceRequestConfig } from "./till-config.js";
import {
  collectOrderOrchestration as collectOrder,
  printSaleReceipt,
  readSettledTicket,
  recordTillSaleOrchestration as recordTillSale,
  reprintSale,
} from "./till-sale.js";
import { createOpenOrder, parkOrder, placeOrder } from "./working-order.js";
import { createTable } from "./testing/live-table.js";
import { takeBillPayment } from "./bill-payments.js";
import {
  DRAWER_KICK,
  enqueueReceiptReprint,
  enqueueOriginalReceipt,
  enqueueSaleReceipt,
  resolveInvoicePrinter,
  resolvePaymentSlipPrinter,
  resolveReceiptPrinter,
} from "./receipt-print.js";
import {
  decodeTicket,
  opensDrawer,
  printedCommands,
  printedLines,
} from "./testing/decode-ticket.js";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { venueModuleConfig } from "./provision.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  join,
  nameParty,
  orderForParty,
  partyRow,
  pay,
  revisionOf,
  seat,
  setupPartyVenue,
  split,
} from "./testing/party-venue.js";
import { setPartyGuests } from "./parties.js";
import { readReceiptOrder } from "./receipt-order.js";
import { openPartyTab } from "./testing/serve-line.js";
import { printingAlertSource } from "./alert-sources.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg, openTillSession } from "./testing/session-device.js";
import { seedDevice } from "@waitron/db/testing/seed.js";
import { CAPABILITY_FLAGS } from "@waitron/layouts";

/**
 * The auto-print hook: a `print_jobs` outbox row and a `drawer_opens` audit row written atomically
 * with a chained fiscal sale.
 *
 * PRINTING NEVER OPENS THE DRAWER (CLAUDE.md §5): a receipt is a `document` job carrying no drawer
 * command, the kick is a separate `drawer` job, and a cash or hand-keyed card payment writes its own
 * audit row.
 * NEVER-BLOCK: a broken or absent receipt printer never delays or fails a sale. Each test asserts
 * the fiscal record still lands, and the printer transports' `send` — the hardware entry points —
 * are spied to show the sale path delivers nothing.
 */
const LOCALE = "es-ES";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

// The acting operator recorded in `drawer_opens.person_id`.
const OPERATOR = "cccccccc-0000-4000-8000-000000000001";

let backend: FiscalBackend;
let clock: TrustedClock;
let netSend: MockInstance;
let usbSend: MockInstance;

/** An already-anchored wall clock; `recordSale` reads `now()` once and never anchors. */
function systemClock(): TrustedClock {
  return {
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
      throw new Error("receipt-print.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(60_000_000 + nifCounter);
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    nodeId: brandNodeId(venue.nodeId),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

function printCfg(cfg: DeviceRequestConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

/**
 * A fresh chained venue and a one-`each`-product catalogue (1.50 gross, general/21 %), offered in
 * the counter zone under `orderFlow`.
 */
async function setupVenue(orderFlow: OrderFlow = "prepay"): Promise<{
  cfg: DeviceRequestConfig;
  each: AvailableProduct & { menuItemId: string };
  zoneId: string;
}> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Recibos SL",
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

  const cfg = await deviceRequestCfg(suite.db, tillConfigFromVenue(venue));
  const { available, offers } = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      name: "Agua mineral",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return {
      available: (await listAvailableProducts(tx, cfg.locationId)).products,
      offers: await offerProducts(tx, cfg, {
        orderStart: "counter",
        paidWhen: orderFlow,
      }),
    };
  });
  const each = available.find((p) => p.pricingUnit === "each")!;
  const [{ departmentId }] = await suite.db
    .select({ departmentId: zoneServicePolicies.departmentId })
    .from(zoneServicePolicies)
    .where(eq(zoneServicePolicies.zoneId, offers.zoneId));
  await storeDepartmentReceipt(departmentId!, {});
  return { cfg, each: { ...each, menuItemId: offers.offerFor(each.id) }, zoneId: offers.zoneId };
}

async function storeDepartmentReceipt(
  departmentId: string,
  decoration: Record<string, unknown>,
  logoRasters: ReceiptLogoRasters | null = null,
) {
  const receipt = { operationDescription: "Venta en establecimiento", ...decoration };
  await suite.db
    .insert(departmentReceipts)
    .values({ departmentId, receipt, logoRasters })
    .onConflictDoUpdate({
      target: departmentReceipts.departmentId,
      set: { receipt, logoRasters },
    });
}

/**
 * A receipt printer. `network_tcp` makes the transport spy cover its delivery path — a `cloud_poll`
 * printer is driven by neither adapter, so the spy would be vacuous. `192.0.2.1` is TEST-NET-1 (RFC
 * 5737, unroutable).
 */
async function makePrinter(
  cfg: DeviceRequestConfig,
  {
    active = true,
    transport = "cloud_poll" as "cloud_poll" | "network_tcp",
    hasCashDrawer = true,
  } = {},
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { id } = await createPrinter(
      tx,
      printCfg(cfg),
      transport === "network_tcp"
        ? { name: "Recibos", transport: "network_tcp", host: "192.0.2.1", hasCashDrawer }
        : {
            name: "Recibos",
            transport: "cloud_poll",
            pollId: `poll-${randomUUID()}`,
            hasCashDrawer,
          },
    );
    if (!active) await deactivatePrinter(tx, printCfg(cfg), id);
    return id;
  });
}

async function configureReceipt(
  cfg: DeviceRequestConfig,
  opts: { mode?: "auto" | "on_request"; printerId?: string | null },
): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    if (opts.mode !== undefined) {
      const scopedDepartments = await tx
        .select({ id: departments.id })
        .from(departments)
        .where(eq(departments.locationId, cfg.locationId));
      await tx
        .update(departmentSalePolicies)
        .set({ receiptPrintMode: opts.mode })
        .where(
          inArray(
            departmentSalePolicies.departmentId,
            scopedDepartments.map((row) => row.id),
          ),
        );
    }
    if (opts.printerId !== undefined) {
      await tx
        .update(devices)
        .set({
          receiptPrinterId: opts.printerId,
          paymentSlipPrinterId: opts.printerId,
          cashDrawerPrinterId: opts.printerId,
        })
        .where(eq(devices.id, cfg.origin.deviceId));
    }
  });
}

/** Every capability but the drawer. */
const NO_DRAWER_CAPABILITY = CAPABILITY_FLAGS.filter((flag) => flag !== "open-cash-drawer");

/** `cfg` as a request from a new device at its location whose profile lacks `capability`. */
async function deviceWithout(
  cfg: DeviceRequestConfig,
  capability: string,
): Promise<DeviceRequestConfig> {
  const { deviceId } = await seedDevice(suite.db, {
    locationId: cfg.locationId,
    capabilities: CAPABILITY_FLAGS.filter((flag) => flag !== capability),
  });
  return { ...cfg, origin: deviceOrigin(deviceId) };
}

async function printJobsFor(
  cfg: DeviceRequestConfig,
): Promise<{ printerId: string; status: string; payload: Uint8Array }[]> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return tx
      .select({
        printerId: printJobs.printerId,
        status: printJobs.status,
        payload: printJobs.payload,
      })
      .from(printJobs);
  });
}

async function drawerOpensFor(cfg: DeviceRequestConfig): Promise<
  {
    reason: string;
    saleId: string | null;
    personId: string;
    deviceId: string | null;
    printerId: string | null;
  }[]
> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return tx
      .select({
        reason: drawerOpens.reason,
        saleId: drawerOpens.saleId,
        personId: drawerOpens.personId,
        deviceId: drawerOpens.deviceId,
        printerId: drawerOpens.printerId,
      })
      .from(drawerOpens);
  });
}

async function registroCount(cfg: DeviceRequestConfig): Promise<number> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx.select().from(registrosFacturacion);
    return rows.length;
  });
}

/** The one filed sale's id; the database is emptied after each test. */
async function onlySaleId(cfg: DeviceRequestConfig): Promise<string> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx.select({ id: sales.id }).from(sales);
    return rows[0]!.id;
  });
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("receipt-print.test: resolveClient must never be called by recordSale"),
      ),
  });
});

// Spied for every test: no test may open a socket or write a device on the sale path.
beforeAll(() => {
  netSend = vi.spyOn(NetworkTcpTransport.prototype, "send");
  usbSend = vi.spyOn(UsbTransport.prototype, "send");
});
afterEach(() => {
  netSend.mockClear();
  usbSend.mockClear();
});

const deps = () => ({ db: suite.db, backend, clock });

describe("the words around a receipt's QR come from the venue's fiscal backend", () => {
  async function sellOnce(backendForSale: FiscalBackend) {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });
    const ticket = await recordTillSale(
      { db: suite.db, backend: backendForSale, clock },
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    const papers = (await printJobsFor(cfg)).map((job) => new Uint8Array(job.payload));
    const receipt = papers.find((payload) => decodeTicket(payload).includes("TOTAL"))!;
    return { ticket, lines: printedLines(receipt).map((line) => line.trim()) };
  }

  it("prints the Veri*Factu backend's caption above the QR and its legend under it, first", async () => {
    const { ticket, lines } = await sellOnce(backend);
    expect(ticket.qr).not.toBe("");
    expect(ticket.qrText).toEqual({ caption: "QR tributario:", legend: "VERI*FACTU" });
    expect(lines.indexOf("QR tributario:")).toBe(0);
    expect(lines.indexOf("VERI*FACTU")).toBeGreaterThan(0);
    expect(lines.indexOf("VERI*FACTU")).toBeLessThan(
      lines.findIndex((line) => line.startsWith("TOTAL")),
    );
  });

  it("prints neither on a sale filed through a venue with no fiscal regime", async () => {
    const config = venueModuleConfig(parseModuleConfig({}, ALL_MODULES), "GB-vat");
    const none = fiscalSlot(enabledModules(ALL_MODULES, config), null).makeBackend({
      db: suite.db,
      clock,
      environment: deploymentEnvironment(process.env),
    });
    expect(none.id).toBe("none");
    const { ticket, lines } = await sellOnce(none);
    expect(ticket.qr).toBe("");
    expect(ticket).not.toHaveProperty("qrText");
    expect(lines.some((line) => line.startsWith("TOTAL"))).toBe(true);
    expect(lines.join("\n")).not.toContain("VERI*FACTU");
    expect(lines.join("\n")).not.toContain("QR tributario");
  });
});

it("prints one non-fiscal numbered collection ticket when a pay-on-collection order is placed", async () => {
  const { cfg, each, zoneId } = await setupVenue("ticket_then_pay");
  const printerId = await makePrinter(cfg);
  await configureReceipt(cfg, { printerId });
  await suite.db.execute(sql`
    update department_sale_policies
    set order_start = 'counter', paid_when = 'ticket_then_pay', collection_number = 'numbered'
    where department_id = (select department_id from zone_service_policies where zone_id = ${zoneId})
  `);
  const id = randomUUID();
  const { orderNumber } = await parkOrder({ db: suite.db }, cfg, {
    id,
    zoneId,
    lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
  });

  expect(
    (
      await suite.db.execute(
        sql`select service_mode from order_service_contexts where working_order_id = ${id}`,
      )
    ).rows,
  ).toEqual([{ service_mode: "ticket_then_pay" }]);
  await placeOrder(deps(), cfg, id, OPERATOR);

  const jobs = (await printJobsFor(cfg)).filter((job) => job.printerId === printerId);
  expect(jobs).toHaveLength(1);
  const [job] = await suite.db
    .select({ kind: printJobs.kind, saleId: printJobs.saleId })
    .from(printJobs)
    .where(eq(printJobs.printerId, printerId));
  expect(job).toEqual({ kind: "document", saleId: null });
  const ticket = decodeTicket(new Uint8Array(jobs[0]!.payload));
  expect(ticket).toContain("Pedido");
  expect(ticket).toContain(String(orderNumber));
  expect(ticket).not.toContain("FACTURA");
  expect(ticket).not.toContain("TOTAL");
  expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
  expect(await registroCount(cfg)).toBe(0);
  expect(await drawerOpensFor(cfg)).toEqual([]);
  await expect(placeOrder(deps(), cfg, id, OPERATOR)).rejects.toMatchObject({
    code: "working_order.not_open",
  });
  expect((await printJobsFor(cfg)).filter((job) => job.printerId === printerId)).toHaveLength(1);
});

it("a counter order paid at collection records its flow but prints no collection ticket when numbering is off", async () => {
  const { cfg, each, zoneId } = await setupVenue("ticket_then_pay");
  const printerId = await makePrinter(cfg);
  await configureReceipt(cfg, { printerId });
  await suite.db.execute(
    sql`update department_sale_policies set order_start = 'counter', paid_when = 'ticket_then_pay', collection_number = 'none' where department_id = (select department_id from zone_service_policies where zone_id = ${zoneId})`,
  );
  const id = randomUUID();
  await parkOrder({ db: suite.db }, cfg, {
    id,
    zoneId,
    lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
  });
  expect(
    (
      await suite.db.execute(
        sql`select service_mode from order_service_contexts where working_order_id = ${id}`,
      )
    ).rows,
  ).toEqual([{ service_mode: "ticket_then_pay" }]);
  await placeOrder(deps(), cfg, id, OPERATOR);
  expect((await printJobsFor(cfg)).filter((job) => job.printerId === printerId)).toEqual([]);
  expect(await registroCount(cfg)).toBe(0);
  expect(await drawerOpensFor(cfg)).toEqual([]);
});

it("prints a separate numbered collection ticket when a prepaid order is paid", async () => {
  const { cfg, each, zoneId } = await setupVenue("prepay");
  const printerId = await makePrinter(cfg);
  await configureReceipt(cfg, { printerId });
  await suite.db.execute(sql`
    update department_sale_policies
    set paid_when = 'prepay', collection_number = 'numbered'
    where department_id = (select department_id from zone_service_policies where zone_id = ${zoneId})
  `);
  const id = randomUUID();
  const { orderNumber } = await parkOrder({ db: suite.db }, cfg, {
    id,
    zoneId,
    lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
  });

  await recordTillSale(
    deps(),
    cfg,
    { workingOrderId: id, lines: [], tender: { method: "cash", amount: "2.00" } },
    OPERATOR,
  );

  const jobs = (await printJobsFor(cfg)).filter((job) => job.printerId === printerId);
  const papers = jobs.map((job) => decodeTicket(new Uint8Array(job.payload))).filter(Boolean);
  expect(papers).toHaveLength(2);
  const collection = papers.find((paper) => !paper.includes("TOTAL"))!;
  expect(collection).toContain(String(orderNumber));
  expect(collection).not.toContain("FACTURA");
  expect(collection).not.toContain("TOTAL");
  expect(await registroCount(cfg)).toBe(1);
  await recordTillSale(
    deps(),
    cfg,
    { workingOrderId: id, lines: [], tender: { method: "cash", amount: "2.00" } },
    OPERATOR,
  );
  expect(
    (await printJobsFor(cfg))
      .filter((job) => job.printerId === printerId)
      .map((job) => decodeTicket(new Uint8Array(job.payload)))
      .filter(Boolean),
  ).toHaveLength(2);
});

it("a prepaid cash sale reads the device's printers once for its collection ticket, receipt and drawer", async () => {
  const { cfg, each, zoneId } = await setupVenue("prepay");
  const printerId = await makePrinter(cfg);
  await configureReceipt(cfg, { mode: "auto", printerId });
  async function collectionNumber(value: "numbered" | "none"): Promise<void> {
    await suite.db.execute(sql`
      update department_sale_policies
      set paid_when = 'prepay', collection_number = ${value}
      where department_id = (select department_id from zone_service_policies where zone_id = ${zoneId})
    `);
  }
  /** The reads a cash sale of a parked order takes; only a sale with an operator opens the drawer. */
  async function readsOfSale(operatorId: string | undefined): Promise<number> {
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId,
      lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
    });
    const selects = vi.spyOn(suite.db, "select");
    try {
      await recordTillSale(
        deps(),
        cfg,
        { workingOrderId: id, lines: [], tender: { method: "cash", amount: "2.00" } },
        operatorId,
      );
      return selects.mock.calls.length;
    } finally {
      selects.mockRestore();
    }
  }
  await collectionNumber("numbered");
  await readsOfSale(OPERATOR);

  const all = await readsOfSale(OPERATOR);
  const noDrawer = await readsOfSale(undefined);
  await collectionNumber("none");
  const receiptOnly = await readsOfSale(undefined);

  expect(await drawerOpensFor(cfg)).toHaveLength(2);
  // Each extra job adds only its enqueue's own check that the printer is switched on.
  expect(all - noDrawer).toBe(1);
  expect(noDrawer - receiptOnly).toBe(1);
});

it("a cash bill payment that pays the bill in full reads the device's printers once for its drawer and receipt", async () => {
  const { cfg, each } = await setupVenue();
  const printerId = await makePrinter(cfg);
  await configureReceipt(cfg, { mode: "auto", printerId });
  const tabId = await withTransaction(suite.db, async (tx) => {
    const offers = await offerProducts(tx, cfg, { zone: "tables" });
    const table = await createTable(tx, cfg, { label: "Mesa 4", zoneId: offers.zoneId });
    const { tabId } = await openPartyTab(tx, cfg, {
      tableId: table.id,
      lines: [{ menuItemId: offers.offerFor(each.id), quantity: "1" }],
    });
    return tabId;
  });
  const operator = {
    personId: OPERATOR,
    sessionId: await openTillSession(suite.db, {
      deviceId: cfg.origin.deviceId,
      personId: OPERATOR,
    }),
  };

  const selects = vi.spyOn(suite.db, "select");
  let printerReads: number;
  try {
    const { invoice } = await takeBillPayment(
      deps(),
      cfg,
      tabId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "1.50",
        method: "cash",
        tendered: "1.50",
        applied: "1.50",
        tip: "0.00",
      },
      operator,
    );
    expect(invoice).not.toBeNull();
    // The one select that reads the device's printers with its profile's drawer permission.
    printerReads = selects.mock.calls.filter(
      ([fields]) => fields !== undefined && "hasCashDrawer" in fields && "capabilities" in fields,
    ).length;
  } finally {
    selects.mockRestore();
  }

  expect((await drawerOpensFor(cfg)).map((open) => open.reason)).toEqual(["bill_payment"]);
  const jobs = (await printJobsFor(cfg)).filter((job) => job.printerId === printerId);
  expect(jobs.filter((job) => opensDrawer(new Uint8Array(job.payload)))).toHaveLength(1);
  expect(jobs.filter((job) => decodeTicket(new Uint8Array(job.payload)))).toHaveLength(1);
  expect(printerReads).toBe(1);
});

describe("receipt grouping after table changes", () => {
  it.each(["prepay", "ticket_then_pay", "issued"] as const)(
    "%s freezes the table label at issuance across renaming, collection and table turnover",
    async (orderFlow) => {
      const base = await setupVenue(orderFlow === "issued" ? "ticket_then_pay" : orderFlow);
      const cfg = base.cfg;
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode: "auto", printerId });
      // A tab opens only in a table_tab zone, so the order that carries the table here is a counter
      // order in a zone of this flow, delivered to the table.
      const { tableId, orderId } = await withTransaction(suite.db, async (tx) => {
        const table = await createTable(tx, cfg, {
          label: "Terrace 6",
          zoneId: (await offerProducts(tx, cfg, { zone: "tables" })).zoneId,
        });
        const orderId = randomUUID();
        await createOpenOrder(
          tx,
          cfg,
          orderId,
          [{ menuItemId: base.each.menuItemId, quantity: "1" }],
          null,
          { deliveryTableId: table.id, zoneId: base.zoneId },
        );
        return { tableId: table.id, orderId };
      });
      if (orderFlow === "prepay") {
        await recordTillSale(
          deps(),
          cfg,
          {
            workingOrderId: orderId,
            lines: [],
            tender: { method: "cash", amount: "2.00" },
          },
          OPERATOR,
        );
      } else {
        if (orderFlow === "issued") await issueOrderInvoice(deps(), cfg, orderId, OPERATOR);
        await placeOrder(deps(), cfg, orderId, OPERATOR);
        if (orderFlow === "issued") await printSaleReceipt(deps(), cfg, orderId, false);
        if (orderFlow === "ticket_then_pay") {
          await collectOrder(
            deps(),
            cfg,
            {
              id: orderId,
              lines: [],
              tender: { method: "cash", amount: "2.00" },
            },
            OPERATOR,
          );
        }
      }
      expect(decodeTicket(new Uint8Array((await printJobsFor(cfg))[0]!.payload))).toContain(
        "Terrace 6",
      );
      await withTransaction(suite.db, async (tx) => {
        await tx
          .update(diningTables)
          .set({ label: "Renamed table" })
          .where(eq(diningTables.id, tableId));
      });
      await reprintSale({ db: suite.db, backend }, cfg, orderId);
      if (orderFlow === "issued") {
        const collected = await collectOrder(
          deps(),
          cfg,
          {
            id: orderId,
            lines: [],
            tender: { method: "cash", amount: "2.00" },
          },
          OPERATOR,
        );
        expect(collected.orderLabel).toBe("Terrace 6");
      }
      await withTransaction(suite.db, async (tx) => {
        await openPartyTab(tx, cfg, { tableId });
      });
      await reprintSale({ db: suite.db, backend }, cfg, orderId);
      const receiptTexts = (await printJobsFor(cfg))
        .map((job) => decodeTicket(new Uint8Array(job.payload)))
        .filter((text) => text.includes("TOTAL"));
      expect(receiptTexts).toHaveLength(3);
      for (const text of receiptTexts) {
        expect(text).toContain("Terrace 6");
        expect(text).not.toContain("Renamed table");
      }
      expect(await registroCount(cfg)).toBe(1);
    },
  );
});

describe("receipt original and copy tracking", () => {
  it("distinguishes the F2 original, manual copy and drawer job without changing the sale", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });
    const workingOrderId = randomUUID();
    await recordTillSale(
      deps(),
      cfg,
      {
        workingOrderId,
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "2.00" },
      },
      OPERATOR,
    );
    const before = await withTransaction(suite.db, (tx) =>
      tx.select().from(sales).where(eq(sales.workingOrderId, workingOrderId)),
    );
    await reprintSale({ db: suite.db, backend }, cfg, workingOrderId);
    const jobs = await withTransaction(suite.db, (tx) => tx.select().from(printJobs));
    const originals = jobs.filter((job) => job.kind === "document" && job.receiptCopy === false);
    const copies = jobs.filter((job) => job.kind === "document" && job.receiptCopy === true);
    const drawers = jobs.filter((job) => job.kind === "drawer");
    expect(originals).toHaveLength(1);
    expect(copies).toHaveLength(1);
    expect(drawers).toHaveLength(1);
    expect(drawers[0]!.receiptCopy).toBeNull();
    expect(decodeTicket(new Uint8Array(originals[0]!.payload))).not.toContain("DUPLICADO");
    expect(decodeTicket(new Uint8Array(copies[0]!.payload))).toContain("DUPLICADO");
    for (const job of [...originals, ...copies]) {
      expect(job.saleId).toBe(before[0]!.id);
      expect(opensDrawer(new Uint8Array(job.payload))).toBe(false);
    }
    expect(
      await withTransaction(suite.db, (tx) =>
        tx.select().from(sales).where(eq(sales.workingOrderId, workingOrderId)),
      ),
    ).toEqual(before);
    await printSaleReceipt({ db: suite.db, backend }, cfg, workingOrderId, false);
    await printSaleReceipt({ db: suite.db, backend }, cfg, workingOrderId, false);
    const repeated = await withTransaction(suite.db, (tx) => tx.select().from(printJobs));
    expect(repeated.filter((job) => job.receiptCopy === false)).toHaveLength(3);
    expect(repeated.filter((job) => job.receiptCopy === true)).toHaveLength(1);
    expect(repeated.filter((job) => job.kind === "drawer")).toHaveLength(1);
    expect(await registroCount(cfg)).toBe(1);
  });
});

describe("cash payment drawer separation", () => {
  it("prints a cash receipt without a drawer command or audit when its printer has no drawer", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg, { hasCashDrawer: false });
    await configureReceipt(cfg, { mode: "auto", printerId });
    const result = await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "2.00" },
      },
      OPERATOR,
    );
    expect(result.total).toBe("1.50");
    expect(await registroCount(cfg)).toBe(1);
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(decodeTicket(new Uint8Array(jobs[0]!.payload))).toContain("TOTAL");
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it.each(["auto", "on_request"] as const)(
    "%s mode keeps cash payment separate from document printing",
    async (mode) => {
      const { cfg, each, zoneId } = await setupVenue();
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode, printerId });
      await recordTillSale(
        deps(),
        cfg,
        {
          zoneId,
          lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
          tender: { method: "cash", amount: "2.00" },
        },
        OPERATOR,
      );
      const jobs = await printJobsFor(cfg);
      const drawerJobs = jobs.filter((job) => opensDrawer(new Uint8Array(job.payload)));
      expect(drawerJobs).toHaveLength(1);
      expect([...drawerJobs[0]!.payload]).toEqual([...DRAWER_KICK]);
      const documents = jobs.filter((job) =>
        decodeTicket(new Uint8Array(job.payload)).includes("TOTAL"),
      );
      expect(documents).toHaveLength(mode === "auto" ? 1 : 0);
      for (const job of documents) expect(opensDrawer(new Uint8Array(job.payload))).toBe(false);
      expect(await drawerOpensFor(cfg)).toHaveLength(1);
    },
  );
});

describe("print-on-sale hook (auto-enqueue + cash drawer kick, post-filing outbox)", () => {
  it("uses the zone's automatic receipt policy when the department setting is on request", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "on_request", printerId });
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(zoneSalePolicies)
        .set({ receiptPrintMode: "auto" })
        .where(eq(zoneSalePolicies.zoneId, zoneId));
    });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "card", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1);
    const documents = (await printJobsFor(cfg)).filter((job) =>
      decodeTicket(new Uint8Array(job.payload)).includes("TOTAL"),
    );
    expect(documents).toHaveLength(1);
    expect(opensDrawer(new Uint8Array(documents[0]!.payload))).toBe(false);
  });

  it("lays the automatic receipt out for the device printer's paper width and resolution", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await withTransaction(suite.db, async (tx) => {
      await updatePrinter(tx, printCfg(cfg), printerId, {
        paperWidth: "58mm",
        resolution: "203dpi",
      });
    });
    await configureReceipt(cfg, { mode: "auto", printerId });
    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );
    const receipt = (await printJobsFor(cfg))
      .map((job) => new Uint8Array(job.payload))
      .find((payload) => decodeTicket(payload).includes("VERI*FACTU"))!;
    expect([...receipt.subarray(0, 10)]).toEqual([
      0x1b,
      0x40,
      0x1d,
      0x4c,
      0x00,
      0x00,
      0x1d,
      0x57,
      384 & 0xff,
      384 >> 8,
    ]);
    for (const line of printedLines(receipt)) expect(line.length, line).toBeLessThanOrEqual(30);
  });

  it("auto + printer + CASH: enqueues separate receipt and drawer jobs, records the drawer open, never blocks filing", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    // network_tcp, so the transport spy is not vacuous (see `makePrinter`).
    const printerId = await makePrinter(cfg, { transport: "network_tcp" });
    await configureReceipt(cfg, { mode: "auto", printerId });

    const result = await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );

    // Filing is unaffected by the print hook: the chained fiscal record exists.
    expect(result.total).toBe("3.00");
    expect(await registroCount(cfg)).toBe(1);
    // NEVER-BLOCK: the enqueue is an INSERT; delivery is the agent's.
    expect(netSend).not.toHaveBeenCalled();
    expect(usbSend).not.toHaveBeenCalled();

    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) {
      expect(job.printerId).toBe(printerId);
      expect(job.status).toBe("queued");
    }
    const receipt = jobs.find((job) =>
      decodeTicket(new Uint8Array(job.payload)).includes("VERI*FACTU"),
    )!;
    const payload = new Uint8Array(receipt.payload);
    expect(decodeTicket(payload)).toContain("Deli Recibos SL");
    expect(opensDrawer(payload)).toBe(false);
    const drawer = jobs.find((job) => job !== receipt)!;
    expect([...drawer.payload]).toEqual([...DRAWER_KICK]);

    // The drawer open is audited, its `sale_id` pinned to the filed sale.
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({
      reason: "cash_sale",
      personId: OPERATOR,
      deviceId: cfg.origin.deviceId,
      printerId,
    });
    expect(opens[0]!.saleId).toBe(await onlySaleId(cfg));
  });

  it("ignores the venue footer while printing the filed invoice", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg, { transport: "network_tcp" });
    await configureReceipt(cfg, { mode: "auto", printerId });
    await withTransaction(suite.db, async (tx) => {
      // Through the table definition: `receipt` is a JSON column whose write mapping encodes the
      // object, and `updated_at` is a JavaScript generator a raw insert never reaches.
      await tx
        .insert(tenantReceipts)
        .values({ receipt: { footerMessage: "Gracias por su visita" } });
    });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(2);
    const decoded = decodeTicket(new Uint8Array(jobs[0]!.payload));
    expect(decoded).toContain("VERI*FACTU"); // still a real fiscal receipt
    expect(decoded).not.toContain("Gracias por su visita");
  });

  it("marks an automatically printed practice sale as simulated", async () => {
    const base = await setupVenue();
    const cfg = { ...base.cfg, practiceMode: true };
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(2);
    expect(decodeTicket(new Uint8Array(jobs[0]!.payload))).toContain("PRUEBA - SIN COBRO REAL");
  });

  it("auto + printer + hand-keyed CARD: the receipt carries NO kick; a separate drawer job opens the drawer for the card slip", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "card", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1);
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(2);
    for (const job of jobs) expect(job.printerId).toBe(printerId);
    const receipt = jobs.find((job) =>
      decodeTicket(new Uint8Array(job.payload)).includes("VERI*FACTU"),
    )!;
    expect(opensDrawer(new Uint8Array(receipt.payload))).toBe(false);
    const drawer = jobs.find((job) => job !== receipt)!;
    expect([...drawer.payload]).toEqual([...DRAWER_KICK]);
    expect(await drawerOpensFor(cfg)).toEqual([
      {
        reason: "card_slip",
        saleId: await onlySaleId(cfg),
        personId: OPERATOR,
        deviceId: cfg.origin.deviceId,
        printerId,
      },
    ]);
  });

  it("hand-keyed CARD on a device that may not open the drawer: the receipt prints, and no drawer job or audit row", async () => {
    const { cfg: base, each, zoneId } = await setupVenue();
    const cfg = await deviceWithout(base, "open-cash-drawer");
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "card", amount: "1.50" },
      },
      OPERATOR,
    );

    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("hand-keyed CARD at a till whose printer has no drawer: the receipt prints, and no drawer job or audit row", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg, { hasCashDrawer: false });
    await configureReceipt(cfg, { mode: "auto", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "card", amount: "1.50" },
      },
      OPERATOR,
    );

    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("hand-keyed CARD but NO operator: prints the receipt, but no kick and no audit row", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    await recordTillSale(deps(), cfg, {
      zoneId,
      lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      tender: { method: "card", amount: "1.50" },
    });

    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("hand-keyed CARD in mode 'on_request': files the sale and enqueues only the drawer job for the card slip", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "on_request", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "card", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1);
    expect((await printJobsFor(cfg)).map((job) => [...job.payload])).toEqual([[...DRAWER_KICK]]);
    expect(await drawerOpensFor(cfg)).toEqual([
      {
        reason: "card_slip",
        saleId: await onlySaleId(cfg),
        personId: OPERATOR,
        deviceId: cfg.origin.deviceId,
        printerId,
      },
    ]);
  });

  it("mode 'on_request': files the sale and enqueues only the cash drawer job", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "on_request", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1); // sale still files
    expect((await printJobsFor(cfg)).map((job) => [...job.payload])).toEqual([[...DRAWER_KICK]]);
    expect(await drawerOpensFor(cfg)).toHaveLength(1);
  });

  it("mode 'on_request': files the sale and enqueues only the cash drawer job", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "on_request", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1);
    expect((await printJobsFor(cfg)).map((job) => [...job.payload])).toEqual([[...DRAWER_KICK]]);
    expect(await drawerOpensFor(cfg)).toHaveLength(1);
  });

  it("auto but NO printer set: files the sale, enqueues nothing, opens no drawer", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    // Default mode is 'auto'; leave receipt_printer_id NULL.
    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1); // the sale is unaffected by the absent printer
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("auto + INACTIVE printer: files the sale, enqueues nothing (printer.not_found stays unreachable)", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    // The hook's active filter drops a deactivated printer, so `enqueuePrintJob`'s
    // `printer.not_found` throw, which would abort the sale (§5), stays unreachable.
    const printerId = await makePrinter(cfg, { active: false });
    await configureReceipt(cfg, { mode: "auto", printerId });

    const result = await recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(result.total).toBe("1.50"); // the sale files cleanly
    expect(await registroCount(cfg)).toBe(1);
    expect(await printJobsFor(cfg)).toEqual([]); // nothing enqueued to the inactive printer
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("auto + printer + CASH but NO operator: prints the receipt, but no kick and no audit row", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    // No operator: the kick and its audit row are skipped; the customer receipt still prints.
    await recordTillSale(deps(), cfg, {
      zoneId,
      lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    expect(await registroCount(cfg)).toBe(1);
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1); // the receipt is still enqueued
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false); // no kick
    expect(await drawerOpensFor(cfg)).toEqual([]); // no audit row
  });

  it.each(["auto", "on_request"] as const)(
    "an explicit original print of an unpaid invoice routes to the issuing device's printer in %s mode",
    async (mode) => {
      const base = await setupVenue("ticket_then_pay");
      const { cfg } = base;
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode, printerId });
      const id = randomUUID();
      await parkOrder({ db: suite.db }, cfg, {
        id,
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
      });
      await placeOrder(deps(), cfg, id, OPERATOR);
      await issueOrderInvoice(deps(), cfg, id, OPERATOR);
      await printSaleReceipt(deps(), cfg, id, false);
      const jobs = await printJobsFor(cfg);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.printerId).toBe(printerId);
      expect(await registroCount(cfg)).toBe(1);
    },
  );

  it.each(["auto", "on_request"] as const)(
    "an explicitly printed unpaid original in %s mode is retained; collection only opens and audits the drawer",
    async (mode) => {
      const base = await setupVenue("ticket_then_pay");
      const { cfg } = base;
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode, printerId });

      const id = randomUUID();
      await parkOrder({ db: suite.db }, cfg, {
        id,
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
      });
      await placeOrder(deps(), cfg, id, OPERATOR);
      await issueOrderInvoice(deps(), cfg, id, OPERATOR);
      await printSaleReceipt(deps(), cfg, id, false);
      const issuedJobs = await printJobsFor(cfg);
      expect(issuedJobs).toHaveLength(1);
      const original = new Uint8Array(issuedJobs[0]!.payload);
      const text = decodeTicket(original);
      expect(text).toContain("TOTAL");
      const caption = text.indexOf("QR tributario:");
      expect(caption).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("VERI*FACTU")).toBeGreaterThan(caption);
      expect(text.indexOf("VERI*FACTU")).toBeLessThan(text.indexOf("TOTAL"));
      expect(text).not.toContain("Efectivo");
      expect(text).not.toContain("Cambio");
      expect(text).not.toContain("Tarjeta");
      expect(text).not.toContain("DUPLICADO");
      expect(opensDrawer(original)).toBe(false);
      expect(await drawerOpensFor(cfg)).toEqual([]);

      await collectOrder(
        deps(),
        cfg,
        { id, lines: [], tender: { method: "cash", amount: "2.00" } },
        OPERATOR,
      );

      // Collection settles the same invoice and emits only the cash-drawer command.
      expect(await registroCount(cfg)).toBe(1);
      expect(netSend).not.toHaveBeenCalled();
      expect(usbSend).not.toHaveBeenCalled();
      const jobs = await printJobsFor(cfg);
      expect(jobs).toHaveLength(2);
      expect(jobs[0]!.printerId).toBe(printerId);
      expect(jobs.map((job) => job.payload)).toContainEqual(Buffer.from(original));
      expect(jobs.map((job) => job.payload)).toContainEqual(Buffer.from(DRAWER_KICK));
      const opens = await drawerOpensFor(cfg);
      expect(opens).toHaveLength(1);
      expect(opens[0]).toMatchObject({ reason: "cash_sale", personId: OPERATOR });
      // The `sale_id` back-reference is PINNED to the settled invoice's sale.
      expect(opens[0]!.saleId).toBe(await onlySaleId(cfg));
    },
  );
});

describe("every device whose profile allows the drawer opens its chosen drawer", () => {
  /** Another till device at the venue's location, and the config a sale there runs under. */
  async function addTill(
    cfg: DeviceRequestConfig,
    name: string,
    capabilities: string[] = [...CAPABILITY_FLAGS],
  ): Promise<DeviceRequestConfig> {
    const { deviceId } = await seedDevice(suite.db, {
      locationId: cfg.locationId,
      label: name,
      capabilities,
    });
    return { ...cfg, origin: deviceOrigin(deviceId) };
  }

  async function sale(
    cfg: DeviceRequestConfig,
    product: { zoneId: string; menuItemId: string },
    method: "cash" | "card" = "cash",
  ): Promise<void> {
    await recordTillSale(
      deps(),
      cfg,
      {
        zoneId: product.zoneId,
        lines: [{ menuItemId: product.menuItemId, quantity: "1" }],
        tender: { method, amount: "1.50" },
      },
      OPERATOR,
    );
  }

  /** Each job's printer, and whether it is a drawer kick or a document. */
  async function jobKinds(
    cfg: DeviceRequestConfig,
  ): Promise<{ printerId: string; kick: boolean }[]> {
    return (await printJobsFor(cfg)).map((job) => ({
      printerId: job.printerId,
      kick: Buffer.from(job.payload).equals(Buffer.from(DRAWER_KICK)),
    }));
  }

  /** Two till devices at one location, both printing their receipts on one drawer printer; the other's
   *  device has `otherCapabilities`. */
  async function sharedDrawer(
    orderFlow: OrderFlow = "prepay",
    otherCapabilities: string[] = [...CAPABILITY_FLAGS],
  ) {
    const base = await setupVenue(orderFlow);
    const cfg = await deviceRequestCfg(suite.db, { ...base.cfg });
    const other = await addTill(cfg, "Caja 2", otherCapabilities);
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });
    await configureReceipt(other, { printerId });
    return {
      ...base,
      cfg,
      other,
      printerId,
      product: { zoneId: base.zoneId, menuItemId: base.each.menuItemId },
    };
  }

  it.each(["cash", "card"] as const)(
    "two tills sharing one drawer printer, both allowed the drawer: a %s sale on each opens the drawer, naming that device",
    async (method) => {
      const { cfg, other, printerId, product } = await sharedDrawer();

      await sale(cfg, product, method);
      await sale(other, product, method);

      expect(await registroCount(cfg)).toBe(2);
      expect((await jobKinds(cfg)).filter((job) => job.kick)).toEqual([
        { printerId, kick: true },
        { printerId, kick: true },
      ]);
      expect(
        (await drawerOpensFor(cfg)).map((row) => [row.reason, row.deviceId, row.printerId]),
      ).toEqual([
        [method === "cash" ? "cash_sale" : "card_slip", cfg.origin.deviceId, printerId],
        [method === "cash" ? "cash_sale" : "card_slip", other.origin.deviceId, printerId],
      ]);
    },
  );

  it.each(["cash", "card"] as const)(
    "with one of them on a profile without the drawer, its %s sale prints its receipt there and opens nothing, while the other's still opens it",
    async (method) => {
      const { cfg, other, printerId, product } = await sharedDrawer("prepay", NO_DRAWER_CAPABILITY);

      await sale(other, product, method);
      expect(await jobKinds(cfg)).toEqual([{ printerId, kick: false }]);
      expect(await drawerOpensFor(cfg)).toEqual([]);

      await sale(cfg, product, method);
      expect((await jobKinds(cfg)).filter((job) => job.kick)).toEqual([{ printerId, kick: true }]);
      expect(await drawerOpensFor(cfg)).toEqual([
        {
          reason: method === "cash" ? "cash_sale" : "card_slip",
          saleId: expect.any(String),
          personId: OPERATOR,
          deviceId: cfg.origin.deviceId,
          printerId,
        },
      ]);
    },
  );

  it("a kitchen display opens no drawer, even when its stored list names the drawer", async () => {
    const { cfg, printerId, product } = await sharedDrawer();
    const [profile] = await suite.db
      .insert(deviceProfiles)
      .values({
        name: `Display ${randomUUID()}`,
        formFactor: "kds",
        capabilities: [...CAPABILITY_FLAGS],
      })
      .returning({ id: deviceProfiles.id });
    const [device] = await suite.db
      .insert(devices)
      .values({
        locationId: cfg.locationId,
        label: `Display ${randomUUID()}`,
        tokenHash: "scrypt$00$00",
        deviceProfileId: profile!.id,
        receiptPrinterId: printerId,
        cashDrawerPrinterId: printerId,
      })
      .returning({ id: devices.id });
    const display = { ...cfg, origin: deviceOrigin(device!.id) };

    await sale(display, product, "cash");
    expect((await jobKinds(cfg)).filter((job) => job.kick)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);

    await sale(cfg, product, "cash");
    expect((await jobKinds(cfg)).filter((job) => job.kick)).toEqual([{ printerId, kick: true }]);
  });

  it.each(["ticket_then_pay", "issued"] as const)(
    "collecting a placed %s order in cash opens the drawer only on the till allowed the drawer",
    async (orderFlow) => {
      const { cfg, other, printerId, zoneId, each } = await sharedDrawer(
        "ticket_then_pay",
        NO_DRAWER_CAPABILITY,
      );

      const collectOn = async (till: DeviceRequestConfig): Promise<void> => {
        const id = randomUUID();
        await parkOrder({ db: suite.db }, till, {
          id,
          zoneId,
          lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        });
        await placeOrder(deps(), till, id, OPERATOR);
        if (orderFlow === "issued") await issueOrderInvoice(deps(), till, id, OPERATOR);
        await collectOrder(
          deps(),
          till,
          { id, lines: [], tender: { method: "cash", amount: "2.00" } },
          OPERATOR,
        );
      };

      await collectOn(other);
      expect((await jobKinds(cfg)).filter((job) => job.kick)).toEqual([]);
      expect(await drawerOpensFor(cfg)).toEqual([]);

      await collectOn(cfg);
      expect((await jobKinds(cfg)).filter((job) => job.kick)).toEqual([{ printerId, kick: true }]);
      expect((await drawerOpensFor(cfg)).map((row) => [row.reason, row.deviceId])).toEqual([
        ["cash_sale", cfg.origin.deviceId],
      ]);
    },
  );
});

describe("the drawer follows the device's drawer choice, not its receipt printer", () => {
  /** Every print job, oldest first, with what it is and what it carries. */
  async function allJobs() {
    return withTransaction(suite.db, (tx) =>
      tx
        .select({
          printerId: printJobs.printerId,
          kind: printJobs.kind,
          saleId: printJobs.saleId,
          payload: printJobs.payload,
        })
        .from(printJobs)
        .orderBy(sql`rowid`),
    );
  }

  async function sell(
    cfg: DeviceRequestConfig,
    product: { zoneId: string; menuItemId: string },
    method: "cash" | "card",
    workingOrderId: string = randomUUID(),
  ): Promise<void> {
    await recordTillSale(
      deps(),
      cfg,
      {
        workingOrderId,
        zoneId: product.zoneId,
        lines: [{ menuItemId: product.menuItemId, quantity: "1" }],
        tender: { method, amount: "2.00" },
      },
      OPERATOR,
    );
  }

  /** A venue whose device prints receipts on `receipt` and opens the drawer of `drawer`. */
  async function venue(opts: { receiptHasDrawer: boolean }) {
    const base = await setupVenue();
    const cfg = base.cfg;
    const drawer = await makePrinter(cfg);
    const receipt = await makePrinter(cfg, { hasCashDrawer: opts.receiptHasDrawer });
    await configureReceipt(cfg, { mode: "auto", printerId: receipt });
    await withTransaction(suite.db, (tx) =>
      tx
        .update(devices)
        .set({ cashDrawerPrinterId: drawer })
        .where(eq(devices.id, cfg.origin.deviceId)),
    );
    return {
      cfg,
      drawer,
      receipt,
      product: { zoneId: base.zoneId, menuItemId: base.each.menuItemId },
    };
  }

  it("a device switching to a portable receipt printer without a drawer still opens its chosen drawer on a cash sale", async () => {
    const { cfg, drawer, product } = await venue({ receiptHasDrawer: true });
    const portable = await makePrinter(cfg, { hasCashDrawer: false });
    await withTransaction(suite.db, async (tx) => {
      await tx.update(printers).set({ portable: true }).where(eq(printers.id, portable));
      await tx
        .insert(printerHolders)
        .values({ printerId: portable, deviceId: cfg.origin.deviceId });
      await tx
        .update(devices)
        .set({ receiptPrinterId: portable })
        .where(eq(devices.id, cfg.origin.deviceId));
    });

    await sell(cfg, product, "cash");

    const saleId = await onlySaleId(cfg);
    const jobs = await allJobs();
    expect(jobs.map((job) => [job.printerId, job.kind])).toEqual([
      [portable, "document"],
      [drawer, "drawer"],
    ]);
    const kick = jobs[1]!;
    expect(kick.saleId).toBeNull();
    expect([...new Uint8Array(kick.payload)]).toEqual([...DRAWER_KICK]);
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
    expect(await drawerOpensFor(cfg)).toEqual([
      {
        reason: "cash_sale",
        saleId,
        personId: OPERATOR,
        deviceId: cfg.origin.deviceId,
        printerId: drawer,
      },
    ]);
  });

  it("a hand-keyed card opens one audited drawer job on the drawer printer, not the receipt printer", async () => {
    const { cfg, drawer, receipt, product } = await venue({ receiptHasDrawer: true });

    await sell(cfg, product, "card");

    expect((await allJobs()).map((job) => [job.printerId, job.kind])).toEqual([
      [receipt, "document"],
      [drawer, "drawer"],
    ]);
    expect(await drawerOpensFor(cfg)).toEqual([
      {
        reason: "card_slip",
        saleId: await onlySaleId(cfg),
        personId: OPERATOR,
        deviceId: cfg.origin.deviceId,
        printerId: drawer,
      },
    ]);
  });

  it("a device whose drawer choice resolves to none opens nothing on a cash sale, though its receipt printer has a drawer", async () => {
    const { cfg, receipt, product } = await venue({ receiptHasDrawer: true });
    await withTransaction(suite.db, (tx) =>
      tx
        .update(devices)
        .set({ cashDrawerPrinterId: null })
        .where(eq(devices.id, cfg.origin.deviceId)),
    );

    await sell(cfg, product, "cash");

    expect((await allJobs()).map((job) => [job.printerId, job.kind])).toEqual([
      [receipt, "document"],
    ]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("a device with no drawer choice of its own opens its profile's default drawer", async () => {
    const { cfg, drawer, receipt, product } = await venue({ receiptHasDrawer: true });
    await withTransaction(suite.db, async (tx) => {
      const [device] = await tx
        .update(devices)
        .set({ cashDrawerPrinterId: null })
        .where(eq(devices.id, cfg.origin.deviceId))
        .returning({ profileId: devices.deviceProfileId });
      await tx.insert(deviceProfilePrinters).values({
        deviceProfileId: device!.profileId,
        printerId: drawer,
        role: "cash_drawer",
        position: 0,
        isDefault: true,
      });
    });

    await sell(cfg, product, "cash");

    expect((await allJobs()).map((job) => [job.printerId, job.kind])).toEqual([
      [receipt, "document"],
      [drawer, "drawer"],
    ]);
    expect((await drawerOpensFor(cfg)).map((row) => [row.reason, row.printerId])).toEqual([
      ["cash_sale", drawer],
    ]);
  });

  it("a receipt document and a reprint open no drawer, though the device has one it could open", async () => {
    const { cfg, drawer, receipt, product } = await venue({ receiptHasDrawer: true });
    await configureReceipt(cfg, { mode: "on_request" });
    const workingOrderId = randomUUID();
    await sell(cfg, product, "cash", workingOrderId);
    expect((await allJobs()).map((job) => [job.printerId, job.kind])).toEqual([[drawer, "drawer"]]);

    await printSaleReceipt({ db: suite.db, backend }, cfg, workingOrderId, false);
    await reprintSale({ db: suite.db, backend }, cfg, workingOrderId);

    const jobs = await allJobs();
    expect(jobs.map((job) => [job.printerId, job.kind])).toEqual([
      [drawer, "drawer"],
      [receipt, "document"],
      [receipt, "document"],
    ]);
    for (const job of jobs.slice(1)) expect(opensDrawer(new Uint8Array(job.payload))).toBe(false);
    expect(await drawerOpensFor(cfg)).toHaveLength(1);
  });
});

describe("a receipt reprint and the printer's alert (A167)", () => {
  /** Every print job, oldest first. */
  async function jobs() {
    return withTransaction(suite.db, (tx) =>
      tx
        .select({
          id: printJobs.id,
          kind: printJobs.kind,
          printerId: printJobs.printerId,
          saleId: printJobs.saleId,
        })
        .from(printJobs)
        .orderBy(sql`rowid`),
    );
  }

  async function setJobs(
    ids: string[],
    values: { status: "done" } | { status: "failed"; attempts: number },
  ): Promise<void> {
    await withTransaction(suite.db, (tx) =>
      tx.update(printJobs).set(values).where(inArray(printJobs.id, ids)),
    );
  }

  const exhausted = { status: "failed", attempts: MAX_DELIVERY_ATTEMPTS } as const;

  // These cases count receipts; a card sale at a printer with a drawer also opens it (B30).
  const NO_DRAWER = { hasCashDrawer: false } as const;

  /** The count the printer's "jobs waiting" alert shows for `printerId`, or 0 when it raises none. */
  async function waitingAt(printerId: string): Promise<number> {
    const alerts = await withTransaction(suite.db, (tx) =>
      printingAlertSource().read({ tx, now: new Date() }),
    );
    const alert = alerts.find((a) => a.key === `printer.jobs_waiting:${printerId}`);
    return alert === undefined ? 0 : Number(alert.params.count);
  }

  /** Files a 1.50 sale paid as `method`, answering the sale and its bill. */
  async function sell(
    venue: Awaited<ReturnType<typeof setupVenue>>,
    method: "card" | "cash" = "card",
  ): Promise<{ saleId: string; workingOrderId: string }> {
    await recordTillSale(
      deps(),
      venue.cfg,
      {
        zoneId: venue.zoneId,
        lines: [{ menuItemId: venue.each.menuItemId, quantity: "1" }],
        tender: { method, amount: "1.50" },
      },
      OPERATOR,
    );
    const [sale] = await withTransaction(suite.db, (tx) =>
      tx
        .select({ saleId: sales.id, workingOrderId: sales.workingOrderId })
        .from(sales)
        .orderBy(sql`rowid desc`)
        .limit(1),
    );
    return { saleId: sale!.saleId, workingOrderId: sale!.workingOrderId! };
  }

  /** An auto-printed card sale's receipt that ran out of attempts, then the till's reprint of it. */
  async function failedThenReprinted() {
    const venue = await setupVenue();
    const printerId = await makePrinter(venue.cfg, NO_DRAWER);
    await configureReceipt(venue.cfg, { mode: "auto", printerId });
    const sale = await sell(venue);
    const [original] = await jobs();
    await setJobs([original!.id], exhausted);
    await reprintSale({ db: suite.db, backend }, venue.cfg, sale.workingOrderId);
    const reprint = (await jobs()).at(-1)!;
    expect(reprint.id).not.toBe(original!.id);
    return { venue, printerId, sale, original: original!.id, reprint: reprint.id };
  }

  it("records the sale on its original and duplicate receipts, and not on its drawer job", async () => {
    const venue = await setupVenue();
    const printerId = await makePrinter(venue.cfg, { hasCashDrawer: true });
    await configureReceipt(venue.cfg, { mode: "on_request", printerId });
    const sale = await sell(venue, "cash");
    await printSaleReceipt({ db: suite.db, backend }, venue.cfg, sale.workingOrderId, false);
    await reprintSale({ db: suite.db, backend }, venue.cfg, sale.workingOrderId);

    expect((await jobs()).map(({ kind, saleId }) => ({ kind, saleId }))).toEqual([
      { kind: "drawer", saleId: null },
      { kind: "document", saleId: sale.saleId },
      { kind: "document", saleId: sale.saleId },
    ]);
  });

  it("records the sale on an automatically printed receipt", async () => {
    const venue = await setupVenue();
    await configureReceipt(venue.cfg, {
      mode: "auto",
      printerId: await makePrinter(venue.cfg, NO_DRAWER),
    });
    const sale = await sell(venue);

    expect((await jobs()).map(({ kind, saleId }) => ({ kind, saleId }))).toEqual([
      { kind: "document", saleId: sale.saleId },
    ]);
  });

  it("counts a failed receipt while the till's reprint waits, and drops it once the reprint has printed", async () => {
    const { printerId, reprint } = await failedThenReprinted();
    expect(await waitingAt(printerId)).toBe(1);

    await setJobs([reprint], { status: "done" });
    expect(await waitingAt(printerId)).toBe(0);
  });

  it("drops a failed resend of the receipt from the Printers screen once the till's reprint has printed", async () => {
    const venue = await setupVenue();
    const printerId = await makePrinter(venue.cfg, NO_DRAWER);
    await configureReceipt(venue.cfg, { mode: "auto", printerId });
    const sale = await sell(venue);
    const [original] = await jobs();
    await setJobs([original!.id], exhausted);
    const resent = await withTransaction(suite.db, (tx) => resendPrintJob(tx, original!.id));
    await setJobs([resent.jobId], exhausted);
    await reprintSale({ db: suite.db, backend }, venue.cfg, sale.workingOrderId);
    expect(await waitingAt(printerId)).toBe(2);

    await setJobs([(await jobs()).at(-1)!.id], { status: "done" });
    expect(await waitingAt(printerId)).toBe(0);
  });

  it("counts both when the reprint also runs out of attempts", async () => {
    const { printerId, reprint } = await failedThenReprinted();
    await setJobs([reprint], exhausted);

    expect(await waitingAt(printerId)).toBe(2);
  });

  it("counts a reprint that runs out of attempts after the original printed", async () => {
    const venue = await setupVenue();
    const printerId = await makePrinter(venue.cfg, NO_DRAWER);
    await configureReceipt(venue.cfg, { mode: "auto", printerId });
    const sale = await sell(venue);
    const [original] = await jobs();
    await setJobs([original!.id], { status: "done" });
    await reprintSale({ db: suite.db, backend }, venue.cfg, sale.workingOrderId);
    await setJobs([(await jobs()).at(-1)!.id], exhausted);

    expect(await waitingAt(printerId)).toBe(1);
  });

  it("keeps counting a failed receipt when the reprint prints on another printer", async () => {
    const venue = await setupVenue();
    const first = await makePrinter(venue.cfg, NO_DRAWER);
    await configureReceipt(venue.cfg, { mode: "auto", printerId: first });
    const sale = await sell(venue);
    const [original] = await jobs();
    await setJobs([original!.id], exhausted);
    const second = await makePrinter(venue.cfg, NO_DRAWER);
    await configureReceipt(venue.cfg, { printerId: second });
    await reprintSale({ db: suite.db, backend }, venue.cfg, sale.workingOrderId);
    const reprint = (await jobs()).at(-1)!;
    expect(reprint.printerId).toBe(second);

    await setJobs([reprint.id], { status: "done" });
    expect(await waitingAt(first)).toBe(1);
    expect(await waitingAt(second)).toBe(0);
  });

  it("keeps counting another sale's failed receipt when this sale's reprint prints", async () => {
    const venue = await setupVenue();
    const printerId = await makePrinter(venue.cfg, NO_DRAWER);
    await configureReceipt(venue.cfg, { mode: "auto", printerId });
    await sell(venue);
    const other = await sell(venue);
    const [failed, printed] = await jobs();
    await setJobs([failed!.id], exhausted);
    await setJobs([printed!.id], { status: "done" });
    await reprintSale({ db: suite.db, backend }, venue.cfg, other.workingOrderId);
    await setJobs([(await jobs()).at(-1)!.id], { status: "done" });

    expect(await waitingAt(printerId)).toBe(1);
  });
});

describe("a record with no device prints nothing", () => {
  it.each(["demo_seed", "readiness_test", "operator_script", "payment_check"] as const)(
    "finds no receipt or payment slip printer for the %s source",
    async (source) => {
      const { cfg } = await setupVenue();
      await configureReceipt(cfg, { printerId: await makePrinter(cfg) });
      const found = await withTransaction(suite.db, async (tx) => [
        await resolveReceiptPrinter(tx, jobOrigin(source)),
        await resolvePaymentSlipPrinter(tx, jobOrigin(source)),
      ]);
      expect(found).toEqual([undefined, undefined]);
      // The control: the same venue's device does find its printer.
      expect(
        await withTransaction(suite.db, (tx) => resolveReceiptPrinter(tx, cfg.origin)),
      ).toBeDefined();
    },
  );
});

describe("the device's invoice printer", () => {
  async function officePrinter(cfg: DeviceRequestConfig, active = true): Promise<string> {
    const [row] = await suite.db
      .insert(pagePrinters)
      .values({
        locationId: cfg.locationId,
        name: active ? "Back office" : "Old office",
        host: `192.0.2.${active ? 40 : 41}`,
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
        active,
      })
      .returning({ id: pagePrinters.id });
    return row!.id;
  }

  async function profileOf(cfg: DeviceRequestConfig): Promise<string> {
    const [device] = await suite.db
      .select({ profileId: devices.deviceProfileId })
      .from(devices)
      .where(eq(devices.id, cfg.origin.deviceId));
    return device!.profileId;
  }

  const resolve = (origin: Parameters<typeof resolveInvoicePrinter>[1]) =>
    withTransaction(suite.db, (tx) => resolveInvoicePrinter(tx, origin));

  it("resolves the profile's default A4 printer at the device's location", async () => {
    const { cfg } = await setupVenue();
    const office = await officePrinter(cfg);
    await withTransaction(suite.db, async (tx) =>
      listInvoicePrinter(tx, {
        profileId: await profileOf(cfg),
        pagePrinterId: office,
        isDefault: true,
      }),
    );

    expect(await resolve(cfg.origin)).toEqual({ kind: "a4", id: office, name: "Back office" });
  });

  it("resolves the device's own receipt-printer choice over the profile's default", async () => {
    const { cfg } = await setupVenue();
    const office = await officePrinter(cfg);
    const receipt = await makePrinter(cfg);
    await withTransaction(suite.db, async (tx) => {
      const profileId = await profileOf(cfg);
      await listInvoicePrinter(tx, { profileId, pagePrinterId: office, isDefault: true });
      await listInvoicePrinter(tx, { profileId, printerId: receipt, isDefault: false });
      await tx
        .update(devices)
        .set({ invoicePrinterId: receipt })
        .where(eq(devices.id, cfg.origin.deviceId));
    });

    expect(await resolve(cfg.origin)).toEqual({ kind: "receipt", id: receipt, name: "Recibos" });
  });

  it("resolves none when the profile lists no invoice printer, or the origin is not a device", async () => {
    const { cfg } = await setupVenue();
    await officePrinter(cfg);

    expect(await resolve(cfg.origin)).toBeUndefined();
    expect(await resolve(jobOrigin("operator_script"))).toBeUndefined();
  });

  it("resolves none for a switched-off choice, never falling back to the profile's default", async () => {
    const { cfg } = await setupVenue();
    const office = await officePrinter(cfg);
    const old = await officePrinter(cfg, false);
    await withTransaction(suite.db, async (tx) => {
      const profileId = await profileOf(cfg);
      await listInvoicePrinter(tx, { profileId, pagePrinterId: office, isDefault: true });
      await listInvoicePrinter(tx, { profileId, pagePrinterId: old, isDefault: false });
      await tx
        .update(devices)
        .set({ invoicePagePrinterId: old })
        .where(eq(devices.id, cfg.origin.deviceId));
    });

    expect(await resolve(cfg.origin)).toBeUndefined();
  });
});

describe("receipt issuer", () => {
  it("keeps a department's printed trading name on reprint after its settings change", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "auto", printerId: await makePrinter(cfg) });
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update departments set trading_name = 'Deli Counter' where location_id = ${cfg.locationId}`,
      ),
    );
    const filed = await recordTillSale(deps(), cfg, {
      zoneId,
      lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      tender: { method: "card", amount: "1.50" },
    });
    const saleId = await onlySaleId(cfg);
    const original = (await printJobsFor(cfg)).map((job) =>
      printedLines(new Uint8Array(job.payload)).map((line) => line.trim()),
    )[0]!;
    expect(original.indexOf("Deli Counter")).toBeGreaterThanOrEqual(0);
    const issuerAt = (lines: string[]) =>
      lines.findIndex(
        (line, at) => line === "Deli Recibos SL" && lines[at + 1]?.startsWith("NIF: "),
      );
    expect(issuerAt(original)).toBeGreaterThan(0);
    expect(original.indexOf("Deli Counter")).toBeLessThan(issuerAt(original));

    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update departments set trading_name = 'Renamed', active = 0 where location_id = ${cfg.locationId}`,
      ),
    );
    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, filed, saleId));
    const jobs = await printJobsFor(cfg);
    const reprint = printedLines(new Uint8Array(jobs.at(-1)!.payload)).map((line) => line.trim());
    expect(reprint.indexOf("Deli Counter")).toBeGreaterThanOrEqual(0);
    expect(issuerAt(reprint)).toBeGreaterThan(0);
    expect(reprint.indexOf("Deli Counter")).toBeLessThan(issuerAt(reprint));
    expect(reprint).not.toContain("Renamed");
  });

  it("leaves a manual till reprint unqueued when its taxpayer row is missing", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "on_request", printerId: await makePrinter(cfg) });
    const filed = await recordTillSale(deps(), cfg, {
      zoneId,
      lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      tender: { method: "card", amount: "1.50" },
    });
    const saleId = await onlySaleId(cfg);
    await withTransaction(suite.db, (tx) => tx.delete(tenants));

    await expect(
      withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, filed, saleId)),
    ).resolves.toBeUndefined();
    expect(await printJobsFor(cfg)).toEqual([]);
  });

  it("prints the taxpayer's own name and NIF when the ticket carries no filed issuer", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "on_request", printerId: await makePrinter(cfg) });
    const filed = await recordTillSale(deps(), cfg, {
      zoneId,
      lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
      tender: { method: "card", amount: "1.50" },
    });
    const withoutIssuer = { ...filed, issuer: undefined };
    const taxpayer = (await withTransaction(suite.db, (tx) => readTenant(tx)))!;
    const saleId = await onlySaleId(cfg);

    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, withoutIssuer, saleId));
    const [fallback] = (await printJobsFor(cfg)).map((job) =>
      decodeTicket(new Uint8Array(job.payload)),
    );
    expect(fallback).toContain(taxpayer.legalName);
    expect(fallback).toContain(taxpayer.taxId);

    // The control: a ticket that does carry a filed issuer prints that one instead.
    await withTransaction(suite.db, (tx) => tx.delete(printJobs));
    await withTransaction(suite.db, (tx) =>
      enqueueReceiptReprint(
        tx,
        cfg,
        { ...filed, issuer: { venueName: "Emisor Registrado SL", nif: "B99999999" } },
        saleId,
      ),
    );
    const [recorded] = (await printJobsFor(cfg)).map((job) =>
      decodeTicket(new Uint8Array(job.payload)),
    );
    expect(recorded).toContain("Emisor Registrado SL");
    expect(recorded).not.toContain(taxpayer.legalName);
  });
});

describe("a party's receipt names the party and its tables (spec §8)", () => {
  /** The receipt a party at Mesa 4 and 5 is printed when it pays, named `name` when one is given. */
  async function receiptOfJoinedParty(name?: string): Promise<string> {
    const v = await setupPartyVenue(suite.db);
    const [{ departmentId }] = await suite.db
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    await storeDepartmentReceipt(departmentId!, { operationDescription: "Restaurante" });
    await configureReceipt(v.cfg, { mode: "auto", printerId: await makePrinter(v.cfg) });
    const mesa4 = await v.table("Mesa 4");
    const mesa5 = await v.table("Mesa 5");
    const { partyId, tabId } = await seat(v, mesa4);
    await join(v, partyId, mesa5);
    if (name !== undefined) await nameParty(v, partyId, name);
    await orderForParty(v, partyId, ["Burger"], tabId);

    await pay(v, tabId, "12.00");

    const receipts = (await printJobsFor(v.cfg))
      .map((job) => decodeTicket(new Uint8Array(job.payload)))
      .filter((text) => text.includes("TOTAL"));
    expect(receipts).toHaveLength(1);
    return receipts[0]!;
  }

  it("prints a named party's name and all its tables", async () => {
    expect(await receiptOfJoinedParty("Ana")).toMatch(/^Ana · Mesa 4, 5 +Pedido \d+$/mu);
  });

  it("prints an unnamed party's tables alone", async () => {
    const receipt = await receiptOfJoinedParty();
    expect(receipt).toMatch(/^Mesa 4, 5 +Pedido \d+$/mu);
    expect(receipt).not.toContain("· Mesa 4, 5");
  });

  it("names a party's bill by its own label once the party holds no table", async () => {
    const v = await setupPartyVenue(suite.db);
    const mesa4 = await v.table("Mesa 4");
    const { partyId, tabId } = await seat(v, mesa4);
    await nameParty(v, partyId, "Ana");
    await orderForParty(v, partyId, ["Burger", "Vino"], tabId);
    const checkId = await split(v, partyId, tabId, [2]);
    await inTx(v, (tx) =>
      tx.update(partyTables).set({ leftAt: nowIso() }).where(eq(partyTables.partyId, partyId)),
    );

    const { orderLabel } = await inTx(v, (tx) => readReceiptOrder(tx, v.cfg, checkId));

    expect(orderLabel).toBe("Mesa 4");
  });

  it("still names a counter order's delivery table", async () => {
    const v = await setupPartyVenue(suite.db);
    const terraza = await v.table("Terraza 2");
    const orderId = randomUUID();
    await inTx(v, (tx) =>
      createOpenOrder(tx, v.cfg, orderId, [], null, { deliveryTableId: terraza }),
    );

    const { orderLabel } = await inTx(v, (tx) => readReceiptOrder(tx, v.cfg, orderId));

    expect(orderLabel).toBe("Terraza 2");
  });
});

describe("a party's receipt prints its guests and the amount per person", () => {
  /** The receipt printed when a party seated with `guests` pays one Burger at 12,00 €. */
  async function receiptOfParty(guests: number | null): Promise<string> {
    const v = await setupPartyVenue(suite.db);
    const [{ departmentId }] = await suite.db
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, v.tables.zoneId));
    await storeDepartmentReceipt(departmentId!, { operationDescription: "Restaurante" });
    await configureReceipt(v.cfg, { mode: "auto", printerId: await makePrinter(v.cfg) });
    const { partyId, tabId } = await seat(v, await v.table("Mesa 12"), guests);
    await orderForParty(v, partyId, ["Burger"], tabId);

    await pay(v, tabId, "12.00");

    const receipts = (await printJobsFor(v.cfg))
      .map((job) => decodeTicket(new Uint8Array(job.payload)))
      .filter((text) => text.includes("TOTAL"));
    expect(receipts).toHaveLength(1);
    return receipts[0]!;
  }

  it("prints a party of 4's guests and its share of 12,00 €", async () => {
    const receipt = await receiptOfParty(4);
    expect(receipt).toContain("4 comensales · por persona");
    expect(receipt).toContain("3,00 €");
  });

  it("prints no guests for a party seated with no count", async () => {
    expect(await receiptOfParty(null)).not.toContain("comensal");
  });

  /**
   * A party of 4 that paid one Burger at 12,00 € in a department printing on request, whose sale
   * holds `stored` as its receipt's guests.
   */
  async function partyWithStoredGuests(stored: number | null) {
    const v = await setupPartyVenue(suite.db);
    const printerId = await makePrinter(v.cfg);
    await configureReceipt(v.cfg, { mode: "on_request", printerId });
    const { partyId, tabId } = await seat(v, await v.table("Mesa 13"), 4);
    await orderForParty(v, partyId, ["Burger"], tabId);
    await pay(v, tabId, "12.00", stored);
    const deps = { db: v.db, backend: v.backend };
    /** Each receipt printed since the last call. */
    let seen = 0;
    const newReceipts = async () => {
      const jobs = await inTx(v, (tx) =>
        tx
          .select({ payload: printJobs.payload })
          .from(printJobs)
          .where(eq(printJobs.printerId, printerId))
          .orderBy(sql`rowid`),
      );
      const all = jobs
        .map((job) => decodeTicket(new Uint8Array(job.payload)))
        .filter((text) => text.includes("TOTAL"));
      const fresh = all.slice(seen);
      seen = all.length;
      return fresh;
    };
    const changeCountTo = async (guestCount: number) => {
      const expectedPartyRevision = await revisionOf(v, partyId);
      await inTx(v, (tx) => setPartyGuests(tx, { partyId, guestCount, expectedPartyRevision }));
    };
    return {
      newReceipts,
      changeCountTo,
      print: () => printSaleReceipt(deps, v.cfg, tabId, false),
      reprint: () => reprintSale(deps, v.cfg, tabId),
    };
  }

  it("prints the stored guests on Print receipt and every Reprint, whatever the party's count becomes", async () => {
    const sale = await partyWithStoredGuests(5);
    expect(await sale.newReceipts()).toEqual([]);

    await sale.print();
    const [original] = await sale.newReceipts();
    expect(original).toContain("5 comensales · por persona");
    expect(original).toContain("2,40 €");
    expect(original).not.toContain("DUPLICADO");

    await sale.reprint();
    const [copy] = await sale.newReceipts();
    expect(copy).toContain("5 comensales · por persona");
    expect(copy).toContain("2,40 €");
    expect(copy).toContain("DUPLICADO");

    await sale.changeCountTo(6);
    await sale.reprint();
    const [later] = await sale.newReceipts();
    expect(later).toContain("5 comensales · por persona");
    expect(later).toContain("2,40 €");
  });

  it("prints no guests on Print receipt or Reprint when the stored row says none", async () => {
    const sale = await partyWithStoredGuests(null);

    await sale.print();
    await sale.reprint();
    const receipts = await sale.newReceipts();
    expect(receipts).toHaveLength(2);
    for (const receipt of receipts) expect(receipt).not.toContain("comensal");
  });

  /**
   * A venue printing automatically, and a way to seat a party of 4 at a new table that pays one
   * Burger at 12,00 € in cash, sending `chosen` as its guests unless it is left out.
   */
  async function partiesPaying() {
    const v = await setupPartyVenue(suite.db);
    const printerId = await makePrinter(v.cfg);
    await configureReceipt(v.cfg, { mode: "auto", printerId });
    const deps = { db: v.db, backend: v.backend };
    const pays = async (table: string, ...chosen: [] | [number | null]) => {
      const { partyId, tabId } = await seat(v, await v.table(table), 4);
      await orderForParty(v, partyId, ["Burger"], tabId);
      await pay(v, tabId, "12.00", ...chosen);
      const [sale] = await inTx(v, (tx) =>
        tx.select({ id: sales.id }).from(sales).where(eq(sales.workingOrderId, tabId)),
      );
      const saleId = sale!.id;
      return {
        partyId,
        saleId,
        /** Every receipt of this sale printed so far, oldest first. */
        receipts: async () =>
          (
            await inTx(v, (tx) =>
              tx
                .select({ payload: printJobs.payload })
                .from(printJobs)
                .where(eq(printJobs.saleId, saleId))
                .orderBy(sql`rowid`),
            )
          )
            .map((job) => decodeTicket(new Uint8Array(job.payload)))
            .filter((text) => text.includes("TOTAL")),
        stored: () =>
          inTx(v, (tx) =>
            tx
              .select({ guests: saleReceiptGuests.guests })
              .from(saleReceiptGuests)
              .where(eq(saleReceiptGuests.saleId, saleId)),
          ),
        guestCount: async () => (await partyRow(v, partyId)).guestCount,
        changeCountTo: async (guestCount: number) => {
          const expectedPartyRevision = await revisionOf(v, partyId);
          await inTx(v, (tx) => setPartyGuests(tx, { partyId, guestCount, expectedPartyRevision }));
        },
        reprint: () => reprintSale(deps, v.cfg, tabId),
      };
    };
    return { v, pays };
  }

  /** A sale's `sales` and `registros_facturacion` rows, less ids, numbers, times and chain links. */
  function filedFacts(v: { db: typeof suite.db }, saleId: string) {
    const strip = (row: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)));
    const [sale] = v.db.all<Record<string, unknown>>(sql`select * from sales where id = ${saleId}`);
    const [registro] = v.db.all<Record<string, unknown>>(
      sql`select * from registros_facturacion where sale_id = ${saleId}`,
    );
    return {
      sale: strip(sale!, ["id", "working_order_id", "invoice_number", "issued_at"]),
      registro: strip(registro!, [
        "id",
        "sale_id",
        "secuencia",
        "num_serie_factura",
        "fecha_hora_huso_gen_registro",
        "creado_en",
        "primer_registro",
        "anterior_id_emisor_factura",
        "anterior_num_serie_factura",
        "anterior_fecha_expedicion_factura",
        "anterior_huella",
        "huella",
      ]),
    };
  }

  it("prints the guests chosen at payment, files the same as without them, and repeats them on a Reprint", async () => {
    const { v, pays } = await partiesPaying();
    const chosen = await pays("Mesa 14", 5);
    const [original] = await chosen.receipts();
    expect(original).toContain("5 comensales · por persona");
    expect(original).toContain("2,40 €");
    expect(await chosen.guestCount()).toBe(4);

    const plain = await pays("Mesa 15");
    expect(filedFacts(v, chosen.saleId)).toEqual(filedFacts(v, plain.saleId));

    await chosen.changeCountTo(6);
    await chosen.reprint();
    const [, copy] = await chosen.receipts();
    expect(copy).toContain("5 comensales");
    expect(copy).toContain("DUPLICADO");
  });

  it("stores the party's count whether the field is sent as it was or not at all, and a later Reprint repeats it", async () => {
    const { pays } = await partiesPaying();
    const asItWas = await pays("Mesa 16", 4);
    const unsent = await pays("Mesa 17");
    expect(await asItWas.stored()).toEqual([{ guests: 4 }]);
    expect(await unsent.stored()).toEqual([{ guests: 4 }]);

    for (const sale of [asItWas, unsent]) {
      await sale.changeCountTo(6);
      await sale.reprint();
      const [, copy] = await sale.receipts();
      expect(copy).toContain("4 comensales · por persona");
      expect(copy).toContain("DUPLICADO");
    }
  });
});

describe("the receipt's top block: logo, address, phone and email", () => {
  const LOGO = `${"a".repeat(64)}.png`;
  /** 16 × 2 dots: a printable raster for either paper. */
  const LOGO_BITS = [0xff, 0x00, 0x0f, 0xf0];
  const logoRaster = {
    widthDots: 16,
    heightDots: 2,
    data: Buffer.from(LOGO_BITS).toString("base64"),
  };

  async function storeReceipt(
    receipt: Record<string, unknown> & { logoRasters?: ReceiptLogoRasters },
  ): Promise<void> {
    await withTransaction(suite.db, async (tx) => {
      await tx
        .insert(tenantReceipts)
        .values({
          receipt: { phone: "910999999", footerMessage: "Global decoration", printAddress: true },
        })
        .onConflictDoUpdate({
          target: tenantReceipts.id,
          set: {
            receipt: { phone: "910999999", footerMessage: "Global decoration", printAddress: true },
          },
        });
      const { logoRasters, ...decoration } = receipt;
      const authored = { operationDescription: "Venta en establecimiento", ...decoration };
      const rows = await tx.select({ id: departments.id }).from(departments);
      for (const row of rows)
        await tx
          .insert(departmentReceipts)
          .values({ departmentId: row.id, receipt: authored, logoRasters: logoRasters ?? null })
          .onConflictDoUpdate({
            target: departmentReceipts.departmentId,
            set: { receipt: authored, logoRasters: logoRasters ?? null },
          });
    });
  }

  async function sellOne(cfg: DeviceRequestConfig, each: { menuItemId: string }, zoneId: string) {
    return recordTillSale(
      deps(),
      cfg,
      {
        zoneId,
        lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        tender: { method: "card", amount: "1.50" },
      },
      OPERATOR,
    );
  }

  /** The receipt jobs' payloads, oldest first. */
  async function receiptPayloads(cfg: DeviceRequestConfig): Promise<Uint8Array[]> {
    return (await printJobsFor(cfg))
      .map((job) => new Uint8Array(job.payload))
      .filter((payload) => decodeTicket(payload).includes("VERI*FACTU"));
  }

  /** The pictures a payload prints that are not a drawn line of text, as width, height and bits. */
  function pictures(payload: Uint8Array): [number, number, number[]][] {
    return printedCommands(payload)
      .filter((command) => command.widthDots !== undefined && command.text === undefined)
      .map((command) => [command.widthDots!, command.heightDots!, [...command.bytes.subarray(8)]]);
  }

  /** The centred lines from the legal name to the rule that ends the block, trimmed. */
  function topBlock(payload: Uint8Array): string[] {
    const lines = printedLines(payload).map((line) => line.trim());
    const name = lines.indexOf("Deli Recibos SL");
    expect(name).toBeGreaterThanOrEqual(0);
    return lines.slice(
      name,
      lines.findIndex((line, at) => at > name && /^-+$/.test(line)),
    );
  }

  it("prints the stored logo for the printer's paper, then the location's address, phone and email", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });
    await storeReceipt({
      printAddress: true,
      logo: LOGO,
      phone: "+34 910 000 000",
      email: "hola@deli.test",
      logoRasters: {
        "58mm": { widthDots: 8, heightDots: 1, data: Buffer.from([0x81]).toString("base64") },
        "80mm": logoRaster,
      },
    });

    await sellOne(cfg, each, zoneId);
    const [payload] = await receiptPayloads(cfg);
    // The QR first, then the 80 mm logo.
    expect(pictures(payload!).slice(1)).toEqual([[16, 2, LOGO_BITS]]);
    const taxId = (await withTransaction(suite.db, (tx) => readTenant(tx)))!.taxId;
    expect(topBlock(payload!)).toEqual([
      "Deli Recibos SL",
      `NIF: ${taxId}`,
      "Calle Mayor 1",
      "28013 Madrid",
      "Tel. +34 910 000 000",
      "hola@deli.test",
    ]);
  });

  it("a photo replacement refreshes both papers and retained department logos while queued receipt bytes stay fixed", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "auto", printerId: await makePrinter(cfg) });
    await suite.db.insert(departments).values({
      locationId: cfg.locationId,
      name: "Retained logo department",
      tradingName: "Retained",
      active: false,
    });
    const [languages] = await suite.db.select().from(contentLanguages);
    expect(languages).toBeDefined();
    const language = languages!.defaultLanguage;
    async function solid(background: string) {
      const bytes = await sharp({ create: { width: 800, height: 200, channels: 3, background } })
        .png()
        .toBuffer();
      return prepareImage(new Uint8Array(bytes), { maxUploadBytes: 20 * 1024 * 1024 });
    }
    const white = await solid("white");
    const black = await solid("black");
    const { image } = await withTransaction(suite.db, (tx) =>
      uploadImage(tx, { image: white, names: { [language]: "Logo" } }),
    );
    const whiteRasters = await drawLogoRasters(white.bytes);
    await storeReceipt({ logo: image.filename, phone: "910111111", logoRasters: whiteRasters });
    const first = await sellOne(cfg, each, zoneId);
    const answer = structuredClone(first);
    const queued = await printJobsFor(cfg);
    const saved = await suite.db
      .select({
        departmentId: departmentReceipts.departmentId,
        receipt: departmentReceipts.receipt,
      })
      .from(departmentReceipts);
    const policies = await suite.db.select().from(departmentSalePolicies);
    const framing = { x: 7500, y: 5000, zoom: 200 };
    const blackRasters = await drawLogoRasters(
      await renderRendition(black.bytes, "display", framing),
    );
    await withTransaction(suite.db, (tx) =>
      saveImage(
        tx,
        image.id,
        { names: image.names, framing, expectedRevision: image.revision },
        black,
        blackRasters,
        language,
      ),
    );
    expect(
      await suite.db
        .select({
          departmentId: departmentReceipts.departmentId,
          receipt: departmentReceipts.receipt,
        })
        .from(departmentReceipts),
    ).toEqual(saved);
    expect(await suite.db.select().from(departmentSalePolicies)).toEqual(policies);
    const retained = await suite.db.select().from(departmentReceipts);
    expect(retained.length).toBeGreaterThanOrEqual(2);
    for (const row of retained)
      for (const paper of ["58mm", "80mm"] as const) {
        expect(row.logoRasters![paper]).not.toEqual(whiteRasters[paper]);
        expect(new Set(Buffer.from(row.logoRasters![paper].data, "base64"))).toEqual(
          new Set([255]),
        );
      }
    expect(await printJobsFor(cfg)).toEqual(queued);
    const second = await sellOne(cfg, each, zoneId);
    const payloads = await receiptPayloads(cfg);
    expect(payloads).toHaveLength(2);
    expect(new Set(pictures(payloads[0]!).at(-1)![2])).toEqual(new Set([0]));
    expect(new Set(pictures(payloads[1]!).at(-1)![2])).toEqual(new Set([255]));
    expect(first.receiptTrim).toMatchObject({
      logo: image.filename,
      logoUrl: `/media/renditions/v1/${white.filename}/display/5000-5000-100.webp`,
    });
    expect(second.receiptTrim).toMatchObject({
      logo: image.filename,
      logoUrl: `/media/renditions/v1/${black.filename}/display/7500-5000-200.webp`,
    });
    expect(first).toEqual(answer);
  });

  it("prints no address when the receipt switches it off", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "auto", printerId: await makePrinter(cfg) });
    await storeReceipt({ printAddress: false });

    await sellOne(cfg, each, zoneId);
    const [payload] = await receiptPayloads(cfg);
    const taxId = (await withTransaction(suite.db, (tx) => readTenant(tx)))!.taxId;
    expect(topBlock(payload!)).toEqual(["Deli Recibos SL", `NIF: ${taxId}`]);
  });

  it.each([
    // Three bytes for a 16 × 2 picture, which needs four: the printer command would refuse it.
    ["three bytes for a picture that needs four", "////"],
    ["ten million characters of data", "A".repeat(10_000_000)],
  ])("files and prints the sale without a logo when the stored picture has %s", async (_, data) => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "auto", printerId: await makePrinter(cfg) });
    await storeReceipt({
      printAddress: true,
      logo: LOGO,
      logoRasters: { "58mm": logoRaster, "80mm": { ...logoRaster, data } },
    });

    const result = await sellOne(cfg, each, zoneId);
    expect(result.total).toBe("1.50");
    expect(await registroCount(cfg)).toBe(1);
    const [payload] = await receiptPayloads(cfg);
    expect(pictures(payload!)).toHaveLength(1);
    expect(topBlock(payload!)).toContain("Calle Mayor 1");
  });

  it.each([
    ["a number for the slogan", { headerSubtitle: 5 }],
    ["a number for the phone", { phone: 5 }],
    ["an object for the email", { email: {} }],
    ["a list for the footer", { footerMessage: [] }],
    ["a word for the address switch, which omits the address", { printAddress: "no" }],
  ])("files and prints the sale without a trim field stored as %s", async (_, trim) => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "auto", printerId: await makePrinter(cfg) });
    await storeReceipt(trim);

    const result = await sellOne(cfg, each, zoneId);
    expect(result.total).toBe("1.50");
    expect(await registroCount(cfg)).toBe(1);
    const [payload] = await receiptPayloads(cfg);
    const taxId = (await withTransaction(suite.db, (tx) => readTenant(tx)))!.taxId;
    expect(topBlock(payload!)).toEqual(["Deli Recibos SL", `NIF: ${taxId}`]);
    // The footer prints after the tender line.
    const lines = printedLines(payload!).map((line) => line.trim());
    expect(lines.slice(lines.indexOf("Tarjeta") + 1).filter(Boolean)).toEqual([]);
  });

  it("reprints with the trim saved since, as it does the slogan", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "auto", printerId: await makePrinter(cfg) });
    const filed = await sellOne(cfg, each, zoneId);
    const saleId = await onlySaleId(cfg);
    await storeReceipt({
      logo: LOGO,
      phone: "910000000",
      printAddress: false,
      logoRasters: { "58mm": logoRaster, "80mm": logoRaster },
    });

    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, filed, saleId));
    const [original, reprint] = await receiptPayloads(cfg);
    expect(pictures(original!)).toHaveLength(1);
    expect(topBlock(original!)).not.toContain("Calle Mayor 1");
    expect(pictures(reprint!).slice(1)).toEqual([[16, 2, LOGO_BITS]]);
    expect(topBlock(reprint!)).toContain("Tel. 910000000");
    expect(topBlock(reprint!)).not.toContain("Calle Mayor 1");
  });
});

describe("automatic F1 receipt delivery enrollment", () => {
  async function issued(
    mode: "auto" | "on_request",
    attributed = true,
    full = true,
    beforeCommit?: (
      tx: Transaction,
      value: {
        cfg: DeviceRequestConfig;
        ticket: Awaited<ReturnType<typeof readSettledTicket>>;
        saleId: string;
      },
    ) => Promise<void>,
  ) {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode, printerId });
    return withTransaction(suite.db, async (tx) => {
      await tx.update(tenants).set({ taxpayerDomicile: "Calle Fiscal 8, Madrid" });
      const [operator] = await tx.select({ id: persons.id }).from(persons);
      const [series] = await tx
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.purpose, full ? "full" : "standard"));
      const orderId = randomUUID();
      await createOpenOrder(
        tx,
        cfg,
        orderId,
        [{ menuItemId: each.menuItemId, quantity: "1" }],
        null,
        { zoneId },
      );
      const sale = await recordSale(tx, backend, {
        origin: cfg.origin,
        nodeId: cfg.nodeId,
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
        ...(attributed ? { operatorId: operator!.id } : {}),
      });
      const ticket = await readSettledTicket(backend, tx, cfg, orderId);
      await beforeCommit?.(tx, { cfg, ticket, saleId: sale.saleId });
      return {
        cfg,
        printerId,
        saleId: sale.saleId,
        orderId,
        zoneId,
        ticket,
        personId: operator!.id,
      };
    });
  }

  it("propagates an engine rollback and reports no successful optional rollback", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(
        issued("auto", true, true, async (tx, value) => {
          await tx.execute(
            sql`create trigger test_engine_receipt_rollback before insert on invoice_deliveries begin select raise(rollback, 'engine transaction invalidated'); end`,
          );
          await enqueueSaleReceipt(tx, value.cfg, value.ticket, value.saleId);
        }),
      ).rejects.toThrow(/no transaction is active|no such savepoint/u);
      expect(warning.mock.calls).toEqual([]);
      expect(await suite.db.select().from(sales)).toEqual([]);
      expect(await suite.db.select().from(printJobs)).toEqual([]);
      expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
      expect(await suite.db.select().from(registrosFacturacion)).toEqual([]);
      expect(
        (
          await suite.db.execute(
            sql`select name from sqlite_schema where name = 'test_engine_receipt_rollback'`,
          )
        ).rows,
      ).toEqual([]);
    } finally {
      warning.mockRestore();
    }
  });

  it("returns an explicit copy failure without rewriting an already-issued invoice", async () => {
    const { cfg, saleId, ticket } = await issued("auto");
    const before = await suite.db.select().from(sales);
    const fiscalBefore = await suite.db.select().from(registrosFacturacion);
    const formatter = vi.spyOn(receiptTicket, "formatReceipt").mockImplementationOnce(() => {
      throw new Error("explicit print failure");
    });
    try {
      await expect(
        withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, saleId)),
      ).rejects.toThrow("explicit print failure");
      expect(await suite.db.select().from(sales)).toEqual(before);
      expect(await suite.db.select().from(registrosFacturacion)).toEqual(fiscalBefore);
      expect(await suite.db.select().from(printJobs)).toEqual([]);
      expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
    } finally {
      formatter.mockRestore();
    }
    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, saleId));
    expect(await suite.db.select().from(printJobs)).toEqual([
      expect.objectContaining({ saleId, receiptCopy: true }),
    ]);
    expect(await suite.db.select().from(sales)).toEqual(before);
  });

  it("omits a refused staged delivery reservation inside an invoice transaction", async () => {
    const { cfg } = await issued("auto", true, true, async (tx, value) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, value.saleId));
      await tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.test",
            personId: sale!.operatorId!,
          },
        })
        .where(eq(workingOrders.id, sale!.workingOrderId!));
      await tx.execute(
        sql`create trigger test_staged_delivery_refusal before insert on invoice_deliveries when new.medium = 'email' begin select raise(abort, 'optional staged refusal'); end`,
      );
      try {
        expect(await reserveStagedInvoiceDelivery(tx, value.saleId)).toBeUndefined();
        await enqueueSaleReceipt(tx, value.cfg, value.ticket, value.saleId);
        await tx.update(tenants).set({ legalName: "Staged refusal did not abort invoice" });
      } finally {
        await tx.execute(sql`drop trigger test_staged_delivery_refusal`);
      }
    });
    expect(await registroCount(cfg)).toBe(1);
    expect(await suite.db.select().from(sales)).toHaveLength(1);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
    expect(await suite.db.select().from(printJobs)).toEqual([]);
    expect((await readTenant(suite.db))!.legalName).toBe("Staged refusal did not abort invoice");
  });

  it("rolls back a partial automatic document on a delivery refusal while committing the invoice", async () => {
    const { cfg, saleId, ticket } = await issued("auto", true, true, async (tx, value) => {
      await VENUE_SERVICE.recordSaleReceiptHeader(tx, value.cfg, value.saleId, null);
      await tx.execute(
        sql`create trigger test_receipt_delivery_refusal before insert on invoice_deliveries begin select raise(abort, 'optional receipt refusal'); end`,
      );
      try {
        await enqueueSaleReceipt(tx, value.cfg, value.ticket, value.saleId);
        await tx.update(tenants).set({ legalName: "Outer write remains usable" });
      } finally {
        await tx.execute(sql`drop trigger test_receipt_delivery_refusal`);
      }
    });
    expect(await registroCount(cfg)).toBe(1);
    expect(await suite.db.select().from(sales)).toHaveLength(1);
    expect(await suite.db.select().from(saleReceiptHeaders)).toHaveLength(1);
    expect(await suite.db.select().from(printJobs)).toEqual([]);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
    expect((await readTenant(suite.db))!.legalName).toBe("Outer write remains usable");
    await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
    const jobs = await suite.db.select().from(printJobs);
    expect(jobs).toHaveLength(1);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
      expect.objectContaining({ saleId, medium: "receipt", printJobId: jobs[0]!.id }),
    ]);
    expect(await registroCount(cfg)).toBe(1);
  });

  it.each(["absent", "null"] as const)(
    "omits optional decoration with an %s department header",
    async (kind) => {
      const { cfg, saleId, ticket } = await issued("auto");
      await suite.db.insert(tenantReceipts).values({
        receipt: {
          headerSubtitle: "Venue subtitle",
          footerMessage: "Venue footer",
          phone: "910000000",
          email: "venue@example.test",
        },
      });
      const [department] = await suite.db.select().from(departments);
      await storeDepartmentReceipt(department!.id, {
        headerSubtitle: { "es-ES": "Default department text" },
        email: "default@example.test",
      });
      if (kind === "null")
        await suite.db.insert(saleReceiptHeaders).values({
          saleId,
          departmentId: null,
          tradingName: "Inconsistent brand",
          printTradingName: true,
        });
      await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, saleId));
      const jobs = await suite.db.select().from(printJobs);
      expect(jobs).toHaveLength(1);
      const text = decodeTicket(jobs[0]!.payload);
      expect(text).not.toContain("Venue subtitle");
      expect(text).not.toContain("Venue footer");
      expect(text).not.toContain("910000000");
      expect(text).not.toContain("venue@example.test");
      expect(text).not.toContain("Default department text");
      expect(text).not.toContain("default@example.test");
      expect(text).not.toContain("Inconsistent brand");
      expect(await registroCount(cfg)).toBe(1);
    },
  );

  it.each(["auto", "on_request"] as const)(
    "enrolls the automatic original with its recorded issuer under %s policy",
    async (mode) => {
      const { cfg, printerId, saleId, ticket, personId } = await issued(mode);
      const invoices = await suite.db.select().from(sales);
      const fiscal = await suite.db.select().from(registrosFacturacion);
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      const jobs = await suite.db.select().from(printJobs);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ saleId, printerId, receiptCopy: false, kind: "document" });
      expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
        expect.objectContaining({
          saleId,
          printJobId: jobs[0]!.id,
          personId,
          medium: "receipt",
          designation: "original",
          status: "queued",
          generation: 1,
        }),
      ]);
      expect(decodeTicket(new Uint8Array(jobs[0]!.payload))).not.toContain("DUPLICADO");
      expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(await suite.db.select().from(printJobs)).toEqual(jobs);
      expect(await suite.db.select().from(invoiceDeliveries)).toHaveLength(1);
      expect(await suite.db.select().from(sales)).toEqual(invoices);
      expect(await suite.db.select().from(registrosFacturacion)).toEqual(fiscal);
      expect(await suite.db.select().from(drawerOpens)).toEqual([]);
    },
  );

  it.each(["email", "a4"] as const)(
    "queues the saved %s original without a receipt and replays its reservation after completion",
    async (medium) => {
      const { cfg, saleId, orderId, ticket, personId } = await issued("auto");
      const pagePrinterId = randomUUID();
      await withTransaction(suite.db, async (tx) => {
        await tx.insert(pagePrinters).values({
          id: pagePrinterId,
          locationId: cfg.locationId,
          name: "Invoice A4",
          host: "127.0.0.1",
          port: 631,
          resourcePath: "/ipp/print",
          documentFormat: "application/pdf",
          supportedFormats: ["application/pdf"],
          media: "iso_a4_210x297mm",
          resolutionDpi: 300,
        });
        await tx
          .update(workingOrders)
          .set({
            invoiceDelivery:
              medium === "email"
                ? { medium, recipient: "customer@example.test", personId }
                : { medium, pagePrinterId, personId },
          })
          .where(eq(workingOrders.id, orderId));
      });
      const invoices = await suite.db.select().from(sales);
      const fiscal = await suite.db.select().from(registrosFacturacion);
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      const deliveries = await suite.db.select().from(invoiceDeliveries);
      expect(deliveries).toEqual([
        expect.objectContaining({
          saleId,
          medium,
          personId,
          designation: "original",
          status: "queued",
          generation: 1,
          printJobId: null,
          ...(medium === "email"
            ? { recipient: "customer@example.test", pagePrinterId: null }
            : { recipient: null, pagePrinterId }),
        }),
      ]);
      expect(await suite.db.select().from(printJobs)).toEqual([]);
      expect(await suite.db.select().from(drawerOpens)).toEqual([]);
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(await suite.db.select().from(invoiceDeliveries)).toEqual(deliveries);
      await withTransaction(suite.db, (tx) =>
        tx
          .update(invoiceDeliveries)
          .set({ status: "sent" })
          .where(eq(invoiceDeliveries.id, deliveries[0]!.id)),
      );
      const completed = await suite.db.select().from(invoiceDeliveries);
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(await suite.db.select().from(invoiceDeliveries)).toEqual(completed);
      expect(await suite.db.select().from(printJobs)).toEqual([]);
      expect(await suite.db.select().from(sales)).toEqual(invoices);
      expect(await suite.db.select().from(registrosFacturacion)).toEqual(fiscal);
    },
  );

  it("attributes an unattributed sale's staged email to the staff member who chose it", async () => {
    const { cfg, saleId, orderId, ticket, personId } = await issued("auto", false);
    await withTransaction(suite.db, (tx) =>
      tx
        .update(workingOrders)
        .set({
          invoiceDelivery: { medium: "email", recipient: "customer@example.test", personId },
        })
        .where(eq(workingOrders.id, orderId)),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(warning.mock.calls).toEqual([]);
    } finally {
      warning.mockRestore();
    }
    expect((await suite.db.select().from(sales))[0]!.operatorId).toBeNull();
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
      expect.objectContaining({
        saleId,
        medium: "email",
        recipient: "customer@example.test",
        personId,
        designation: "original",
        status: "queued",
      }),
    ]);
    expect(await suite.db.select().from(printJobs)).toEqual([]);
  });

  it("reports an unattributed staged email that names no staff member as a missing operator", async () => {
    const { cfg, saleId, orderId, ticket } = await issued("auto", false);
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update working_orders set invoice_delivery = ${JSON.stringify({
          medium: "email",
          recipient: "customer@example.test",
        })} where id = ${orderId}`,
      ),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(warning.mock.calls).toEqual([
        [
          "receipt.optional_document_failed",
          {
            operation: "reserveStagedInvoiceDelivery",
            saleId,
            code: "management.request_invalid",
            field: "operatorId",
          },
        ],
      ]);
    } finally {
      warning.mockRestore();
    }
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
  });

  it("attributes an unattributed sale's staged A4 to the staff member who chose it", async () => {
    const { cfg, saleId, orderId, ticket, personId } = await issued("auto", false);
    const pagePrinterId = randomUUID();
    await withTransaction(suite.db, async (tx) => {
      await tx.insert(pagePrinters).values({
        id: pagePrinterId,
        locationId: cfg.locationId,
        name: "Invoice A4",
        host: "127.0.0.1",
        port: 631,
        resourcePath: "/ipp/print",
        documentFormat: "application/pdf",
        supportedFormats: ["application/pdf"],
        media: "iso_a4_210x297mm",
        resolutionDpi: 300,
      });
      const [device] = await tx
        .select({ profileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, cfg.origin.deviceId));
      await listInvoicePrinter(tx, {
        profileId: device!.profileId,
        pagePrinterId,
        isDefault: true,
      });
      await tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "a4", pagePrinterId, personId } })
        .where(eq(workingOrders.id, orderId));
    });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(warning.mock.calls).toEqual([]);
    } finally {
      warning.mockRestore();
    }
    expect((await suite.db.select().from(sales))[0]!.operatorId).toBeNull();
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
      expect.objectContaining({
        saleId,
        medium: "a4",
        pagePrinterId,
        recipient: null,
        personId,
        designation: "original",
        status: "queued",
      }),
    ]);
    expect(await suite.db.select().from(printJobs)).toEqual([]);
  });

  it("reports an unattributed staged A4 that names no staff member as a missing operator", async () => {
    const { cfg, saleId, orderId, ticket } = await issued("auto", false);
    await withTransaction(suite.db, (tx) =>
      tx.execute(
        sql`update working_orders set invoice_delivery = ${JSON.stringify({
          medium: "a4",
          pagePrinterId: randomUUID(),
        })} where id = ${orderId}`,
      ),
    );
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
      expect(warning.mock.calls).toEqual([
        [
          "receipt.optional_document_failed",
          {
            operation: "reserveStagedInvoiceDelivery",
            saleId,
            code: "management.request_invalid",
            field: "operatorId",
          },
        ],
      ]);
    } finally {
      warning.mockRestore();
    }
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
    expect(await suite.db.select().from(printJobs)).toEqual([]);
  });

  it("keeps a prepaid collection ticket separate from an emailed invoice", async () => {
    const { cfg, saleId, orderId, zoneId, ticket, personId } = await issued("auto");
    await withTransaction(suite.db, async (tx) => {
      await tx.execute(sql`update department_sale_policies
        set paid_when = 'prepay', collection_number = 'numbered'
        where department_id = (select department_id from zone_service_policies where zone_id = ${zoneId})`);
      await tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.test",
            personId,
          },
        })
        .where(eq(workingOrders.id, orderId));
      await enqueueSaleReceipt(tx, cfg, ticket, saleId);
    });
    const jobs = await suite.db.select().from(printJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "document", saleId: null });
    const text = decodeTicket(new Uint8Array(jobs[0]!.payload));
    expect(text).toContain(String(ticket.orderNumber));
    expect(text).not.toContain("FACTURA");
    expect(text).not.toContain("TOTAL");
    expect(opensDrawer(new Uint8Array(jobs[0]!.payload))).toBe(false);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
      expect.objectContaining({ saleId, medium: "email", status: "queued" }),
    ]);
  });

  it("keeps a saved receipt choice on the paper-original path", async () => {
    const { cfg, saleId, orderId, ticket } = await issued("on_request");
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(workingOrders)
        .set({ invoiceDelivery: { medium: "receipt" } })
        .where(eq(workingOrders.id, orderId));
      await enqueueSaleReceipt(tx, cfg, ticket, saleId);
    });
    const jobs = await suite.db.select().from(printJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ saleId, receiptCopy: false });
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
      expect.objectContaining({ saleId, medium: "receipt", printJobId: jobs[0]!.id }),
    ]);
  });

  it("does not interpret a synthetic F2's stale email draft as a full-invoice delivery", async () => {
    const { cfg, saleId, orderId, ticket, personId } = await issued("auto", true, false);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(workingOrders)
        .set({
          invoiceDelivery: {
            medium: "email",
            recipient: "customer@example.test",
            personId,
          },
        })
        .where(eq(workingOrders.id, orderId));
      await enqueueSaleReceipt(tx, cfg, ticket, saleId);
    });
    const jobs = await suite.db.select().from(printJobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ saleId, receiptCopy: false });
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
  });

  it("refuses a competing email after an automatic paper original", async () => {
    const { cfg, saleId, ticket, personId } = await issued("auto");
    await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
    await expect(
      withTransaction(suite.db, (tx) =>
        reserveInvoiceDelivery(tx, saleId, {
          requestKey: randomUUID(),
          personId,
          medium: "email",
          recipient: "synthetic@example.test",
        }),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await suite.db.select().from(invoiceDeliveries)).toHaveLength(1);
  });

  it("leaves no paper job when an email original already reserves delivery", async () => {
    const { cfg, saleId, ticket, personId } = await issued("auto");
    await withTransaction(suite.db, (tx) =>
      reserveInvoiceDelivery(tx, saleId, {
        requestKey: randomUUID(),
        personId,
        medium: "email",
        recipient: "synthetic@example.test",
      }),
    );
    await expect(
      withTransaction(suite.db, (tx) =>
        enqueueOriginalReceipt(tx, cfg, ticket, saleId, undefined, personId),
      ),
    ).rejects.toMatchObject({ code: "invoice_delivery.active" });
    expect(await suite.db.select().from(printJobs)).toEqual([]);
    expect(await suite.db.select().from(invoiceDeliveries)).toHaveLength(1);
  });

  it("preserves an unattributed sale's paper original without inventing a staff identity", async () => {
    const { cfg, saleId, ticket } = await issued("on_request", false);
    await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
    expect(await suite.db.select().from(printJobs)).toEqual([
      expect.objectContaining({ saleId, receiptCopy: false }),
    ]);
    const [job] = await suite.db.select().from(printJobs);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([
      expect.objectContaining({ saleId, printJobId: job!.id, personId: null, status: "queued" }),
    ]);
    expect((await suite.db.select().from(sales))[0]!.operatorId).toBeNull();
    await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
    expect(await suite.db.select().from(printJobs)).toHaveLength(1);
    expect(await suite.db.select().from(invoiceDeliveries)).toHaveLength(1);
  });

  it("queues no delivery for an automatic original without an active receipt printer", async () => {
    const { cfg, printerId, saleId, ticket } = await issued("auto");
    await withTransaction(suite.db, (tx) => deactivatePrinter(tx, printCfg(cfg), printerId));
    await withTransaction(suite.db, (tx) => enqueueSaleReceipt(tx, cfg, ticket, saleId));
    expect(await suite.db.select().from(printJobs)).toEqual([]);
    expect(await suite.db.select().from(invoiceDeliveries)).toEqual([]);
  });
});

describe("department receipt presentation on thermal jobs", () => {
  async function setupReceipt() {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { printerId });
    const [{ departmentId }] = await suite.db
      .select({ departmentId: zoneServicePolicies.departmentId })
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, zoneId));
    await suite.db.insert(tenantReceipts).values({
      receipt: {
        headerSubtitle: "Venue subtitle",
        footerMessage: "Venue footer",
        phone: "910000000",
        email: "venue@example.test",
      },
    });
    await suite.db
      .update(departments)
      .set({ tradingName: "Recorded brand" })
      .where(eq(departments.id, departmentId!));
    await suite.db
      .update(departmentSalePolicies)
      .set({ printTradingName: true })
      .where(eq(departmentSalePolicies.departmentId, departmentId!));
    const sell = () =>
      recordTillSale(
        deps(),
        cfg,
        {
          zoneId,
          lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
          tender: { method: "cash" as const, amount: "1.50" },
        },
        OPERATOR,
      );
    const documents = async () =>
      (await suite.db.select().from(printJobs)).filter(
        (job) => job.saleId !== null && job.kind === "document",
      );
    return { cfg, departmentId: departmentId!, zoneId, sell, documents };
  }

  it.each(["58mm", "80mm"] as const)(
    "uses the current department logo on %s and omits it after clearing",
    async (paperWidth) => {
      const { cfg, departmentId, sell, documents } = await setupReceipt();
      await suite.db
        .update(printers)
        .set({ paperWidth })
        .where(eq(printers.locationId, cfg.locationId));
      const venuePair = {
        "58mm": { widthDots: 8, heightDots: 1, data: "gQ==" },
        "80mm": { widthDots: 16, heightDots: 1, data: "gf8=" },
      };
      const ownPair = {
        "58mm": { widthDots: 16, heightDots: 1, data: "//8=" },
        "80mm": { widthDots: 24, heightDots: 1, data: "////" },
      };
      await suite.db
        .update(tenantReceipts)
        .set({ receipt: { logo: `${"a".repeat(64)}.png`, logoRasters: venuePair } });
      await storeDepartmentReceipt(departmentId, { logo: `${"b".repeat(64)}.png` }, ownPair);
      const ticket = await sell();
      const saleId = await onlySaleId(cfg);
      await suite.db
        .update(departmentReceipts)
        .set({ receipt: {}, logoRasters: null })
        .where(eq(departmentReceipts.departmentId, departmentId));
      await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, saleId));
      const logoBytes = (await documents()).map((job) =>
        printedCommands(job.payload)
          .filter((c) => c.name === "GS v 0" && c.text === undefined)
          .slice(1)
          .map((c) => [...c.bytes.subarray(8)]),
      );
      expect(logoBytes).toEqual(
        paperWidth === "58mm" ? [[[255, 255]], []] : [[[255, 255, 255]], []],
      );
      expect(await registroCount(cfg)).toBe(1);
    },
  );

  it("omits a corrupt explicit department picture without substituting the venue logo", async () => {
    const { cfg, departmentId, sell, documents } = await setupReceipt();
    const pair = {
      "58mm": { widthDots: 8, heightDots: 1, data: "gQ==" },
      "80mm": { widthDots: 8, heightDots: 1, data: "gQ==" },
    };
    await suite.db
      .update(tenantReceipts)
      .set({ receipt: { logo: `${"a".repeat(64)}.png`, logoRasters: pair } });
    await storeDepartmentReceipt(departmentId, {
      logo: `${"b".repeat(64)}.png`,
      headerSubtitle: { "es-ES": "Retained own text" },
    });
    await suite.db.execute(
      sql`update department_receipts set logo_rasters = ${JSON.stringify({ "58mm": { widthDots: 999999, heightDots: 1, data: "bad" }, "80mm": { widthDots: 8, heightDots: 1, data: "bad" } })} where department_id = ${departmentId}`,
    );
    await sell();
    const [job] = await documents();
    expect(decodeTicket(job!.payload)).toContain("Retained own text");
    const logos = printedCommands(job!.payload)
      .filter((c) => c.name === "GS v 0" && c.text === undefined)
      .slice(1);
    expect(logos.map((c) => [...c.bytes.subarray(8)])).toEqual([]);
    expect(await registroCount(cfg)).toBe(1);
    expect(await suite.db.select().from(tenders)).toHaveLength(1);
  });

  it("lets a mandatory drawer refusal roll back the sale", async () => {
    const { sell } = await setupReceipt();
    await suite.db.execute(
      sql`create trigger test_mandatory_drawer_refusal before insert on drawer_opens begin select raise(abort, 'mandatory drawer refusal'); end`,
    );
    try {
      await expect(sell()).rejects.toThrow("mandatory drawer refusal");
      expect(await suite.db.select().from(sales)).toEqual([]);
      expect(await suite.db.select().from(tenders)).toEqual([]);
      expect(await suite.db.select().from(saleReceiptHeaders)).toEqual([]);
      expect(await suite.db.select().from(printJobs)).toEqual([]);
      expect(await suite.db.select().from(registrosFacturacion)).toEqual([]);
    } finally {
      await suite.db.execute(sql`drop trigger test_mandatory_drawer_refusal`);
    }
  });

  it.each(["venue", "department"] as const)(
    "omits a failed %s optional read with bounded diagnostic and surviving fields",
    async (source) => {
      const { cfg, departmentId, sell, documents } = await setupReceipt();
      await storeDepartmentReceipt(departmentId, {
        headerSubtitle: { "es-ES": "Own subtitle" },
        email: "own@example.test",
      });
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      let mandatoryRead: MockInstance | undefined;
      if (source === "venue")
        await suite.db.execute(sql`alter table tenant_receipts rename to test_hidden_receipts`);
      else {
        const read = VENUE_SERVICE.readDepartmentReceipt;
        mandatoryRead = vi
          .spyOn(VENUE_SERVICE, "readDepartmentReceipt")
          .mockImplementationOnce(async (tx, scope, id) => {
            const receipt = await read(tx, scope, id);
            expect(receipt.operationDescription).toBe("Venta en establecimiento");
            await tx.execute(
              sql`alter table department_receipts rename to test_hidden_department_receipts`,
            );
            return receipt;
          });
      }
      try {
        const ticket = await sell();
        expect(ticket.total).toBe("1.50");
        const jobs = await documents();
        expect(jobs).toHaveLength(1);
        const text = decodeTicket(jobs[0]!.payload);
        expect(text.includes("Own subtitle")).toBe(source === "venue");
        expect(text).not.toContain("Venue subtitle");
        expect(text).not.toContain("Venue footer");
        expect(text.includes("own@example.test")).toBe(source === "venue");
        expect(text).not.toContain("venue@example.test");
        expect(await registroCount(cfg)).toBe(1);
        expect(await suite.db.select().from(tenders)).toHaveLength(1);
        const diagnostic = [
          "receipt.optional_read_failed",
          source === "venue"
            ? { operation: "getPrintedReceipt", receiptId: 1, code: "receipt.read_failed" }
            : {
                operation: "readPrintedDepartmentReceipt",
                departmentId,
                code: "receipt.read_failed",
              },
        ];
        expect(warning.mock.calls).toEqual(source === "venue" ? [] : [diagnostic, diagnostic]);
        expect(ticket.receiptTrim).toEqual(
          source === "venue" ? { headerSubtitle: "Own subtitle", email: "own@example.test" } : {},
        );
      } finally {
        mandatoryRead?.mockRestore();
        if (source === "venue")
          await suite.db.execute(sql`alter table test_hidden_receipts rename to tenant_receipts`);
        else
          await suite.db.execute(
            sql`alter table test_hidden_department_receipts rename to department_receipts`,
          );
        warning.mockRestore();
      }
    },
  );

  it("commits one sale, tender, header and drawer when optional formatting fails, including replay", async () => {
    const { cfg, sell } = await setupReceipt();
    const formatter = vi.spyOn(receiptTicket, "formatReceipt").mockImplementationOnce(() => {
      throw new Error("untrusted imported detail");
    });
    try {
      const ticket = await sell();
      expect(ticket.total).toBe("1.50");
      expect(await registroCount(cfg)).toBe(1);
      const sold = await suite.db.select().from(sales);
      expect(sold).toHaveLength(1);
      expect(await suite.db.select().from(tenders)).toHaveLength(1);
      expect(await suite.db.select().from(saleReceiptHeaders)).toHaveLength(1);
      expect((await suite.db.select().from(printJobs)).map((job) => job.kind)).toEqual(["drawer"]);
      expect(await drawerOpensFor(cfg)).toHaveLength(1);
      const before = await suite.db
        .select({ id: invoiceSeries.id, nextNumber: invoiceSeries.nextNumber })
        .from(invoiceSeries);
      const replay = await recordTillSale(
        deps(),
        cfg,
        {
          workingOrderId: sold[0]!.workingOrderId!,
          lines: [],
          tender: { method: "cash", amount: "1.50" },
        },
        OPERATOR,
      );
      expect(replay.invoiceNumber).toBe(ticket.invoiceNumber);
      expect(await registroCount(cfg)).toBe(1);
      expect(await suite.db.select().from(tenders)).toHaveLength(1);
      expect(
        await suite.db
          .select({ id: invoiceSeries.id, nextNumber: invoiceSeries.nextNumber })
          .from(invoiceSeries),
      ).toEqual(before);
      expect(await drawerOpensFor(cfg)).toHaveLength(1);
    } finally {
      formatter.mockRestore();
    }
  });

  it("refreshes a cash replay's text and address without another drawer or fiscal record", async () => {
    const { cfg, departmentId, sell } = await setupReceipt();
    await storeDepartmentReceipt(departmentId, {
      headerSubtitle: { "es-ES": "Original subtitle" },
    });
    const first = await sell();
    expect(first.receiptTrim).toEqual({
      headerSubtitle: "Original subtitle",
    });
    const [sale] = await suite.db.select().from(sales);
    const before = {
      drawer: await suite.db.select().from(drawerOpens),
      jobs: await suite.db.select().from(printJobs),
      tenders: await suite.db.select().from(tenders),
      series: await suite.db.select().from(invoiceSeries),
    };
    expect(before.drawer).toHaveLength(1);
    await suite.db
      .update(departmentReceipts)
      .set({ receipt: { headerSubtitle: { "es-ES": "Current subtitle" } } })
      .where(eq(departmentReceipts.departmentId, departmentId));
    await suite.db.update(tenantReceipts).set({ receipt: { printAddress: false } });
    await suite.db
      .update(locations)
      .set({ addressLine1: "Current street" })
      .where(eq(locations.id, cfg.locationId));
    const replay = await recordTillSale(
      deps(),
      cfg,
      {
        workingOrderId: sale!.workingOrderId!,
        lines: [],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );
    expect(replay.receiptTrim).toEqual({ headerSubtitle: "Current subtitle" });
    expect(replay.venueAddress).toEqual(["Current street", "28013 Madrid"]);
    expect(replay.receiptSettings).toEqual({ printAddress: false });
    expect({
      ...replay,
      receiptTrim: first.receiptTrim,
      venueAddress: first.venueAddress,
      receiptSettings: first.receiptSettings,
    }).toEqual(first);
    expect(await registroCount(cfg)).toBe(1);
    expect({
      drawer: await suite.db.select().from(drawerOpens),
      jobs: await suite.db.select().from(printJobs),
      tenders: await suite.db.select().from(tenders),
      series: await suite.db.select().from(invoiceSeries),
    }).toEqual(before);
  });

  it("uses two recorded departments on one printer without inheriting venue contact", async () => {
    const { cfg, departmentId, zoneId, sell, documents } = await setupReceipt();
    await storeDepartmentReceipt(departmentId, {
      headerSubtitle: { "es-ES": "First subtitle" },
      phone: "911111111",
    });
    await sell();
    const other = await withTransaction(suite.db, (tx) =>
      createDepartment(tx, cfg, { name: "Second", tradingName: "Second brand" }),
    );
    await storeDepartmentReceipt(other.id, {
      headerSubtitle: { "es-ES": "Second subtitle" },
      email: "second@example.test",
    });
    await suite.db
      .update(zoneServicePolicies)
      .set({ departmentId: other.id })
      .where(eq(zoneServicePolicies.zoneId, zoneId));
    await withTransaction(suite.db, (tx) => offerProducts(tx, cfg, { zone: { zoneId } }));
    await sell();
    const text = (await documents()).map((job) => decodeTicket(job.payload));
    expect(text).toHaveLength(2);
    expect(text[0]).toContain("First subtitle");
    expect(text[0]).toContain("911111111");
    expect(text[0]).not.toContain("Venue subtitle");
    expect(text[0]).not.toContain("venue@example.test");
    expect(text[1]).toContain("Second subtitle");
    expect(text[1]).toContain("second@example.test");
    expect(text[1]).not.toContain("910000000");
    expect(text[1]).not.toContain("First subtitle");
    expect(text.every((t) => !t.includes("Venue footer"))).toBe(true);
  });

  it("reprints a disabled recorded department with live text and recorded trading name", async () => {
    const { cfg, departmentId, sell, documents } = await setupReceipt();
    await storeDepartmentReceipt(departmentId, { headerSubtitle: { "es-ES": "Before edit" } });
    const ticket = await sell();
    const id = await onlySaleId(cfg);
    await suite.db
      .update(departments)
      .set({ active: false, tradingName: "New mutable brand" })
      .where(eq(departments.id, departmentId));
    await suite.db
      .update(departmentReceipts)
      .set({ receipt: { headerSubtitle: { "es-ES": "After edit" }, printAddress: true } })
      .where(eq(departmentReceipts.departmentId, departmentId));
    await suite.db.update(tenantReceipts).set({ receipt: { footerMessage: "New venue footer" } });
    await suite.db
      .update(locations)
      .set({ addressLine1: "New current address" })
      .where(eq(locations.id, cfg.locationId));
    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, id));
    const text = (await documents()).map((job) => decodeTicket(job.payload));
    expect(text[0]).toContain("Before edit");
    expect(text[1]).toContain("After edit");
    expect(text[1]).not.toContain("New venue footer");
    expect(text[1]).toContain("Recorded brand");
    expect(text[1]).not.toContain("New mutable brand");
    expect(text[1]).toContain("New current address");
    expect(text[1]).toContain("DUPLICADO");
    expect(await registroCount(cfg)).toBe(1);
    await suite.db
      .update(departmentReceipts)
      .set({ receipt: { headerSubtitle: { "es-ES": "After edit" }, printAddress: false } })
      .where(eq(departmentReceipts.departmentId, departmentId));
    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, id));
    expect(decodeTicket((await documents())[2]!.payload)).not.toContain("New current address");
  });

  it.each(["en-GB", "fr-FR"])(
    "retains the printed %s department text after the current receipt language changes",
    async (printed) => {
      const { cfg, departmentId, sell, documents } = await setupReceipt();
      await storeDepartmentReceipt(departmentId, {
        headerSubtitle: { [printed]: "Printed subtitle", "es-ES": "Current subtitle" },
        footerMessage: { [printed]: "Printed footer", "es-ES": "Current footer" },
      });
      const ticket = await sell();
      const id = await onlySaleId(cfg);
      await suite.db
        .update(locations)
        .set({ invoiceLocales: ["es-ES"] })
        .where(eq(locations.id, cfg.locationId));
      await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, id, printed));
      const text = decodeTicket((await documents())[1]!.payload);
      expect(text).toContain("Printed subtitle");
      expect(text).toContain("Printed footer");
      expect(text).not.toContain("Current subtitle");
      expect(text).not.toContain("Current footer");
      expect(await registroCount(cfg)).toBe(1);
    },
  );

  it.each([
    { printed: "ca-ES", current: "es-ES", subtitle: "Catalan subtitle", footer: "Spanish footer" },
    { printed: "ca-ES", current: "gl-ES", subtitle: "Catalan subtitle", footer: "Galician footer" },
    { printed: "eu-ES", current: "gl-ES", subtitle: null, footer: "Galician footer" },
  ])(
    "resolves $printed against current $current without a third-language candidate",
    async ({ printed, current, subtitle, footer }) => {
      const { cfg, departmentId, sell, documents } = await setupReceipt();
      await storeDepartmentReceipt(departmentId, {
        headerSubtitle: { "ca-ES": "Catalan subtitle", "es-ES": "Spanish subtitle" },
        footerMessage: { "es-ES": "Spanish footer", "gl-ES": "Galician footer" },
      });
      const ticket = await sell();
      const id = await onlySaleId(cfg);
      await suite.db
        .update(locations)
        .set({ invoiceLocales: [current] })
        .where(eq(locations.id, cfg.locationId));
      await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, ticket, id, printed));
      const text = decodeTicket((await documents())[1]!.payload);
      if (subtitle === null) expect(text).not.toContain("Venue subtitle");
      else expect(text).toContain(subtitle);
      expect(text).toContain(footer);
      expect(text).not.toContain("venue@example.test");
      expect(text).not.toContain("Spanish subtitle");
      expect(await registroCount(cfg)).toBe(1);
    },
  );
});
