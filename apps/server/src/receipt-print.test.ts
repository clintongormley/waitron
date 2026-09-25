import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  diningTables,
  drawerOpens,
  locations,
  printJobs,
  readTenant,
  sales,
  tenantReceipts,
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
import { createPrinter, deactivatePrinter, updatePrinter } from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import { NetworkTcpTransport, UsbTransport } from "@waitron/print-agent";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import { collectOrder, recordTillSale, reprintSale } from "./till-sale.js";
import { createOpenOrder, openTab, parkOrder, placeOrder } from "./working-order.js";
import { createTable } from "./tables.js";
import { DRAWER_KICK, enqueueReceiptReprint } from "./receipt-print.js";
import { bytesInclude, decodeTicket, printedLines } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";

/**
 * The auto-print hook: a `print_jobs` outbox row and a `drawer_opens` audit row written atomically
 * with a chained fiscal sale.
 *
 * PRINTING NEVER OPENS THE DRAWER (CLAUDE.md §5): a receipt is a `document` job carrying no drawer
 * command, the kick is a separate `drawer` job, and cash settlement writes its own audit row.
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
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult, orderFlow: OrderFlow): TillConfig {
  return {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow,
  };
}

function printCfg(cfg: TillConfig): PrintConfig {
  return { locationId: cfg.locationId };
}

/**
 * A fresh chained venue and a one-`each`-product catalogue (1.50 gross, general/21 %), offered in
 * the counter zone under `orderFlow`.
 */
async function setupVenue(orderFlow: OrderFlow = "prepay"): Promise<{
  cfg: TillConfig;
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
        tillName: "Caja 1",
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

  const cfg = tillConfigFromVenue(venue, orderFlow);
  const { available, offers } = await withTransaction(suite.db, async (tx) => {
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: { [LOCALE]: "Bebidas" } });
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
  cfg: TillConfig,
  { active = true, transport = "cloud_poll" as "cloud_poll" | "network_tcp" } = {},
): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { id } = await createPrinter(
      tx,
      printCfg(cfg),
      transport === "network_tcp"
        ? { name: "Recibos", transport: "network_tcp", host: "192.0.2.1" }
        : { name: "Recibos", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    if (!active) await deactivatePrinter(tx, printCfg(cfg), id);
    return id;
  });
}

/** Set the location's `receipt_print_mode` and/or the till's `receipt_printer_id`. Pass
 *  `printerId: null` to leave the till with no printer. */
async function configureReceipt(
  cfg: TillConfig,
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
        .update(tills)
        .set({ receiptPrinterId: opts.printerId })
        .where(eq(tills.id, cfg.tillId));
    }
  });
}

async function printJobsFor(
  cfg: TillConfig,
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

async function drawerOpensFor(
  cfg: TillConfig,
): Promise<{ reason: string; saleId: string | null; personId: string; tillId: string }[]> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    return tx
      .select({
        reason: drawerOpens.reason,
        saleId: drawerOpens.saleId,
        personId: drawerOpens.personId,
        tillId: drawerOpens.tillId,
      })
      .from(drawerOpens);
  });
}

async function registroCount(cfg: TillConfig): Promise<number> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx.select().from(registrosFacturacion);
    return rows.length;
  });
}

/** The one filed sale's id; the database is emptied after each test. */
async function onlySaleId(cfg: TillConfig): Promise<string> {
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

describe("receipt grouping after table changes", () => {
  it.each(["prepay", "ticket_then_pay", "invoice_first"] as const)(
    "%s freezes the table label at issuance across renaming, collection and table turnover",
    async (orderFlow) => {
      const base = await setupVenue(orderFlow);
      const cfg: TillConfig = { ...base.cfg, orderFlow };
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
        await placeOrder(deps(), cfg, orderId, OPERATOR, cfg.tillId);
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
        await openTab(tx, cfg, { tableId });
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
      const drawerJobs = jobs.filter((job) =>
        bytesInclude(new Uint8Array(job.payload), DRAWER_KICK),
      );
      expect(drawerJobs).toHaveLength(1);
      expect([...drawerJobs[0]!.payload]).toEqual([...DRAWER_KICK]);
      const documents = jobs.filter((job) =>
        decodeTicket(new Uint8Array(job.payload)).includes("TOTAL"),
      );
      expect(documents).toHaveLength(mode === "auto" ? 1 : 0);
      for (const job of documents)
        expect(bytesInclude(new Uint8Array(job.payload), DRAWER_KICK)).toBe(false);
      expect(await drawerOpensFor(cfg)).toHaveLength(1);
    },
  );
});

describe("print-on-sale hook (auto-enqueue + cash drawer kick, post-filing outbox)", () => {
  it("lays the automatic receipt out for the till printer's paper width and character set", async () => {
    const { cfg, each, zoneId } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await withTransaction(suite.db, async (tx) => {
      await updatePrinter(tx, printCfg(cfg), printerId, {
        paperWidth: "58mm",
        characterSet: "pc858",
        characterTable: 19,
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
    expect([...receipt.subarray(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
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
    expect(bytesInclude(payload, DRAWER_KICK)).toBe(false);
    const drawer = jobs.find((job) => job !== receipt)!;
    expect([...drawer.payload]).toEqual([...DRAWER_KICK]);

    // The drawer open is audited, its `sale_id` pinned to the filed sale.
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ reason: "cash_sale", personId: OPERATOR, tillId: cfg.tillId });
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

  it("auto + printer + CARD: enqueues the receipt with NO kick and records NO drawer open", async () => {
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
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
    const payload = new Uint8Array(jobs[0]!.payload);
    expect(decodeTicket(payload)).toContain("VERI*FACTU"); // a real receipt, still printed
    expect(bytesInclude(payload, DRAWER_KICK)).toBe(false); // card → NO drawer kick
    expect(await drawerOpensFor(cfg)).toEqual([]); // card → NO cash_sale audit row
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
    expect(bytesInclude(new Uint8Array(jobs[0]!.payload), DRAWER_KICK)).toBe(false); // no kick
    expect(await drawerOpensFor(cfg)).toEqual([]); // no audit row
  });

  it.each(["auto", "on_request", "never"] as const)(
    "invoice-first placement routes the original to the issuing device's till printer in %s mode",
    async (mode) => {
      const base = await setupVenue("invoice_first");
      const cfg: TillConfig = { ...base.cfg, orderFlow: "invoice_first" };
      const deviceTillId = await withTransaction(suite.db, async (tx) => {
        const [till] = await tx
          .insert(tills)
          .values({
            locationId: cfg.locationId,
            name: "Issuing counter",
          })
          .returning({ id: tills.id });
        return brandTillId(till!.id);
      });
      const printerId = await makePrinter(cfg);
      await configureReceipt({ ...cfg, tillId: deviceTillId }, { mode, printerId });
      const id = randomUUID();
      await parkOrder({ db: suite.db }, cfg, {
        id,
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
      });
      await placeOrder(deps(), cfg, id, OPERATOR, deviceTillId);
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
      const cfg: TillConfig = { ...base.cfg, orderFlow: "invoice_first" };
      const printerId = await makePrinter(cfg);
      await configureReceipt(cfg, { mode, printerId });

      const id = randomUUID();
      await parkOrder({ db: suite.db }, cfg, {
        id,
        zoneId: base.zoneId,
        lines: [{ menuItemId: base.each.menuItemId, quantity: "1" }],
      });
      await placeOrder(deps(), cfg, id, OPERATOR, cfg.tillId);
      const issuedJobs = await printJobsFor(cfg);
      expect(issuedJobs).toHaveLength(1);
      const original = new Uint8Array(issuedJobs[0]!.payload);
      const text = decodeTicket(original);
      expect(text).toContain("TOTAL");
      expect(text).not.toContain("Efectivo");
      expect(text).not.toContain("Cambio");
      expect(text).not.toContain("Tarjeta");
      expect(text).not.toContain("DUPLICADO");
      expect(bytesInclude(original, DRAWER_KICK)).toBe(false);
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

describe("receipt issuer", () => {
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

    await withTransaction(suite.db, (tx) => enqueueReceiptReprint(tx, cfg, withoutIssuer));
    const [fallback] = (await printJobsFor(cfg)).map((job) =>
      decodeTicket(new Uint8Array(job.payload)),
    );
    expect(fallback).toContain(taxpayer.legalName);
    expect(fallback).toContain(taxpayer.taxId);

    // The control: a ticket that does carry a filed issuer prints that one instead.
    await withTransaction(suite.db, (tx) => tx.delete(printJobs));
    await withTransaction(suite.db, (tx) =>
      enqueueReceiptReprint(tx, cfg, {
        ...filed,
        issuer: { venueName: "Emisor Registrado SL", nif: "B99999999" },
      }),
    );
    const [recorded] = (await printJobsFor(cfg)).map((job) =>
      decodeTicket(new Uint8Array(job.payload)),
    );
    expect(recorded).toContain("Emisor Registrado SL");
    expect(recorded).not.toContain(taxpayer.legalName);
  });
});
