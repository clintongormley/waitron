import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
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
import { hashPassword, hashPin, loginWithPin } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  allocateInvoiceNumber,
  drawerOpens,
  invoiceSeries,
  nodes,
  parties,
  printJobs,
  sales,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  rawCentsToDecimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import {
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  SimulatorPaymentProvider,
} from "@waitron/payments";
import type { PaymentProvider, PaymentResult, PaymentResultState } from "@waitron/payments";
import { listOutstandingSales, recordCorrection } from "@waitron/core";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { FakeSumUp } from "@waitron/payments-sumup/src/testing/fake-sumup.js";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES, VENUE_SERVICE } from "./modules.js";
import type { OrderFlow, TillConfig, DeviceRequestConfig } from "./till-config.js";
import type { ServiceMode } from "@waitron/module";
import { requestBill } from "./bill-request.js";
import {
  addTabRound,
  createOpenOrder,
  listStationQueue,
  listTablesWithState,
  parkOrder,
  placeOrder,
  updateOrderLine,
} from "./working-order.js";
import { createTable } from "./tables.js";
import {
  collectOrder,
  payWorkingOrder,
  payWorkingOrderIntegrated,
  releaseStalePaymentAttempts,
} from "./till-sale.js";
import type { IntegratedPayDeps } from "./till-sale.js";
import { decodeTicket, opensDrawer } from "./testing/decode-ticket.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { cancelLine } from "./testing/cancel-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import {
  seedSessionDevice,
  deviceRequestCfg,
  orderDeviceOrigin,
} from "./testing/session-device.js";

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
  return nifWithControlLetter(70_000_000 + nifCounter);
}

function tillConfigFromVenue(venue: VenueResult): TillConfig {
  return {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    simplifiedInvoiceLimit: null,
  };
}

/** A product with the offer that sells it in the venue's counter zone. */
type OfferedProduct = AvailableProduct & { menuItemId: string; zoneId: string };

interface SeededVenue {
  cfg: DeviceRequestConfig;
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
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignCatalogueToLocation(tx, venue.locationId, cat.id);
    return {
      available: (await listAvailableProducts(tx, cfg.locationId)).products,
      offers: await offerProducts(tx, cfg, { serviceMode: orderFlow, paidWhen: orderFlow }),
    };
  });
  const cafe = available.find((p) => p.name === "Café")!;
  return {
    cfg,
    cafe: { ...cafe, menuItemId: offers.offerFor(cafe.id), zoneId: offers.zoneId },
  };
}

async function modeVenue(mode: OrderFlow): Promise<SeededVenue> {
  const venue = await setupVenue(mode);
  return { ...venue, cfg: { ...venue.cfg } };
}

/** The split-flow deps with a real `StripeTerminalProvider` over `FakeStripe`. A tips-on test
 * overrides `cfg.tipsEnabled`. */
function integratedDeps(
  _cfg: TillConfig,
  app: Database,
  client = new FakeStripe(),
): { deps: IntegratedPayDeps; client: FakeStripe } {
  const provider = new StripeTerminalProvider({
    client,
    db: app,
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

async function makeReceiptPrinter(cfg: DeviceRequestConfig): Promise<string> {
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
    tx.run(
      sql`update devices set receipt_printer_id = ${id}, cash_drawer_printer_id = ${id} where id = ${cfg.origin.deviceId}`,
    );
    return id;
  });
}

/** The receipt payloads enqueued to `printerId`, as the shared `binary` column hands them back. */
async function printJobPayloads(
  cfg: DeviceRequestConfig,
  printerId: string,
): Promise<Uint8Array[]> {
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
async function drawerOpenCount(cfg: DeviceRequestConfig): Promise<number> {
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
async function defaultStationId(cfg: DeviceRequestConfig): Promise<string> {
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

/** The venue's rectificative series. */
function rectificativeSeries(cfg: DeviceRequestConfig): string {
  return suite.db.all<{ id: string }>(sql`
    select id from invoice_series where node_id = ${cfg.nodeId} and purpose = 'rectificative'
  `)[0]!.id;
}

/** Café's 1.50 invoice (a 1.24 base at 21%), reversed whole by a credit note through
 *  `recordCorrection`. */
async function correctToZero(cfg: DeviceRequestConfig, saleId: string): Promise<void> {
  const adminId = suite.db.all<{ id: string }>(sql`select id from persons where role = 'admin'`)[0]!
    .id;
  const deviceId = await seedSessionDevice(suite.db, cfg);
  await withTransaction(suite.db, async (tx) => {
    const session = await loginWithPin(tx, {
      deviceId,
      personId: adminId,
      pin: "1234",
    });
    await recordCorrection(tx, backend, {
      origin: cfg.origin,
      nodeId: cfg.nodeId,
      seriesId: brandSeriesId(rectificativeSeries(cfg)),
      correctsSaleId: brandSaleId(saleId),
      total: "-1.50",
      lines: [
        {
          lineNo: 1,
          name: "Descuento",
          descriptions: { [LOCALE]: "Descuento" },
          quantity: "-1",
          unitPrice: "1.24",
          vatRate: "21.00",
          lineTotal: "-1.24",
        },
      ],
      clock,
      authz: { sessionId: session.id },
    });
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
      Promise.reject(new Error("till-sale-integrated.db.test: resolveClient must never be called")),
  });
});

describe("walk-up invoice preparation", () => {
  const recipient = {
    taxId: "b12345674",
    legalName: "  Cliente SL  ",
    address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
    countryCode: "es",
  };

  it.each(["1", "2001"])(
    "saves a validated F1 recipient with %s coffees before money or filing",
    async (quantity) => {
      const { cfg, cafe } = await setupVenue();
      const id = randomUUID();
      const limited = { ...cfg, simplifiedInvoiceLimit: decimal("3000.00") };
      await withTransaction(suite.db, async (tx) => {
        await createOpenOrder(tx, limited, id, [{ menuItemId: cafe.menuItemId, quantity }], null, {
          zoneId: cafe.zoneId,
          invoiceChoice: {
            invoiceType: "F1",
            recipient,
            recipientNameMaxLength: backend.recipientNameMaxLength,
          },
        });
      });
      const [saved] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
      expect(saved).toMatchObject({
        status: "open",
        revision: 0,
        invoiceType: "F1",
        recipientTaxId: "B12345674",
        recipientLegalName: "Cliente SL",
        recipientAddress: "Calle Mayor 2, 28013 Madrid, Madrid, España",
        recipientCountryCode: "ES",
      });
      expect(await saleCount(id)).toBe(0);
      const paymentRows = suite.db.all(sql`select id from payments where working_order_id = ${id}`);
      expect(paymentRows).toEqual([]);
    },
  );

  it.each([
    { invoiceType: "F1", recipient: { ...recipient, taxId: "B12345675" }, field: "taxId" },
    {
      invoiceType: "F1",
      recipient: { ...recipient, legalName: "x".repeat(121) },
      field: "legalName",
    },
    { invoiceType: "F1", recipient: { ...recipient, address: "Calle Mayor" }, field: "address" },
  ])("refuses invalid walk-up $field without leaving an order or lines", async (request) => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        createOpenOrder(tx, cfg, id, [{ menuItemId: cafe.menuItemId, quantity: "1" }], null, {
          zoneId: cafe.zoneId,
          invoiceChoice: { ...request, recipientNameMaxLength: backend.recipientNameMaxLength },
        }),
      ),
    ).rejects.toMatchObject({
      code: "invoice.recipient_invalid",
      params: { field: request.field },
    });
    expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
    expect(
      await suite.db
        .select()
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([]);
  });

  it.each(["missing", "retired", "other-node"])(
    "refuses a %s full series during preparation and rolls back the basket",
    async (condition) => {
      const { cfg, cafe } = await setupVenue();
      const other =
        condition === "other-node"
          ? (
              await suite.db
                .insert(nodes)
                .values({ locationId: cfg.locationId, name: "Other node" })
                .returning()
            )[0]
          : undefined;
      const full = and(eq(invoiceSeries.nodeId, cfg.nodeId), eq(invoiceSeries.purpose, "full"));
      if (condition === "missing") await suite.db.delete(invoiceSeries).where(full);
      else
        await suite.db
          .update(invoiceSeries)
          .set(
            condition === "retired"
              ? { retiredAt: new Date() }
              : { nodeId: other!.id, code: "other-full" },
          )
          .where(full);
      const before = await suite.db
        .select()
        .from(invoiceSeries)
        .where(eq(invoiceSeries.nodeId, cfg.nodeId));
      const id = randomUUID();
      await expect(
        withTransaction(suite.db, (tx) =>
          createOpenOrder(tx, cfg, id, [{ menuItemId: cafe.menuItemId, quantity: "1" }], null, {
            zoneId: cafe.zoneId,
            invoiceChoice: {
              invoiceType: "F1",
              recipient,
              recipientNameMaxLength: backend.recipientNameMaxLength,
            },
          }),
        ),
      ).rejects.toMatchObject({ code: "series.no_full_for_node" });
      expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual(
        [],
      );
      expect(
        await suite.db
          .select()
          .from(workingOrderLines)
          .where(eq(workingOrderLines.workingOrderId, id)),
      ).toEqual([]);
      expect(
        await suite.db.select().from(invoiceSeries).where(eq(invoiceSeries.nodeId, cfg.nodeId)),
      ).toEqual(before);
      expect(await saleCount(id)).toBe(0);
    },
  );

  it.each([
    {
      invoiceType: ["F1"],
      recipient,
      code: "management.request_invalid",
      params: { field: "invoiceType" },
    },
    {
      invoiceType: null,
      recipient,
      code: "management.request_invalid",
      params: { field: "invoiceType" },
    },
    {
      invoiceType: "F2",
      recipient,
      code: "management.request_invalid",
      params: { field: "recipient" },
    },
    {
      invoiceType: undefined,
      recipient,
      code: "management.request_invalid",
      params: { field: "recipient" },
    },
    {
      invoiceType: "F1",
      recipient: null,
      code: "invoice.recipient_invalid",
      params: { field: "taxId" },
    },
    {
      invoiceType: "F1",
      recipient: "a name",
      code: "invoice.recipient_invalid",
      params: { field: "taxId" },
    },
    {
      invoiceType: "F1",
      recipient: { ...recipient, countryCode: "FR" },
      code: "fiscal.foreign_recipient_unsupported",
      params: { countryCode: "FR" },
    },
  ])("refuses malformed or unsupported walk-up invoice input %#", async (request) => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        createOpenOrder(tx, cfg, id, [{ menuItemId: cafe.menuItemId, quantity: "1" }], null, {
          zoneId: cafe.zoneId,
          invoiceChoice: {
            invoiceType: request.invoiceType,
            recipient: request.recipient,
            recipientNameMaxLength: backend.recipientNameMaxLength,
          },
        }),
      ),
    ).rejects.toMatchObject({ code: request.code, params: request.params });
    expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
  });

  it("keeps explicit F2 at exactly the simplified ceiling without customer fields", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(
        tx,
        { ...cfg, simplifiedInvoiceLimit: decimal("3000.00") },
        id,
        [{ menuItemId: cafe.menuItemId, quantity: "2000" }],
        null,
        {
          zoneId: cafe.zoneId,
          invoiceChoice: {
            invoiceType: "F2",
            recipient: null,
            recipientNameMaxLength: backend.recipientNameMaxLength,
          },
        },
      ),
    );
    const [row] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(row).toMatchObject({
      invoiceType: "F2",
      recipientTaxId: null,
      recipientLegalName: null,
      recipientAddress: null,
      recipientCountryCode: null,
    });
    expect(await saleCount(id)).toBe(0);
  });

  it("still refuses an omitted invoice choice above the simplified ceiling", async () => {
    const { cfg, cafe } = await setupVenue();
    const id = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        createOpenOrder(
          tx,
          { ...cfg, simplifiedInvoiceLimit: decimal("3000.00") },
          id,
          [{ menuItemId: cafe.menuItemId, quantity: "2001" }],
          null,
          { zoneId: cafe.zoneId },
        ),
      ),
    ).rejects.toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
    expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
  });
});

describe("payWorkingOrderIntegrated (split-transaction integrated pay, ordering 2)", () => {
  it("snapshots the zone department's receipt header with a captured card sale", async () => {
    const { cfg, cafe } = await setupVenue();
    suite.db.run(
      sql`update departments set trading_name = 'Deli Counter' where location_id = ${cfg.locationId}`,
    );
    const id = randomUUID();
    const provider = new SimulatorPaymentProvider(suite.db);

    const out = await payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      simulationOutcome: "captured",
    });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.receiptHeader).toMatchObject({
      tradingName: "Deli Counter",
      printTradingName: true,
    });
    const saleId = await saleIdFor(id);
    const receiptHeader = await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.readSaleReceiptHeader(tx, saleId),
    );
    expect(receiptHeader).toMatchObject({
      tradingName: "Deli Counter",
      printTradingName: true,
    });
  });

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

  it("credits a card walk-up's lines to the operator who rang it", async () => {
    const { cfg, cafe } = await setupVenue();
    const app = suite.db;
    const provider = new SimulatorPaymentProvider(app);
    const id = randomUUID();
    const operatorId = "cccccccc-0000-4000-8000-00000000000a";
    await payWorkingOrderIntegrated(
      { db: app, backend, clock, provider },
      cfg,
      {
        id,
        zoneId: cafe.zoneId,
        lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
        simulationOutcome: "captured",
      },
      operatorId,
    );

    expect(
      await app
        .select({ creditedTo: workingOrderLines.creditedTo })
        .from(workingOrderLines)
        .where(eq(workingOrderLines.workingOrderId, id)),
    ).toEqual([{ creditedTo: operatorId }]);
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
    expect(first.ticket.qrText).toEqual({ caption: "QR tributario:", legend: "VERI*FACTU" });
    expect(second.ticket.qrText).toEqual(first.ticket.qrText);
    expect(client.lastCreateIntent).toBe(firstIntent); // no second createPaymentIntent
    expect(await saleCount(id)).toBe(1);
    expect(await registroCount(id)).toBe(1);
    expect(await preparationTicketCount(id)).toBe(1);
    expect(await paymentCount(id)).toBe(1);
  });

  it("auto-prints the customer receipt on an integrated card sale (no kick, no drawer), and a REPLAY does not double-print", async () => {
    // An integrated card's receipt carries no drawer kick and records no `drawer_opens` row; a
    // replay prints nothing more.
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
    expect(decodeTicket(payload)).toContain("VERI*FACTU");
    expect(opensDrawer(payload)).toBe(false);
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

  it("an open ticket_then_pay counter order paid by card sends its dish once, and a replay sends nothing more", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    const { deps } = integratedDeps(cfg, suite.db);

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(await preparationTicketCount(id)).toBe(1);
    expect(await stationQueueOrderIds(station)).toEqual([id]);

    const replay = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });
    expect(replay.outcome).toBe("captured");
    expect(await preparationTicketCount(id)).toBe(1);
    expect(await saleCount(id)).toBe(1);
  });

  it("placed (ticket_then_pay) order: ISSUES the invoice AT PAY from the frozen lines (ordering 2), records no handover, stays on the station queue", async () => {
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
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
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
    // Paying records no handover, so the order stays on its station queue until it is handed over.
    expect(await collectedAtSet(id)).toBe(false);
    expect(await stationQueueOrderIds(station)).toEqual([id]);
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
    // A placed order: its card collect writes no in-flight mark, so a cash collect at another till
    // can still settle it while the reader runs. On an open order that cash pay is refused (plan
    // D22), which the D22 cases below cover.
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const app = suite.db;
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);

    // Mid-`collect` (after P1 committed, before P3) a concurrent cash collect settles this id. P3's
    // `recordSale` is refused by `sales_working_order_id_key` and replays the winner's ticket.
    const provider = cannedProvider(async () => {
      await collectOrder({ db: suite.db, backend, clock }, cfg, {
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
    expect(out.ticket.qrText).toBeUndefined();
  });
});

// A captured payment with no sale (P2 committed, P3 never ran) must be finished WITHOUT charging
// again. The state is seeded directly, as the row `collect` leaves behind.
describe("payWorkingOrderIntegrated — capture idempotency (recovery window + concurrency)", () => {
  /** Seed an OPEN order with a locked café line and a captured stripe payment whose `sale_id` is
   *  NULL. `capturedAmount` is the gross the card was charged. */
  async function seedLostCapture(
    cfg: DeviceRequestConfig,
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
        origin: cfg.origin,
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

  it.each([
    ["captured", "1", "1.50"],
    ["captured", "2001", "3001.50"],
    ["accepted_offline", "1", "1.50"],
    ["accepted_offline", "2001", "3001.50"],
  ] as const)(
    "retains an unfiled F1 %s payment of %s coffees while public issuance is disabled",
    async (state, quantity, amount) => {
      const { cfg, cafe } = await setupVenue();
      suite.db.run(
        sql`update tenants set taxpayer_domicile = 'Calle Mayor 1, 28013 Madrid, Madrid, España'`,
      );
      const id = randomUUID();
      await withTransaction(suite.db, async (tx) => {
        await createOpenOrder(tx, cfg, id, [{ menuItemId: cafe.menuItemId, quantity }], null, {
          zoneId: cafe.zoneId,
          invoiceChoice: {
            invoiceType: "F1",
            recipient: {
              taxId: "B12345674",
              legalName: "Cliente SL",
              address: "Calle Mayor 2, 28013 Madrid, Madrid, España",
              countryCode: "ES",
            },
            recipientNameMaxLength: backend.recipientNameMaxLength,
          },
        });
        const insert = state === "captured" ? insertCapturedPayment : insertAcceptedOffline;
        await insert(tx, {
          origin: cfg.origin,
          workingOrderId: id,
          provider: "stripe",
          paymentRef: `pi-ref-${randomUUID()}`,
          amount: decimal(amount),
          settledAt: new Date(),
          externalRef: `pi_lost_${randomUUID()}`,
        });
      });
      const before = {
        orders: suite.db.all(sql`select * from working_orders order by id`),
        lines: suite.db.all(sql`select * from working_order_lines order by id`),
        payments: suite.db.all(sql`select * from payments order by id`),
        series: suite.db.all(sql`select * from invoice_series order by id`),
        fiscal: suite.db.all(sql`select * from registros_facturacion order by id`),
        jobs: suite.db.all(sql`select * from print_jobs order by id`),
      };
      const { deps, client } = integratedDeps(cfg, suite.db);

      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
        code: "sale.full_invoice_unavailable",
        params: {},
      });

      expect(client.lastCreateIntent).toBeUndefined();
      expect(await saleCount(id)).toBe(0);
      expect(await tendersFor(id)).toEqual([]);
      expect(await paymentCount(id)).toBe(1);
      expect(
        suite.db.all(sql`select state, sale_id from payments where working_order_id = ${id}`),
      ).toEqual([{ state, sale_id: null }]);
      expect({
        orders: suite.db.all(sql`select * from working_orders order by id`),
        lines: suite.db.all(sql`select * from working_order_lines order by id`),
        payments: suite.db.all(sql`select * from payments order by id`),
        series: suite.db.all(sql`select * from invoice_series order by id`),
        fiscal: suite.db.all(sql`select * from registros_facturacion order by id`),
        jobs: suite.db.all(sql`select * from print_jobs order by id`),
      }).toEqual(before);
    },
  );

  it("snapshots the original zone department when a captured card payment is recovered", async () => {
    const { cfg, cafe } = await setupVenue();
    suite.db.run(
      sql`update departments set trading_name = 'Deli Counter' where location_id = ${cfg.locationId}`,
    );
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.50");
    const { deps } = integratedDeps(cfg, suite.db);

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.receiptHeader).toMatchObject({
      tradingName: "Deli Counter",
      printTradingName: true,
    });
    const saleId = await saleIdFor(id);
    const receiptHeader = await withTransaction(suite.db, (tx) =>
      VENUE_SERVICE.readSaleReceiptHeader(tx, saleId),
    );
    expect(receiptHeader).toMatchObject({
      tradingName: "Deli Counter",
      printTradingName: true,
    });
  });

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
    expect(out.ticket.qrText).toEqual({ caption: "QR tributario:", legend: "VERI*FACTU" });
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

  it("files a recovered capture under the device that took the card, not the one retrying", async () => {
    const { cfg, cafe } = await setupVenue();
    const { deps } = integratedDeps(cfg, suite.db);
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.50");
    const retrying = await deviceRequestCfg(suite.db, cfg);
    expect(retrying.origin.deviceId).not.toBe(cfg.origin.deviceId);

    const out = await payWorkingOrderIntegrated(deps, retrying, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(
      suite.db.all(sql`select source, device_id from sales where working_order_id = ${id}`),
    ).toEqual([{ source: "device", device_id: cfg.origin.deviceId }]);
  });

  it("recovers a lost capture on an open ticket_then_pay counter order: sends its dish once", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const { deps, client } = integratedDeps(cfg, suite.db);
    const { id } = await seedLostCapture(cfg, cafe, "1", "1.50");

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [] });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent).toBeUndefined();
    expect(await saleCount(id)).toBe(1);
    expect(await preparationTicketCount(id)).toBe(1);
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

  it("recovers a lost-T2 capture on a PLACED order: files, records no handover, stays on the station queue", async () => {
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
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
    await withTransaction(suite.db, async (tx) => {
      await insertCapturedPayment(tx, {
        origin: cfg.origin,
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
    expect(await collectedAtSet(id)).toBe(false);
    expect(await stationQueueOrderIds(station)).toEqual([id]);
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

  it("two concurrent pays for one placed order file ONE sale; the loser replays (one sale/settlement)", async () => {
    // Placed, because a second card pay of an OPEN order is refused while the first runs (plan
    // D22); a placed order's collect writes no mark, so both still reach the reader.
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
      label: "Mesa 7",
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);

    // Two orchestrations, each with its own reader, pay the SAME placed order, interleaved by
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

describe("payWorkingOrderIntegrated — already-issued bill settlement", () => {
  /** Place an order and seed an unpaid invoice for the settlement tests. */
  async function placedIssuedBill(
    cfg: DeviceRequestConfig,
    cafe: OfferedProduct,
    quantity = "1",
  ): Promise<{ id: string; saleId: string }> {
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
    await issueOrderInvoice({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
    return { id, saleId: await saleIdFor(id) };
  }

  it("settles the already-issued outstanding invoice on capture (settleSale, not recordSale), records no handover, stays on the station queue", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const station = await defaultStationId(cfg);
    const app = suite.db;
    const { id, saleId } = await placedIssuedBill(cfg, cafe);
    // The seeded invoice is outstanding; placement fired the order to the default station.
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
    expect(await collectedAtSet(id)).toBe(false);
    expect(await stationQueueOrderIds(station)).toEqual([id]);
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
    const payments = await paymentsFor(id);
    expect(payments).toHaveLength(1);
    expect(payments[0]!.state).toBe("captured");
    expect(payments[0]!.linkedToSale).toBe(true);
    expect(payments[0]!.externalRef).toMatch(/^pi_/);
    expect(client.lastCreateIntent?.amount).toBe("1.50");
  });

  it("tips on: charges amountDue+tip, settles the invoice at the total, records the tip on the tender", async () => {
    const { cfg: baseCfg, cafe } = await modeVenue("ticket_then_pay");
    const cfg = { ...baseCfg, tipsEnabled: true };
    const app = suite.db;
    const { id } = await placedIssuedBill(cfg, cafe);
    const { deps, client } = integratedDeps(cfg, app);

    const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [], tip: "0.30" });

    expect(out.outcome).toBe("captured");
    expect(client.lastCreateIntent?.amount).toBe("1.80");
    expect(await filedSaleTotal(id)).toBe("1.50");
    expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.80", tipAmount: "0.30" }]);
    expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
  });

  it("a decline leaves the invoice OUTSTANDING — nothing re-filed or voided; listOutstandingSales still lists it", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const app = suite.db;
    const { id, saleId } = await placedIssuedBill(cfg, cafe);

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
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const app = suite.db;
    const { id } = await placedIssuedBill(cfg, cafe);

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
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const app = suite.db;
    const { id, saleId } = await placedIssuedBill(cfg, cafe);

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

  describe("a bill whose corrections leave nothing owed", () => {
    it("closes the bill without asking the reader, writing no tender and no payment", async () => {
      const { cfg: baseCfg, cafe } = await modeVenue("ticket_then_pay");
      const cfg = { ...baseCfg, tipsEnabled: true };
      const station = await defaultStationId(cfg);
      const { id, saleId } = await placedIssuedBill(cfg, cafe);
      await correctToZero(cfg, saleId);
      expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "0.00" }]);
      expect(await stationQueueOrderIds(station)).toEqual([id]);
      expect(await collectedAtSet(id)).toBe(false);
      const { deps, client } = integratedDeps(cfg, suite.db);

      const out = await payWorkingOrderIntegrated(deps, cfg, { id, lines: [], tip: "0.30" });

      expect(client.lastCreateIntent).toBeUndefined();
      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.invoiceNumber).toBe("A/1");
      expect(out.ticket.total).toBe("1.50");
      expect(out.ticket.tender).toEqual({ method: "unpaid" });
      expect(await tendersFor(id)).toEqual([]);
      expect(await paymentCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await collectedAtSet(id)).toBe(false);
      expect(await stationQueueOrderIds(station)).toEqual([id]);
      expect(await outstandingSalesFor()).toEqual([]);
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
    });

    it("refuses a malformed tip without asking the reader, and leaves the bill open", async () => {
      const { cfg: baseCfg, cafe } = await modeVenue("ticket_then_pay");
      const cfg = { ...baseCfg, tipsEnabled: true };
      const { id, saleId } = await placedIssuedBill(cfg, cafe);
      await correctToZero(cfg, saleId);
      const { deps, client } = integratedDeps(cfg, suite.db);

      await expect(
        payWorkingOrderIntegrated(deps, cfg, { id, lines: [], tip: "not-money" }),
      ).rejects.toMatchObject({ code: "shared.invalid_decimal", params: { value: "not-money" } });

      expect(client.lastCreateIntent).toBeUndefined();
      expect(await tendersFor(id)).toEqual([]);
      expect(await paymentCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
      expect(await collectedAtSet(id)).toBe(false);
      expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "0.00" }]);
    });

    it("two pays at once close the bill once, and neither asks the reader", async () => {
      const { cfg, cafe } = await modeVenue("ticket_then_pay");
      const { id, saleId } = await placedIssuedBill(cfg, cafe);
      await correctToZero(cfg, saleId);
      const { deps: depsA, client: clientA } = integratedDeps(cfg, suite.db);
      const { deps: depsB, client: clientB } = integratedDeps(cfg, suite.db);
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
      expect(clientA.lastCreateIntent).toBeUndefined();
      expect(clientB.lastCreateIntent).toBeUndefined();
      expect(await tendersFor(id)).toEqual([]);
      expect(await paymentCount(id)).toBe(0);
      expect(await saleCount(id)).toBe(1);
      expect(await registroCount(id)).toBe(1);
      expect(await orderState(id)).toEqual({ status: "settled", settledAtSet: true });
      expect(await outstandingSalesFor()).toEqual([]);
    });

    it("refuses a bill already below zero with the domain code, without asking the reader", async () => {
      const { cfg, cafe } = await modeVenue("ticket_then_pay");
      const { id, saleId } = await placedIssuedBill(cfg, cafe);
      // Written straight to `sales`: `recordCorrection` refuses a correction this large, but a
      // bill below zero must still be refused at collection. No fiscal record is written for it.
      await withTransaction(suite.db, async (tx) => {
        const seriesId = rectificativeSeries(cfg);
        const now = clock.now();
        await tx.insert(sales).values({
          source: cfg.origin.source,
          deviceId: cfg.origin.deviceId,
          nodeId: cfg.nodeId,
          seriesId,
          invoiceNumber: await allocateInvoiceNumber(tx, seriesId),
          issuedAt: now.instant.toISOString(),
          issuedOffsetMinutes: now.offsetMinutes,
          total: -200,
          vatBreakdown: [{ rate: "21.00", base: "-1.65", tax: "-0.35" }],
          locale: LOCALE,
          invoiceLocales: [LOCALE],
          fiscalBackend: backend.id,
          fiscalState: "recorded",
          correctsSaleId: saleId,
        });
      });
      const { deps, client } = integratedDeps(cfg, suite.db);

      await expect(payWorkingOrderIntegrated(deps, cfg, { id, lines: [] })).rejects.toMatchObject({
        code: "sale.tender_shortfall",
        params: { due: "-0.50", charged: "0" },
      });

      expect(client.lastCreateIntent).toBeUndefined();
      expect(await tendersFor(id)).toEqual([]);
      expect(await paymentCount(id)).toBe(0);
      expect(await orderState(id)).toEqual({ status: "placed", settledAtSet: false });
      expect(await collectedAtSet(id)).toBe(false);
      expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "-0.50" }]);
    });
  });

  describe("lost-T2 recovery settles (never re-files)", () => {
    async function seedLostCaptureOnPlaced(id: string, capturedAmount: string): Promise<string> {
      const externalRef = `pi_lost_${randomUUID()}`;
      const origin = await orderDeviceOrigin(suite.db, id);
      await withTransaction(suite.db, async (tx) => {
        await insertCapturedPayment(tx, {
          origin,
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

    it("recovers by settling the issued invoice: no re-charge, no second file, links the existing row, records no handover, stays on the station queue", async () => {
      const { cfg, cafe } = await modeVenue("ticket_then_pay");
      const station = await defaultStationId(cfg);
      const app = suite.db;
      const { id } = await placedIssuedBill(cfg, cafe); // placing fires the ticket item to the station
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
      expect(await collectedAtSet(id)).toBe(false);
      expect(await stationQueueOrderIds(station)).toEqual([id]);
      expect(await tendersFor(id)).toEqual([{ method: "card", amount: "1.50", tipAmount: "0.00" }]);
      const payments = await paymentsFor(id);
      expect(payments).toHaveLength(1);
      expect(payments[0]!.externalRef).toBe(externalRef); // the EXISTING lost row, not a fresh one
      expect(payments[0]!.linkedToSale).toBe(true);
    });

    it("reconstructs a tip when the captured amount exceeds the amount due", async () => {
      const { cfg, cafe } = await modeVenue("ticket_then_pay");
      const app = suite.db;
      const { id } = await placedIssuedBill(cfg, cafe);
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
      const { cfg, cafe } = await modeVenue("ticket_then_pay");
      const app = suite.db;
      const { id, saleId } = await placedIssuedBill(cfg, cafe);
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
      const { cfg, cafe } = await modeVenue("ticket_then_pay");
      const { id } = await placedIssuedBill(cfg, cafe);
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

describe("an order being paid by card cannot be changed from another device (plan D22)", () => {
  /** The simulator, held in P2 until `release`: it writes no payment row until it is released, which
   * is what shows the guard reads the order's own mark and not the payments store. */
  class PausedSimulator extends SimulatorPaymentProvider {
    readonly entered: Promise<void>;
    release!: () => void;
    private signal!: () => void;
    private readonly gate: Promise<void>;

    constructor(db: Database) {
      super(db);
      this.entered = new Promise((resolve) => (this.signal = resolve));
      this.gate = new Promise((resolve) => (this.release = resolve));
    }

    override async collect(params: Parameters<PaymentProvider["collect"]>[0]) {
      this.signal();
      await this.gate;
      return super.collect(params);
    }
  }

  /** Two open tabs in a tables zone, each with one café line. */
  async function twoTabs() {
    const venue = await setupVenue();
    const { cfg, cafe } = venue;
    const { tabId, otherId, menuItemId } = await withTransaction(suite.db, async (tx) => {
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const offer = offers.offerFor(cafe.id);
      const tab = async (label: string) => {
        const table = await createTable(tx, cfg, { label, zoneId: offers.zoneId });
        const { tabId: id } = await openPartyTab(tx, cfg, { tableId: table.id });
        await addTabRound(tx, cfg, id, [{ menuItemId: offer, quantity: "2" }]);
        return id;
      };
      return { tabId: await tab("T1"), otherId: await tab("T2"), menuItemId: offer };
    });
    return { ...venue, tabId, otherId, menuItemId };
  }
  type Tabs = Awaited<ReturnType<typeof twoTabs>>;

  async function markOf(id: string): Promise<string | null> {
    const [row] = await suite.db
      .select({ at: workingOrders.paymentAttemptAt })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    return row!.at;
  }

  /** One pass of the server loop's release. */
  async function releaseLoopPass(): Promise<number> {
    return releaseStalePaymentAttempts(suite.db);
  }

  async function setMark(id: string, at: string): Promise<void> {
    await suite.db
      .update(workingOrders)
      .set({ paymentAttemptAt: at })
      .where(eq(workingOrders.id, id));
  }

  async function revisionOf(id: string): Promise<number> {
    const [row] = await suite.db
      .select({ revision: workingOrders.revision })
      .from(workingOrders)
      .where(eq(workingOrders.id, id));
    return row!.revision;
  }

  /** A new round, a line edit and a void, each in its own transaction, on `id`. */
  function writes(t: Tabs, id: string): (() => Promise<unknown>)[] {
    return [
      () =>
        withTransaction(suite.db, (tx) =>
          addTabRound(tx, t.cfg, id, [{ menuItemId: t.menuItemId, quantity: "1" }]),
        ),
      async () => {
        const revision = await revisionOf(id);
        return withTransaction(suite.db, (tx) =>
          updateOrderLine(tx, t.cfg, id, 1, { note: "sin azúcar" }, revision),
        );
      },
      () => withTransaction(suite.db, (tx) => cancelLine(tx, t.cfg, id, 1, "1")),
    ];
  }

  it("refuses a round, a line edit and a void while the reader runs; the capture then files and clears the mark", async () => {
    const t = await twoTabs();
    const provider = new PausedSimulator(suite.db);
    const paying = payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider }, t.cfg, {
      id: t.tabId,
      lines: [],
      simulationOutcome: "captured",
    });
    await provider.entered;

    expect(await markOf(t.tabId)).not.toBeNull();
    // The control: nothing is in the payments store while the reader runs.
    expect(await paymentCount(t.tabId)).toBe(0);
    const before = await revisionOf(t.tabId);
    for (const write of writes(t, t.tabId)) {
      await expect(write()).rejects.toMatchObject({
        code: "order.payment_in_flight",
        params: { workingOrderId: t.tabId },
      });
    }
    expect(await revisionOf(t.tabId)).toBe(before);
    // A different order is never blocked.
    for (const write of writes(t, t.otherId)) await write();
    expect(await markOf(t.otherId)).toBeNull();

    provider.release();
    const out = await paying;

    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    // P3 files what P1 priced: the two cafés the order held when Pay was pressed.
    expect(out.ticket.total).toBe("3.00");
    expect(await orderState(t.tabId)).toEqual({ status: "settled", settledAtSet: true });
    expect(await markOf(t.tabId)).toBeNull();
    // The settled order is closed to writes, and says so rather than that a payment is running.
    await expect(writes(t, t.tabId)[0]!()).rejects.toMatchObject({ code: "tab.not_open" });
  });

  it("a declined card clears the mark, and the order takes a round, an edit and a void again", async () => {
    const t = await twoTabs();
    const provider = new PausedSimulator(suite.db);
    const paying = payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider }, t.cfg, {
      id: t.tabId,
      lines: [],
      simulationOutcome: "declined",
    });
    await provider.entered;
    expect(await markOf(t.tabId)).not.toBeNull();
    provider.release();

    expect(await paying).toEqual({ outcome: "declined" });
    expect(await markOf(t.tabId)).toBeNull();
    const before = await revisionOf(t.tabId);
    for (const write of writes(t, t.tabId)) await write();
    expect(await revisionOf(t.tabId)).toBe(before + 3);
  });

  it("a reader that throws clears the mark before the error reaches the till", async () => {
    const t = await twoTabs();
    const provider = new PausedSimulator(suite.db);
    provider.collect = () => Promise.reject(new Error("reader unreachable"));

    await expect(
      payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider }, t.cfg, {
        id: t.tabId,
        lines: [],
      }),
    ).rejects.toThrow("reader unreachable");
    expect(await markOf(t.tabId)).toBeNull();
    for (const write of writes(t, t.tabId)) await write();
  });

  it("a second card payment of the order from another till is refused while the first runs, and never reaches its reader", async () => {
    const t = await twoTabs();
    const first = new PausedSimulator(suite.db);
    const firstPay = payWorkingOrderIntegrated(
      { db: suite.db, backend, clock, provider: first },
      t.cfg,
      { id: t.tabId, lines: [], simulationOutcome: "captured" },
    );
    await first.entered;

    let secondReaderAsked = false;
    const second = cannedProvider(() => {
      secondReaderAsked = true;
      return Promise.resolve();
    }, "captured");
    await expect(
      payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider: second }, t.cfg, {
        id: t.tabId,
        lines: [],
      }),
    ).rejects.toMatchObject({
      code: "order.payment_in_flight",
      params: { workingOrderId: t.tabId },
    });
    expect(secondReaderAsked).toBe(false);

    first.release();
    const out = await firstPay;
    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    expect(out.ticket.total).toBe("3.00");
    expect(await saleCount(t.tabId)).toBe(1);
    expect(await markOf(t.tabId)).toBeNull();
  });

  it("the loop never releases the mark of an attempt still running in this process, however old", async () => {
    const t = await twoTabs();
    const provider = new PausedSimulator(suite.db);
    const paying = payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider }, t.cfg, {
      id: t.tabId,
      lines: [],
      simulationOutcome: "captured",
    });
    await provider.entered;
    // Far older than any reader waits: only the attempt being live can keep it.
    await setMark(t.tabId, "2020-01-01T00:00:00.000Z");

    await releaseLoopPass();

    expect(await markOf(t.tabId)).toBe("2020-01-01T00:00:00.000Z");
    const before = await revisionOf(t.tabId);
    await expect(writes(t, t.tabId)[0]!()).rejects.toMatchObject({
      code: "order.payment_in_flight",
    });
    provider.release();
    const out = await paying;
    expect(out.outcome).toBe("captured");
    if (out.outcome !== "captured") throw new Error("unreachable");
    // The two cafés the order held at Pay, and no round added while the reader ran.
    expect(out.ticket.total).toBe("3.00");
    expect(await revisionOf(t.tabId)).toBe(before);
  });

  describe("a SumUp reader that stops polling before the card is resolved", () => {
    /** Pay by SumUp with the checkout left pending, so `collect` returns `attempting` with the
     * payment row still `attempting`. */
    async function timedOut() {
      const t = await twoTabs();
      const client = new FakeSumUp();
      const provider = new SumUpCloudProvider({
        client,
        db: suite.db,
        incidents: () => Promise.resolve(false),
        poll: { maxAttempts: 2, intervalMs: 0, sleep: () => Promise.resolve() },
      });
      const deps: IntegratedPayDeps = { db: suite.db, backend, clock, provider, readerRef: "rdr" };
      client.stallNext();
      expect(await payWorkingOrderIntegrated(deps, t.cfg, { id: t.tabId, lines: [] })).toEqual({
        outcome: "timeout",
      });
      const [row] = suite.db.all<{ ref: string }>(
        sql`select external_ref as ref from payments where working_order_id = ${t.tabId}`,
      );
      return { t, client, provider, deps, checkout: row!.ref };
    }

    it("keeps the mark, so edits and a second Pay are refused while SumUp may still capture it", async () => {
      const { t, deps } = await timedOut();

      expect(await markOf(t.tabId)).not.toBeNull();
      await releaseLoopPass();
      expect(await markOf(t.tabId)).not.toBeNull();
      for (const write of writes(t, t.tabId)) {
        await expect(write()).rejects.toMatchObject({ code: "order.payment_in_flight" });
      }
      await expect(
        payWorkingOrderIntegrated(deps, t.cfg, { id: t.tabId, lines: [] }),
      ).rejects.toMatchObject({ code: "order.payment_in_flight" });
      expect(await rawPaymentsFor(t.tabId)).toEqual([{ state: "attempting", hasSale: false }]);
    });

    it("is released by the loop once the sweep resolves the attempt as failed", async () => {
      const { t, client, provider, checkout } = await timedOut();

      client.decline(checkout);
      await provider.resolvePending(new Date());
      await releaseLoopPass();

      expect(await markOf(t.tabId)).toBeNull();
      for (const write of writes(t, t.tabId)) await write();
    });

    it("stays after the sweep captures it, until Pay files the captured payment", async () => {
      const { t, client, provider, deps, checkout } = await timedOut();

      client.settle(checkout);
      await provider.resolvePending(new Date());
      await releaseLoopPass();

      expect(await markOf(t.tabId)).not.toBeNull();
      await expect(writes(t, t.tabId)[2]!()).rejects.toMatchObject({
        code: "order.payment_in_flight",
      });
      const out = await payWorkingOrderIntegrated(deps, t.cfg, { id: t.tabId, lines: [] });
      expect(out.outcome).toBe("captured");
      if (out.outcome !== "captured") throw new Error("unreachable");
      expect(out.ticket.total).toBe("3.00");
      expect(await tendersFor(t.tabId)).toEqual([
        { method: "card", amount: "3.00", tipAmount: "0.00" },
      ]);
      expect(await markOf(t.tabId)).toBeNull();
    });
  });

  describe("when clearing the mark after an attempt that filed nothing fails", () => {
    /** Refuse, until dropped, any write that clears this order's mark. */
    function refuseRelease(id: string): () => void {
      const name = `test_refuse_release_${id.replaceAll("-", "_")}`;
      suite.db.run(
        sql.raw(`create trigger ${name} before update of payment_attempt_at on working_orders
          when old.id = '${id}' and new.payment_attempt_at is null
          begin select raise(abort, 'release refused'); end`),
      );
      return () => suite.db.run(sql.raw(`drop trigger ${name}`));
    }

    it("a decline is still reported as a decline, and the failure is logged", async () => {
      const t = await twoTabs();
      const logged: unknown[][] = [];
      const log: Logger = (...args) => void logged.push(args);
      const drop = refuseRelease(t.tabId);
      try {
        expect(
          await payWorkingOrderIntegrated(
            { db: suite.db, backend, clock, provider: new SimulatorPaymentProvider(suite.db), log },
            t.cfg,
            { id: t.tabId, lines: [], simulationOutcome: "declined" },
          ),
        ).toEqual({ outcome: "declined" });
      } finally {
        drop();
      }
      expect(logged).toEqual([
        [
          "warn",
          "payment_attempt.release_failed",
          { workingOrderId: t.tabId, error: expect.stringContaining("release refused") },
        ],
      ]);
      // The next loop pass clears what this release could not.
      expect(await markOf(t.tabId)).not.toBeNull();
      await releaseLoopPass();
      expect(await markOf(t.tabId)).toBeNull();
    });

    it("a reader that throws still reaches the till with its own error", async () => {
      const t = await twoTabs();
      const logged: unknown[][] = [];
      const log: Logger = (...args) => void logged.push(args);
      const provider = new PausedSimulator(suite.db);
      provider.collect = () => Promise.reject(new Error("reader unreachable"));
      const drop = refuseRelease(t.tabId);
      try {
        await expect(
          payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider, log }, t.cfg, {
            id: t.tabId,
            lines: [],
          }),
        ).rejects.toThrow("reader unreachable");
      } finally {
        drop();
      }
      expect(logged.map((entry) => entry[1])).toEqual(["payment_attempt.release_failed"]);
    });
  });

  it("a pay pressed again over a mark a crash left is not refused by it, and clears it", async () => {
    const t = await twoTabs();
    await setMark(t.tabId, "2026-09-26T10:00:00.000Z");

    const out = await payWorkingOrderIntegrated(
      { db: suite.db, backend, clock, provider: new SimulatorPaymentProvider(suite.db) },
      t.cfg,
      { id: t.tabId, lines: [], simulationOutcome: "captured" },
    );

    expect(out.outcome).toBe("captured");
    expect(await markOf(t.tabId)).toBeNull();
  });

  it("a cash payment of an order a card is paying is refused, filing nothing", async () => {
    const t = await twoTabs();
    await setMark(t.tabId, "2026-09-26T10:00:00.000Z");

    await expect(
      payWorkingOrder({ db: suite.db, backend, clock }, t.cfg, {
        id: t.tabId,
        lines: [],
        tender: { method: "cash", amount: "10.00" },
      }),
    ).rejects.toMatchObject({
      code: "order.payment_in_flight",
      params: { workingOrderId: t.tabId },
    });
    expect(await saleCount(t.tabId)).toBe(0);
    expect(await orderState(t.tabId)).toEqual({ status: "open", settledAtSet: false });
  });

  describe("a mark left by a crash after the card was captured", () => {
    /** The crash: P1 marked the order and P2 captured, and P3 never ran. */
    async function crashedAfterCapture(capturedAmount: string) {
      const t = await twoTabs();
      await setMark(t.tabId, "2026-09-26T10:00:00.000Z");
      await withTransaction(suite.db, (tx) =>
        insertCapturedPayment(tx, {
          origin: t.cfg.origin,
          workingOrderId: t.tabId,
          provider: "stripe",
          paymentRef: `pi-ref-${randomUUID()}`,
          amount: decimal(capturedAmount),
          settledAt: new Date(),
          externalRef: `pi_lost_${randomUUID()}`,
        }),
      );
      return t;
    }

    it("is cleared by the recovery that files the sale", async () => {
      const t = await crashedAfterCapture("3.00");
      const { deps } = integratedDeps(t.cfg, suite.db);

      const out = await payWorkingOrderIntegrated(deps, t.cfg, { id: t.tabId, lines: [] });

      expect(out.outcome).toBe("captured");
      expect(await orderState(t.tabId)).toEqual({ status: "settled", settledAtSet: true });
      expect(await markOf(t.tabId)).toBeNull();
    });

    it("stays when the recovery cannot file, because the captured payment still waits to be filed", async () => {
      const t = await crashedAfterCapture("1.00");
      const { deps } = integratedDeps(t.cfg, suite.db);

      await expect(
        payWorkingOrderIntegrated(deps, t.cfg, { id: t.tabId, lines: [] }),
      ).rejects.toThrow(/below the locked total/);

      expect(await saleCount(t.tabId)).toBe(0);
      await releaseLoopPass();
      expect(await markOf(t.tabId)).toBe("2026-09-26T10:00:00.000Z");
      await expect(writes(t, t.tabId)[0]!()).rejects.toMatchObject({
        code: "order.payment_in_flight",
      });
    });
  });

  it("the loop releases a mark no attempt in this process and no unfiled payment stands behind, on open orders only", async () => {
    const t = await twoTabs();
    const [crashed, attempting, failed, abandoned] = [
      randomUUID(),
      randomUUID(),
      randomUUID(),
      randomUUID(),
    ];
    await withTransaction(suite.db, async (tx) => {
      for (const id of [crashed, attempting, failed, abandoned]) {
        await createOpenOrder(
          tx,
          t.cfg,
          id,
          [{ menuItemId: t.cafe.menuItemId, quantity: "1" }],
          null,
          {
            zoneId: t.cafe.zoneId,
          },
        );
      }
      const payment = (workingOrderId: string) => ({
        origin: t.cfg.origin,
        workingOrderId,
        provider: "sumup",
        paymentRef: randomUUID(),
        amount: decimal("1.50"),
      });
      await insertAttempting(tx, payment(attempting));
      await insertFailedPayment(tx, payment(failed));
      // An unresolved attempt on ANOTHER order does not hold `crashed`'s mark.
      await insertAttempting(tx, payment(t.otherId));
    });
    const mark = "2026-09-26T10:00:00.000Z";
    // A crash's mark with no payment row behind it: the simulator's, or one written before collect.
    await setMark(crashed, mark);
    // A reader attempt the provider has not resolved yet.
    await setMark(attempting, mark);
    // An attempt the provider resolved as failed.
    await setMark(failed, mark);
    // A mark on an order that left `open` cannot be cleared: the transition trigger refuses it.
    await setMark(abandoned, mark);
    suite.db.run(sql`update working_orders set status = 'abandoned' where id = ${abandoned}`);

    await releaseLoopPass();

    expect(await markOf(crashed)).toBeNull();
    expect(await markOf(failed)).toBeNull();
    expect(await markOf(attempting)).toBe(mark);
    expect(await markOf(abandoned)).toBe(mark);
  });

  it("never writes the mark on a placed order it collects", async () => {
    const { cfg, cafe } = await modeVenue("ticket_then_pay");
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: cafe.zoneId,
      lines: [{ menuItemId: cafe.menuItemId, quantity: "1" }],
    });
    await placeOrder({ db: suite.db, backend, clock }, cfg, id, OPERATOR);
    const provider = new PausedSimulator(suite.db);
    const paying = payWorkingOrderIntegrated({ db: suite.db, backend, clock, provider }, cfg, {
      id,
      lines: [],
      simulationOutcome: "captured",
    });
    await provider.entered;

    expect(await markOf(id)).toBeNull();
    provider.release();
    expect((await paying).outcome).toBe("captured");
    expect(await markOf(id)).toBeNull();
  });
});

describe("a party's bill request goes when a card or collect settles its last owing bill", () => {
  /**
   * A party at a table, asking for the bill, with one café on its tab. With `owingSibling`, a second
   * café is split onto another bill of the party, left unpaid. For any other `serviceMode` the tab
   * is then moved to a counter zone serving it, as `collect-by-invoice.test.ts` moves a counter
   * bill: a tab opens only in a `table_tab` zone, and placing a bill there issues no invoice.
   */
  async function partyAskingForBill(serviceMode: ServiceMode, owingSibling = false) {
    const venue = await setupVenue();
    const { cfg, cafe } = venue;
    const seated = await withTransaction(suite.db, async (tx) => {
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const table = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
      const { tabId, partyId } = await openPartyTab(tx, cfg, { tableId: table.id });
      await addTabRound(tx, cfg, tabId, [
        { menuItemId: offers.offerFor(cafe.id), quantity: owingSibling ? "2" : "1" },
      ]);
      if (owingSibling) await splitPartyBill(tx, cfg, tabId, [{ lineNo: 1, quantity: "1" }]);
      if (serviceMode !== "table_tab") {
        const elsewhere = await offerProducts(tx, cfg, { serviceMode });
        await VENUE_SERVICE.retargetOrderContext(tx, cfg, tabId, elsewhere.zoneId);
      }
      const [party] = await tx
        .select({ revision: parties.revision })
        .from(parties)
        .where(eq(parties.id, partyId));
      await requestBill(tx, partyId, true, {
        submissionId: randomUUID(),
        expectedPartyRevision: party!.revision,
        operatorId: OPERATOR,
      });
      return { tabId, partyId, tableId: table.id };
    });
    return { ...venue, ...seated };
  }

  /** Place the tab and seed an outstanding invoice for settlement tests. */
  async function placed(cfg: DeviceRequestConfig, tabId: string): Promise<void> {
    await placeOrder({ db: suite.db, backend, clock }, cfg, tabId, OPERATOR);
    await issueOrderInvoice({ db: suite.db, backend, clock }, cfg, tabId, OPERATOR);
    expect(await outstandingSalesFor()).toHaveLength(1);
  }

  /** A captured card payment of the tab's 1.50 that no sale was filed for. */
  async function lostCapture(tabId: string): Promise<void> {
    const origin = await orderDeviceOrigin(suite.db, tabId);
    await withTransaction(suite.db, (tx) =>
      insertCapturedPayment(tx, {
        origin,
        workingOrderId: tabId,
        provider: "stripe",
        paymentRef: `pi-ref-${randomUUID()}`,
        amount: decimal("1.50"),
        settledAt: new Date(),
        externalRef: `pi_lost_${randomUUID()}`,
      }),
    );
  }

  async function payByCard(cfg: DeviceRequestConfig, tabId: string, log?: Logger): Promise<void> {
    const { deps } = integratedDeps(cfg, suite.db);
    expect(
      (await payWorkingOrderIntegrated({ ...deps, log }, cfg, { id: tabId, lines: [] })).outcome,
    ).toBe("captured");
    expect((await orderState(tabId)).status).toBe("settled");
  }

  async function payInCash(cfg: DeviceRequestConfig, tabId: string, log?: Logger): Promise<void> {
    await payWorkingOrder(
      { db: suite.db, backend, clock, log },
      cfg,
      { id: tabId, lines: [], tender: { method: "cash", amount: "1.50" } },
      OPERATOR,
    );
    expect((await orderState(tabId)).status).toBe("settled");
  }

  async function collectInCash(
    cfg: DeviceRequestConfig,
    tabId: string,
    log?: Logger,
  ): Promise<void> {
    await collectOrder(
      { db: suite.db, backend, clock, log },
      cfg,
      { id: tabId, lines: [], tender: { method: "cash", amount: "1.50" } },
      OPERATOR,
    );
    expect((await orderState(tabId)).status).toBe("settled");
  }

  /** A trigger refusing the clearing of any party's bill request; answers its removal. */
  function refuseClearing(): () => void {
    suite.db.run(
      sql.raw(`create trigger refuse_bill_request_clearing
        before update of bill_requested_at on parties when new.bill_requested_at is null
        begin select raise(abort, 'clearing refused'); end`),
    );
    return () => suite.db.run(sql.raw("drop trigger refuse_bill_request_clearing"));
  }

  /** The party's stored request time, and whether the floor shows its table asking for the bill. */
  async function request(cfg: DeviceRequestConfig, partyId: string, tableId: string) {
    return withTransaction(suite.db, async (tx) => {
      const [party] = await tx
        .select({ at: parties.billRequestedAt })
        .from(parties)
        .where(eq(parties.id, partyId));
      const table = (await listTablesWithState(tx, cfg)).find((row) => row.id === tableId)!;
      return {
        billRequestedAt: party!.at,
        shown: table.signals.some((signal) => signal.kind === "bill_requested"),
      };
    });
  }

  const gone = { billRequestedAt: null, shown: false };
  const kept = { billRequestedAt: expect.any(String), shown: true };

  const paths: [
    string,
    ServiceMode,
    (cfg: DeviceRequestConfig, tabId: string, log?: Logger) => Promise<void>,
  ][] = [
    ["a card capture of an open bill", "table_tab", payByCard],
    ["a cash payment of an open bill", "table_tab", payInCash],
    [
      "the recovery of a card capture never filed",
      "table_tab",
      async (cfg, tabId, log) => {
        await lostCapture(tabId);
        await payByCard(cfg, tabId, log);
      },
    ],
    [
      "a card settling a presented bill's invoice",
      "ticket_then_pay",
      async (cfg, tabId, log) => {
        await placed(cfg, tabId);
        await payByCard(cfg, tabId, log);
      },
    ],
    [
      "the recovery of a card capture of a presented bill's invoice",
      "ticket_then_pay",
      async (cfg, tabId, log) => {
        await placed(cfg, tabId);
        await lostCapture(tabId);
        await payByCard(cfg, tabId, log);
      },
    ],
    [
      "a card closing a presented bill whose corrections leave nothing owed",
      "ticket_then_pay",
      async (cfg, tabId, log) => {
        await placed(cfg, tabId);
        const saleId = await saleIdFor(tabId);
        await correctToZero(cfg, saleId);
        expect(await outstandingSalesFor()).toEqual([{ saleId, amountDue: "0.00" }]);
        await payByCard(cfg, tabId, log);
        // No card tender, so the reader was never asked for the 1.50.
        expect(await tendersFor(tabId)).toEqual([]);
      },
    ],
    [
      "collecting a presented bill's invoice",
      "ticket_then_pay",
      async (cfg, tabId, log) => {
        await placed(cfg, tabId);
        await collectInCash(cfg, tabId, log);
      },
    ],
  ];

  it("a clearing failure that is not a refusal still fails the payment, filing nothing", async () => {
    const { cfg, tabId, partyId, tableId } = await partyAskingForBill("table_tab");
    suite.db.run(
      sql.raw(`create trigger break_bill_request_clearing
        before update of bill_requested_at on parties when new.bill_requested_at is null
        begin insert into no_such_table values (1); end`),
    );
    try {
      await expect(payInCash(cfg, tabId)).rejects.toThrow("no such table");
    } finally {
      suite.db.run(sql.raw("drop trigger break_bill_request_clearing"));
    }

    expect((await orderState(tabId)).status).toBe("open");
    expect(await saleCount(tabId)).toBe(0);
    expect(await request(cfg, partyId, tableId)).toEqual(kept);
  });

  describe.each(paths)("through %s", (_name, serviceMode, settle) => {
    it("goes when that bill was the party's last owing one", async () => {
      const { cfg, tabId, partyId, tableId } = await partyAskingForBill(serviceMode);
      expect(await request(cfg, partyId, tableId)).toEqual(kept);

      await settle(cfg, tabId);

      expect(await request(cfg, partyId, tableId)).toEqual(gone);
    });

    it("stays while another bill of the party still owes", async () => {
      const { cfg, tabId, partyId, tableId } = await partyAskingForBill(serviceMode, true);

      await settle(cfg, tabId);

      expect(await request(cfg, partyId, tableId)).toEqual(kept);
    });

    it("stays, and the payment still settles the bill, when clearing it is refused", async () => {
      const { cfg, tabId, partyId, tableId } = await partyAskingForBill(serviceMode);
      const logged: unknown[][] = [];
      const log: Logger = (...args) => void logged.push(args);

      const drop = refuseClearing();
      try {
        await settle(cfg, tabId, log);
      } finally {
        drop();
      }

      expect(await orderState(tabId)).toEqual({ status: "settled", settledAtSet: true });
      expect(await saleCount(tabId)).toBe(1);
      expect((await rawPaymentsFor(tabId)).filter((payment) => !payment.hasSale)).toEqual([]);
      expect(await request(cfg, partyId, tableId)).toEqual(kept);
      expect(logged).toEqual([
        [
          "warn",
          "bill_request.clear_failed",
          { billId: tabId, partyId, error: expect.stringContaining("clearing refused") },
        ],
      ]);
    });
  });
});
