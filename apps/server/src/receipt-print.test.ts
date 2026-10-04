import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  devices,
  diningTables,
  drawerOpens,
  locations,
  nowIso,
  partyTables,
  printJobs,
  readTenant,
  sales,
  tenantReceipts,
  tenants,
  tills,
  withTransaction,
} from "@waitron/db";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { registrosFacturacion } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
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
  jobOrigin,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { OrderFlow, TillConfig, DeviceRequestConfig } from "./till-config.js";
import { collectOrder, printSaleReceipt, recordTillSale, reprintSale } from "./till-sale.js";
import { createOpenOrder, parkOrder, placeOrder } from "./working-order.js";
import { createTable } from "./tables.js";
import {
  DRAWER_KICK,
  enqueueReceiptReprint,
  resolvePaymentSlipPrinter,
  resolveReceiptPrinter,
} from "./receipt-print.js";
import { decodeTicket, opensDrawer, printedLines } from "./testing/decode-ticket.js";
import { enabledModules, fiscalSlot, parseModuleConfig } from "@waitron/module";
import { venueModuleConfig } from "./provision.js";
import { offerProducts } from "./testing/zone-offers.js";
import {
  inTx,
  join,
  nameParty,
  orderForParty,
  pay,
  seat,
  setupPartyVenue,
  split,
} from "./testing/party-venue.js";
import { readReceiptOrder } from "./receipt-order.js";
import { openPartyTab } from "./testing/serve-line.js";
import { printingAlertSource } from "./alert-sources.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { deviceRequestCfg } from "./testing/session-device.js";
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

function tillConfigFromVenue(venue: VenueResult, orderFlow: OrderFlow): TillConfig {
  return {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
    orderFlow,
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

  const cfg = await deviceRequestCfg(suite.db, tillConfigFromVenue(venue, orderFlow));
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
      offers: await offerProducts(tx, cfg),
    };
  });
  const each = available.find((p) => p.pricingUnit === "each")!;
  return { cfg, each: { ...each, menuItemId: offers.offerFor(each.id) }, zoneId: offers.zoneId };
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

/** Set the location's `receipt_print_mode` and/or the printer `cfg`'s device prints its receipts
 *  and payment slips on. Pass `printerId: null` to leave the device with no printer. */
async function configureReceipt(
  cfg: DeviceRequestConfig,
  opts: { mode?: "auto" | "on_request" | "never"; printerId?: string | null },
): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    if (opts.mode !== undefined) {
      await tx
        .update(locations)
        .set({ receiptPrintMode: opts.mode })
        .where(eq(locations.id, cfg.locationId));
    }
    if (opts.printerId !== undefined) {
      await tx
        .update(devices)
        .set({ receiptPrinterId: opts.printerId, paymentSlipPrinterId: opts.printerId })
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

describe("receipt grouping after table changes", () => {
  it.each(["prepay", "ticket_then_pay", "invoice_first"] as const)(
    "%s freezes the table label at issuance across renaming, collection and table turnover",
    async (orderFlow) => {
      const base = await setupVenue(orderFlow);
      const cfg = await deviceRequestCfg(suite.db, { ...base.cfg, orderFlow });
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode: "auto", printerId });
      // A tab opens only in a table_tab zone, so the order that carries the table here is a counter
      // order in a zone of this flow, delivered to the table.
      const { tableId, orderId } = await withTransaction(suite.db, async (tx) => {
        const table = await createTable(tx, cfg, { label: "Terrace 6" });
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
        await placeOrder(deps(), cfg, orderId, OPERATOR);
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
      if (orderFlow === "invoice_first") {
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

  it.each(["auto", "on_request", "never"] as const)(
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

  it("prints the tenant's authored receipt trim from tenant_receipts (SP-B4 rehome)", async () => {
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
    expect(decoded).toContain("Gracias por su visita"); // the authored trim renders around the art
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

  it("hand-keyed CARD in mode 'never': files the sale and enqueues only the drawer job for the card slip", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "never", printerId });

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

  it("mode 'never': files the sale and enqueues only the cash drawer job", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "never", printerId });

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

  it.each(["auto", "on_request", "never"] as const)(
    "invoice-first placement routes the original to the issuing device's printer in %s mode",
    async (mode) => {
      const base = await setupVenue("invoice_first");
      const cfg = await deviceRequestCfg(suite.db, { ...base.cfg, orderFlow: "invoice_first" });
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode, printerId });
      const id = randomUUID();
      await parkOrder({ db: suite.db }, cfg, {
        id,
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
      });
      await placeOrder(deps(), cfg, id, OPERATOR);
      const jobs = await printJobsFor(cfg);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.printerId).toBe(printerId);
      expect(await registroCount(cfg)).toBe(1);
    },
  );

  it.each(["auto", "on_request", "never"] as const)(
    "invoice-first %s placement prints an unpaid original; collection only opens and audits the drawer",
    async (mode) => {
      const base = await setupVenue("invoice_first");
      // Placement issues the invoice before any payment; collection retains its separate drawer action.
      await withTransaction(suite.db, async (tx) => {
        await tx
          .update(locations)
          .set({ orderFlow: "invoice_first" })
          .where(eq(locations.id, base.cfg.locationId));
      });
      const cfg = await deviceRequestCfg(suite.db, { ...base.cfg, orderFlow: "invoice_first" });
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode, printerId });

      const id = randomUUID();
      await parkOrder({ db: suite.db }, cfg, {
        id,
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
      });
      await placeOrder(deps(), cfg, id, OPERATOR);
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

describe("every device whose profile allows the drawer opens its receipt printer's drawer", () => {
  /** Another till at the venue's location, a device on it, and the config a sale there runs under. */
  async function addTill(
    cfg: DeviceRequestConfig,
    name: string,
    capabilities: string[] = [...CAPABILITY_FLAGS],
  ): Promise<DeviceRequestConfig> {
    const id = await withTransaction(suite.db, async (tx) => {
      const [till] = await tx
        .insert(tills)
        .values({ locationId: cfg.locationId, name })
        .returning({ id: tills.id });
      return till!.id;
    });
    const { deviceId } = await seedDevice(suite.db, { tillId: id, capabilities });
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

  /** Two tills at one location, both printing their receipts on one drawer printer; the other's
   *  device has `otherCapabilities`. */
  async function sharedDrawer(
    orderFlow: OrderFlow = "prepay",
    otherCapabilities: string[] = [...CAPABILITY_FLAGS],
  ) {
    const base = await setupVenue(orderFlow);
    const cfg = await deviceRequestCfg(suite.db, { ...base.cfg, orderFlow });
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

  it.each(["ticket_then_pay", "invoice_first"] as const)(
    "collecting a placed %s order in cash opens the drawer only on the till allowed the drawer",
    async (orderFlow) => {
      const { cfg, other, printerId, zoneId, each } = await sharedDrawer(
        orderFlow,
        NO_DRAWER_CAPABILITY,
      );
      await withTransaction(suite.db, async (tx) => {
        await tx.update(locations).set({ orderFlow }).where(eq(locations.id, cfg.locationId));
      });

      const collectOn = async (till: DeviceRequestConfig): Promise<void> => {
        const id = randomUUID();
        await parkOrder({ db: suite.db }, till, {
          id,
          zoneId,
          lines: [{ menuItemId: each.menuItemId, quantity: "1" }],
        });
        await placeOrder(deps(), till, id, OPERATOR);
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
  it.each(["demo_seed", "readiness_test", "payment_check"] as const)(
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

describe("receipt issuer", () => {
  it("leaves a manual till reprint unqueued when its taxpayer row is missing", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    await configureReceipt(cfg, { mode: "never", printerId: await makePrinter(cfg) });
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
    await configureReceipt(cfg, { mode: "never", printerId: await makePrinter(cfg) });
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
    expect(await receiptOfJoinedParty("Ana")).toContain("Ana · Mesa 4, 5 · Pedido");
  });

  it("prints an unnamed party's tables alone", async () => {
    const receipt = await receiptOfJoinedParty();
    expect(receipt).toContain("Mesa 4, 5 · Pedido");
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
