import {
  billShare,
  closeZeroBill,
  takeReaderPaymentWithRecovery,
  payCounterBasket,
  payFreshCounterInCash,
  paySavedBillInCash,
} from "./testing/bill-payment-fixture.js";
import type { TradingContext } from "./trading-context.js";
import type { CounterPaymentBasket, ReaderBillPaymentDeps } from "./bill-payments.js";
import { readBillEditState } from "./bill-editing.js";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { addTabRound } from "./testing/order-writer-fixture.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { departments } from "@waitron/venue-service";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { writeNodeMembership, type Database } from "@waitron/db";
import {
  assignMenuToVenue,
  createMenu,
  createCategory,
  createProduct,
  listAvailableProducts,
} from "@waitron/menu";
import type { AvailableProduct } from "@waitron/menu";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import { openFilingCase, recordCaseEvent } from "@waitron/fiscal-verifactu/src/filing-cases.js";
import type { FiscalBackend, TrustedClock } from "@waitron/fiscal";
import { hashPassword, hashPin, loginWithPin } from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import type { VenueResult } from "@waitron/provisioning";
import {
  invoiceSeries,
  parties,
  persons,
  personStaffRoles,
  printJobs,
  sales,
  withTransaction,
  workingOrderLines,
  workingOrders,
} from "@waitron/db";
import {
  decimal,
  nodeId as brandNodeId,
  PORTIONS_AT_ONCE,
  rawCentsToDecimal,
  saleId as brandSaleId,
  seriesId as brandSeriesId,
} from "@waitron/shared";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { SimulatorPaymentProvider } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import { listOutstandingSales, recordCorrection } from "@waitron/core";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES, VENUE_SERVICE } from "./modules.js";
import type { OrderFlow } from "./testing/bill-payment-fixture.js";
import type { DeviceRequestConfig } from "./trading-context.js";
import type { ServiceMode } from "@waitron/module";
import { requestBill } from "./bill-request.js";
import { createOpenOrder, listTablesWithState, parkOrder } from "./working-order.js";
import { createTable } from "./testing/live-table.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";
import { openPartyTab, splitPartyBill } from "./testing/serve-line.js";
import { ensureOperator } from "./testing/cancel-line.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import { ensureFixtureJobRole, seedNode, seedDepartmentReceipt } from "@waitron/db/testing/seed.js";
import {
  counterFixtureOperator,
  seedSessionDevice,
  openTillSession,
  deviceRequestCfg,
} from "./testing/session-device.js";

/** `quantity` of one offer as request lines of at most {@link PORTIONS_AT_ONCE}, the most
 * `refuseTooManyPortions` lets one line expand into. */
function linesOf(menuItemId: string, quantity: string): { menuItemId: string; quantity: string }[] {
  const lines = [];
  for (let left = Number(quantity); left > 0; left -= PORTIONS_AT_ONCE) {
    lines.push({ menuItemId, quantity: String(Math.min(left, PORTIONS_AT_ONCE)) });
  }
  return lines;
}

// The integrated (split-transaction) card-pay orchestration, end to end on one venue: P1 commits a
// walk-up before `collect`, because the provider's payment row has a foreign key to
// `working_orders`; P3's settled-order replay; and recovery of a capture P3 never filed. `FakeStripe`
// drives the reader deterministically.
const LOCALE = "es-ES";

// The operator a placing amendment is attributed to.
async function paymentOperator(cfg: DeviceRequestConfig, personId?: string) {
  if (personId === undefined) return counterFixtureOperator(suite.db, cfg.origin.deviceId);
  return {
    personId,
    sessionId: await openTillSession(suite.db, { deviceId: cfg.origin.deviceId, personId }),
  };
}

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

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(70_000_000 + nifCounter);
}

function tillConfigFromVenue(venue: VenueResult): TradingContext {
  return {
    nodeId: brandNodeId(venue.nodeId),
    locale: LOCALE,
    simplifiedInvoiceLimit: null,
  };
}

/** A product with the offer that sells it in the venue's counter zone. */
type OfferedProduct = AvailableProduct & { menuItemId: string; zoneId: string };

interface SeededVenue {
  seriesId: ReturnType<typeof brandSeriesId>;
  cfg: DeviceRequestConfig;
  coffee: OfferedProduct;
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
        name: "Main room",
        fiscalTerritory: "ES-common",
        invoiceLocales: [LOCALE],
        addressLine1: "Calle Mayor 1",
        addressLine2: null,
        postalCode: "28013",
        city: "Madrid",
        province: "Madrid",
        timeZone: "Europe/Madrid",
        dayCutover: "05:00",
        seriesCode: "A",
        correctiveSeriesCode: "R",
        admin: {
          displayName: "Administrator",
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
  const rows = await suite.db.select().from(departments);
  for (const department of rows)
    await seedDepartmentReceipt(suite.db, department.id, {
      operationDescription: "Venta en establecimiento",
    });
  const { available, offers } = await withTransaction(suite.db, async (tx) => {
    await ensureOperator(tx, OPERATOR);
    const [admin] = await tx
      .select({ id: persons.id })
      .from(persons)
      .where(eq(persons.email, "owner@example.test"));
    await tx
      .insert(personStaffRoles)
      .values({ personId: admin!.id, staffRoleId: await ensureFixtureJobRole(tx) });
    const cat = await createMenu(tx, { name: "Delicatessen" });
    const drinks = await createCategory(tx, { name: "Drinks" });
    await createProduct(tx, {
      categoryId: drinks.id,
      name: "Café",
      pricingUnit: "each",
      unitPrice: "1.50",
      vatClass: "general",
    });
    await assignMenuToVenue(tx, cat.id);
    return {
      available: (await listAvailableProducts(tx)).products,
      offers: await offerProducts(tx, cfg, {
        orderStart: "counter",
        paidWhen: orderFlow,
      }),
    };
  });
  const coffee = available.find((p) => p.name === "Café")!;
  return {
    cfg,
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    coffee: { ...coffee, menuItemId: offers.offerFor(coffee.id), zoneId: offers.zoneId },
  };
}

async function anotherNodeSeries(): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    const other = await seedNode(tx);
    await tx
      .insert(invoiceSeries)
      .values({ nodeId: other, code: "OTHER-P999999", purpose: "standard", nextNumber: 99 });
  });
}

/** The split-flow deps with a real `StripeTerminalProvider` over `FakeStripe`. */
function integratedDeps(
  app: Database,
  client = new FakeStripe(),
): { deps: ReaderBillPaymentDeps; client: FakeStripe } {
  const provider = new StripeTerminalProvider({
    captureAlerts,
    client,
    db: app,
    poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
  });
  return {
    deps: {
      admission: testTradingAdmission(),
      db: app,
      backend,
      clock,
      provider,
      readerRef: "reader_1",
    },
    client,
  };
}

async function payReader(
  deps: ReaderBillPaymentDeps,
  cfg: DeviceRequestConfig,
  input: CounterPaymentBasket & { id: string; simulationOutcome?: "captured" },
  personId?: string,
) {
  const { id, simulationOutcome, ...basket } = input;
  const request = billShare("card", "1.50", {
    entry: "reader",
    submissionId: id,
    simulationOutcome,
  });
  return takeReaderPaymentWithRecovery(
    deps,
    cfg,
    id,
    request,
    await paymentOperator(cfg, personId),
    basket.lines.length === 0 ? undefined : basket,
  );
}

// --- verification reads (not part of the behaviour under test) -----------------------------------

async function saleCount(workingOrderId: string): Promise<number> {
  const rows = suite.db.all<{ count: string }>(
    sql`select cast(count(*) as text) as count from sales where working_order_id = ${workingOrderId}`,
  );
  return Number(rows[0]!.count);
}

async function fiscalRecordCount(workingOrderId: string): Promise<number> {
  const rows = suite.db.all<{ count: string }>(sql`
    select cast(count(*) as text) as count
    from registros_facturacion r
    join sales s on s.id = r.sale_id
    where s.working_order_id = ${workingOrderId}
  `);
  return Number(rows[0]!.count);
}

async function orderState(id: string): Promise<{ status: string; settledAtSet: boolean }> {
  // A raw comparison arrives as the number 1 or 0: this engine has no boolean type.
  const rows = suite.db.all<{ status: string; settled: number }>(sql`
    select status, (settled_at is not null) as settled from working_orders where id = ${id}
  `);
  return { status: rows[0]!.status, settledAtSet: rows[0]!.settled === 1 };
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

/** The venue's corrective series. */
function correctiveSeries(cfg: DeviceRequestConfig): string {
  return suite.db.all<{ id: string }>(sql`
    select id from invoice_series where node_id = ${cfg.nodeId} and purpose = 'corrective'
  `)[0]!.id;
}

/** Café's 1.50 invoice (a 1.24 base at 21%), reversed whole by a corrective through
 *  `recordCorrection`. */
async function correctToZero(cfg: DeviceRequestConfig, saleId: string): Promise<void> {
  const adminId = suite.db.all<{ id: string }>(
    sql`select id from persons where email = 'owner@example.test'`,
  )[0]!.id;
  const deviceId = await seedSessionDevice(suite.db);
  await withTransaction(suite.db, async (tx) => {
    const session = await loginWithPin(tx, {
      deviceId,
      personId: adminId,
      pin: "1234",
    });
    await recordCorrection(tx, backend, {
      operationDescription: "Venta en establecimiento",
      origin: cfg.origin,
      nodeId: cfg.nodeId,
      seriesId: brandSeriesId(correctiveSeries(cfg)),
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
  });
});

describe("active fiscal conflict stops new money", () => {
  async function seedConflict(
    cfg: DeviceRequestConfig,
    cause: "fiscal.huella_divergente" | "fiscal.duplicado_anulado",
  ) {
    const [record] = suite.db.all<{ id: string }>(sql`
      select id from registros_facturacion where node_id = ${cfg.nodeId} order by secuencia limit 1
    `);
    await withTransaction(suite.db, async (tx) => {
      const opened = await openFilingCase(tx, {
        registroId: record!.id,
        cause,
        evidence: { codigo: 3000, mensaje: "Invoice identity conflict", csv: null },
        now: clock.now().instant,
      });
      await recordCaseEvent(tx, {
        caseId: opened.id,
        actionKey: randomUUID(),
        kind: "resolved",
        personId: OPERATOR,
        action: "Recorded an administrator note",
        now: clock.now().instant,
      });
    });
  }

  async function originalSale(cfg: DeviceRequestConfig, coffee: OfferedProduct) {
    return payFreshCounterInCash(
      { admission: testTradingAdmission(), db: suite.db, backend, clock },
      cfg,
      await paymentOperator(cfg),
      randomUUID(),
      { zoneId: coffee.zoneId, lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }] },
      "1.50",
    );
  }

  for (const cause of ["fiscal.huella_divergente", "fiscal.duplicado_anulado"] as const) {
    it.each(["cash", "card"] as const)(
      `refuses %s before money for one historical resolved ${cause}`,
      async (method) => {
        const { cfg, coffee } = await setupVenue();
        await originalSale(cfg, coffee);
        await seedConflict(cfg, cause);
        const series = await suite.db.select().from(invoiceSeries);
        const records = await suite.db.execute(sql`select * from registros_facturacion`);
        const jobs = await suite.db.select().from(printJobs);
        const provider = new FakePaymentProvider(suite.db);
        const id = randomUUID();
        const lines = [{ menuItemId: coffee.menuItemId, quantity: "1" }];
        const pay =
          method === "cash"
            ? payFreshCounterInCash(
                { admission: testTradingAdmission(), db: suite.db, backend, clock },
                cfg,
                await paymentOperator(cfg),
                id,
                { zoneId: coffee.zoneId, lines: lines },
                "1.50",
              )
            : payReader(
                { admission: testTradingAdmission(), db: suite.db, backend, clock, provider },
                cfg,
                {
                  id,
                  lines,
                  zoneId: coffee.zoneId,
                },
              );
        await expect(pay).rejects.toMatchObject({
          code: "sif.allocation_invalid",
          params: { reason: "conflict_requires_administrator" },
        });
        expect(provider.collectCalls).toEqual([]);
        expect(provider.refundCalls).toEqual([]);
        expect(await paymentCount(id)).toBe(0);
        expect(await saleCount(id)).toBe(0);
        expect(await suite.db.select().from(invoiceSeries)).toEqual(series);
        expect(await suite.db.execute(sql`select * from registros_facturacion`)).toEqual(records);
        expect(await suite.db.select().from(printJobs)).toEqual(jobs);
      },
    );
  }

  for (const flow of ["prepay", "ticket_then_pay"] as const) {
    it.each(["fiscal.huella_divergente", "fiscal.duplicado_anulado"] as const)(
      `refuses a parked connected-card order before collection in ${flow} after %s`,
      async (cause) => {
        const { cfg, coffee } = await setupVenue(flow);
        await originalSale(cfg, coffee);
        const id = randomUUID();
        await parkOrder({ db: suite.db }, cfg, {
          id,
          zoneId: coffee.zoneId,
          lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
        });
        await seedConflict(cfg, cause);
        const series = await suite.db.select().from(invoiceSeries);
        const records = await suite.db.execute(sql`select * from registros_facturacion`);
        const jobs = await suite.db.select().from(printJobs);
        const provider = new FakePaymentProvider(suite.db);
        const refusal = await payReader(
          {
            admission: testTradingAdmission(),
            db: suite.db,
            backend,
            clock,
            provider,
            sayCardChargedNotRecorded: true,
          },
          cfg,
          { id, lines: [] },
        ).then(
          () => null,
          (error: unknown) => error,
        );
        expect({
          refusal,
          collections: provider.collectCalls.length,
          payments: await paymentCount(id),
        }).toMatchObject({
          refusal: {
            code: "sif.allocation_invalid",
            params: { reason: "conflict_requires_administrator" },
          },
          collections: 0,
          payments: 0,
        });
        expect(await saleCount(id)).toBe(0);
        expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
        expect(await suite.db.select().from(invoiceSeries)).toEqual(series);
        expect(await suite.db.execute(sql`select * from registros_facturacion`)).toEqual(records);
        expect(await suite.db.select().from(printJobs)).toEqual(jobs);
        expect(provider.refundCalls).toEqual([]);
      },
    );
  }

  it("capture_finishes_after_conflict: keeps the charge unfiled and never charges the retry", async () => {
    const { cfg, coffee } = await setupVenue();
    await originalSale(cfg, coffee);
    const provider = new FakePaymentProvider(suite.db);
    const collect = provider.collect.bind(provider);
    provider.collect = async (params) => {
      const captured = await collect(params);
      await seedConflict(cfg, "fiscal.huella_divergente");
      return captured;
    };
    const id = randomUUID();
    const deps = {
      admission: testTradingAdmission(),
      db: suite.db,
      backend,
      clock,
      provider,
      sayCardChargedNotRecorded: true,
    };
    const request = {
      id,
      zoneId: coffee.zoneId,
      lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
    };
    await expect(payReader(deps, cfg, request)).rejects.toMatchObject({
      code: "sale.charged_not_recorded",
      params: { reason: "issuance_refused" },
    });
    expect(
      suite.db.all(sql`select state, amount, sale_id from payments where working_order_id = ${id}`),
    ).toEqual([{ state: "captured", amount: 150, sale_id: null }]);
    expect(await saleCount(id)).toBe(0);
    await expect(payReader(deps, cfg, request)).rejects.toMatchObject({
      code: "sale.charged_not_recorded",
    });
    expect(provider.collectCalls).toHaveLength(1);
    expect(await paymentCount(id)).toBe(1);
    expect(await saleCount(id)).toBe(0);
    expect(provider.refundCalls).toEqual([]);
  });

  it("replays an issued sale while the same identity is stopped", async () => {
    const { cfg, coffee } = await setupVenue();
    const id = randomUUID();
    const req = {
      id,
      zoneId: coffee.zoneId,
      lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
      tender: { method: "cash" as const, amount: "1.50" },
    };
    const operator = await paymentOperator(cfg);
    const pay = () =>
      payCounterBasket(
        { admission: testTradingAdmission(), db: suite.db, backend, clock },
        cfg,
        operator,
        id,
        { zoneId: req.zoneId, lines: req.lines },
        { method: "cash", tendered: req.tender.amount },
        id,
      );
    const ticket = await pay();
    await seedConflict(cfg, "fiscal.duplicado_anulado");
    await expect(pay()).resolves.toEqual(ticket);
    expect(await saleCount(id)).toBe(1);
    expect(await fiscalRecordCount(id)).toBe(1);
  });

  it("refuses an invoice-first issue while preserving the open order and counters", async () => {
    const { cfg, coffee } = await setupVenue("ticket_then_pay");
    await originalSale(cfg, coffee);
    const id = randomUUID();
    await parkOrder({ db: suite.db }, cfg, {
      id,
      zoneId: coffee.zoneId,
      lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
    });
    await seedConflict(cfg, "fiscal.huella_divergente");
    const before = await suite.db.select().from(invoiceSeries);
    await expect(
      issueOrderInvoice(
        { admission: testTradingAdmission(), db: suite.db, backend, clock },
        cfg,
        id,
        OPERATOR,
      ),
    ).rejects.toMatchObject({
      code: "sif.allocation_invalid",
      params: { reason: "conflict_requires_administrator" },
    });
    expect(await saleCount(id)).toBe(0);
    expect(await orderState(id)).toEqual({ status: "open", settledAtSet: false });
    expect(await suite.db.select().from(invoiceSeries)).toEqual(before);
  });
});

describe("a box the held chart does not name primary takes no new money", () => {
  async function chartNamingAnotherBoxPrimary(cfg: DeviceRequestConfig) {
    await writeNodeMembership(suite.db, {
      body: {
        term: 2,
        nodes: [
          { nodeId: cfg.nodeId, contactUrl: "https://this-box", standing: "sell-only" },
          { nodeId: randomUUID(), contactUrl: "https://new-box", standing: "serving-primary" },
        ],
      },
      signerNodeId: "new-box",
      signature: "sig-2",
      endorsements: [],
    });
  }

  it("refuses a cash sale before any money or record", async () => {
    const { cfg, coffee } = await setupVenue();
    await chartNamingAnotherBoxPrimary(cfg);
    const id = randomUUID();

    await expect(
      payFreshCounterInCash(
        { admission: testTradingAdmission(), db: suite.db, backend, clock },
        cfg,
        await paymentOperator(cfg),
        id,
        { zoneId: coffee.zoneId, lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }] },
        "1.50",
      ),
    ).rejects.toMatchObject({ code: "fiscal.chain_handed_over", params: { nodeId: cfg.nodeId } });
    expect(await paymentCount(id)).toBe(0);
    expect(await saleCount(id)).toBe(0);
  });

  it("refuses a connected-card sale before the reader is asked to charge", async () => {
    const { cfg, coffee } = await setupVenue();
    await chartNamingAnotherBoxPrimary(cfg);
    const provider = new FakePaymentProvider(suite.db);
    const id = randomUUID();

    await expect(
      payReader(
        {
          admission: testTradingAdmission(),
          db: suite.db,
          backend,
          clock,
          provider,
          sayCardChargedNotRecorded: true,
        },
        cfg,
        { id, zoneId: coffee.zoneId, lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }] },
      ),
    ).rejects.toMatchObject({ code: "fiscal.chain_handed_over", params: { nodeId: cfg.nodeId } });
    expect(provider.collectCalls).toEqual([]);
    expect(await paymentCount(id)).toBe(0);
    expect(await saleCount(id)).toBe(0);
  });

  it("answers a card charged before the chart moved as charged and not recorded", async () => {
    const { cfg, coffee } = await setupVenue();
    const provider = new FakePaymentProvider(suite.db);
    const collect = provider.collect.bind(provider);
    provider.collect = async (params) => {
      const captured = await collect(params);
      await chartNamingAnotherBoxPrimary(cfg);
      return captured;
    };
    const id = randomUUID();

    await expect(
      payReader(
        {
          admission: testTradingAdmission(),
          db: suite.db,
          backend,
          clock,
          provider,
          sayCardChargedNotRecorded: true,
        },
        cfg,
        { id, zoneId: coffee.zoneId, lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }] },
      ),
    ).rejects.toMatchObject({
      code: "sale.charged_not_recorded",
      params: { reason: "issuance_refused" },
    });
    expect(provider.collectCalls).toHaveLength(1);
    expect(await paymentCount(id)).toBe(1);
    expect(await saleCount(id)).toBe(0);
    expect(provider.refundCalls).toEqual([]);
  });
});

describe("walk-up invoice preparation", () => {
  const recipient = {
    taxId: "b12345674",
    legalName: "  Cliente SL  ",
    address: "2 Main Street, 28013 Madrid, Madrid",
    countryCode: "es",
  };

  it.each(["1", "2001"])(
    "saves a validated F1 recipient with %s coffees before money or filing",
    async (quantity) => {
      const { cfg, coffee } = await setupVenue();
      const id = randomUUID();
      const limited = { ...cfg, simplifiedInvoiceLimit: decimal("3000.00") };
      await withTransaction(suite.db, async (tx) => {
        await createOpenOrder(tx, limited, id, linesOf(coffee.menuItemId, quantity), null, {
          zoneId: coffee.zoneId,
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
        recipientAddress: "2 Main Street, 28013 Madrid, Madrid",
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
    const { cfg, coffee } = await setupVenue();
    const id = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        createOpenOrder(tx, cfg, id, [{ menuItemId: coffee.menuItemId, quantity: "1" }], null, {
          zoneId: coffee.zoneId,
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
      const { cfg, coffee } = await setupVenue();
      const other = condition === "other-node" ? { id: await seedNode(suite.db) } : undefined;
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
          createOpenOrder(tx, cfg, id, [{ menuItemId: coffee.menuItemId, quantity: "1" }], null, {
            zoneId: coffee.zoneId,
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
      recipient: { ...recipient, countryCode: "ZZ" },
      code: "management.request_invalid",
      params: { field: "recipient.countryCode" },
    },
  ])("refuses malformed or unsupported walk-up invoice input %#", async (request) => {
    const { cfg, coffee } = await setupVenue();
    const id = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        createOpenOrder(tx, cfg, id, [{ menuItemId: coffee.menuItemId, quantity: "1" }], null, {
          zoneId: coffee.zoneId,
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
    const { cfg, coffee } = await setupVenue();
    const id = randomUUID();
    await withTransaction(suite.db, (tx) =>
      createOpenOrder(
        tx,
        { ...cfg, simplifiedInvoiceLimit: decimal("3000.00") },
        id,
        linesOf(coffee.menuItemId, "2000"),
        null,
        {
          zoneId: coffee.zoneId,
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
    const { cfg, coffee } = await setupVenue();
    const id = randomUUID();
    await expect(
      withTransaction(suite.db, (tx) =>
        createOpenOrder(
          tx,
          { ...cfg, simplifiedInvoiceLimit: decimal("3000.00") },
          id,
          [{ menuItemId: coffee.menuItemId, quantity: "2001" }],
          null,
          { zoneId: coffee.zoneId },
        ),
      ),
    ).rejects.toMatchObject({ code: "sale.total_exceeds_simplified_limit" });
    expect(await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id))).toEqual([]);
  });
});

describe("invoice series during reader payment", () => {
  it("reads the active series after a card capture that overlaps a series switch", async () => {
    const { cfg, coffee, seriesId } = await setupVenue();
    await anotherNodeSeries();
    const { deps } = integratedDeps(suite.db);
    const provider = deps.provider;
    let activeId: string | undefined;
    const switchingProvider: PaymentProvider = {
      ...provider,
      provider: provider.provider,
      capabilities: provider.capabilities,
      collect: async (params) => {
        const captured = await provider.collect(params);
        const [fresh] = await withTransaction(suite.db, async (tx) => {
          await tx
            .update(invoiceSeries)
            .set({ retiredAt: new Date() })
            .where(eq(invoiceSeries.id, seriesId));
          return tx
            .insert(invoiceSeries)
            .values({
              nodeId: cfg.nodeId,
              code: "A-P000099",
              purpose: "standard",
              nextNumber: 11,
            })
            .returning();
        });
        activeId = fresh!.id;
        return captured;
      },
      resolvePending: (...args) => provider.resolvePending(...args),
      void: (...args) => provider.void(...args),
      refund: (...args) => provider.refund(...args),
      partialRefund: (...args) => provider.partialRefund!(...args),
    };
    const id = randomUUID();
    const result = await payReader({ ...deps, provider: switchingProvider }, cfg, {
      id,
      zoneId: coffee.zoneId,
      lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
    });
    expect(result.outcome).toBe("received");
    expect(activeId).toBeDefined();
    const [sale] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(sale!.seriesId).toBe(activeId);
    expect(sale!.invoiceNumber).toBe(11);
    expect(await fiscalRecordCount(id)).toBe(1);
  });

  it("issues on a newly active series and replays that invoice after a later switch", async () => {
    const { cfg, coffee, seriesId } = await setupVenue();
    await anotherNodeSeries();
    const id = randomUUID();
    const [fresh] = await withTransaction(suite.db, async (tx) => {
      await tx
        .update(invoiceSeries)
        .set({ retiredAt: new Date() })
        .where(eq(invoiceSeries.id, seriesId));
      return tx
        .insert(invoiceSeries)
        .values({
          nodeId: cfg.nodeId,
          code: "A-P000042",
          purpose: "standard",
          nextNumber: 7,
        })
        .returning();
    });
    const { deps } = integratedDeps(suite.db);
    const input = {
      id,
      zoneId: coffee.zoneId,
      lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
    };
    const first = await payReader(deps, cfg, input);
    expect(first.outcome).toBe("received");
    const [sale] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(sale!.seriesId).toBe(fresh!.id);
    expect(sale!.invoiceNumber).toBe(7);
    await withTransaction(suite.db, async (tx) => {
      await tx
        .update(invoiceSeries)
        .set({ retiredAt: new Date() })
        .where(eq(invoiceSeries.id, fresh!.id));
      await tx
        .insert(invoiceSeries)
        .values({ nodeId: cfg.nodeId, code: "A-P000043", purpose: "standard" });
    });
    const retry = await payReader(deps, cfg, input);
    expect(retry).toEqual(first);
    expect(await saleCount(id)).toBe(1);
    expect(await fiscalRecordCount(id)).toBe(1);
    const [unchanged] = await suite.db.select().from(sales).where(eq(sales.workingOrderId, id));
    expect(unchanged).toEqual(sale);
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
    const { cfg, coffee } = venue;
    const seated = await withTransaction(suite.db, async (tx) => {
      const offers = await offerProducts(tx, cfg, { zone: "tables" });
      const table = await createTable(tx, cfg, { label: "T1", zoneId: offers.zoneId });
      const { tabId, partyId } = await openPartyTab(tx, cfg, { tableId: table.id });
      const coffeeLine = { menuItemId: offers.offerFor(coffee.id), quantity: "1" };
      await addTabRound(tx, cfg, tabId, owingSibling ? [coffeeLine, coffeeLine] : [coffeeLine]);
      if (owingSibling) await splitPartyBill(tx, cfg, tabId, [{ lineNo: 1 }]);
      if (serviceMode !== "table_tab") {
        const elsewhere = await offerProducts(tx, cfg, {
          orderStart: "counter",
        });
        await VENUE_SERVICE.retargetOrderContext(tx, tabId, elsewhere.zoneId);
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
    await placeOrder(
      { admission: testTradingAdmission(), db: suite.db, backend, clock },
      cfg,
      tabId,
      OPERATOR,
    );
    await issueOrderInvoice(
      { admission: testTradingAdmission(), db: suite.db, backend, clock },
      cfg,
      tabId,
      OPERATOR,
    );
    expect(await outstandingSalesFor()).toHaveLength(1);
  }

  async function payByCard(
    cfg: DeviceRequestConfig,
    tabId: string,
    log?: Logger,
    recover = false,
  ): Promise<void> {
    const provider = new FakePaymentProvider(suite.db);
    const deps = { db: suite.db, backend, clock, admission: testTradingAdmission(), provider, log };
    const pay = () => payReader(deps, cfg, { id: tabId, lines: [] }, OPERATOR);
    if (recover) {
      provider.crashNextCollect("captured");
      await expect(pay()).rejects.toThrow("process stopped");
    }
    expect((await pay()).outcome).toBe("received");
    expect(provider.collectCalls).toHaveLength(1);
    expect((await orderState(tabId)).status).toBe("settled");
  }

  async function payInCash(cfg: DeviceRequestConfig, tabId: string, log?: Logger): Promise<void> {
    await paySavedBillInCash(
      { admission: testTradingAdmission(), db: suite.db, backend, clock, log },
      cfg,
      await paymentOperator(cfg, OPERATOR),
      tabId,
      "1.50",
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
  async function request(partyId: string, tableId: string) {
    return withTransaction(suite.db, async (tx) => {
      const [party] = await tx
        .select({ at: parties.billRequestedAt })
        .from(parties)
        .where(eq(parties.id, partyId));
      const table = (await listTablesWithState(tx)).find((row) => row.id === tableId)!;
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
        await payByCard(cfg, tabId, log, true);
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
        await payByCard(cfg, tabId, log, true);
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
        await closeZeroBill(
          { db: suite.db, backend, clock, admission: testTradingAdmission(), log },
          cfg,
          tabId,
          {
            ...billShare("card", "0.00", { entry: "reader", submissionId: tabId }),
            expectedEdit: await readBillEditState(suite.db, tabId),
          },
          await paymentOperator(cfg, OPERATOR),
        );
        // No card tender, so the reader was never asked for the 1.50.
        expect(await tendersFor(tabId)).toEqual([]);
      },
    ],
    [
      "collecting a presented bill's invoice",
      "ticket_then_pay",
      async (cfg, tabId, log) => {
        await placed(cfg, tabId);
        await payInCash(cfg, tabId, log);
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
    expect(await request(partyId, tableId)).toEqual(kept);
  });

  describe.each(paths)("through %s", (_name, serviceMode, settle) => {
    it("goes when that bill was the party's last owing one", async () => {
      const { cfg, tabId, partyId, tableId } = await partyAskingForBill(serviceMode);
      expect(await request(partyId, tableId)).toEqual(kept);

      await settle(cfg, tabId);

      expect(await request(partyId, tableId)).toEqual(gone);
    });

    it("stays while another bill of the party still owes", async () => {
      const { cfg, tabId, partyId, tableId } = await partyAskingForBill(serviceMode, true);

      await settle(cfg, tabId);

      expect(await request(partyId, tableId)).toEqual(kept);
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
      expect(await request(partyId, tableId)).toEqual(kept);
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

describe("integrated answer receipt presentation", () => {
  it("includes current department fields on connected capture and refreshes them on replay", async () => {
    const { cfg, coffee } = await setupVenue();
    const [{ department_id: departmentId }] = suite.db.all<{ department_id: string }>(
      sql`select department_id from floor_zones where id = ${coffee.zoneId}`,
    );
    await suite.db
      .update(departments)
      .set({
        receiptText: null,
        receiptLogoImageId: null,
        receiptLogoRasters: null,
        receiptUpdatedAt: null,
      })
      .where(eq(departments.id, departmentId));
    suite.db.run(
      sql`update departments set operation_description = 'Venta en establecimiento', receipt_text = '{"headerSubtitle":{"es-ES":"Connected subtitle"},"printAddress":true}', receipt_updated_at = '2026-10-10T00:00:00Z' where id = ${departmentId}`,
    );

    const provider = new SimulatorPaymentProvider(suite.db);
    const req = {
      id: randomUUID(),
      zoneId: coffee.zoneId,
      lines: [{ menuItemId: coffee.menuItemId, quantity: "1" }],
      simulationOutcome: "captured" as const,
    };
    const deps = { db: suite.db, backend, clock, provider };
    const first = await payReader({ ...deps, admission: testTradingAdmission() }, cfg, req);
    expect(first.outcome).toBe("received");
    expect(first.invoice!.receiptTrim).toEqual({ headerSubtitle: "Connected subtitle" });
    expect(first.invoice!.receiptSettings).toEqual({ printAddress: true });
    suite.db.run(sql`update departments set receipt_text = '{}' where id = ${departmentId}`);
    const replay = await payReader({ ...deps, admission: testTradingAdmission() }, cfg, req);
    expect(replay.outcome).toBe("received");
    expect(replay.invoice!.receiptTrim).toEqual({});
    expect(replay.invoice!.receiptSettings).toEqual({ printAddress: false });
    expect(replay.invoice!.invoiceNumber).toBe(first.invoice!.invoiceNumber);
    expect(replay.invoice!.tender).toEqual(first.invoice!.tender);
    expect(await saleCount(req.id)).toBe(1);
    expect(await paymentCount(req.id)).toBe(1);
  });
});
