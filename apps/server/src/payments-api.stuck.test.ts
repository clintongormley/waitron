import { setTipsForTest } from "./testing/payment-settings.js";
import { liftPaymentGuard } from "@waitron/payments/src/testing/lift-payment-guard.js";
import { CARD_PROVIDERS } from "@waitron/composition";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  refunds,
  tenders,
  billPayments,
  devices,
  withTransaction,
  saveSettings,
  workingOrders,
  readNodeMembership,
  stampDeployment,
  writeNodeMembership,
  withFoldedPersonChanges,
} from "@waitron/db";
import { createPrinter } from "@waitron/printing";
import { receiptLabelsFor } from "@waitron/country-packs";
import { decodeTicket } from "./testing/decode-ticket.js";
import { assignMenuToVenue, createMenu, createCategory, createProduct } from "@waitron/menu";
import { listAvailableProducts } from "@waitron/menu";
import { VerifactuBackend } from "@waitron/fiscal-verifactu";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  hashPassword,
  hashPin,
  persons,
  PIN_THROTTLE_FREE_ATTEMPTS,
  startManagementSession,
} from "@waitron/identity";
import { applyHistoricalTestVenue as applyVenue } from "@waitron/provisioning/testing/allocated-venue";
import { planVenue } from "@waitron/provisioning";
import { deleteCredential, loadKeyRing, putCredential, type KeyRing } from "@waitron/credentials";
import {
  AppError,
  decimal,
  nodeId as brandNodeId,
  seriesId as brandSeriesId,
  workingOrderId as brandWorkingOrderId,
  deviceOrigin,
} from "@waitron/shared";
import {
  PAYMENTS_SETTINGS,
  failAttempting,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  recordRefund,
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
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { billRefundFields, takeReaderBillPayment } from "./testing/bill-payment-fixture.js";
import { mountPaymentsApi } from "./payments-api.js";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";

import type { CardProviderPool } from "./card-provider-pool.js";
import { deploymentEnvironment } from "./config.js";
import type { Logger } from "./logger.js";
import { ALL_MODULES } from "./modules.js";
import type { DeviceRequestConfig } from "./trading-context.js";

import { systemClock } from "./till-backend.js";
import { createOpenOrder } from "./working-order.js";
import { completeBillPayment, readBillBalance } from "./bill-payments.js";
import { ordersWithUnfiledPayment } from "./till-sale.js";
import { offerProducts } from "./testing/zone-offers.js";
import { descendingIds } from "./testing/descending-ids.js";
import "./errors.js";
import { nifWithControlLetter } from "@waitron/fiscal-verifactu/src/testing/seed.js";
import {
  watchDerivationsAndLock,
  watchedOrder,
  watchedDerivationCount,
} from "./testing/watched-scrypt.js";
import { setSingletonRole } from "@waitron/node-db";
import { generateNodeKeyPair } from "@waitron/membership";
import { createDeploymentHolders } from "./deployment-holders.js";
import { establishNodeIdentity } from "./node-identity.js";
import { promoteLocalSecondaryToPrimary } from "./promote.js";
import { signedMembershipDoc } from "./testing/membership-doc-fixture.js";
import { pinMainBoxKey } from "./testing/pinned-main-box.js";
import { seedDevice, seedNode } from "@waitron/db/testing/seed.js";
import { insertHandoverActivationTx } from "@waitron/handover";
import { deviceRequestCfg, openTillSession } from "./testing/session-device.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

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
  });
});

let nifCounter = 0;
function nextNif(): string {
  nifCounter += 1;
  return nifWithControlLetter(79_000_000 + nifCounter);
}

const stripeSeat: CardProviderContribution = createStripeCardProvider((() => {
  throw new Error("payments-api.stuck.test: the seat's own Stripe SDK is never built");
}) as unknown as MakeStripe);

interface Venue {
  cfg: DeviceRequestConfig;
  /** Two devices at the venue: payments start on `deviceId` unless a case says otherwise. */
  deviceId: string;
  otherDeviceId: string;
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
  opts: {
    isPrimary?: boolean;
    client?: FakeStripe;
    providerFor?: (p: StripeTerminalProvider) => PaymentProvider;
    /** A second provider, served under its own id and connected through the Stripe credential. */
    extra?: PaymentProvider;
    partialRefundRelease?: boolean;
    attendance?: AttendanceRecorder;
    /** Mount the routes without Stripe's seat, so a stored Stripe payment names no served provider. */
    withoutStripeSeat?: boolean;
  } = {},
): Promise<Venue> {
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
  const cfg = await deviceRequestCfg(suite.db, {
    nodeId: brandNodeId(venue.nodeId),
    seriesId: brandSeriesId(venue.seriesIds[0]!),
    locale: LOCALE,
    invoiceLocales: [LOCALE],
    simplifiedInvoiceLimit: null,
  });
  const seeded = await withTransaction(suite.db, async (tx) => {
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
    const available = (await listAvailableProducts(tx)).products;
    const offers = await offerProducts(tx, cfg);
    const coffee = available.find((p) => p.name === "Café")!;
    const [mgr] = await seedPersons(tx, {
      displayName: "The Manager",
      pinHash: hashPin("1234"),
      role: "manager",
    });
    const [stf] = await seedPersons(tx, {
      displayName: "The Clerk",
      pinHash: hashPin("1234"),
      role: "staff",
    });
    await putCredential(tx, RING, {
      personId: null,
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_ok",
        webhookSecret: "whsec_x",
        successUrl: "https://x/s",
        cancelUrl: "https://x/c",
      },
    });
    return {
      menuItemId: offers.offerFor(coffee.id),
      zoneId: offers.zoneId,
      managerId: mgr!.id,
      managerSid: (await startManagementSession(tx, { method: "password", personId: mgr!.id }))
        .token,
      staffSid: (await startManagementSession(tx, { method: "password", personId: stf!.id })).token,
    };
  });

  const client = opts.client ?? new FakeStripe();
  const provider = new StripeTerminalProvider({
    captureAlerts,
    client,
    db: suite.db,
    poll: { maxAttempts: 3, intervalMs: 0, sleep: () => Promise.resolve() },
  });
  const served = opts.providerFor?.(provider) ?? provider;
  const pool: CardProviderPool = {
    get: async (providerId) => {
      if (providerId === "stripe") return served;
      if (providerId === opts.extra?.provider) return opts.extra;
      throw new Error(`unexpected provider ${providerId}`);
    },
    evict: () => {},
  };
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      admission: testTradingAdmission(),
      db: suite.db,
      backend,
      clock,
      cfg,
      isPrimary: () => opts.isPrimary ?? true,
      ring: RING,
      environment: "preproduction",
      pool,
      ...{ attendance: opts.attendance },
      providers: [
        ...(opts.withoutStripeSeat ? [] : [stripeSeat]),
        ...(opts.extra === undefined
          ? []
          : [
              {
                ...stripeSeat,
                providerId: opts.extra.provider,
                partialRefundRelease: opts.partialRefundRelease ?? false,
              },
            ]),
      ],
    },
    noopLog,
  );
  const devices = [
    await seedDevice(suite.db, { label: "Barra 1" }),
    await seedDevice(suite.db, { label: "Barra 2" }),
  ];
  return {
    cfg,
    deviceId: devices[0]!.deviceId,
    otherDeviceId: devices[1]!.deviceId,
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
async function openOrder(v: Venue, id: string = randomUUID()): Promise<string> {
  await withTransaction(suite.db, (tx) =>
    createOpenOrder(tx, v.cfg, id, [{ menuItemId: v.menuItemId, quantity: "1" }], null, {
      zoneId: v.zoneId,
    }),
  );
  return id;
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

describe("retired whole-order payment recovery", () => {
  it("returns 404 for the old list", async () => {
    const venue = await setup();
    expect((await send(venue, "GET", "/management-api/payments/stuck")).status).toBe(404);
  });

  it("returns the router's 404 for the old resolve action", async () => {
    const venue = await setup();
    const response = await send(venue, "POST", resolvePath(randomUUID()));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found");
  });
});

describe("A1381 manager collection ownership", () => {
  it.each([true, false])(
    "leaves payments with no provider row to the singleton primary (%s)",
    async (isPrimary) => {
      const v = await setup({ isPrimary });
      const id = await strandBillPayment(v, await openOrder(v), { kind: "none" });
      const listed = await send(v, "GET", "/management-api/payments/bill-payments");
      expect(listed.status).toBe(200);
      expect(
        ((await listed.json()) as { billPaymentId: string }[]).map((row) => row.billPaymentId),
      ).toEqual(isPrimary ? [id] : []);
      const resolved = await send(v, "POST", billResolvePath(id));
      expect(resolved.status).toBe(isPrimary ? 200 : 409);
      if (!isPrimary) expect((await errorOf(resolved)).code).toBe("bill.payment_not_stuck");
      expect((await billPaymentOf(id)).state).toBe(isPrimary ? "failed" : "pending");
    },
  );

  it.each([true, false])(
    "handles provider rows naming no box only as primary (%s)",
    async (isPrimary) => {
      const v = await setup({ isPrimary });
      const billOrderId = await openOrder(v);
      const bill = await strandBillPayment(v, billOrderId, { kind: "failed" });
      await liftPaymentGuard(suite.db, () => suite.db.update(payments).set({ nodeId: null }));
      const billList = await send(v, "GET", "/management-api/payments/bill-payments");
      expect(billList.status).toBe(200);
      expect(
        ((await billList.json()) as { billPaymentId: string }[]).map((row) => row.billPaymentId),
      ).toEqual(isPrimary ? [bill] : []);
      const attested = await post(v, attestPath(bill), {
        outcome: "failed",
        note: "Provider confirmed no charge",
        pin: "1234",
      });
      expect(attested.status).toBe(isPrimary ? 200 : 409);
      if (!isPrimary) expect((await errorOf(attested)).code).toBe("bill.payment_not_stuck");
      expect((await billPaymentOf(bill)).state).toBe(isPrimary ? "failed" : "pending");
      expect(saleIdsFor(billOrderId)).toEqual([]);
    },
  );

  it.each(["failed", "captured"] as const)(
    "refuses attesting another box's %s bill payment",
    async (kind) => {
      const v = await setup();
      const other = { ...v, cfg: { ...v.cfg, nodeId: await seedNode(suite.db) } };
      const orderId = await openOrder(v);
      const id = await strandBillPayment(other, orderId, { kind });
      const res = await post(v, attestPath(id), {
        outcome: kind === "captured" ? "received" : "failed",
        note: "Provider outcome confirmed",
        pin: "1234",
      });
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe("bill.payment_not_stuck");
      expect(await billPaymentOf(id)).toEqual({
        state: "pending",
        attestedBy: null,
        attestationNote: null,
      });
      expect(v.client.cancelledIntents).toEqual([]);
      expect(saleIdsFor(orderId)).toEqual([]);
    },
  );

  it.each(["evicted", "revoked", "active", "other-primary", "secondary", "malformed"] as const)(
    "applies the held chart's collection limits (%s)",
    async (caseName) => {
      const v = await setup({ isPrimary: caseName !== "secondary" });
      const previous = await seedNode(suite.db);
      const old = { ...v, cfg: { ...v.cfg, nodeId: previous } };
      const orderId = await openOrder(v);
      const bill = await strandBillPayment(old, orderId, {
        kind: "attempting",
        intent: { status: "requires_payment_method" },
      });
      const chartPrimary = caseName === "other-primary" ? await seedNode(suite.db) : v.cfg.nodeId;
      const chart = signedMembershipDoc(2, {
        signerNodeId: chartPrimary,
        nodes: [
          {
            nodeId: chartPrimary,
            standing: "serving-primary",
            contactUrl: "https://main.example.test",
          },
          ...(caseName === "revoked"
            ? []
            : [
                {
                  nodeId: previous,
                  standing:
                    caseName === "active" ? ("serving-secondary" as const) : ("evicted" as const),
                  contactUrl: "https://old.example.test",
                },
              ]),
        ],
        ...(caseName === "revoked" ? { revoked: [previous] } : {}),
      });
      await writeNodeMembership(
        suite.db,
        caseName === "malformed"
          ? ({ ...chart, body: { term: 2 } } as unknown as typeof chart)
          : chart,
      );
      const owned = caseName === "evicted" || caseName === "revoked";
      const listed = await send(v, "GET", "/management-api/payments/bill-payments");
      expect(listed.status).toBe(200);
      expect(
        ((await listed.json()) as { billPaymentId: string }[]).map(
          ({ billPaymentId }) => billPaymentId,
        ),
      ).toEqual(owned ? [bill] : []);
      const res = await send(v, "POST", billResolvePath(bill));
      expect(res.status).toBe(owned ? 200 : 409);
      if (!owned) expect((await errorOf(res)).code).toBe("bill.payment_not_stuck");
      expect((await billPaymentOf(bill)).state).toBe(owned ? "failed" : "pending");
      expect(v.client.cancelledIntents).toHaveLength(owned ? 1 : 0);
      expect(saleIdsFor(orderId)).toEqual([]);
    },
  );

  it("recovers the replaced primary's payments after a real plain promotion", async () => {
    const role = { isPrimary: false };
    const v = await setup(role);
    const previous = await seedNode(suite.db);
    const other = await seedNode(suite.db);
    const old = { ...v, cfg: { ...v.cfg, nodeId: previous } };
    const billOrder = await openOrder(v);
    const bill = await strandBillPayment(old, billOrder, { kind: "captured" });
    const attested = await strandBillPayment(old, await openOrder(v), { kind: "failed" });
    const peer = { ...v, cfg: { ...v.cfg, nodeId: other } };
    const peerPayment = await strandBillPayment(peer, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });
    const key = generateNodeKeyPair();
    await stampDeployment(suite.db, "preproduction");
    await setSingletonRole(
      { venue: suite.db, node: suite.node },
      v.cfg.nodeId,
      "secondary",
      "fenced",
    );
    await establishNodeIdentity({ ownerDb: suite.db, node: suite.node, ring: RING }, v.cfg.nodeId);
    await pinMainBoxKey(suite.node, v.cfg.nodeId, { nodeId: previous, publicKey: key.publicKey });
    await writeNodeMembership(
      suite.db,
      signedMembershipDoc(1, {
        signerNodeId: previous,
        keyPair: key,
        nodes: [
          { nodeId: previous, standing: "serving-primary", contactUrl: "https://old.example.test" },
          {
            nodeId: v.cfg.nodeId,
            standing: "serving-secondary",
            contactUrl: "https://self.example.test",
          },
          { nodeId: other, standing: "serving-secondary", contactUrl: "https://peer.example.test" },
        ],
      }),
    );
    expect(await (await send(v, "GET", "/management-api/payments/bill-payments")).json()).toEqual(
      [],
    );
    role.isPrimary = true;
    expect(await (await send(v, "GET", "/management-api/payments/bill-payments")).json()).toEqual(
      [],
    );
    role.isPrimary = false;
    const holders = createDeploymentHolders("primary", "secondary");
    await promoteLocalSecondaryToPrimary(
      {
        db: suite.db,
        node: suite.node,
        nodeId: v.cfg.nodeId,
        holders,
        ring: RING,
        log: noopLog,
      },
      { oldNodeNeutralised: true },
    );
    role.isPrimary = holders.singletonRole.current === "primary";
    expect(
      (await readNodeMembership(suite.db))!.body.nodes.map(({ nodeId, standing }) => ({
        nodeId,
        standing,
      })),
    ).toEqual([
      { nodeId: previous, standing: "sell-only" },
      { nodeId: v.cfg.nodeId, standing: "serving-primary" },
      { nodeId: other, standing: "serving-secondary" },
    ]);
    role.isPrimary = false;
    expect(await (await send(v, "GET", "/management-api/payments/bill-payments")).json()).toEqual(
      [],
    );
    const refused = await send(v, "POST", billResolvePath(bill));
    expect(refused.status).toBe(409);
    expect((await errorOf(refused)).code).toBe("bill.payment_not_stuck");
    role.isPrimary = true;
    const billList = await send(v, "GET", "/management-api/payments/bill-payments");
    expect(billList.status).toBe(200);
    expect(
      ((await billList.json()) as { billPaymentId: string }[]).map(
        ({ billPaymentId }) => billPaymentId,
      ),
    ).toEqual([bill, attested]);
    expect((await send(v, "POST", billResolvePath(bill))).status).toBe(200);
    const peerRefused = await send(v, "POST", billResolvePath(peerPayment));
    expect(peerRefused.status).toBe(409);
    expect((await errorOf(peerRefused)).code).toBe("bill.payment_not_stuck");
    expect(
      (
        await post(v, attestPath(attested), {
          outcome: "failed",
          note: "No charge confirmed",
          pin: "1234",
        })
      ).status,
    ).toBe(200);
    expect((await billPaymentOf(attested)).state).toBe("failed");
    expect((await billPaymentOf(peerPayment)).state).toBe("pending");
    expect((await billPaymentOf(bill)).state).toBe("received");
    expect(saleIdsFor(billOrder)).toHaveLength(1);
    expect(v.client.cancelledIntents).toEqual([]);
  });

  it("collects a predecessor's payments after a recorded handover", async () => {
    const v = await setup();
    const previous = await seedNode(suite.db);
    const old = { ...v, cfg: { ...v.cfg, nodeId: previous } };
    const bill = await strandBillPayment(old, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });
    await withTransaction(suite.db, (tx) =>
      insertHandoverActivationTx(tx, {
        operationId: randomUUID(),
        scenario: "controlled",
        sourceNodeId: previous,
        destinationNodeId: v.cfg.nodeId,
        evidence: {} as never,
        personId: v.managerId,
        activatedAt: new Date().toISOString(),
      }),
    );
    const billList = await send(v, "GET", "/management-api/payments/bill-payments");
    expect(
      ((await billList.json()) as { billPaymentId: string }[]).map((row) => row.billPaymentId),
    ).toEqual([bill]);
    expect((await send(v, "POST", billResolvePath(bill))).status).toBe(200);
    expect(v.client.cancelledIntents).toHaveLength(1);
  });
  it("lists this box's bill payment and omits another box's payment", async () => {
    const v = await setup();
    const other = { ...v, cfg: { ...v.cfg, nodeId: await seedNode(suite.db) } };
    const provided = { kind: "attempting" as const, intent: { status: "requires_payment_method" } };
    const own = await strandBillPayment(v, await openOrder(v), provided);
    await strandBillPayment(other, await openOrder(v), provided);
    const res = await send(v, "GET", "/management-api/payments/bill-payments");
    expect(res.status).toBe(200);
    expect(
      ((await res.json()) as { billPaymentId: string }[]).map((row) => row.billPaymentId),
    ).toEqual([own]);
  });

  it.each(["attempting", "captured"] as const)(
    "refuses another box's %s bill payment before any resolution",
    async (kind) => {
      const v = await setup();
      const other = { ...v, cfg: { ...v.cfg, nodeId: await seedNode(suite.db) } };
      const orderId = await openOrder(v);
      const id = await strandBillPayment(
        other,
        orderId,
        kind === "captured" ? { kind } : { kind, intent: { status: "requires_payment_method" } },
      );
      const res = await send(v, "POST", billResolvePath(id));
      expect(res.status).toBe(409);
      expect((await errorOf(res)).code).toBe("bill.payment_not_stuck");
      expect(v.client.cancelledIntents).toEqual([]);
      expect((await billPaymentOf(id)).state).toBe("pending");
      expect(saleIdsFor(orderId)).toEqual([]);
    },
  );
});

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

async function orderOf(id: string): Promise<{ status: string }> {
  const [row] = await suite.db
    .select({ status: workingOrders.status })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  return { status: row!.status };
}

type Provided =
  | { kind: "none" }
  | { kind: "attempting"; intent: { status: string; amountReceived?: number } }
  | { kind: "captured"; amount?: string }
  | { kind: "failed" };

/**
 * What a crash in the middle of a card bill payment leaves: the payment `pending` for the Café's
 * €1.50, and its provider row as `provided` says. Returns the bill payment's id.
 */
async function strandBillPayment(
  v: Venue,
  orderId: string,
  provided: Provided,
  amount = "1.50",
  startedOn: string = v.cfg.origin.deviceId,
  requester?: { personId: string; at: string },
  slipWanted = false,
): Promise<string> {
  const [bill] = await suite.db
    .insert(billPayments)
    .values({
      workingOrderId: orderId,
      submissionId: randomUUID(),
      fingerprint: "stranded",
      kind: "contribution",
      method: "card",
      applied: Math.round(Number(amount) * 100),
      state: "pending",
      requestedBy: requester?.personId ?? v.managerId,
      ...(requester === undefined ? {} : { createdAt: requester.at }),
      source: "device",
      deviceId: startedOn,
      slipWanted,
    })
    .returning({ id: billPayments.id });
  const billPaymentId = bill!.id;
  const key = { provider: "stripe", paymentRef: randomUUID() };
  const common = {
    ...key,
    origin: deviceOrigin(v.deviceId),
    workingOrderId: brandWorkingOrderId(orderId),
    nodeId: v.cfg.nodeId,
    amount: decimal(amount),
    billPaymentId,
  };
  await withTransaction(suite.db, async (tx) => {
    if (provided.kind === "attempting") {
      const piId = `pi_bill_${randomUUID()}`;
      v.client.setIntent(piId, {
        status: provided.intent.status,
        amount: 150,
        ...(provided.intent.amountReceived === undefined
          ? {}
          : { amountReceived: provided.intent.amountReceived }),
      });
      await insertAttempting(tx, common);
      await stampAttemptingRef(tx, key, piId);
    } else if (provided.kind === "captured") {
      await insertCapturedPayment(tx, {
        ...common,
        amount: decimal(provided.amount ?? amount),
        externalRef: `pi_done_${randomUUID()}`,
        settledAt: new Date("2026-09-27T10:00:00Z"),
      });
    } else if (provided.kind === "failed") {
      await insertFailedPayment(tx, common);
    }
  });
  return billPaymentId;
}

async function billPaymentOf(id: string) {
  const [row] = await suite.db
    .select({
      state: billPayments.state,
      attestedBy: billPayments.attestedBy,
      attestationNote: billPayments.attestationNote,
    })
    .from(billPayments)
    .where(eq(billPayments.id, id));
  return row!;
}

async function receivedAtOf(id: string): Promise<string | null> {
  const [row] = await suite.db
    .select({ receivedAt: billPayments.receivedAt })
    .from(billPayments)
    .where(eq(billPayments.id, id));
  return row!.receivedAt;
}

async function post(
  v: Venue,
  path: string,
  body: unknown,
  cookie: string = v.managerCookie,
): Promise<Response> {
  return v.app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const billResolvePath = (id: string) => `/management-api/payments/bill-payments/${id}/resolve`;
const attestPath = (id: string) => `/management-api/payments/bill-payments/${id}/attest`;

describe("bill resolution attendance attribution", () => {
  it.each([
    {
      route: "resolve",
      provided: { kind: "captured" } as Provided,
      outcome: "received",
      expected: "qualifying",
    },
    {
      route: "resolve",
      provided: { kind: "none" } as Provided,
      outcome: "failed",
      expected: "refused",
    },
    {
      route: "resolve",
      provided: { kind: "attempting", intent: { status: "requires_payment_method" } } as Provided,
      outcome: "failed",
      expected: "refused",
    },
    {
      route: "attest",
      provided: { kind: "failed" } as Provided,
      outcome: "received",
      expected: "qualifying",
    },
    {
      route: "attest",
      provided: { kind: "failed" } as Provided,
      outcome: "failed",
      expected: "refused",
    },
  ])(
    "$route $outcome settles the original collector's evidence",
    async ({ route, provided, outcome }) => {
      const v = await setup({ attendance: recordAttendanceFact });
      const [worker] = await seedPersons(suite.db, {
        displayName: "Original collector",
        pinHash: "scrypt$00$00",
      });
      const orderId = await openOrder(v);
      const id = await strandBillPayment(v, orderId, provided, "1.50", v.cfg.origin.deviceId, {
        personId: worker!.id,
        at: MARK,
      });
      await withTransaction(suite.db, (tx) =>
        recordAttendanceFact(tx, {
          source: "bill-payment",
          key: id,
          personId: worker!.id,
          kind: "payment",
          at: MARK,
          offsetMinutes: 120,
          outcome: "pending",
        }),
      );
      const res =
        route === "resolve"
          ? await send(v, "POST", billResolvePath(id))
          : await post(v, attestPath(id), { outcome, note: "Outcome checked", pin: "1234" });
      expect(res.status).toBe(200);
      expect((await billPaymentOf(id)).state).toBe(outcome);
    },
  );
});

describe("GET /management-api/payments/bill-payments", () => {
  it("lists a pending bill payment with its provider row, and omits a settled one", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const pending = await strandBillPayment(v, orderId, {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });
    const settled = await strandBillPayment(v, await openOrder(v), { kind: "none" });
    await suite.db
      .update(billPayments)
      .set({ state: "failed", failedAt: "2026-09-27T10:00:00.000Z" })
      .where(eq(billPayments.id, settled));

    const res = await send(v, "GET", "/management-api/payments/bill-payments");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>[];
    expect(body).toEqual([
      expect.objectContaining({
        billPaymentId: pending,
        workingOrderId: orderId,
        source: "device",
        deviceId: v.cfg.origin.deviceId,
        deviceName: expect.any(String),
        method: "card",
        applied: "1.50",
        tip: "0.00",
        provider: "stripe",
        providerState: "attempting",
      }),
    ]);
  });

  it("is refused to a staff session", async () => {
    const v = await setup();
    const res = await send(v, "GET", "/management-api/payments/bill-payments", v.staffCookie);
    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("authorization.not_permitted");
  });
});

describe("POST /management-api/payments/bill-payments/:id/resolve", () => {
  it("records a captured payment once while its provider is turned off for new charges", async () => {
    const v = await setup();
    await withTransaction(suite.db, (tx) =>
      saveSettings(tx, PAYMENTS_SETTINGS, {
        doc: { ...PAYMENTS_SETTINGS.defaults(), providers: { stripe: false } },
        expectedRevision: 0,
        personId: v.managerId,
      }),
    );
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, {
      kind: "attempting",
      intent: { status: "succeeded", amountReceived: 150 },
    });

    const res = await send(v, "POST", billResolvePath(id));
    const again = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; invoiceNumber?: string };
    expect(body.outcome).toBe("received");
    expect(body.invoiceNumber).toMatch(/^A\//);
    expect((await billPaymentOf(id)).state).toBe("received");
    expect(await orderOf(orderId)).toEqual({ status: "settled" });
    expect(saleIdsFor(orderId)).toHaveLength(1);
    expect(v.client.lastCreateIntent).toBeUndefined();
    expect(v.client.processedReaders).toEqual([]);
    const [provider] = await suite.db.select().from(payments).where(eq(payments.billPaymentId, id));
    expect(provider).toMatchObject({
      state: "captured",
      saleId: saleIdsFor(orderId)[0],
      resolvedBy: v.managerId,
      resolutionOutcome: "captured",
      resolutionCancelledAtProvider: false,
    });
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toEqual({
      code: "bill.payment_not_stuck",
      params: { paymentId: id },
    });
  });

  it("fails a payment whose PaymentIntent was still waiting for a card, once Stripe cancels it", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "not_charged" });
    expect((await billPaymentOf(id)).state).toBe("failed");
    expect(saleIdsFor(orderId)).toEqual([]);
  });

  it("refuses outcome_unconfirmed when Stripe cannot be reached, leaving the payment pending", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), {
      kind: "attempting",
      intent: { status: "succeeded", amountReceived: 150 },
    });
    v.client.unreachableNext();

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "bill.payment_outcome_unconfirmed",
      params: { paymentId: id, reason: "unreachable" },
    });
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("refuses to check a pending bill payment when the provider has been disconnected", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });
    await withTransaction(suite.db, (tx) =>
      deleteCredential(tx, { personId: null, purpose: "payments.stripe" }),
    );
    const refused = await send(v, "POST", billResolvePath(id));
    expect(refused.status).toBe(409);
    expect(await errorOf(refused)).toEqual({
      code: "reader.provider_disconnected",
      params: { providerId: "stripe" },
    });
    expect(v.client.cancelledIntents).toEqual([]);
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("refuses resolve_unsupported for a provider that cannot resolve an abandoned attempt", async () => {
    const v = await setup({
      providerFor: (p) =>
        new Proxy(p, {
          get: (target, prop) =>
            prop === "resolveAbandonedAttempt" ? undefined : Reflect.get(target, prop),
        }),
    });
    const id = await strandBillPayment(v, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "payment.resolve_unsupported",
      params: { providerId: "stripe" },
    });
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("refuses 409 provider_unknown when the bill payment's provider is no longer served", async () => {
    const v = await setup({ withoutStripeSeat: true });
    const id = await strandBillPayment(v, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "payment.provider_unknown",
      params: { providerId: "stripe" },
    });
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("refuses outcome_unconfirmed for a provider row marked failed: that word is not proof", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "failed" });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "bill.payment_outcome_unconfirmed",
      params: { paymentId: id, reason: "ambiguous", providerStatus: "failed" },
    });
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("completes a stored short bill capture without inventing a full payment", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured", amount: "1.40" });
    const res = await send(v, "POST", billResolvePath(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "received" });
    expect((await billPaymentOf(id)).state).toBe("received");
    expect(
      await suite.db
        .select({ applied: billPayments.applied, tip: billPayments.tip })
        .from(billPayments)
        .where(eq(billPayments.id, id)),
    ).toEqual([{ applied: 140, tip: 0 }]);
    expect(saleIdsFor(orderId)).toEqual([]);
  });

  it("records the actual amount when a manager resolves a short bill payment", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, {
      kind: "attempting",
      intent: { status: "succeeded", amountReceived: 100 },
    });
    const res = await send(v, "POST", billResolvePath(id));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "received" });
    expect((await billPaymentOf(id)).state).toBe("received");
    const [received] = await suite.db
      .select({ applied: billPayments.applied, tip: billPayments.tip })
      .from(billPayments)
      .where(eq(billPayments.id, id));
    expect(received).toEqual({ applied: 100, tip: 0 });
    expect(saleIdsFor(orderId)).toEqual([]);
  });

  it("refuses not_stuck when a concurrent resolve settles the provider row first", async () => {
    const v = await setup({
      providerFor: (p) =>
        new Proxy(p, {
          get: (target, prop) =>
            prop === "resolveAbandonedAttempt"
              ? async (paymentRef: string, now: Date, audit: { personId: string }) => {
                  await withTransaction(suite.db, (tx) =>
                    failAttempting(tx, { provider: "stripe", paymentRef }),
                  );
                  return target.resolveAbandonedAttempt(paymentRef, now, audit);
                }
              : Reflect.get(target, prop),
        }),
    });
    const id = await strandBillPayment(v, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "bill.payment_not_stuck",
      params: { paymentId: id },
    });
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("answers an error and changes nothing when the provider's resolve throws something else", async () => {
    const v = await setup({
      providerFor: (p) =>
        new Proxy(p, {
          get: (target, prop) =>
            prop === "resolveAbandonedAttempt"
              ? () => Promise.reject(new Error("database is locked"))
              : Reflect.get(target, prop),
        }),
    });
    const id = await strandBillPayment(v, await openOrder(v), {
      kind: "attempting",
      intent: { status: "requires_payment_method" },
    });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(500);
    expect((await errorOf(res)).code).toBe("server.internal");
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("completes a payment its provider row already shows captured", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured" });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "received" });
    expect((await billPaymentOf(id)).state).toBe("received");
  });

  it("keeps the payment's device, and files the invoice it completes under that device", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured" }, "1.50", v.otherDeviceId);
    await suite.db.update(devices).set({ active: false }).where(eq(devices.id, v.otherDeviceId));
    const list = await send(v, "GET", "/management-api/payments/bill-payments");
    expect(await list.json()).toMatchObject([{ billPaymentId: id, deviceName: "Barra 2" }]);

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(200);
    const expected = [{ source: "device", device_id: v.otherDeviceId }];
    expect(suite.db.all(sql`select source, device_id from bill_payments where id = ${id}`)).toEqual(
      expected,
    );
    expect(
      suite.db.all(sql`select source, device_id from sales where working_order_id = ${orderId}`),
    ).toEqual(expected);
    expect(
      suite.db.all(sql`
        select r.source, r.device_id from registros_facturacion r
        join sales s on s.id = r.sale_id where s.working_order_id = ${orderId}`),
    ).toEqual(expected);
  });

  it("answers a full disk when filing a captured bill payment", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured" });
    const recordSale = vi
      .spyOn(backend, "recordSale")
      .mockRejectedValueOnce(new AppError("storage.disk_full", {}));
    try {
      const res = await send(v, "POST", billResolvePath(id));
      expect(res.status).toBe(507);
      expect(await errorOf(res)).toEqual({ code: "storage.disk_full", params: {} });
      expect(saleIdsFor(orderId)).toHaveLength(0);
      expect((await billPaymentOf(id)).state).toBe("pending");
    } finally {
      recordSale.mockRestore();
    }
  });

  it("keeps a captured bill payment pending when its invoice number is already taken", async () => {
    const v = await setup();
    const firstOrder = await openOrder(v);
    const first = await strandBillPayment(v, firstOrder, { kind: "captured" });
    expect((await send(v, "POST", billResolvePath(first))).status).toBe(200);
    await suite.db.execute(sql`
      update invoice_series set next_number = next_number - 1
      where id = (select series_id from sales where working_order_id = ${firstOrder})`);
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured" });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(409);
    expect((await errorOf(res)).code).toBe("sale.number_reused");
    expect(saleIdsFor(orderId)).toEqual([]);
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("completes a payment that leaves the bill owing, answering no invoice", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured" }, "1.00");

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "received" });
    expect(await orderOf(orderId)).toEqual({ status: "open" });
  });

  it("fails a payment no provider was asked to charge", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "none" });

    const res = await send(v, "POST", billResolvePath(id));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "not_charged" });
    expect((await billPaymentOf(id)).state).toBe("failed");
  });

  it("refuses not_stuck for a payment whose card is at a reader in this process", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const card = new FakePaymentProvider(suite.db);
    const release = card.holdNextCollect();
    const operator = {
      personId: v.managerId,
      sessionId: await openTillSession(suite.db, {
        deviceId: v.cfg.origin.deviceId,
        personId: v.managerId,
      }),
    };
    const paying = takeReaderBillPayment(
      { admission: testTradingAdmission(), db: suite.db, backend, clock, provider: card },
      v.cfg,
      orderId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "1.00",
        method: "card",
        entry: "reader",
        applied: "1.00",
        tip: "0.00",
      },
      operator,
    );
    await vi.waitFor(() => expect(card.collectCalls).toHaveLength(1));
    const [live] = await suite.db
      .select({ id: billPayments.id })
      .from(billPayments)
      .where(eq(billPayments.workingOrderId, orderId));

    const listed = await send(v, "GET", "/management-api/payments/bill-payments");
    const res = await send(v, "POST", billResolvePath(live!.id));
    const attested = await post(v, attestPath(live!.id), {
      outcome: "failed",
      note: "n",
      pin: "1234",
    });
    release();
    await paying;

    expect(await listed.json()).toEqual([]);
    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "bill.payment_not_stuck",
      params: { paymentId: live!.id },
    });
    expect(attested.status).toBe(409);
    expect(await errorOf(attested)).toEqual({
      code: "bill.payment_not_stuck",
      params: { paymentId: live!.id },
    });
    expect((await billPaymentOf(live!.id)).state).toBe("received");
  });

  it("answers bill.payment_not_found for an unknown id, and refuses a staff session", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "none" });
    const unknown = randomUUID();

    const missing = await send(v, "POST", billResolvePath(unknown));
    const staff = await send(v, "POST", billResolvePath(id), v.staffCookie);

    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toEqual({
      code: "bill.payment_not_found",
      params: { paymentId: unknown },
    });
    expect(staff.status).toBe(403);
    expect((await billPaymentOf(id)).state).toBe("pending");
  });
});

describe("POST /management-api/payments/bill-payments/:id/attest", () => {
  const NOTE = "SumUp dashboard shows transaction TX-1 successful";

  it("records a confirmed receipt with the manager and note, and issues the invoice it completes", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "failed" });

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: string; invoiceNumber?: string };
    expect(body.outcome).toBe("received");
    expect(body.invoiceNumber).toMatch(/^A\//);
    expect(await billPaymentOf(id)).toEqual({
      state: "received",
      attestedBy: v.managerId,
      attestationNote: NOTE,
    });
    expect(await orderOf(orderId)).toEqual({ status: "settled" });
    const [tender] = suite.db.all<{ bill_payment_id: string; method: string }>(
      sql`select t.bill_payment_id, t.method from tenders t join sales s on s.id = t.sale_id where s.working_order_id = ${orderId}`,
    );
    expect(tender).toEqual({ bill_payment_id: id, method: "card" });
  });

  it("does not automatically print an attested invoice", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "failed" });
    await withTransaction(suite.db, async (tx) => {
      const printer = await createPrinter(tx, {
        name: "Recibos",
        transport: "cloud_poll",
        pollId: `poll-${randomUUID()}`,
      });
      await tx
        .update(devices)
        .set({ receiptPrinterId: printer.id })
        .where(eq(devices.id, v.cfg.origin.deviceId));
      return printer.id;
    });

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    expect(
      suite.db.all<{ printer_id: string; kind: string }>(
        sql`select printer_id, kind from print_jobs`,
      ),
    ).toEqual([]);
  });

  it("keeps the payment's device, and files the invoice it completes under that device", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "failed" }, "1.50", v.otherDeviceId);

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    const expected = [{ source: "device", device_id: v.otherDeviceId }];
    expect(suite.db.all(sql`select source, device_id from bill_payments where id = ${id}`)).toEqual(
      expected,
    );
    expect(
      suite.db.all(sql`select source, device_id from sales where working_order_id = ${orderId}`),
    ).toEqual(expected);
  });

  it("records a confirmed receipt that leaves the bill owing, answering no invoice", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "failed" }, "1.00");

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "received" });
    expect((await billPaymentOf(id)).state).toBe("received");
    expect(saleIdsFor(orderId)).toEqual([]);
  });

  it("records a confirmed failure with the manager and note, releasing the payment", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "failed" });

    const res = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ outcome: "not_charged" });
    expect(await billPaymentOf(id)).toEqual({
      state: "failed",
      attestedBy: v.managerId,
      attestationNote: NOTE,
    });
    expect(saleIdsFor(orderId)).toEqual([]);
  });

  it.each(["failed", "received"] as const)(
    "refuses outcome_unconfirmed to record %s while the provider row is still attempting",
    async (outcome) => {
      const v = await setup();
      const orderId = await openOrder(v);
      const id = await strandBillPayment(v, orderId, {
        kind: "attempting",
        intent: { status: "requires_payment_method" },
      });

      const res = await post(v, attestPath(id), { outcome, note: NOTE, pin: "1234" });

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({
        code: "bill.payment_outcome_unconfirmed",
        params: { paymentId: id, reason: "attempting" },
      });
      expect(await billPaymentOf(id)).toEqual({
        state: "pending",
        attestedBy: null,
        attestationNote: null,
      });
      expect(saleIdsFor(orderId)).toEqual([]);
    },
  );

  it("refuses to record a failure over a provider row that shows the card charged, and records its receipt", async () => {
    const v = await setup();
    const orderId = await openOrder(v);
    const id = await strandBillPayment(v, orderId, { kind: "captured", amount: "1.20" });

    const failed = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });
    const pendingAfter = await billPaymentOf(id);
    const received = await post(v, attestPath(id), {
      outcome: "received",
      note: NOTE,
      pin: "1234",
    });

    expect(failed.status).toBe(409);
    expect(await errorOf(failed)).toEqual({
      code: "bill.attestation_contradicted",
      params: { id, evidence: "captured" },
    });
    expect(pendingAfter).toEqual({ state: "pending", attestedBy: null, attestationNote: null });
    expect(received.status).toBe(200);
    expect(await billPaymentOf(id)).toEqual({
      state: "received",
      attestedBy: v.managerId,
      attestationNote: NOTE,
    });
  });

  it("dates a confirmed receipt at the provider row's settled time", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "captured", amount: "1.20" });

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    expect(await receivedAtOf(id)).toBe("2026-09-27T10:00:00.000Z");
  });

  it("dates a confirmed receipt at the attestation when the provider row carries no settled time", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "failed" });
    const before = Date.now();

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    const receivedAt = Date.parse((await receivedAtOf(id))!);
    expect(receivedAt).toBeGreaterThanOrEqual(before);
    expect(receivedAt).toBeLessThanOrEqual(Date.now());
  });

  it("refuses the right PIN once too many wrong ones were entered, and changes nothing", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "failed" });
    const wrong = { outcome: "failed", note: NOTE, pin: "9999" };
    for (let i = 0; i <= PIN_THROTTLE_FREE_ATTEMPTS; i += 1) {
      expect((await errorOf(await post(v, attestPath(id), wrong))).code).toBe("pin.invalid");
    }

    const res = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    expect(res.status).toBe(429);
    expect(await errorOf(res)).toEqual({
      code: "pin.throttled",
      params: { retryAfterSeconds: expect.any(Number) },
    });
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("starts the wrong-PIN count again after the right PIN", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "failed" });
    const wrong = { outcome: "failed", note: NOTE, pin: "9999" };
    for (let i = 0; i < PIN_THROTTLE_FREE_ATTEMPTS; i += 1) await post(v, attestPath(id), wrong);
    const accepted = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    const again = await post(v, attestPath(id), wrong);
    const right = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    expect(accepted.status).toBe(200);
    expect((await errorOf(again)).code).toBe("pin.invalid");
    expect(await errorOf(right)).toEqual({
      code: "bill.payment_not_stuck",
      params: { paymentId: id },
    });
  });

  it.each([
    ["a wrong PIN", { outcome: "failed", note: NOTE, pin: "9999" }, 401, "pin.invalid", undefined],
    ["no PIN", { outcome: "failed", note: NOTE }, 401, "pin.invalid", undefined],
    [
      "a blank note",
      { outcome: "failed", note: "   ", pin: "1234" },
      400,
      "management.request_invalid",
      { field: "note" },
    ],
    [
      "no note",
      { outcome: "received", pin: "1234" },
      400,
      "management.request_invalid",
      { field: "note" },
    ],
    [
      "another outcome",
      { outcome: "declined", note: NOTE, pin: "1234" },
      400,
      "management.request_invalid",
      { field: "outcome" },
    ],
  ] as const)("refuses %s and changes nothing", async (_name, body, status, code, params) => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "failed" });

    const res = await post(v, attestPath(id), body);

    expect(res.status).toBe(status);
    expect(await errorOf(res)).toEqual(
      params === undefined ? { code, params: {} } : { code, params },
    );
    expect(await billPaymentOf(id)).toEqual({
      state: "pending",
      attestedBy: null,
      attestationNote: null,
    });
  });

  it("refuses a staff session even with that person's own PIN", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "failed" });

    const res = await post(
      v,
      attestPath(id),
      { outcome: "failed", note: NOTE, pin: "1234" },
      v.staffCookie,
    );

    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("authorization.not_permitted");
    expect((await billPaymentOf(id)).state).toBe("pending");
  });

  it("refuses not_stuck for a payment that is no longer pending", async () => {
    const v = await setup();
    const id = await strandBillPayment(v, await openOrder(v), { kind: "none" });
    await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    const res = await post(v, attestPath(id), { outcome: "received", note: NOTE, pin: "1234" });

    expect(res.status).toBe(409);
    expect(await errorOf(res)).toEqual({
      code: "bill.payment_not_stuck",
      params: { paymentId: id },
    });
    expect((await billPaymentOf(id)).state).toBe("failed");
  });
});

describe("the bill payment attestation checks the manager's PIN before the write lock is taken", () => {
  const NOTE = "SumUp dashboard shows transaction TX-1 successful";

  afterEach(async () => {
    await watchedOrder();
  });

  const anotherWriter = () => withTransaction(suite.db, (tx) => tx.execute(sql`select 1`));

  async function strandedBillPayment(v: Venue): Promise<string> {
    return strandBillPayment(v, await openOrder(v), { kind: "failed" });
  }

  it("records the outcome while another writer commits during the PIN check", async () => {
    const v = await setup();
    const id = await strandedBillPayment(v);
    watchDerivationsAndLock(suite.db, "1234", anotherWriter, anotherWriter, anotherWriter);

    const res = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    expect(res.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(await billPaymentOf(id)).toEqual({
      state: "failed",
      attestedBy: v.managerId,
      attestationNote: NOTE,
    });
  });

  it("refuses the outcome when the manager's PIN changes while its key is being derived", async () => {
    const v = await setup();
    const id = await strandedBillPayment(v);
    watchDerivationsAndLock(suite.db, "1234", () =>
      withTransaction(suite.db, (tx) =>
        tx
          .update(persons)
          .set(withFoldedPersonChanges({ pinHash: hashPin("4321") }))
          .where(eq(persons.id, v.managerId)),
      ),
    );

    const res = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: "1234" });

    // The row changed after the early check, so the transaction derives the key again.
    expect(await watchedOrder()).toEqual(["writer", "derived", "derived under the request's lock"]);
    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual({ code: "pin.invalid", params: {} });
    expect(await billPaymentOf(id)).toEqual({
      state: "pending",
      attestedBy: null,
      attestationNote: null,
    });
  });

  it("derives no key for a session without hardware.manage", async () => {
    const v = await setup();
    const id = await strandedBillPayment(v);
    watchDerivationsAndLock(suite.db, "1234", anotherWriter);

    const res = await post(
      v,
      attestPath(id),
      { outcome: "failed", note: NOTE, pin: "1234" },
      v.staffCookie,
    );

    expect(res.status).toBe(403);
    expect(await watchedOrder()).toEqual([]);
  });

  it("derives no key for a PIN that is not text", async () => {
    const v = await setup();
    const id = await strandedBillPayment(v);
    watchDerivationsAndLock(suite.db, "1234", anotherWriter);

    const res = await post(v, attestPath(id), { outcome: "failed", note: NOTE, pin: 1234 });

    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual({ code: "pin.invalid", params: {} });
    expect(await watchedOrder()).toEqual([]);
  });

  it("derives no key once the wrong-PIN limit refuses", async () => {
    const v = await setup();
    const id = await strandedBillPayment(v);
    const wrong = { outcome: "failed", note: NOTE, pin: "9999" };
    for (let i = 0; i <= PIN_THROTTLE_FREE_ATTEMPTS; i += 1) {
      expect((await post(v, attestPath(id), wrong)).status).toBe(401);
    }
    watchDerivationsAndLock(suite.db, "1234", anotherWriter);

    const res = await post(v, attestPath(id), { ...wrong, pin: "1234" });

    expect(res.status).toBe(429);
    expect(await watchedOrder()).toEqual([]);
  });

  it("counts wrong PINs sent at once as it counts them sent in turn, deriving as many keys", async () => {
    const v = await setup();
    const id = await strandedBillPayment(v);
    const wrong = { outcome: "failed", note: NOTE, pin: "9999" };
    watchDerivationsAndLock(suite.db, "9999");

    const answers = await Promise.all(
      Array.from({ length: PIN_THROTTLE_FREE_ATTEMPTS + 2 }, () => post(v, attestPath(id), wrong)),
    );
    const derived = watchedDerivationCount();
    const right = await post(v, attestPath(id), { ...wrong, pin: "1234" });

    expect(answers.map((res) => res.status).sort()).toEqual([
      ...Array.from({ length: PIN_THROTTLE_FREE_ATTEMPTS + 1 }, () => 401),
      429,
    ]);
    // As many keys as when they are sent in turn: none for the one the limit refuses.
    expect(derived).toBe(PIN_THROTTLE_FREE_ATTEMPTS + 1);
    expect(right.status).toBe(429);
    expect((await billPaymentOf(id)).state).toBe("pending");
  });
});

describe("the manager's lists, of rows written within one millisecond", () => {
  const AT = "2026-09-26T09:59:00.000Z";
  const COUNT = 6;

  /**
   * `COUNT` open orders, the one for the first row written opened LAST and given the highest id,
   * so a list read through the orders comes back reversed. Returns them in the rows' order.
   */
  async function ordersOpenedBackwards(v: Venue): Promise<string[]> {
    const id = descendingIds();
    const orders = Array.from({ length: COUNT }, () => id());
    for (const orderId of [...orders].reverse()) await openOrder(v, orderId);
    return orders;
  }

  /** A pending card bill payment on each order, written in the order given, all at `AT`. */
  async function writeBillPayments(v: Venue, orders: readonly string[]): Promise<string[]> {
    const id = descendingIds();
    const written: string[] = [];
    for (const workingOrderId of orders) {
      const [row] = await suite.db
        .insert(billPayments)
        .values({
          id: id(),
          workingOrderId,
          submissionId: randomUUID(),
          fingerprint: "stranded",
          kind: "contribution",
          method: "card",
          applied: 150,
          state: "pending",
          requestedBy: v.managerId,
          source: v.cfg.origin.source,
          deviceId: v.cfg.origin.deviceId,
          createdAt: AT,
        })
        .returning({ id: billPayments.id });
      written.push(row!.id);
    }
    return written;
  }

  it("lists the pending bill payments in the order they were taken", async () => {
    const v = await setup();
    const taken = await writeBillPayments(v, await ordersOpenedBackwards(v));
    // Their provider rows are written the other way round.
    const id = descendingIds();
    for (const billPaymentId of [...taken].reverse()) {
      const [bill] = await suite.db
        .select({ workingOrderId: billPayments.workingOrderId })
        .from(billPayments)
        .where(eq(billPayments.id, billPaymentId));
      await suite.db.insert(payments).values({
        id: id(),
        workingOrderId: bill!.workingOrderId,
        source: v.cfg.origin.source,
        deviceId: v.cfg.origin.deviceId,
        provider: "stripe",
        paymentRef: randomUUID(),
        amount: 150,
        state: "attempting",
        billPaymentId,
        createdAt: AT,
        updatedAt: AT,
      });
    }

    const res = await send(v, "GET", "/management-api/payments/bill-payments");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { billPaymentId: string }[];
    expect(body.map((row) => row.billPaymentId)).toEqual(taken);
  });

  it("lists the pending bill refunds in the order they were asked for", async () => {
    const v = await setup();
    const orders = await ordersOpenedBackwards(v);
    // The bill payments are written the other way round from their refunds.
    const paid = (await writeBillPayments(v, [...orders].reverse())).reverse();
    const id = descendingIds();
    const asked: string[] = [];
    for (const billPaymentId of paid) {
      const [row] = await suite.db
        .insert(refunds)
        .values({
          id: id(),
          billPaymentId,
          ...billRefundFields(suite.db, v.cfg.nodeId, billPaymentId),
          submissionId: randomUUID(),
          fingerprint: "f",
          appliedAmount: 100,
          reason: "error",
          authorizedBy: v.managerId,
          requestedBy: v.managerId,
          source: v.cfg.origin.source,
          deviceId: v.cfg.origin.deviceId,
          state: "pending",
          createdAt: AT,
        })
        .returning({ id: refunds.id });
      asked.push(row!.id);
    }

    const res = await send(v, "GET", "/management-api/payments/bill-refunds");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { refundId: string }[];
    expect(body.map((row) => row.refundId)).toEqual(asked);
  });
});

describe("provider-confirmed partial-refund release", () => {
  const releasePath = (id: string) => `/management-api/payments/partial-refunds/${id}/release`;
  async function partial(
    options: {
      bill?: "pending" | "failed";
      placed?: boolean;
      unidentified?: boolean;
      supported?: boolean;
      amount?: string;
      slipWanted?: boolean;
    } = {},
  ) {
    const evidence = {
      kind: "known" as const,
      processorRef: "partial-txn",
      captured: decimal(options.amount ?? "1.50"),
      refunds: [
        { providerRefundRef: "first", amount: decimal("0.40") },
        { providerRefundRef: "rest", amount: decimal("1.10") },
      ],
    };
    const lookup = vi.fn<(processorRef: string) => Promise<typeof evidence>>(async () => evidence);
    const provider = Object.assign(new FakePaymentProvider(suite.db), {
      lookupCompletedRefunds: lookup,
    });
    const v = await setup({ extra: provider, partialRefundRelease: options.supported ?? true });
    const orderId = await openOrder(v);
    const bill = options.bill
      ? await strandBillPayment(
          v,
          orderId,
          { kind: "captured" },
          options.amount,
          undefined,
          undefined,
          options.slipWanted,
        )
      : null;
    const key = { provider: provider.provider, paymentRef: randomUUID() };
    await withTransaction(suite.db, async (tx) => {
      if (bill)
        await liftPaymentGuard(tx, () =>
          tx
            .update(payments)
            .set({ ...key, externalRef: "partial-txn" })
            .where(eq(payments.billPaymentId, bill)),
        );
      else
        await insertCapturedPayment(tx, {
          ...key,
          origin: deviceOrigin(v.deviceId),
          nodeId: v.cfg.nodeId,
          workingOrderId: brandWorkingOrderId(orderId),
          amount: decimal(options.amount ?? "1.50"),
          externalRef: "partial-txn",
          settledAt: new Date(MARK),
          card: { scheme: "VISA", last4: "1234", entryMode: "chip", authCode: "AUTH" },
        });
      await recordRefund(tx, {
        ...key,
        amount: decimal("0.40"),
        ...(options.unidentified ? {} : { providerRefundRef: "first" }),
      });
      if (bill && options.bill === "failed")
        await tx
          .update(billPayments)
          .set({ state: "failed", failedAt: MARK })
          .where(eq(billPayments.id, bill));
      if (options.placed)
        await tx
          .update(workingOrders)
          .set({ status: "placed" })
          .where(eq(workingOrders.id, orderId));
    });
    const [payment] = await suite.db
      .select()
      .from(payments)
      .where(eq(payments.paymentRef, key.paymentRef));
    return { v, orderId, bill, payment: payment!, lookup, evidence };
  }

  const retainPath = (id: string) => `/management-api/payments/partial-refunds/${id}/retain`;
  const allocation = { remaining: "1.10", applied: "1.10", tip: "0.00" };
  it("refuses partial-refund recovery for a payment without a bill payment", async () => {
    const { v, payment, lookup } = await partial();
    const retained = await post(v, retainPath(payment.id), allocation);
    const released = await send(v, "POST", releasePath(payment.id));
    for (const response of [retained, released]) {
      expect(response.status).toBe(409);
      expect(await errorOf(response)).toMatchObject({ code: "payment.not_stuck" });
    }
    expect(lookup).not.toHaveBeenCalled();
  });
  it("retains net money and collects only the remainder", async () => {
    const { v, orderId, payment, evidence, lookup } = await partial({ bill: "pending" });
    evidence.refunds.pop();
    const result = await post(v, retainPath(payment.id), allocation);
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      outcome: "retained",
      applied: "1.10",
      tip: "0.00",
      outstanding: "0.40",
    });
    const [saved] = await suite.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(saved).toMatchObject({
      amount: 150,
      state: "partially_refunded",
      externalRef: "partial-txn",
      billPaymentId: expect.any(String),
    });
    const [received] = await suite.db
      .select()
      .from(billPayments)
      .where(eq(billPayments.id, saved!.billPaymentId!));
    expect(received).toMatchObject({
      state: "received",
      applied: 110,
      tip: 0,
      attestedBy: v.managerId,
    });
    expect(
      (await withTransaction(suite.db, (tx) => readBillBalance(tx, orderId))).outstanding,
    ).toBe("0.40");
    expect(await orderOf(orderId)).toEqual({ status: "open" });
    expect(await post(v, retainPath(payment.id), allocation).then((r) => r.status)).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(
      await post(v, retainPath(payment.id), { ...allocation, tip: "0.10" }).then((r) => r.status),
    ).toBe(400);
    await takeReaderBillPayment(
      {
        db: suite.db,
        backend,
        clock,
        provider: new FakePaymentProvider(suite.db),
        admission: testTradingAdmission(),
      },
      v.cfg,
      orderId,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "0.40",
        method: "card",
        applied: "0.40",
        tip: "0.00",
      },
      {
        personId: v.managerId,
        sessionId: await openTillSession(suite.db, {
          deviceId: v.cfg.origin.deviceId,
          personId: v.managerId,
        }),
      },
    );
    const [linked] = await suite.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(linked!.saleId).not.toBeNull();
    expect(
      await suite.db
        .select({ amount: tenders.amount })
        .from(tenders)
        .where(eq(tenders.saleId, linked!.saleId!)),
    ).toEqual([{ amount: 110 }, { amount: 40 }]);
    expect(await post(v, retainPath(payment.id), allocation).then((r) => r.status)).toBe(200);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("retaining a pending bill payment's money prints its asked-for slip once", async () => {
    const { v, payment, evidence } = await partial({ bill: "pending", slipWanted: true });
    await slipPrinterFor(v.cfg.origin.deviceId);
    evidence.refunds.pop();
    expect((await post(v, retainPath(payment.id), allocation)).status).toBe(200);
    expect((await post(v, retainPath(payment.id), allocation)).status).toBe(200);
    expect(slipsPrinted()).toEqual(["taken"]);
  });

  it("retaining money keeps the payment received when its slip's write ends the transaction", async () => {
    const { v, bill, payment, evidence } = await partial({ bill: "pending", slipWanted: true });
    await slipPrinterFor(v.cfg.origin.deviceId);
    evidence.refunds.pop();
    const warn = slipsEndTheirTransaction();
    expect((await post(v, retainPath(payment.id), allocation)).status).toBe(200);
    expect((await billPaymentOf(bill!)).state).toBe("received");
    expect(slipsPrinted()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "receipt.optional_document_failed",
      expect.objectContaining({ operation: "printSettledPaymentSlip" }),
    );
  });

  it("releasing a charge refunded in full prints no slip, though one was asked for", async () => {
    const { v, bill, payment } = await partial({ bill: "pending", slipWanted: true });
    await slipPrinterFor(v.cfg.origin.deviceId);
    expect((await send(v, "POST", releasePath(payment.id))).status).toBe(200);
    expect((await billPaymentOf(bill!)).state).toBe("failed");
    expect(slipsPrinted()).toEqual([]);
  });

  it("shows a bill-first excess as tip and issues net tenders, refusing it when tips are off", async () => {
    const { v, orderId, payment, evidence, lookup } = await partial({
      amount: "2.00",
      bill: "pending",
    });
    evidence.refunds.pop();
    const seen = { remaining: "1.60", applied: "1.50", tip: "0.10" };
    const refused = await post(v, retainPath(payment.id), seen);
    expect((await errorOf(refused)).code).toBe("bill.tip_not_allowed");
    expect(lookup).not.toHaveBeenCalled();
    await setTipsForTest(suite.db, true);
    const list = await send(v, "GET", "/management-api/payments/bill-payments");
    expect(await list.json()).toMatchObject([{ retention: { ...seen, outstanding: "0.00" } }]);
    const result = await post(v, retainPath(payment.id), seen);
    expect(result.status).toBe(200);
    const [saved] = await suite.db.select().from(payments).where(eq(payments.id, payment.id));
    expect(saved!.saleId).not.toBeNull();
    expect(
      await suite.db
        .select({ amount: tenders.amount, tip: tenders.tipAmount })
        .from(tenders)
        .where(eq(tenders.saleId, saved!.saleId!)),
    ).toEqual([{ amount: 160, tip: 10 }]);
    expect(await orderOf(orderId)).toEqual({ status: "settled" });
  });

  it("keeps failed-linked money on the full-refund route", async () => {
    const { v, payment, lookup } = await partial({ bill: "failed" });
    const list = await send(v, "GET", "/management-api/payments/bill-payments");
    const [row] = await list.json();
    expect(row.billState).toBe("failed");
    expect(row.retention).toBeUndefined();
    const refused = await post(v, retainPath(payment.id), allocation);
    expect((await errorOf(refused)).code).toBe("payment.not_stuck");
    expect(lookup).not.toHaveBeenCalled();
    expect((await send(v, "POST", releasePath(payment.id))).status).toBe(200);
  });

  it.each(["evidence changed", "another box", "permission lost"])(
    "retains the hold when %s during confirmation",
    async (problem) => {
      const { v, bill, payment, evidence, lookup } = await partial({ bill: "pending" });
      evidence.refunds.pop();
      lookup.mockImplementation(async () => {
        if (problem === "evidence changed")
          evidence.refunds.push({ providerRefundRef: "later", amount: decimal("0.10") });
        if (problem === "another box")
          await liftPaymentGuard(suite.db, async () =>
            suite.db
              .update(payments)
              .set({ nodeId: await seedNode(suite.db) })
              .where(eq(payments.id, payment.id)),
          );
        if (problem === "permission lost")
          await suite.db
            .update(persons)
            .set(withFoldedPersonChanges({ status: "suspended" }))
            .where(eq(persons.id, v.managerId));
        return evidence;
      });
      const result = await post(v, retainPath(payment.id), allocation);
      const refusal = await errorOf(result);
      expect(refusal.code).toBe(
        problem === "evidence changed"
          ? "bill.allocation_changed"
          : problem === "another box"
            ? "payment.not_stuck"
            : "person.suspended",
      );
      expect(
        await suite.db
          .select()
          .from(paymentRefunds)
          .where(eq(paymentRefunds.paymentId, payment.id)),
      ).toHaveLength(problem === "evidence changed" ? 2 : 1);
      expect((await billPaymentOf(bill!)).state).toBe("pending");
      if (problem === "evidence changed") {
        expect(refusal.params).toMatchObject({
          preview: { kind: "allocated", applied: "1.00", charged: "1.00", tip: "0.00" },
        });
        expect(
          await (await send(v, "GET", "/management-api/payments/bill-payments")).json(),
        ).toMatchObject([{ partialRefund: { remaining: "1.00" } }]);
        lookup.mockResolvedValue(evidence);
        expect(
          (
            await post(v, retainPath(payment.id), {
              remaining: "1.00",
              applied: "1.00",
              tip: "0.00",
            })
          ).status,
        ).toBe(200);
      }
    },
  );

  it("refuses gross completion of a partly refunded pending payment", async () => {
    const { v, bill } = await partial({ bill: "pending" });
    await expect(
      withTransaction(suite.db, (tx) =>
        completeBillPayment(
          tx,
          { db: suite.db, backend, clock, admission: testTradingAdmission() },
          v.cfg,
          bill!,
          new Date(MARK),
        ),
      ),
    ).rejects.toMatchObject({ code: "bill.attestation_contradicted" });
    expect((await billPaymentOf(bill!)).state).toBe("pending");
  });

  it.each([
    { bill: "pending" as const, placed: false },
    { bill: "failed" as const, placed: false },
  ])(
    "lists and releases $bill/$placed with only session authorization, preserving the capture",
    async (options) => {
      const { v, orderId, bill, payment, lookup } = await partial(options);
      const list = await send(v, "GET", "/management-api/payments/bill-payments");
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([
        expect.objectContaining({
          partialRefund: {
            paymentId: payment.id,
            captured: "1.50",
            refunded: "0.40",
            remaining: "1.10",
          },
        }),
      ]);
      expect(
        await withTransaction(suite.db, (tx) => ordersWithUnfiledPayment(tx, [orderId])),
      ).toEqual(new Set([orderId]));
      const result = await send(v, "POST", releasePath(payment.id));
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ outcome: "released" });
      expect(lookup).toHaveBeenCalledWith("partial-txn");
      expect(await suite.db.select().from(payments).where(eq(payments.id, payment.id))).toEqual([
        { ...payment, state: "refunded", updatedAt: expect.any(String) },
      ]);
      expect(
        await suite.db
          .select({
            ref: paymentRefunds.providerRefundRef,
            amount: paymentRefunds.amount,
            by: paymentRefunds.authorizedBy,
          })
          .from(paymentRefunds)
          .where(eq(paymentRefunds.paymentId, payment.id)),
      ).toEqual([
        { ref: "first", amount: 40, by: null },
        { ref: "rest", amount: 110, by: v.managerId },
      ]);
      expect(await orderOf(orderId)).toEqual({
        status: options.placed ? "placed" : "open",
      });
      if (bill) expect((await billPaymentOf(bill)).state).toBe("failed");
      expect(saleIdsFor(orderId)).toEqual([]);
      expect(
        await withTransaction(suite.db, (tx) => ordersWithUnfiledPayment(tx, [orderId])),
      ).toEqual(new Set());
      const replay = await send(v, "POST", releasePath(payment.id));
      expect(replay.status).toBe(200);
      expect(await replay.json()).toEqual({ outcome: "released" });
      expect(lookup).toHaveBeenCalledTimes(1);

      expect(
        await suite.db
          .select()
          .from(paymentRefunds)
          .where(eq(paymentRefunds.paymentId, payment.id)),
      ).toHaveLength(2);
      expect(await (await send(v, "GET", "/management-api/payments/bill-payments")).json()).toEqual(
        [],
      );
    },
  );

  it.each([
    "partial",
    "wrong-capture",
    "wrong-reference",
    "missing-prior",
    "different-prior",
    "unidentified",
    "unidentified-partial",
  ])("keeps the capture held for %s evidence", async (problem) => {
    const { v, bill, payment, evidence, lookup } = await partial({
      bill: "pending",
      unidentified: problem.startsWith("unidentified"),
    });
    if (problem === "partial" || problem === "unidentified-partial") evidence.refunds.pop();
    if (problem === "wrong-capture") evidence.captured = decimal("2.00");
    if (problem === "wrong-reference") evidence.processorRef = "another-txn";
    if (problem === "missing-prior") evidence.refunds[0]!.providerRefundRef = "another-refund";
    if (problem === "different-prior") {
      evidence.refunds[0]!.amount = decimal("0.50");
      evidence.refunds[1]!.amount = decimal("1.00");
    }
    const result = await send(v, "POST", releasePath(payment.id));
    expect(result.status).toBe(409);
    const error = await errorOf(result);
    expect(error.code).toBe("payment.outcome_unknown");
    if (problem.startsWith("unidentified")) {
      expect(error.params).toMatchObject({ reason: "refund_reference_missing" });
      expect(lookup).not.toHaveBeenCalled();
    }
    expect(await suite.db.select().from(payments).where(eq(payments.id, payment.id))).toEqual([
      payment,
    ]);
    expect(
      await suite.db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, payment.id)),
    ).toHaveLength(1);
    expect((await billPaymentOf(bill!)).state).toBe("pending");
  });

  it("refuses with 409 provider refunds that, stored in whole cents, would exceed the capture, changing nothing", async () => {
    const { v, bill, payment, evidence } = await partial({ bill: "pending" });
    // 0.40 + 0.555 + 0.545 is the 1.50 captured, but 0.555 is stored as 0.56, so 0.545 more
    // would take the stored refunds to 1.505.
    evidence.refunds.splice(
      1,
      1,
      ...[
        { providerRefundRef: "second", amount: decimal("0.555") },
        { providerRefundRef: "third", amount: decimal("0.545") },
      ],
    );
    const before = await suite.db
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.paymentId, payment.id));

    const result = await send(v, "POST", releasePath(payment.id));

    expect({ status: result.status, code: (await errorOf(result)).code }).toEqual({
      status: 409,
      code: "payment.refund_exceeds_capture",
    });
    expect(await suite.db.select().from(payments).where(eq(payments.id, payment.id))).toEqual([
      payment,
    ]);
    expect(
      await suite.db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, payment.id)),
    ).toEqual(before);
    expect((await billPaymentOf(bill!)).state).toBe("pending");
  });

  it("refuses ordinary received and failed attestations over partially refunded money", async () => {
    const { v, bill, payment } = await partial({ bill: "pending" });
    for (const outcome of ["received", "failed"]) {
      const result = await post(v, attestPath(bill!), {
        outcome,
        note: "Checked refund",
        pin: "1234",
      });
      expect(result.status).toBe(409);
      expect((await errorOf(result)).code).toBe("bill.attestation_contradicted");
    }
    expect((await billPaymentOf(bill!)).state).toBe("pending");
    expect((await paymentRow(payment.id)).state).toBe("partially_refunded");
  });

  it("requires management permission before reading the provider and rechecks it after the read", async () => {
    const { v, bill, payment, lookup, evidence } = await partial({ bill: "pending" });
    for (const cookie of [null, v.staffCookie]) {
      const result = await send(v, "POST", releasePath(payment.id), cookie);
      expect([401, 403]).toContain(result.status);
      expect((await errorOf(result)).code).toBe(
        cookie ? "authorization.not_permitted" : "management_session.required",
      );
    }
    expect(lookup).not.toHaveBeenCalled();
    lookup.mockImplementation(async () => {
      await suite.db
        .update(persons)
        .set(withFoldedPersonChanges({ status: "suspended" }))
        .where(eq(persons.id, v.managerId));
      return evidence;
    });
    const result = await send(v, "POST", releasePath(payment.id));
    expect(result.status).toBe(403);
    expect((await errorOf(result)).code).toBe("person.suspended");
    expect((await paymentRow(payment.id)).state).toBe("partially_refunded");
    expect((await billPaymentOf(bill!)).state).toBe("pending");
  });

  it("uses the production SumUp contribution to enable the manager release", async () => {
    const { v, payment } = await partial({
      bill: "pending",
      supported:
        CARD_PROVIDERS.find((p) => p.providerId === "sumup")?.partialRefundRelease ?? false,
    });
    expect((await send(v, "POST", releasePath(payment.id))).status).toBe(200);
    expect((await paymentRow(payment.id)).state).toBe("refunded");
  });

  it.each(["pending", "failed"] as const)(
    "leaves an unflagged provider's %s payment out of release",
    async (bill) => {
      const { v, payment, lookup } = await partial({ supported: false, bill });
      const list = await send(v, "GET", "/management-api/payments/bill-payments");
      const rows = (await list.json()) as Array<{ partialRefund?: unknown }>;
      expect(rows).toHaveLength(bill === "pending" ? 1 : 0);
      expect(rows[0]?.partialRefund).toBeUndefined();
      const result = await send(v, "POST", releasePath(payment.id));
      expect(result.status).toBe(409);
      expect((await errorOf(result)).code).toBe("payment.not_stuck");
      expect(lookup).not.toHaveBeenCalled();
    },
  );

  it("rolls provider refunds back when the linked bill payment cannot be released", async () => {
    const { v, bill, payment } = await partial({ bill: "pending" });
    await suite.db
      .execute(sql`create trigger refuse_partial_release before update of state on bill_payments
      when old.state = 'pending' and new.state = 'failed'
      begin select raise(abort, 'probe: release refused'); end`);
    let result: Response;
    try {
      result = await send(v, "POST", releasePath(payment.id));
    } finally {
      await suite.db.execute(sql`drop trigger refuse_partial_release`);
    }
    expect(result.status).toBe(500);
    expect((await errorOf(result)).code).toBe("server.internal");
    expect((await paymentRow(payment.id)).state).toBe("partially_refunded");
    expect(
      await suite.db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, payment.id)),
    ).toHaveLength(1);
    expect((await billPaymentOf(bill!)).state).toBe("pending");
  });

  it("does not release another box's charge", async () => {
    const { v, payment, lookup } = await partial({ bill: "pending" });
    await liftPaymentGuard(suite.db, async () =>
      suite.db
        .update(payments)
        .set({ nodeId: await seedNode(suite.db) })
        .where(eq(payments.id, payment.id)),
    );
    const result = await send(v, "POST", releasePath(payment.id));
    expect(result.status).toBe(409);
    expect((await errorOf(result)).code).toBe("payment.not_stuck");
    expect(lookup).not.toHaveBeenCalled();
  });
});

async function slipPrinterFor(deviceId: string): Promise<void> {
  await withTransaction(suite.db, async (tx) => {
    const printer = await createPrinter(tx, {
      name: "Slips",
      transport: "cloud_poll",
      pollId: `poll-${randomUUID()}`,
    });
    await tx
      .update(devices)
      .set({ paymentSlipPrinterId: printer.id })
      .where(eq(devices.id, deviceId));
  });
}

/**
 * From here until the case ends, queueing a document ends the whole transaction it is in, as a full
 * disk can (conventions-data.md, "A full disk sometimes ends the whole transaction"). Answers the
 * silenced `console.warn`.
 */
function slipsEndTheirTransaction() {
  suite.db.run(sql`create temp trigger slip_ends_transaction before insert on print_jobs
    when new.kind = 'document' begin select raise(rollback, 'no room for the slip'); end`);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  onTestFinished(() => {
    suite.db.run(sql`drop trigger slip_ends_transaction`);
    warn.mockRestore();
  });
  return warn;
}

/** Each payment slip queued so far: "taken", "not taken", or "other" for any other document. */
function slipsPrinted(): string[] {
  const labels = ["es-ES", "ca-ES", "gl-ES", "eu-ES", "en-GB"].map(receiptLabelsFor);
  return suite.db
    .all<{ payload: Uint8Array }>(sql`select payload from print_jobs order by rowid`)
    .map(({ payload }) => decodeTicket(payload))
    .map((text) =>
      labels.some((l) => text.includes(l.paymentNotTakenHeading))
        ? "not taken"
        : labels.some((l) => text.includes(l.paymentHeading))
          ? "taken"
          : "other",
    );
}

describe("a slip asked for on a payment a manager settles", () => {
  it("Resolve prints the slip once for a card the provider charged", async () => {
    const v = await setup();
    await slipPrinterFor(v.cfg.origin.deviceId);
    const id = await strandBillPayment(
      v,
      await openOrder(v),
      { kind: "attempting", intent: { status: "succeeded", amountReceived: 150 } },
      "1.50",
      undefined,
      undefined,
      true,
    );
    expect((await send(v, "POST", billResolvePath(id))).status).toBe(200);
    expect((await send(v, "POST", billResolvePath(id))).status).toBe(409);
    expect(slipsPrinted()).toEqual(["taken"]);
  });

  it.each([
    [
      "the provider cancelled",
      { kind: "attempting", intent: { status: "requires_payment_method" } },
    ],
    ["no provider row", { kind: "none" }],
  ] as const)("Resolve prints a not-taken slip once when %s", async (_, provided) => {
    const v = await setup();
    await slipPrinterFor(v.cfg.origin.deviceId);
    const id = await strandBillPayment(
      v,
      await openOrder(v),
      provided as Provided,
      "1.50",
      undefined,
      undefined,
      true,
    );
    expect((await send(v, "POST", billResolvePath(id))).status).toBe(200);
    expect((await send(v, "POST", billResolvePath(id))).status).toBe(409);
    expect(slipsPrinted()).toEqual(["not taken"]);
  });

  it.each([
    ["received", "taken"],
    ["failed", "not taken"],
  ] as const)("Record outcome %s prints the matching slip once", async (outcome, slip) => {
    const v = await setup();
    await slipPrinterFor(v.cfg.origin.deviceId);
    const id = await strandBillPayment(
      v,
      await openOrder(v),
      { kind: "failed" },
      "1.50",
      undefined,
      undefined,
      true,
    );
    const body = { outcome, note: "Checked with the provider", pin: "1234" };
    expect((await post(v, attestPath(id), body)).status).toBe(200);
    expect((await post(v, attestPath(id), body)).status).toBe(409);
    expect(slipsPrinted()).toEqual([slip]);
  });

  it.each([
    ["Resolve", "charged", "received"],
    ["Resolve", "not charged", "failed"],
    ["Resolve", "cancelled at the provider", "failed"],
    ["Record outcome", "received", "received"],
    ["Record outcome", "failed", "failed"],
  ] as const)(
    "%s (%s) keeps the outcome when the slip's write ends the transaction",
    async (route, outcome, state) => {
      const v = await setup();
      await slipPrinterFor(v.cfg.origin.deviceId);
      const provided: Provided =
        route === "Record outcome"
          ? { kind: "failed" }
          : outcome === "charged"
            ? { kind: "attempting", intent: { status: "succeeded", amountReceived: 150 } }
            : outcome === "cancelled at the provider"
              ? { kind: "attempting", intent: { status: "requires_payment_method" } }
              : { kind: "none" };
      const id = await strandBillPayment(
        v,
        await openOrder(v),
        provided,
        "1.50",
        undefined,
        undefined,
        true,
      );
      const warn = slipsEndTheirTransaction();
      const answer =
        route === "Resolve"
          ? await send(v, "POST", billResolvePath(id))
          : await post(v, attestPath(id), {
              outcome,
              note: "Checked with the provider",
              pin: "1234",
            });
      expect(answer.status).toBe(200);
      expect((await billPaymentOf(id)).state).toBe(state);
      expect(slipsPrinted()).toEqual([]);
      expect(warn).toHaveBeenCalledWith(
        "receipt.optional_document_failed",
        expect.objectContaining({ operation: "printSettledPaymentSlip" }),
      );
    },
  );

  it("prints at the slip printer of the device the payment began on", async () => {
    const v = await setup();
    await slipPrinterFor(v.otherDeviceId);
    const id = await strandBillPayment(
      v,
      await openOrder(v),
      { kind: "failed" },
      "1.50",
      v.otherDeviceId,
      undefined,
      true,
    );
    const body = { outcome: "received", note: "Checked with the provider", pin: "1234" };
    expect((await post(v, attestPath(id), body)).status).toBe(200);
    const [device] = await suite.db.select().from(devices).where(eq(devices.id, v.otherDeviceId));
    expect(suite.db.all<{ printer_id: string }>(sql`select printer_id from print_jobs`)).toEqual([
      { printer_id: device!.paymentSlipPrinterId },
    ]);
  });
});
