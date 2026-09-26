import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { Database } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/catalogue";
import type { AvailableProduct } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
// Its records carry NO `verificationUrl`, which exercises the ticket's empty-QR default.
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { hashPassword, hashPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import { drawerOpens, printJobs, withTransaction } from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  seriesId as brandSeriesId,
  tillId as brandTillId,
} from "@waitron/shared";
import { insertCapturedPayment, SimulatorPaymentProvider } from "@waitron/payments";
import type { PaymentProvider, PaymentResult, PaymentResultState } from "@waitron/payments";
import { listOutstandingSales } from "@waitron/core";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { deploymentEnvironment } from "./config.js";
import { ALL_MODULES } from "./modules.js";
import type { OrderFlow, TillConfig } from "./till-config.js";
import { createOpenOrder, listStationQueue, parkOrder, placeOrder } from "./working-order.js";
import { collectOrder, payWorkingOrder, payWorkingOrderIntegrated } from "./till-sale.js";
import type { IntegratedPayDeps } from "./till-sale.js";
import { DRAWER_KICK } from "./receipt-print.js";
import { bytesInclude } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

// The integrated (split-transaction) card-pay orchestration, end to end on one venue: P1 commits a
// walk-up before `collect`, because the provider's payment row has a foreign key to
// `working_orders`; P3's duplicate backstop; and recovery of a capture P3 never filed. `FakeStripe`
// drives the reader deterministically.
const LOCALE = "es-ES";

// The operator a placing amendment is attributed to.
const OPERATOR = "0000ffff-2222-4000-8000-0000000000aa";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

let backend: FiscalBackend;
let clock: TrustedClock;

/** The system wall clock, reported confident/anchored. */
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
      throw new Error("till-sale-integrated.db.test: anchor() is not used by recordSale");
    },
    currentAnchor: () => null,
  };
}

// `tenants_country_tax_id_key` is unique, so each venue gets its own NIF.
let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(70_000_000 + nifCounter).padStart(8, "0")}K`;
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

/** A product with the offer that sells it in the venue's counter zone. */
type OfferedProduct = AvailableProduct & { menuItemId: string; zoneId: string };

interface SeededVenue {
  cfg: TillConfig;
  cafe: OfferedProduct;
}

/** A fresh venue with one "Café" (each, 1.50 gross, general 21%) product offered in the counter
 * zone under `orderFlow`. */
async function setupVenue(orderFlow: OrderFlow = "prepay"): Promise<SeededVenue> {
  const venue = await applyVenue(
    planVenue(
      {
        country: "ES",
        taxId: nextNif(),
        legalName: "Deli Test SL",
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
      name: "Café",
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
  const cafe = available.find((p) => p.name === "Café")!;
  return {
    cfg,
    cafe: { ...cafe, menuItemId: offers.offerFor(cafe.id), zoneId: offers.zoneId },
  };
}

/** Set the location's `order_flow` AND the in-memory cfg to `mode`, so both agree. */
async function modeVenue(mode: OrderFlow): Promise<SeededVenue> {
  const venue = await setupVenue(mode);
  suite.db.run(sql`update locations set order_flow = ${mode} where id = ${venue.cfg.locationId}`);
  return { ...venue, cfg: { ...venue.cfg, orderFlow: mode } };
}

/** The split-flow deps with a real `StripeTerminalProvider` over `FakeStripe`. A tips-on test
 * overrides `cfg.tipsEnabled`. */
function integratedDeps(
  cfg: TillConfig,
  app: Database,
  client = new FakeStripe(),
): { deps: IntegratedPayDeps; client: FakeStripe } {
  const provider = new StripeTerminalProvider({
    client,
    db: app,
    nodeId: cfg.nodeId,
    poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
  });
  return { deps: { db: app, backend, clock, provider, readerRef: "reader_1" }, client };
}

/** A provider that runs `onCollect` (to simulate a concurrent settle) then returns a canned result —
 * for the finalize-time backstop tests, where the point is the DB state at P3, not the reader. */
function cannedProvider(
  onCollect: () => Promise<void>,
  state: PaymentResultState,
): PaymentProvider {
  return {
    provider: "stripe",
    capabilities: { partialRefund: true },
    async collect(params): Promise<PaymentResult> {
      await onCollect();
      return {
        provider: "stripe",
        paymentRef: randomUUID(),
        state,
        amount: params.amount,
        settledAt: state === "captured" || state === "accepted_offline" ? new Date() : null,
      };
    },
    forward: () =>
      Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }),
    resolvePending: () =>
      Promise.resolve({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 }),
    void: () => Promise.reject(new Error("cannedProvider: void unused")),
    refund: () => Promise.reject(new Error("cannedProvider: refund unused")),
    partialRefund: () => Promise.reject(new Error("cannedProvider: partialRefund unused")),
  };
}

// --- verification reads (not part of the behaviour under test) -----------------------------------

async function saleCount(workingOrderId: string): Promise<number> {
  const rows = suite.db.all<{ count: string }>(
    sql`select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}`,
  );
  return Number(rows[0]!.count);
}

async function registroCount(workingOrderId: string): Promise<number> {
  const rows = suite.db.all<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

async function preparationTicketCount(workingOrderId: string): Promise<number> {
  const rows = suite.db.all<{ count: string }>(sql`
    select cast(count(*) as text) as count from ticket_items where working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

/** Create a receipt printer (cloud_poll) and point the till at it. `receipt_print_mode` defaults to
 *  `auto`, so a filed sale auto-enqueues its receipt via the print-on-sale hook. */
async function makeReceiptPrinter(cfg: TillConfig): Promise<string> {
  return withTransaction(suite.db, async (tx) => {
    const { id } = await createPrinter(
      tx,
      { locationId: cfg.locationId },
      {
        name: "Recibos",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
        hasCashDrawer: true,
      },
    );
    tx.run(sql`update tills set receipt_printer_id = ${id} where id = ${cfg.tillId}`);
    return id;
  });
}

/** The receipt payloads enqueued to `printerId`, as the shared `binary` column hands them back. */
async function printJobPayloads(cfg: TillConfig, printerId: string): Promise<Uint8Array[]> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx
      .select({ payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.printerId, printerId));
    return rows.map((r) => r.payload);
  });
}

/** The count of `drawer_opens` rows. */
async function drawerOpenCount(cfg: TillConfig): Promise<number> {
  void cfg;
  return withTransaction(suite.db, async (tx) => {
    const rows = await tx.select().from(drawerOpens);
    return rows.length;
  });
}

async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  // A raw comparison arrives as the number 1 or 0: this engine has no boolean type.
  const rows = suite.db.all<{ status: string; settled: number }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled === 1 };
}

/** Whether this order's `collected_at` handover marker is set. */
async function collectedAtSet(id: string): Promise<boolean> {
  const rows = suite.db.all<{ collected: number }>(sql`
    select (collected_at is not null) as collected from working_orders where id = ${id}
  `);
  return rows[0]!.collected === 1; // 0/1, not a boolean — see `orderState`
}

/** The venue's default kitchen station id (`applyVenue` seeds one "Cocina" per location). Every
 *  fixture line here carries no product/category route, so `placeOrder` fires it to this
 *  station. */
async function defaultStationId(cfg: TillConfig): Promise<string> {
  const rows = suite.db.all<{ id: string }>(sql`
    select id from kitchen_stations where location_id = ${cfg.locationId} and is_default and active
  `);
  return rows[0]!.id;
}

/** The order ids on a station's queue (`listStationQueue`); a collected order drops out. */
async function stationQueueOrderIds(stationId: string): Promise<string[]> {
  return withTransaction(suite.db, async (tx) => {
    const groups = await listStationQueue(tx, stationId);
    return groups.map((g) => g.orderId);
  });
}

/** The tender(s) filed for this order's sale — method, amount, tip. */
async function tendersFor(
  workingOrderId: string,
): Promise<{ method: string; amount: string; tipAmount: string }[]> {
  const rows = suite.db.all<{ method: string; amount: string; tip: string }>(sql`
    select t.method, cast(t.amount as text) as amount, cast(t.tip_amount as text) as tip
    from tenders t join sales s on s.id = t.sale_id
    where s.working_order_id = ${workingOrderId}
    order by t.method
  `);
  return rows.map((r) => ({
    method: r.method,
    amount: rawCentsToDecimal(r.amount),
    tipAmount: rawCentsToDecimal(r.tip),
  }));
}

/** The filed `sales.total` (ex-tip) for this order's sale. */
async function filedSaleTotal(workingOrderId: string): Promise<string> {
  const rows = suite.db.all<{ total: string }>(
    sql`select cast(total as text) as total from sales where working_order_id = ${workingOrderId}`,
  );
  return rawCentsToDecimal(rows[0]!.total);
}

/** The `payments` rows for this order — provider/state/external_ref, plus whether `sale_id` points at
 *  the filed sale (the association witness). */
async function paymentsFor(
  workingOrderId: string,
): Promise<
  { provider: string; state: string; externalRef: string | null; linkedToSale: boolean }[]
> {
  const rows = suite.db.all<{
    provider: string;
    state: string;
    external_ref: string | null;
    linked: number;
  }>(sql`
    select p.provider, p.state, p.external_ref,
           (p.sale_id is not null and p.sale_id = s.id) as linked
    from payments p join sales s on s.working_order_id = p.working_order_id
    where p.working_order_id = ${workingOrderId}
    order by p.provider, p.external_ref
  `);
  // 0/1, not a boolean — see `orderState`.
  return rows.map((r) => ({
    provider: r.provider,
    state: r.state,
    externalRef: r.external_ref,
    linkedToSale: r.linked === 1,
  }));
}

async function paymentCount(workingOrderId: string): Promise<number> {
  const rows = suite.db.all<{ count: string }>(
    sql`select cast(count(*) as text) as count from payments where working_order_id = ${workingOrderId}`,
  );
  return Number(rows[0]!.count);
}

/** The `sales.id` filed for this order. */
async function saleIdFor(workingOrderId: string): Promise<string> {
  const rows = suite.db.all<{ id: string }>(
    sql`select id from sales where working_order_id = ${workingOrderId}`,
  );
  return rows[0]!.id;
}

/** The outstanding (issued-but-unsettled) sales. */
async function outstandingSalesFor(): Promise<{ saleId: string; amountDue: string }[]> {
  return withTransaction(suite.db, async (tx) => {
    const rows = await listOutstandingSales(tx);
    return rows.map((r) => ({ saleId: String(r.saleId), amountDue: String(r.amountDue) }));
  });
}

/** Every `payments` row for this order — state + whether it carries a `sale_id` — WITHOUT the sales
 *  join `paymentsFor` uses, so a declined pay (which files no sale) is still visible. */
async function rawPaymentsFor(
  workingOrderId: string,
): Promise<{ state: string; hasSale: boolean }[]> {
  const rows = suite.db.all<{ state: string; has_sale: number }>(sql`
    select state, (sale_id is not null) as has_sale
    from payments where working_order_id = ${workingOrderId}
    order by state
  `);
  return rows.map((r) => ({ state: r.state, hasSale: r.has_sale === 1 })); // 0/1 — see `orderState`
}

beforeAll(() => {
  clock = systemClock();
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("till-sale-integrated.db.test: resolveClient must never be called")),
  });
});

describe("payWorkingOrderIntegrated (split-transaction integrated pay, ordering 2)", () => {
  it("runs a simulated approval through capture, fiscal filing and payment association", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const provider = new SimulatorPaymentProvider(app);
    const id = randomUUID();
    const out = await payWorkingOrderIntegrated({ db: app, backend, clock, provider }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      simulationOutcome: "captured",
    });

    expect(out.outcome).toBe("captured");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await paymentsFor(id)).toMatchObject([
      { provider: "simulator", state: "captured", linkedToSale: true },
    ]);
  });

  it("runs a simulated decline through payment handling without filing a sale", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const provider = new SimulatorPaymentProvider(app);
    const id = randomUUID();
    const out = await payWorkingOrderIntegrated({ db: app, backend, clock, provider }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      simulationOutcome: "declined",
    });

    expect(out).toEqual({ outcome: "declined" });
    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
    expect(await rawPaymentsFor(id)).toEqual([{ state: "failed", hasSale: false }]);
  });

  it("walk-up: captures, files an immediate card sale, links the payment, settles the order", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const { deps } = integratedDeps(cfg, app);
    const id = randomUUID();

    const out = await payWorkingOrderIntegrated(deps, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.invoiceNumber).toBe("A/1");
    expect(out.ticket.total).toBe("1.50");
    expect(out.ticket.tender.method).toBe("card"); // a card is charged the exact total — no cash change block

    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await preparationTicketCount(id)).toBe(1);
    // A walk-up is not a collect, so its handover marker stays NULL.
    expect(await collectedAtSet(id)).toBe(false);
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
    const payments = await paymentsFor(id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.provider).toBe("stripe");
    expect(payments[0]!.state).toBe("captured");
    expect(payments[0]!.linkedToSale).toBe(true);
    expect(payments[0]!.externalRef).toMatch(/^pi_/);
  });

  it("a declined card files nothing and leaves the order open (retryable)", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const client = new FakeStripe();
    client.declineNext();
    const { deps } = integratedDeps(cfg, app, client);
    const id = randomUUID();

    const out = await payWorkingOrderIntegrated(deps, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    expect(out.outcome).toBe("declined");
    // Nothing filed; the order stays `open`, so the till can retry.
    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    expect(await rawPaymentsFor(id)).toEqual([{ state: "failed", hasSale: false }]);
  });

  it("a settled order replays its ticket without re-collecting", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app);
    const id = randomUUID();
    const req = {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    };

    const first = await payWorkingOrderIntegrated(deps, cfg, req);
    expect(first.outcome).toBe("captured");
    if (first.outcome !== "captured") throw new Error("unreachable");

    // Same id → replays, files nothing, and never drives the reader again.
    const firstIntent = client.lastCreateIntent;
    const second = await payWorkingOrderIntegrated(deps, cfg, req);
    expect(second.outcome).toBe("captured");
    if (second.outcome !== "captured") throw new Error("unreachable");
    expect(second.ticket.invoiceNumber).toBe(first.ticket.invoiceNumber);
    expect(second.ticket.qr).toBe(first.ticket.qr);
    expect(client.lastCreateIntent).toBe(firstIntent); // no second createPaymentIntent
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await preparationTicketCount(id)).toBe(1);
    expect(await paymentCount(id)).toBe(1);
  });

  it("auto-prints the customer receipt on an integrated card sale (no kick, no drawer), and a REPLAY does not double-print", async () => {
    // A card receipt carries no drawer kick and records no `drawer_opens` row; a replay prints
    // nothing more.
    const { cfg, cafe } = await setupVenue();
    const printerId = await makeReceiptPrinter(cfg);
    const app = suite.db;
    const { deps } = integratedDeps(cfg, app);
    const id = randomUUID();
    const req = {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    };

    const first = await payWorkingOrderIntegrated(deps, cfg, req);
    expect(first.outcome).toBe("captured");

    const afterFirst = await printJobPayloads(cfg, printerId);
    expect(afterFirst).toHaveLength(1);
    const payload = new Uint8Array(afterFirst[0]!);
    expect(Buffer.from(payload).toString("latin1")).toContain("VERI*FACTU");
    expect(bytesInclude(payload, DRAWER_KICK)).toBe(false);
    expect(await drawerOpenCount(cfg)).toBe(0);
    expect(await registroCount(id)).toBe(1);

    // A lost-response retry replays and never prints a second receipt.
    const second = await payWorkingOrderIntegrated(deps, cfg, req);
    expect(second.outcome).toBe("captured");
    expect(await registroCount(id)).toBe(1);
    expect(await printJobPayloads(cfg, printerId)).toHaveLength(1);
    expect(await drawerOpenCount(cfg)).toBe(0);
  });

  it("tips on: charges total+tip, files the sale at the total, records the tip on the tender", async () => {
    const { cfg: baseCfg, cafe } = await setupVenue();
    const cfg = { ...baseCfg, tipsEnabled: true };
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app);
    const id = randomUUID();

    const out = await payWorkingOrderIntegrated(deps, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tip: "0.30",
    });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent?.amount).toBe("1.80");
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
  });

  it("tips off: a client-supplied tip is clamped to 0 — charges and settles at the exact total", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app); // cfg.tipsEnabled: false (setupVenue's default)
    const id = randomUUID();

    const out = await payWorkingOrderIntegrated(deps, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      tip: "5.00", // ignored — tips are disabled on this till
    });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent?.amount).toBe("1.50"); // the tip was NOT added
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
  });

  it("retrieved (open) order: files the STORED locked lines at pay, links the payment, settles", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "2" }],
      label: "Mesa 4",
    });

    const { deps } = integratedDeps(cfg, app);
    // No client basket — a retrieved order files from its stored lock (2 × 1.50 = 3.00).
    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.total).toBe("3.00");
    expect(await filedSaleTotal(id)).toBe("3.00");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "3.00", tipAmount: "0.00" }]);
    const payments = await paymentsFor(id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.linkedToSale).toBe(true);
  });

  it("placed (ticket_then_pay) order: ISSUES the invoice AT PAY from the frozen lines (ordering 2), stamps collected_at, drops from the station queue", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);
    const app = suite.db;
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    // Placing files no fiscal document under ticket_then_pay, and fires the order to the default
    // station.
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);
    expect(await saleCount(id)).toBe(0);
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await stationQueueOrderIds(station)).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    const { deps } = integratedDeps(cfg, app);
    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    const payments = await paymentsFor(id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.linkedToSale).toBe(true);
    // A placed card collect stamps `collected_at`, so the order leaves its station queue.
    expect(await collectedAtSet(id)).toBe(true);
    expect(await stationQueueOrderIds(station)).toEqual([]);
  });

  it("refuses an ABANDONED order (working_order.not_open) and never touches the reader", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    suite.db.run(sql`update working_orders set status = 'abandoned' where id = ${id}`);

    const { deps, client } = integratedDeps(cfg, app);
    await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
      code: "working_order.not_open",
      params: { workingOrderId: id },
    });

    // Refused in P1, before P2: no sale, no payment, and the reader was never driven.
    expect(await saleCount(id)).toBe(0);
    expect(await paymentCount(id)).toBe(0);
    expect(client.lastCreateIntent).toBeUndefined();
  });

  it("refuses an empty walk-up basket (sale.empty_basket) before any DB write or collect", async () => {
    const { cfg } = await setupVenue();
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app);
    const id = randomUUID();

    await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
      code: "sale.empty_basket",
    });

    expect(await paymentCount(id)).toBe(0);
    expect(client.lastCreateIntent).toBeUndefined();
  });

  it("concurrent winner: a sale filed between collect and finalize makes P3 REPLAY, filing nothing (duplicate backstop)", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    // Mid-`collect` (after P1 committed, before P3) a concurrent cash pay settles this id. P3's
    // `recordSale` is refused by `sales_working_order_id_key` and replays the winner's ticket.
    const provider = cannedProvider(async () => {
      await payWorkingOrder({ db: suite.db, backend, clock }, cfg, {
        id,
        lines: [],
        tender: { method: "cash", amount: "5.00" },
      });
    }, "captured");
    const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    // A replay describes the same payment; it does not dispense the recorded change again.
    expect(out.ticket.total).toBe("1.50");
    expect(out.ticket.tender).toEqual({ method: "cash", change: "3.50" });
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50", tipAmount: "0.00" }]);
  });

  it("a capture whose payment cannot be associated rolls back the whole sale (P3 is atomic)", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const id = randomUUID();
    // The provider reports `captured` but wrote no `payments` row, so the association throws
    // `payment.not_found`: P3 must re-raise it, and the sale must roll back.
    const provider = cannedProvider(() => Promise.resolve(), "captured");
    const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

    await expect(
      payWorkingOrderIntegrated(deps, cfg, {
        id,
        zoneId: cafe.zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      }),
    ).rejects.toMatchObject({ code: "payment.not_found" });

    // Rolled back; the walk-up order committed in P1 stays `open`.
    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
  });

  it("returns an empty qr when the fiscal backend offers no verification url", async () => {
    // `FakeFiscalBackend`'s records carry no verification link, so the ticket's `qr` default of ""
    // is exercised.
    const { cfg, cafe } = await setupVenue();
    await FakeFiscalBackend.install(suite.db);
    const fake = new FakeFiscalBackend(suite.db);
    await withTransaction(suite.db, async (tx) => {
      await fake.registerNode(tx, cfg.nodeId);
    });
    const app = suite.db;
    const provider = new StripeTerminalProvider({
      client: new FakeStripe(),
      db: app,
      nodeId: cfg.nodeId,
      poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
    });
    const deps: IntegratedPayDeps = {
      db: app,
      backend: fake,
      clock,
      provider,
      readerRef: "reader_1",
    };

    const out = await payWorkingOrderIntegrated(deps, cfg, {
      id: randomUUID(),
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.qr).toBe("");
  });
});

// A captured payment with no sale (P2 committed, P3 never ran) must be finished WITHOUT charging
// again. The state is seeded directly, as the row `collect` leaves behind.
describe("payWorkingOrderIntegrated — capture idempotency (recovery window + concurrency)", () => {
  /** Seed an OPEN order with a locked café line and a captured stripe payment whose `sale_id` is
   *  NULL. `capturedAmount` is the gross the card was charged. */
  async function seedLostCapture(
    cfg: TillConfig,
    cafe: OfferedProduct,
    quantity: string,
    capturedAmount: string,
  ): Promise<{ id: string; externalRef: string }> {
    const id = randomUUID();
    // Payment refs are unique per provider across the database.
    const externalRef = `pi_lost_${randomUUID()}`;
    await withTransaction(suite.db, async (tx) => {
      await createOpenOrder(tx, cfg, id, [{ menuItemId: cafe.menuItemId, quantity }], null, {
        zoneId: cafe.zoneId,
      });
      await insertCapturedPayment(tx, {
        workingOrderId: id,
        provider: "stripe",
        paymentRef: `pi-ref-${randomUUID()}`,
        amount: decimal(capturedAmount),
        settledAt: new Date(),
        externalRef,
      });
    });
    return { id, externalRef };
  }

  it("recovers a lost-T2 captured payment: files from locked lines, no re-charge, links the existing row", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app);
    // Locked total 1.50; the captured charge was exactly the total (no tip).
    const { id, externalRef } = await seedLostCapture(cfg, cafe, "1", "1.50");

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.total).toBe("1.50");
    // Recovery skips P2: no second PaymentIntent, and still ONE payment row, now linked.
    expect(client.lastCreateIntent).toBeUndefined();
    expect(await paymentCount(id)).toBe(1);
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await preparationTicketCount(id)).toBe(1);
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
    // A recovered walk-up is still a walk-up: its handover marker stays NULL.
    expect(await collectedAtSet(id)).toBe(false);
    const payments = await paymentsFor(id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.state).toBe("captured");
    expect(payments[0]!.externalRef).toBe(externalRef); // the EXISTING row, not a fresh one
    expect(payments[0]!.linkedToSale).toBe(true);
  });

  it("recovers a lost capture whose product has since sold out: the card was charged, so it files", async () => {
    const { cfg, cafe } = await setupVenue();
    const { deps } = integratedDeps(cfg, suite.db);
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.50");
    suite.db.run(sql`update products set available = 0 where id = ${cafe.id}`);

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(await filedSaleTotal(id)).toBe("1.50");
  });

  it("refuses a fresh card payment before the reader is asked when a line never sent has sold out", async () => {
    const { cfg, cafe } = await setupVenue();
    const { deps, client } = integratedDeps(cfg, suite.db);
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    suite.db.run(sql`update products set available = 0 where id = ${cafe.id}`);

    await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
      code: "product.unavailable",
      params: { productId: cafe.id },
    });
    expect(client.lastCreateIntent).toBeUndefined();
    expect(await saleCount(id)).toBe(0);
  });

  it("recovers a lost-T2 capture on a PLACED order: files, stamps collected_at, drops from the station queue", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);
    const app = suite.db;
    // A placed ticket_then_pay order whose card collect captured but lost P3. With no outstanding
    // invoice this is `recover`, not `recover-settle`.
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);
    await withTransaction(suite.db, async (tx) => {
      await insertCapturedPayment(tx, {
        workingOrderId: id,
        provider: "stripe",
        paymentRef: `pi-ref-${randomUUID()}`,
        amount: decimal("1.50"),
        settledAt: new Date(),
        externalRef: `pi_lost_${randomUUID()}`,
      });
    });
    expect(await stationQueueOrderIds(station)).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    const { deps, client } = integratedDeps(cfg, app);
    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent).toBeUndefined(); // recovery skips P2 — no re-charge
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await paymentCount(id)).toBe(1);
    expect(await preparationTicketCount(id)).toBe(1); // placement fired it; recovery did not re-fire
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    // A recovered placed collect leaves its station queue.
    expect(await collectedAtSet(id)).toBe(true);
    expect(await stationQueueOrderIds(station)).toEqual([]);
  });

  it("recovers with a reconstructed tip when the captured amount exceeds the locked total", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app);
    // Locked total 1.50, captured 1.80 → the tip is reconstructed as 1.80 − 1.50 = 0.30.
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.80");

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent).toBeUndefined(); // no re-charge
    // The fiscal total stays ex-tip; the tender carries the whole charge with the tip.
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
    expect(await paymentCount(id)).toBe(1);
    expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
  });

  it("a captured amount BELOW the locked total is corruption: files nothing, leaves the payment for reconcile", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const { deps, client } = integratedDeps(cfg, app);
    // The charge cannot cover the locked total: there is no honest figure to file, so recovery
    // files NOTHING and throws, leaving the captured payment for reconciliation.
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.00");

    await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toBeDefined();

    expect(client.lastCreateIntent).toBeUndefined(); // never re-charged
    // No sale, no registro; the order stays open; the captured payment is untouched (still an orphan).
    expect(await saleCount(id)).toBe(0);
    expect(await registroCount(id)).toBe(0);
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    expect(await rawPaymentsFor(id)).toEqual([{ state: "captured", hasSale: false }]);
  });

  it("two concurrent pays for one parked order file ONE sale; the loser replays (one sale/settlement)", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Mesa 7",
    });

    // Two orchestrations, each with its own reader, pay the SAME parked order, interleaved by
    // `Promise.allSettled`. P1 commits before `collect`, so both capture; P3's duplicate backstop
    // files exactly one sale and the loser replays.
    const { deps: depsA } = integratedDeps(cfg, suite.db);
    const { deps: depsB } = integratedDeps(cfg, suite.db);
    const req = { id, lines: [] };

    const [a, b] = await Promise.allSettled([
      payWorkingOrderIntegrated(depsA, cfg, req),
      payWorkingOrderIntegrated(depsB, cfg, req),
    ]);

    if (a.status !== "fulfilled" || b.status !== "fulfilled") {
      throw new Error(`both pays should settle: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`);
    }
    expect(a.value.outcome).toBe("captured");
    expect(b.value.outcome).toBe("captured");
    if (a.value.outcome !== "captured" || b.value.outcome !== "captured") {
      throw new Error("unreachable");
    }
    expect(a.value.ticket.invoiceNumber).toBe(b.value.ticket.invoiceNumber);
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
  });

  it("two concurrent recoveries of one lost capture file ONE sale; the loser replays", async () => {
    const { cfg, cafe } = await setupVenue();
    // ONE lost capture, TWO retries: one recovers, and the other's transaction runs after that
    // commit, reads `settled`, and replays — no second filing, no second association.
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.50");

    const { deps: depsA } = integratedDeps(cfg, suite.db);
    const { deps: depsB } = integratedDeps(cfg, suite.db);
    const req = { id, lines: [] };

    const [a, b] = await Promise.allSettled([
      payWorkingOrderIntegrated(depsA, cfg, req),
      payWorkingOrderIntegrated(depsB, cfg, req),
    ]);

    if (a.status !== "fulfilled" || b.status !== "fulfilled") {
      throw new Error(
        `both recoveries should settle: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
      );
    }
    expect(a.value.outcome).toBe("captured");
    expect(b.value.outcome).toBe("captured");
    if (a.value.outcome !== "captured" || b.value.outcome !== "captured") {
      throw new Error("unreachable");
    }
    expect(a.value.ticket.invoiceNumber).toBe(b.value.ticket.invoiceNumber);
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await paymentCount(id)).toBe(1);
    expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
  });
});

// Invoice-first: the invoice is issued at placing, so the card collect must SETTLE it rather than
// file again, and associate the captured payment. A decline leaves the invoice outstanding.
describe("payWorkingOrderIntegrated — ordering 1 (invoice-first settle path)", () => {
  /** Park, then `placeOrder` issues the deferred invoice (open → placed), leaving one unsettled
   *  sale. Returns the order id and its sale id. */
  async function placeInvoiceFirst(
    cfg: TillConfig,
    cafe: OfferedProduct,
    quantity = "1",
  ): Promise<{ id: string; saleId: string }> {
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR, cfg.tillId);
    return { id, saleId: await saleIdFor(id) };
  }

  it("settles the already-issued outstanding invoice on capture (settleSale, not recordSale), stamps collected_at, drops from the station queue", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const station = await defaultStationId(cfg);
    const app = suite.db;
    const { id, saleId } = await placeInvoiceFirst(cfg, cafe);
    // Issued at placing and outstanding; placing also fired the order to the default station.
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "1.50" }]);
    expect(await stationQueueOrderIds(station)).toEqual([id]);
    expect(await collectedAtSet(id)).toBe(false);

    const { deps, client } = integratedDeps(cfg, app);
    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.invoiceNumber).toBe("A/1"); // the SAME invoice, read back
    expect(out.ticket.total).toBe("1.50");
    expect(out.ticket.tender.method).toBe("card");
    // Settled, not re-filed.
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await outstandingSalesFor()).toEqual([]);
    // A settle is a counter collect, so the order leaves its station queue.
    expect(await collectedAtSet(id)).toBe(true);
    expect(await stationQueueOrderIds(station)).toEqual([]);
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
    const payments = await paymentsFor(id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.state).toBe("captured");
    expect(payments[0]!.linkedToSale).toBe(true);
    expect(payments[0]!.externalRef).toMatch(/^pi_/);
    expect(client.lastCreateIntent?.amount).toBe("1.50");
  });

  it("tips on: charges amountDue+tip, settles the invoice at the total, records the tip on the tender", async () => {
    const { cfg: baseCfg, cafe } = await modeVenue("invoice_first");
    // `placeInvoiceFirst` dispatches only on `orderFlow`, so the tips override does not affect it.
    const cfg = { ...baseCfg, tipsEnabled: true };
    const app = suite.db;
    const { id } = await placeInvoiceFirst(cfg, cafe);
    const { deps, client } = integratedDeps(cfg, app);

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [], tip: "0.30" });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent?.amount).toBe("1.80");
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
  });

  it("a decline leaves the invoice OUTSTANDING — nothing re-filed or voided; listOutstandingSales still lists it", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = suite.db;
    const { id, saleId } = await placeInvoiceFirst(cfg, cafe);

    const client = new FakeStripe();
    client.declineNext();
    const { deps } = integratedDeps(cfg, app, client);
    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("declined");
    // A decline files and voids NOTHING: the invoice stays outstanding, retryable.
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "1.50" }]);
    expect(await tendersFor(id)).toEqual([]);
    expect(await rawPaymentsFor(id)).toEqual([{ state: "failed", hasSale: false }]);
  });

  it("a concurrent collect that settles the invoice first makes finalizeSettle REPLAY via sale.already_settled", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = suite.db;
    const { id } = await placeInvoiceFirst(cfg, cafe);

    // Mid-`collect` (after P1, before P3) a concurrent cash collect settles the invoice. P3's
    // `settleSale` refuses with `sale.already_settled`, and this replays rather than settling twice.
    const provider = cannedProvider(async () => {
      await collectOrder({ db: suite.db, backend, clock }, cfg, {
        id,
        lines: [],
        tender: { method: "cash", amount: "1.50" },
      });
    }, "captured");
    const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.total).toBe("1.50");
    // Replayed the cash winner's settlement; the integrated pay settled nothing of its own.
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
    expect(await tendersFor(id)).toEqual([{ method: "cash", amount: "1.50", tipAmount: "0.00" }]);
  });

  it("a settle whose payment cannot be associated rolls back — the invoice stays OUTSTANDING (P3 is atomic)", async () => {
    const { cfg, cafe } = await modeVenue("invoice_first");
    const app = suite.db;
    const { id, saleId } = await placeInvoiceFirst(cfg, cafe);

    // The provider reports `captured` but wrote no `payments` row, so the association throws
    // `payment.not_found`: it must be re-raised, and the settlement rolled back.
    const provider = cannedProvider(() => Promise.resolve(), "captured");
    const deps: IntegratedPayDeps = { db: app, backend, clock, provider };

    await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
      code: "payment.not_found",
    });

    // The settlement rolled back: no tender, the order stays PLACED, the invoice is still outstanding.
    expect(await tendersFor(id)).toEqual([]);
    expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
    expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "1.50" }]);
  });

  // A captured payment with no sale on an invoice-first order is recovered by SETTLING the issued
  // invoice: no second charge, and no `recordSale`.
  describe("lost-T2 recovery settles (never re-files)", () => {
    /** Seed a captured stripe payment with a NULL `sale_id` on a placed invoice-first order.
     *  `capturedAmount` is the gross the card was charged. */
    async function seedLostCaptureOnPlaced(id: string, capturedAmount: string): Promise<string> {
      const externalRef = `pi_lost_${randomUUID()}`;
      await withTransaction(suite.db, async (tx) => {
        await insertCapturedPayment(tx, {
          workingOrderId: id,
          provider: "stripe",
          paymentRef: `pi-ref-${randomUUID()}`,
          amount: decimal(capturedAmount),
          settledAt: new Date(),
          externalRef,
        });
      });
      return externalRef;
    }

    it("recovers by settling the issued invoice: no re-charge, no second file, links the existing row, stamps collected_at, drops from the station queue", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const station = await defaultStationId(cfg);
      const app = suite.db;
      const { id } = await placeInvoiceFirst(cfg, cafe); // placing fires the ticket item to the station
      const externalRef = await seedLostCaptureOnPlaced(id, "1.50"); // charged exactly the total
      expect(await stationQueueOrderIds(station)).toEqual([id]);
      expect(await collectedAtSet(id)).toBe(false);

      const { deps, client } = integratedDeps(cfg, app);
      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      // Recovery skips P2: no second charge.
      expect(client.lastCreateIntent).toBeUndefined();
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await paymentCount(id)).toBe(1);
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await outstandingSalesFor()).toEqual([]);
      // An invoice-first recovery is a counter collect, so the order leaves its station queue.
      expect(await collectedAtSet(id)).toBe(true);
      expect(await stationQueueOrderIds(station)).toEqual([]);
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.externalRef).toBe(externalRef); // the EXISTING lost row, not a fresh one
      expect(payments[0]!.linkedToSale).toBe(true);
    });

    it("reconstructs a tip when the captured amount exceeds the amount due", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const app = suite.db;
      const { id } = await placeInvoiceFirst(cfg, cafe);
      await seedLostCaptureOnPlaced(id, "1.80"); // amount due 1.50 → tip reconstructed as 0.30

      const { deps, client } = integratedDeps(cfg, app);
      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

      expect(out.outcome).toBe("captured");
      expect(client.lastCreateIntent).toBeUndefined(); // no re-charge
      // The fiscal total stays ex-tip; the tender carries the whole charge with the tip.
      expect(await filedSaleTotal(id)).toBe("1.50");
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
      expect(await paymentCount(id)).toBe(1);
      expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
    });

    it("a captured amount BELOW the amount due is corruption: settles nothing, leaves the payment for reconcile", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const app = suite.db;
      const { id, saleId } = await placeInvoiceFirst(cfg, cafe);
      await seedLostCaptureOnPlaced(id, "1.00"); // below the 1.50 amount due — cannot even cover it

      const { deps, client } = integratedDeps(cfg, app);
      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toBeDefined();

      expect(client.lastCreateIntent).toBeUndefined(); // never re-charged
      // Nothing settled, and the captured payment is left for reconciliation.
      expect(await tendersFor(id)).toEqual([]);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
      expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "1.50" }]);
      expect(await rawPaymentsFor(id)).toEqual([{ state: "captured", hasSale: false }]);
    });

    it("two concurrent recoveries settle the invoice ONCE; the loser replays", async () => {
      const { cfg, cafe } = await modeVenue("invoice_first");
      const { id } = await placeInvoiceFirst(cfg, cafe);
      await seedLostCaptureOnPlaced(id, "1.50");

      // ONE lost capture, TWO retries: one settles, and the other's transaction runs after that
      // commit, reads `settled`, and replays — one settlement, no second association.
      const { deps: depsA } = integratedDeps(cfg, suite.db);
      const { deps: depsB } = integratedDeps(cfg, suite.db);
      const req = { id, lines: [] };

      const [a, b] = await Promise.allSettled([
        payWorkingOrderIntegrated(depsA, cfg, req),
        payWorkingOrderIntegrated(depsB, cfg, req),
      ]);

      if (a.status !== "fulfilled" || b.status !== "fulfilled") {
        throw new Error(
          `both recoveries should settle: a=${JSON.stringify(a)} b=${JSON.stringify(b)}`,
        );
      }
      expect(a.value.outcome).toBe("captured");
      expect(b.value.outcome).toBe("captured");
      if (a.value.outcome !== "captured" || b.value.outcome !== "captured") {
        throw new Error("unreachable");
      }
      expect(a.value.ticket.invoiceNumber).toBe(b.value.ticket.invoiceNumber);
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
      expect(await paymentCount(id)).toBe(1);
      expect((await paymentsFor(id))[0]!.linkedToSale).toBe(true);
    });
  });
});
