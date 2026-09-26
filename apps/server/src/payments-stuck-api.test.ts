import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction, workingOrders } from "@waitron/db";
import {
  assignCatalogueToLocation,
  createCatalogue,
  createCategory,
  createProduct,
} from "@waitron/catalogue";
import { listAvailableProducts } from "@waitron/catalogue";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend } from "@waitron/fiscal";
import { hashPassword, hashPin, persons, startManagementSession } from "@waitron/identity";
import { applyVenue, planVenue } from "@waitron/provisioning";
import { deleteCredential, loadKeyRing, putCredential, type KeyRing } from "@waitron/credentials";
import {
  decimal,
  locationId as brandLocationId,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  tillId as brandTillId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import {
  failAttempting,
  insertAttempting,
  paymentResolutions,
  payments,
  stampAttemptingRef,
  type CardProviderContribution,
  type PaymentProvider,
} from "@waitron/payments";
import {
  createStripeCardProvider,
  StripeTerminalProvider,
  type MakeStripe,
} from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountPaymentsApi } from "./payments-api.js";
import type { CardProviderPool } from "./card-provider-pool.js";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import type { TillConfig } from "./till-config.js";
import { systemClock } from "./till-backend.js";
import { createOpenOrder } from "./working-order.js";
import { payWorkingOrderIntegrated } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import "./errors.js";

/**
 * The manager's way out of a card payment a crash left `attempting`: the stuck list and the
 * resolve action, through the real routes, with the real `StripeTerminalProvider` over `FakeStripe`.
 */
const noopLog: Logger = () => {};
const LOCALE = "es-ES";
const MARK = "2026-09-26T10:00:00.000Z";

const RING: KeyRing = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});

const clock = systemClock();
let backend: FiscalBackend;

beforeAll(() => {
  backend = new VerifactuBackend({
    clock,
    db: suite.db,
    environment: deploymentEnvironment(process.env),
    deploymentEnvironment: deploymentEnvironment(process.env),
    resolveClient: () =>
      Promise.reject(new Error("payments-stuck-api.test: resolveClient must never be called")),
  });
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return `${String(79_000_000 + nifCounter).padStart(8, "0")}K`;
}

const stripeSeat: CardProviderContribution = createStripeCardProvider((() => {
  throw new Error("payments-stuck-api.test: the seat's own Stripe SDK is never built");
}) as unknown as MakeStripe);

interface Venue {
  cfg: TillConfig;
  menuItemId: string;
  zoneId: string;
  managerId: string;
  managerCookie: string;
  staffCookie: string;
  client: FakeStripe;
  provider: StripeTerminalProvider;
  app: Hono;
}

/** A fresh venue selling one 1.50 Café, a connected Stripe seat, and a manager and a staff session. */
async function setup(
  opts: { client?: FakeStripe; providerFor?: (p: StripeTerminalProvider) => PaymentProvider } = {},
): Promise<Venue> {
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
  const cfg: TillConfig = {
    tillId: brandTillId(venue.tillId),
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locationId: brandLocationId(venue.locationId),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    tipsEnabled: false,
    orderFlow: "prepay",
  };
  const seeded = await withTransaction(suite.db, async (tx) => {
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
    const available = (await listAvailableProducts(tx, cfg.locationId)).products;
    const offers = await offerProducts(tx, cfg);
    const cafe = available.find((p) => p.name === "Café")!;
    const [mgr] = await tx
      .insert(persons)
      .values({ displayName: "The Manager", pinHash: hashPin("1234"), role: "manager" })
      .returning({ id: persons.id });
    const [stf] = await tx
      .insert(persons)
      .values({ displayName: "The Clerk", pinHash: hashPin("1234"), role: "staff" })
      .returning({ id: persons.id });
    await putCredential(tx, RING, {
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_ok",
        webhookSecret: "whsec_x",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      },
    });
    return {
      menuItemId: offers.offerFor(cafe.id),
      zoneId: offers.zoneId,
      managerId: mgr!.id,
      managerSid: (await startManagementSession(tx, { personId: mgr!.id })).token,
      staffSid: (await startManagementSession(tx, { personId: stf!.id })).token,
    };
  });

  const client = opts.client ?? new FakeStripe();
  const provider = new StripeTerminalProvider({
    client,
    db: suite.db,
    nodeId: cfg.nodeId,
    poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
  });
  const served = opts.providerFor?.(provider) ?? provider;
  const pool: CardProviderPool = {
    get: async (providerId) => {
      if (providerId !== "stripe") throw new Error(`unexpected provider ${providerId}`);
      return served;
    },
    evict: () => {},
  };
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.db,
      backend,
      clock,
      cfg,
      ring: RING,
      environment: "preproduction",
      pool,
      providers: [stripeSeat],
    },
    noopLog,
  );
  return {
    cfg,
    menuItemId: seeded.menuItemId,
    zoneId: seeded.zoneId,
    managerId: seeded.managerId,
    managerCookie: `${MANAGEMENT_COOKIE}=${seeded.managerSid}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${seeded.staffSid}`,
    client,
    provider,
    app,
  };
}

/** An open order for one Café. */
async function openOrder(v: Venue): Promise<string> {
  const id = randomUUID();
  await withTransaction(suite.db, (tx) =>
    createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.menuItemId, quantity: "1" }], null, {
      zoneId: v.zoneId,
    }),
  );
  return id;
}

/**
 * What a server crash in the middle of a Stripe Terminal collect leaves behind: the order marked
 * in flight, and an `attempting` payment carrying its PaymentIntent, with nothing in this process
 * driving it. Returns the payment's id.
 */
async function strandPayment(
  v: Venue,
  orderId: string,
  intent: { status: string; amountReceived?: number },
  opts: { amount?: string; mark?: string | null } = {},
): Promise<{ paymentId: string; piId: string }> {
  const paymentRef = randomUUID();
  const piId = `pi_stuck_${randomUUID()}`;
  const amount = opts.amount ?? "1.50";
  v.client.setIntent(piId, {
    status: intent.status,
    amount: Math.round(Number(amount) * 100),
    ...(intent.amountReceived === undefined ? {} : { amountReceived: intent.amountReceived }),
  });
  await withTransaction(suite.db, async (tx) => {
    await insertAttempting(tx, {
      workingOrderId: brandWorkingOrderId(orderId),
      provider: "stripe",
      paymentRef,
      amount: decimal(amount),
    });
    await stampAttemptingRef(tx, { provider: "stripe", paymentRef }, piId);
  });
  const mark = opts.mark === undefined ? MARK : opts.mark;
  await suite.db
    .update(workingOrders)
    .set({ paymentAttemptAt: mark })
    .where(eq(workingOrders.id, orderId));
  const [row] = await suite.db
    .select({ id: payments.id })
    .from(payments)
    .where(eq(payments.paymentRef, paymentRef));
  return { paymentId: row!.id, piId };
}

async function send(
  v: Venue,
  method: "GET" | "POST",
  path: string,
  cookie: string | null = v.managerCookie,
): Promise<Response> {
  return v.app.request(path, {
    method,
    headers: cookie === null ? {} : { cookie },
  });
}

const resolvePath = (paymentId: string) => `/management-api/payments/stuck/${paymentId}/resolve`;

async function errorOf(res: Response): Promise<{ code: string; params?: unknown }> {
  return ((await res.json()) as { error: { code: string; params?: unknown } }).error;
}

// --- verification reads ---------------------------------------------------------------------

function saleIdsFor(orderId: string): string[] {
  return suite.db
    .all<{ id: string }>(sql`select id from sales where working_order_id = ${orderId}`)
    .map((r) => r.id);
}

async function paymentRow(
  paymentId: string,
): Promise<{ state: string; saleId: string | null; externalRef: string | null }> {
  const [row] = await suite.db
    .select({ state: payments.state, saleId: payments.saleId, externalRef: payments.externalRef })
    .from(payments)
    .where(eq(payments.id, paymentId));
  return row!;
}

async function orderOf(id: string): Promise<{ status: string; mark: string | null }> {
  const [row] = await suite.db
    .select({ status: workingOrders.status, mark: workingOrders.paymentAttemptAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return { status: row!.status, mark: row!.mark };
}

async function resolutionsFor(paymentId: string) {
  return suite.db
    .select({
      personId: paymentResolutions.personId,
      workingOrderId: paymentResolutions.workingOrderId,
      outcome: paymentResolutions.outcome,
      cancelledAtProvider: paymentResolutions.cancelledAtProvider,
    })
    .from(paymentResolutions)
    .where(eq(paymentResolutions.paymentId, paymentId));
}

// --- the list -------------------------------------------------------------------------------

describe("GET /management-api/payments/stuck", () => {
  it("lists a stranded payment, and omits one on an order that carries no mark", async () => {
    const v = await setup();
    const stuckOrder = await openOrder(v);
    const unmarkedOrder = await openOrder(v);
    const { paymentId } = await strandPayment(v, stuckOrder, { status: "requires_payment_method" });
    await strandPayment(v, unmarkedOrder, { status: "requires_payment_method" }, { mark: null });

    const res = await send(v, "GET", "/management-api/payments/stuck");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      paymentId,
      workingOrderId: stuckOrder,
      tillId: v.cfg.tillId,
      tillName: "Caja 1",
      provider: "stripe",
      amount: "1.50",
      label: null,
    });
    expect(typeof body[0]!.orderNumber).toBe("number");
    expect(typeof body[0]!.startedAt).toBe("string");
  });

  it("is refused to a staff session and to no session", async () => {
    const v = await setup();
    const staff = await send(v, "GET", "/management-api/payments/stuck", v.staffCookie);
    expect(staff.status).toBe(403);
    expect((await errorOf(staff)).code).toBe("authorization.not_permitted");
    const none = await send(v, "GET", "/management-api/payments/stuck", null);
    expect(none.status).toBe(401);
    expect((await errorOf(none)).code).toBe("management_session.required");
  });
});

// --- resolving ------------------------------------------------------------------------------

describe("POST /management-api/payments/stuck/:paymentId/resolve", () => {
  it("(a) files ONE sale for a payment Stripe captured, settles the order, and refuses a second resolve", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId, piId } = await strandPayment(v, orderId, {
      status: "succeeded",
      amountReceived: 150,
    });

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; invoiceNumber: string };
    expect(body.outcome).toBe("filed");
    expect(body.invoiceNumber).toMatch(/^A\//);
    const sales = saleIdsFor(orderId);
    expect(sales).toHaveLength(1);
    expect(await paymentRow(paymentId)).toEqual({
      state: "captured",
      saleId: sales[0],
      externalRef: piId,
    });
    expect(await orderOf(orderId)).toEqual({ status: "settled", mark: null });
    expect(await resolutionsFor(paymentId)).toEqual([
      {
        personId: v.managerId,
        workingOrderId: orderId,
        outcome: "captured",
        cancelledAtProvider: false,
      },
    ]);
    // The card was never driven again: no new PaymentIntent, no reader asked.
    expect(v.client.lastCreateIntent).toBeUndefined();
    expect(v.client.processedReaders).toEqual([]);

    const again = await send(v, "POST", resolvePath(paymentId));
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({ code: "payment.not_stuck", params: { paymentId } });
    expect(saleIdsFor(orderId)).toHaveLength(1);
    expect(await resolutionsFor(paymentId)).toHaveLength(1);
  });

  it("(b) cancels a PaymentIntent still waiting for a card, fails the row, clears the mark, and the order's next card pay uses a NEW PaymentIntent", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId, piId } = await strandPayment(v, orderId, {
      status: "requires_payment_method",
    });

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "released" });
    expect(v.client.cancelledIntents).toEqual([piId]);
    expect((await paymentRow(paymentId)).state).toBe("failed");
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: null });
    expect(await resolutionsFor(paymentId)).toEqual([
      {
        personId: v.managerId,
        workingOrderId: orderId,
        outcome: "failed",
        cancelledAtProvider: true,
      },
    ]);
    expect(saleIdsFor(orderId)).toEqual([]);

    const paid = await payWorkingOrderIntegrated(
      { db: suite.db, backend, clock, provider: v.provider, readerRef: "reader_1" },
      v.cfg,
      { id: orderId, lines: [] },
    );
    expect(paid.outcome).toBe("captured");
    expect(v.client.lastCreateIntent?.idempotencyKey).toBe(`wo_${orderId}_r1`);
    const captured = await suite.db
      .select({ externalRef: payments.externalRef })
      .from(payments)
      .where(eq(payments.state, "captured"));
    expect(captured).toHaveLength(1);
    expect(captured[0]!.externalRef).not.toBe(piId);
  });

  it("(c) refuses outcome_unknown when Stripe cannot be reached, leaving the row attempting and the order locked", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(v, orderId, {
      status: "succeeded",
      amountReceived: 150,
    });
    v.client.unreachableNext();

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "payment.outcome_unknown",
      params: { paymentId, reason: "unreachable" },
    });
    expect((await paymentRow(paymentId)).state).toBe("attempting");
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: MARK });
    expect(await resolutionsFor(paymentId)).toEqual([]);
    expect(saleIdsFor(orderId)).toEqual([]);
  });

  it("refuses outcome_unknown, naming Stripe's status, when Stripe's answer is ambiguous", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    // Succeeded, but for a different amount from the row's.
    const { paymentId } = await strandPayment(v, orderId, {
      status: "succeeded",
      amountReceived: 100,
    });

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "payment.outcome_unknown",
      params: { paymentId, reason: "ambiguous", providerStatus: "succeeded" },
    });
    expect((await paymentRow(paymentId)).state).toBe("attempting");
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: MARK });
    expect(await resolutionsFor(paymentId)).toEqual([]);
  });

  it("(d) refuses not_stuck for an attempt still running in this process, which the list omits", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve));
    // The reader is still waiting for the card while the manager looks.
    class WaitingStripe extends FakeStripe {
      override async readerOutcome(readerId: string) {
        entered();
        await gate;
        return super.readerOutcome(readerId);
      }
    }
    const v = await setup({ client: new WaitingStripe() });
    const orderId = await openOrder(v);
    const paying = payWorkingOrderIntegrated(
      { db: suite.db, backend, clock, provider: v.provider, readerRef: "reader_1" },
      v.cfg,
      { id: orderId, lines: [] },
    );
    await reached;
    const [row] = await suite.db
      .select({ id: payments.id, state: payments.state })
      .from(payments)
      .where(eq(payments.workingOrderId, orderId));
    expect(row!.state).toBe("attempting");
    expect((await orderOf(orderId)).mark).not.toBeNull();

    const list = await send(v, "GET", "/management-api/payments/stuck");
    expect(await list.json()).toEqual([]);
    const res = await send(v, "POST", resolvePath(row!.id));
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "payment.not_stuck",
      params: { paymentId: row!.id },
    });
    expect(v.client.cancelledIntents).toEqual([]);

    release();
    expect((await paying).outcome).toBe("captured");
    expect(saleIdsFor(orderId)).toHaveLength(1);
  });

  it("(e) refuses a staff session and touches nothing", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(v, orderId, { status: "requires_payment_method" });

    const res = await send(v, "POST", resolvePath(paymentId), v.staffCookie);

    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("authorization.not_permitted");
    expect(v.client.cancelledIntents).toEqual([]);
    expect((await paymentRow(paymentId)).state).toBe("attempting");
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: MARK });
  });

  it("refuses not_stuck for an attempting payment whose order carries no mark, and for an unknown id", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(
      v,
      orderId,
      { status: "requires_payment_method" },
      { mark: null },
    );

    const unmarked = await send(v, "POST", resolvePath(paymentId));
    expect(unmarked.status).toBe(409);
    expect((await errorOf(unmarked)).code).toBe("payment.not_stuck");
    expect(v.client.cancelledIntents).toEqual([]);

    const unknownId = randomUUID();
    const unknown = await send(v, "POST", resolvePath(unknownId));
    expect(unknown.status).toBe(409);
    expect(await errorOf(unknown)).toEqual({
      code: "payment.not_stuck",
      params: { paymentId: unknownId },
    });
  });

  it("refuses not_stuck when a concurrent resolve settles the payment before this one's provider call", async () => {
    const v = await setup({
      providerFor: (p) =>
        new Proxy(p, {
          get: (target, prop) =>
            prop === "resolveAbandonedAttempt"
              ? async (paymentRef: string, now: Date) => {
                  // The other resolve won: the row is no longer attempting.
                  await withTransaction(suite.db, (tx) =>
                    failAttempting(tx, { provider: "stripe", paymentRef }),
                  );
                  return target.resolveAbandonedAttempt(paymentRef, now);
                }
              : Reflect.get(target, prop),
        }),
    });
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(v, orderId, { status: "requires_payment_method" });

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({ code: "payment.not_stuck", params: { paymentId } });
    expect(v.client.cancelledIntents).toEqual([]);
    expect(await resolutionsFor(paymentId)).toEqual([]);
  });

  it("answers an error and records nothing when the provider's resolve throws something else", async () => {
    const v = await setup({
      providerFor: (p) =>
        new Proxy(p, {
          get: (target, prop) =>
            prop === "resolveAbandonedAttempt"
              ? () => Promise.reject(new Error("database is locked"))
              : Reflect.get(target, prop),
        }),
    });
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(v, orderId, { status: "requires_payment_method" });

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("server.internal");
    expect((await paymentRow(paymentId)).state).toBe("attempting");
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: MARK });
    expect(await resolutionsFor(paymentId)).toEqual([]);
  });

  it("refuses resolve_unsupported when the payment's provider cannot resolve an abandoned attempt", async () => {
    const v = await setup({
      providerFor: (p) =>
        new Proxy(p, {
          get: (target, prop) =>
            prop === "resolveAbandonedAttempt" ? undefined : Reflect.get(target, prop),
        }),
    });
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(v, orderId, { status: "requires_payment_method" });

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(422);
    expect(await errorOf(res)).toEqual({
      code: "payment.resolve_unsupported",
      params: { provider: "stripe" },
    });
    expect((await paymentRow(paymentId)).state).toBe("attempting");
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: MARK });
  });

  it("refuses provider_disconnected when the payment's provider has no credential any more", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(v, orderId, { status: "requires_payment_method" });
    await withTransaction(suite.db, (tx) => deleteCredential(tx, { purpose: "payments.stripe" }));

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "reader.provider_disconnected",
      params: { providerId: "stripe" },
    });
    expect(v.client.cancelledIntents).toEqual([]);
    expect((await paymentRow(paymentId)).state).toBe("attempting");
  });

  it("answers an error and files nothing when the captured amount is below the order's locked total, leaving the capture for recovery", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const { paymentId } = await strandPayment(
      v,
      orderId,
      { status: "succeeded", amountReceived: 100 },
      { amount: "1.00" },
    );

    const res = await send(v, "POST", resolvePath(paymentId));

    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("server.internal");
    expect(await paymentRow(paymentId)).toMatchObject({ state: "captured", saleId: null });
    expect(saleIdsFor(orderId)).toEqual([]);
    expect(await orderOf(orderId)).toEqual({ status: "open", mark: MARK });
    expect(await resolutionsFor(paymentId)).toEqual([
      {
        personId: v.managerId,
        workingOrderId: orderId,
        outcome: "captured",
        cancelledAtProvider: false,
      },
    ]);
  });
});
