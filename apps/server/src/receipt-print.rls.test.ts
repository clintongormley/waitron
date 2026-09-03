import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import {
  asAppUser,
  drawerOpens,
  locations,
  printJobs,
  sales,
  tills,
  withTenant,
} from "@waitron/db";
import { useTemplateDb } from "@waitron/db/testing/lifecycle.js";
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
  NetworkTcpTransport,
  UsbTransport,
} from "@waitron/printing";
import type { PrintConfig } from "@waitron/printing";
import {
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tenantId as brandTenantId,
  tillId as brandTillId,
} from "@waitron/shared";
import { deploymentEnvironment } from "./config.js";
import type { TillConfig } from "./till-config.js";
import { collectOrder, recordTillSale } from "./till-sale.js";
import { parkOrder, placeOrder } from "./working-order.js";
import { DRAWER_KICK } from "./receipt-print.js";
import { bytesInclude, decodeTicket } from "./testing/decode-ticket.js";

// REAL Postgres, not PGlite: the point is the auto-print HOOK writing a `print_jobs` outbox row and a
// `drawer_opens` audit row through the deployment role under RLS, atomically with a genuine chained
// fiscal sale (CLAUDE.md §4 — PGlite runs every connection as superuser, bypassing RLS). The sale path
// runs through `asAppUser` exactly as `till-sale.test.ts` does; provisioning runs as the owner.
//
// NEVER-BLOCK (CLAUDE.md §5): the LOAD-BEARING guarantee is that a broken/absent receipt printer can
// never delay or fail a sale. Each test asserts the fiscal record still lands, and the cash test spies
// the printer TRANSPORT (the ONLY code that opens a printer socket / writes a device) to prove the sale
// path invoked NONE of it — the enqueue is a pure DB INSERT and the job is left `queued` for the async
// agent. (A global `net.createConnection` spy is deliberately NOT used: node-postgres opens DB sockets
// too, so it would be noisy; the transport `send` methods are the printer-hardware entry points.)
const LOCALE = "es-ES";
const suite = useTemplateDb({ template: "manifest" });

// The acting operator recorded in `drawer_opens.person_id` — an identity person id (plain uuid, no FK;
// the person schema is a separate slice), the shape `drawer-opens.rls.test.ts` uses.
const OPERATOR = "cccccccc-0000-4000-8000-000000000001";

let backend: FiscalBackend;
let clock: TrustedClock;
let netSend: MockInstance;
let usbSend: MockInstance;

/** The wall clock, already anchored — the stub `till-sale.test.ts` documents; `recordSale` reads
 *  `now()` once and touches neither `anchor` nor `currentAnchor`. */
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

// Each provisioned venue needs its own NIF (`tenants_country_tax_id_key` is unique and tenants
// accumulate for the shared container's life) — the `till-sale.test.ts` counter.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(60_000_000 + nifCounter).padStart(8, "0")}K`;
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    tenantId: brandTenantId(venue.tenantId),
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    cardProvider: "none",
    tipsEnabled: false,
    orderFlow: "prepay",
  };
}

function printCfg(cfg: TillConfig): PrintConfig {
  return { tenantId: cfg.tenantId, locationId: cfg.locationId };
}

/** Stand up a fresh chained venue + a one-`each`-product catalogue (1.50 gross, general/21 %). Each test
 *  gets its OWN tenant, so its `print_jobs` / `drawer_opens` / `registros_facturacion` counts are its
 *  own, order-independent (CLAUDE.md §4). */
async function setupVenue(): Promise<{ cfg: TillConfig; each: AvailableProduct }> {
  const venue = await applyVenue(
    planVenue({
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
      },
    }),
    { db: suite.admin },
  );

  const cfg = tillConfigFromVenue(venue);
  const available = await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const cat = await createCatalogue(tx, { name: "Delicatessen" });
    const bebidas = await createCategory(tx, { name: "Bebidas" });
    await createProduct(tx, {
      catalogueId: cat.id,
      categoryId: bebidas.id,
      descriptions: { [LOCALE]: "Agua mineral" },
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return (await listAvailableProducts(tx, cfg.locationId)).products;
  });
  return { cfg, each: available.find((p) => p.pricingUnit === "each")! };
}

/** Seed a print agent (raw insert — the `outbox.test.ts` shape) so a `network_tcp` printer has an agent
 *  to belong to. The token hash is a fixture — the agent is never authenticated here. */
async function seedAgent(cfg: TillConfig): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { rows } = await tx.execute<{ id: string }>(sql`
      insert into print_agents (tenant_id, location_id, name, token_hash)
      values (${cfg.tenantId}, ${cfg.locationId}, 'Recibos agent', 'scrypt$fixture') returning id`);
    return rows[0]!.id;
  });
}

/**
 * Create a receipt printer and return its id. `transport: "network_tcp"` gives it an agent + host so the
 * never-block transport spy (`NetworkTcpTransport.prototype.send`) actually covers ITS delivery path — a
 * `cloud_poll` printer is driven by neither adapter, which would make the spy vacuous. `192.0.2.1` is
 * TEST-NET-1 (RFC 5737, unroutable): if delivery ever ran inline it would route through the spied
 * `send`, which the sale path must never reach. `active: false` deactivates it (for the inactive-printer
 * test).
 */
async function makePrinter(
  cfg: TillConfig,
  { active = true, transport = "cloud_poll" as "cloud_poll" | "network_tcp" } = {},
): Promise<string> {
  const agentId = transport === "network_tcp" ? await seedAgent(cfg) : undefined;
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const { id } = await createPrinter(
      tx,
      printCfg(cfg),
      transport === "network_tcp"
        ? { name: "Recibos", transport: "network_tcp", agentId: agentId!, host: "192.0.2.1" }
        : { name: "Recibos", transport: "cloud_poll", pollId: `poll-${randomUUID()}` },
    );
    if (!active) await deactivatePrinter(tx, printCfg(cfg), id);
    return id;
  });
}

/** Set the location's `receipt_print_mode` and/or the till's `receipt_printer_id` (both settable by the
 *  app role — `drawer-opens.rls.test.ts`). Pass `printerId: null` to leave the till with no printer. */
async function configureReceipt(
  cfg: TillConfig,
  opts: { mode?: "auto" | "on_request" | "never"; printerId?: string | null },
): Promise<void> {
  await withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
): Promise<{ printerId: string; status: string; payload: Buffer }[]> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
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
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await tx.select().from(registrosFacturacion);
    return rows.length;
  });
}

/** The id of the tenant's single filed sale — each test provisions its own tenant, so there is exactly
 *  one — for pinning the `drawer_opens.sale_id` back-reference the helper wires. */
async function onlySaleId(cfg: TillConfig): Promise<string> {
  return withTenant(suite.admin, cfg.tenantId, async (tx) => {
    await asAppUser(tx);
    const rows = await tx.select({ id: sales.id }).from(sales);
    return rows[0]!.id;
  });
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.admin,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(
        new Error("receipt-print.test: resolveClient must never be called by recordSale"),
      ),
  });
});

// Spy the printer transports for EVERY test — the never-block invariant holds on all paths, so no test
// may open a socket or write a device on the sale path. `restoreAllMocks` in afterEach keeps them fresh.
beforeAll(() => {
  netSend = vi.spyOn(NetworkTcpTransport.prototype, "send");
  usbSend = vi.spyOn(UsbTransport.prototype, "send");
});
afterEach(() => {
  netSend.mockClear();
  usbSend.mockClear();
});

const deps = () => ({ db: suite.admin, backend, clock });

describe("print-on-sale hook (auto-enqueue + cash drawer kick, post-filing outbox)", () => {
  it("auto + printer + CASH: enqueues ONE receipt+kick job, records the drawer open, never blocks filing", async () => {
    const { cfg, each } = await setupVenue();
    // A network_tcp printer, so the never-block spy below actually covers ITS delivery adapter (a
    // cloud_poll printer uses neither NetworkTcp nor Usb, which would make the spy vacuous — MINOR 1).
    const printerId = await makePrinter(cfg, { transport: "network_tcp" });
    await configureReceipt(cfg, { mode: "auto", printerId });

    const result = await recordTillSale(
      deps(),
      cfg,
      {
        lines: [{ productId: each.id, quantity: "2" }],
        tender: { method: "cash", amount: "5.00" },
      },
      OPERATOR,
    );

    // Filing succeeded and is UNAFFECTED by the print hook: the chained fiscal record exists.
    expect(result.total).toBe("3.00");
    expect(await registroCount(cfg)).toBe(1);
    // NEVER-BLOCK: the sale path invoked NEITHER printer transport (the network_tcp printer's delivery
    // adapter is `NetworkTcpTransport.send`) — the enqueue is a pure DB INSERT, delivery is the agent's.
    expect(netSend).not.toHaveBeenCalled();
    expect(usbSend).not.toHaveBeenCalled();

    // Exactly ONE outbox job, to the till's printer, left `queued` for the async agent (delivery deferred).
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
    expect(jobs[0]!.status).toBe("queued");
    // The payload carries the full receipt (the legend proves it is the customer ticket) AND ends with
    // the drawer kick appended (cash → the drawer opens as the receipt prints).
    const payload = new Uint8Array(jobs[0]!.payload);
    expect(decodeTicket(payload)).toContain("VERI*FACTU");
    expect(decodeTicket(payload)).toContain("Deli Recibos SL"); // issuer venue name (art. 7.1.d)
    expect(bytesInclude(payload, DRAWER_KICK)).toBe(true);
    // …and the kick is at the very END (receipt THEN kick, one job).
    expect([...payload.slice(-DRAWER_KICK.length)]).toEqual([...DRAWER_KICK]);

    // The drawer open is audited: one `cash_sale` row for this sale, this till, this operator, with its
    // `sale_id` back-reference PINNED to the actual filed sale (MINOR 2).
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ reason: "cash_sale", personId: OPERATOR, tillId: cfg.tillId });
    expect(opens[0]!.saleId).toBe(await onlySaleId(cfg));
  });

  it("auto + printer + CARD: enqueues the receipt with NO kick and records NO drawer open", async () => {
    const { cfg, each } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        lines: [{ productId: each.id, quantity: "1" }],
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

  it("mode 'on_request': files the sale but enqueues NO auto job and opens no drawer", async () => {
    const { cfg, each } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "on_request", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        lines: [{ productId: each.id, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1); // sale still files
    expect(await printJobsFor(cfg)).toEqual([]); // no auto-enqueue
    expect(await drawerOpensFor(cfg)).toEqual([]); // no kick, no audit row
  });

  it("mode 'never': files the sale but enqueues NO auto job and opens no drawer", async () => {
    const { cfg, each } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "never", printerId });

    await recordTillSale(
      deps(),
      cfg,
      {
        lines: [{ productId: each.id, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1);
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("auto but NO printer set: files the sale, enqueues nothing, opens no drawer", async () => {
    const { cfg, each } = await setupVenue();
    // Default mode is 'auto'; leave receipt_printer_id NULL.
    await recordTillSale(
      deps(),
      cfg,
      {
        lines: [{ productId: each.id, quantity: "1" }],
        tender: { method: "cash", amount: "1.50" },
      },
      OPERATOR,
    );

    expect(await registroCount(cfg)).toBe(1); // the sale is unaffected by the absent printer
    expect(await printJobsFor(cfg)).toEqual([]);
    expect(await drawerOpensFor(cfg)).toEqual([]);
  });

  it("auto + INACTIVE printer: files the sale, enqueues nothing (printer.not_found stays unreachable)", async () => {
    const { cfg, each } = await setupVenue();
    // The till NAMES a real printer (the FK is satisfied) but it is DEACTIVATED. The hook's `active = true`
    // filter drops it, so `enqueuePrintJob` is never called with it — its `printer.not_found` throw, which
    // would abort the sale (§5), stays unreachable.
    const printerId = await makePrinter(cfg, { active: false });
    await configureReceipt(cfg, { mode: "auto", printerId });

    const result = await recordTillSale(
      deps(),
      cfg,
      {
        lines: [{ productId: each.id, quantity: "1" }],
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
    const { cfg, each } = await setupVenue();
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    // `operatorId` omitted (undefined). The drawer open's `person_id` is NOT NULL, so it cannot be
    // attributed — the kick + audit are coupled to a known operator and both are skipped, while the
    // customer receipt still prints. (Unreachable on the real session-guarded routes; the defensive
    // degrade keeps a null-operator sale from failing on the NOT-NULL constraint — §5.)
    await recordTillSale(deps(), cfg, {
      lines: [{ productId: each.id, quantity: "1" }],
      tender: { method: "cash", amount: "1.50" },
    });

    expect(await registroCount(cfg)).toBe(1);
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1); // the receipt is still enqueued
    expect(bytesInclude(new Uint8Array(jobs[0]!.payload), DRAWER_KICK)).toBe(false); // no kick
    expect(await drawerOpensFor(cfg)).toEqual([]); // no audit row
  });

  it("invoice-first COLLECT (Mode I) prints identically through the shared helper (receipt+kick, audited)", async () => {
    const base = await setupVenue();
    // Flip the location + cfg to invoice_first, the way `boot` wires them (the collect dispatch reads
    // `cfg.orderFlow`). Placing issues the DEFERRED invoice; collecting SETTLES it and, being a fresh
    // collect (not a replay), prints through the SAME `enqueueSaleReceipt` the walk-up tail uses.
    await withTenant(suite.admin, base.cfg.tenantId, async (tx) => {
      await asAppUser(tx);
      await tx
        .update(locations)
        .set({ orderFlow: "invoice_first" })
        .where(eq(locations.id, base.cfg.locationId));
    });
    const cfg: TillConfig = { ...base.cfg, orderFlow: "invoice_first" };
    const printerId = await makePrinter(cfg);
    await configureReceipt(cfg, { mode: "auto", printerId });

    const id = randomUUID();
    await parkOrder({ db: suite.admin }, cfg, {
      id,
      lines: [{ productId: base.each.id, quantity: "1" }],
    });
    await placeOrder(deps(), cfg, id, OPERATOR, cfg.tillId);
    // Placing filed the deferred invoice; no receipt is printed at place (only collect settles + prints).
    expect(await printJobsFor(cfg)).toEqual([]);

    await collectOrder(
      deps(),
      cfg,
      { id, lines: [], tender: { method: "cash", amount: "2.00" } },
      OPERATOR,
    );

    // Still ONE fiscal record (settled, not re-filed), and the collect printed the receipt+kick + audited.
    expect(await registroCount(cfg)).toBe(1);
    expect(netSend).not.toHaveBeenCalled();
    expect(usbSend).not.toHaveBeenCalled();
    const jobs = await printJobsFor(cfg);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.printerId).toBe(printerId);
    expect(bytesInclude(new Uint8Array(jobs[0]!.payload), DRAWER_KICK)).toBe(true);
    const opens = await drawerOpensFor(cfg);
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ reason: "cash_sale", personId: OPERATOR });
    // The `sale_id` back-reference is PINNED to the settled invoice's sale (MINOR 2).
    expect(opens[0]!.saleId).toBe(await onlySaleId(cfg));
  });
});
