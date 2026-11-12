import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createAdjustmentReason } from "@waitron/adjustments";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import {
  billPaymentRefunds,
  captureError,
  deviceProfiles,
  devices,
  sales,
  tenderRefunds,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { FiscalBackend, SaleForFiscalRecord } from "@waitron/fiscal";
import { startManagementSession } from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  failAttempting,
  insertAttempting,
  insertInitiated,
  recordHold,
  type CardProviderContribution,
} from "@waitron/payments";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import {
  AppError,
  decimal,
  deviceOrigin,
  jobOrigin,
  saleId as brandSaleId,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { readBillEditState } from "./bill-editing.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { attestCardRefund } from "./bill-refunds.js";
import { mountPaymentsApi } from "./payments-api.js";
import { startClockState } from "./start-clock-check.js";
import { gateSeatOnStartClock, startClockGateHolds } from "./start-clock-gate.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { attestTenderRefund } from "./tender-refund-sends.js";
import { REASONS } from "./testing/adjustment-venue.js";
import {
  fiscalRecordCount,
  groupedTabWith,
  inTx,
  provisionBillVenue,
  seatedWith,
  send,
  tabWith,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import { cancelBody, cancelItemRequest, cancelReasonId, giveAway } from "./testing/cancel-line.js";
import { heldRow } from "./testing/held-row.js";
import { issueOrderInvoice } from "./testing/issue-order.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { offerProducts, type ZoneOffers } from "./testing/zone-offers.js";
import {
  signStripeBody,
  stripeSessionEvent,
  verifyingStripe,
} from "./testing/fake-stripe-webhook.js";
import { mountWebhook } from "./webhook.js";
import { advanceTicketItem, parkOrder } from "./working-order.js";
import "./errors.js";

const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

let venue: BillVenue;
let counter: ZoneOffers;
let managerCookie: string;
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    counter = await inTx(venue, (tx) =>
      offerProducts(tx, venue.cfg, { zone: "counter", orderStart: "counter" }),
    );
    // The first till's profile may close by transfer, so that route's row reaches its clock check.
    await inTx(venue, async (tx) => {
      const [device] = await tx
        .select({ profileId: devices.deviceProfileId })
        .from(devices)
        .where(eq(devices.id, venue.deviceId));
      const [profile] = await tx
        .select({ capabilities: deviceProfiles.capabilities })
        .from(deviceProfiles)
        .where(eq(deviceProfiles.id, device!.profileId));
      await tx
        .update(deviceProfiles)
        .set({ capabilities: [...(profile!.capabilities as string[]), "close-by-transfer"] })
        .where(eq(deviceProfiles.id, device!.profileId));
    });
    const session = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: venue.adminId }),
    );
    managerCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    // The dashboard asks a stuck payment's provider only when it is connected: the fake is served
    // under the Stripe seat's credential, which the webhook's secret also comes from.
    await withTransaction(db, (tx) =>
      putCredential(tx, RING, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_ok",
          webhookSecret: "whsec_gate",
          successUrl: "https://example.test/ok",
          cancelUrl: "https://example.test/no",
        },
      }),
    );
  },
});

let invoiceNumber = 9_000;

/** A sale row of its own and the record input for it: positive and simplified unless told. */
async function saleInput(
  options: { total?: string; counterparty?: SaleForFiscalRecord["counterparty"] } = {},
): Promise<SaleForFiscalRecord> {
  const id = brandSaleId(randomUUID());
  const number = invoiceNumber++;
  const issuedAt = venue.clock.now().instant;
  const negative = options.total?.startsWith("-") === true;
  await venue.db.insert(sales).values({
    id,
    ...jobOrigin("readiness_test"),
    nodeId: venue.cfg.nodeId,
    seriesId: venue.seriesId,
    invoiceNumber: number,
    issuedAt: issuedAt.toISOString(),
    issuedOffsetMinutes: 60,
    total: 0,
    vatBreakdown: [],
    locale: "es-ES",
    invoiceLocales: ["es-ES"],
    fiscalBackend: "verifactu",
    fiscalState: "recorded",
  });
  return {
    origin: jobOrigin("readiness_test"),
    nodeId: venue.cfg.nodeId,
    saleId: id,
    seriesId: venue.seriesId,
    seriesCode: "A",
    invoiceNumber: number,
    issuedAt,
    offsetMinutes: 60,
    descriptionOfOperation: "Restaurante",
    total: decimal(negative ? "-12.10" : "12.10"),
    vatBreakdown: [
      {
        rate: decimal("21.00"),
        base: decimal(negative ? "-10.00" : "10.00"),
        tax: decimal(negative ? "-2.10" : "2.10"),
      },
    ],
    counterparty: options.counterparty ?? null,
  };
}

/** A sale recorded through the ungated seat, for the writers that cite one. */
async function recordedOriginal(): Promise<SaleForFiscalRecord> {
  const original = await saleInput();
  await withTransaction(venue.db, (tx) => venue.backend.recordSale(tx, original));
  return original;
}

type Write = (seat: FiscalBackend) => Promise<unknown>;

const writers: Record<string, () => Promise<Write>> = {
  recordSale: async () => {
    const input = await saleInput();
    return (seat) => withTransaction(venue.db, (tx) => seat.recordSale(tx, input));
  },
  recordVoid: async () => {
    const original = await recordedOriginal();
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordVoid(tx, original.saleId, "Wrong charge", venue.cfg.nodeId),
      );
  },
  recordCorrection: async () => {
    const original = await recordedOriginal();
    const input = await saleInput({ total: "-12.10" });
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordCorrection(tx, input, { correctsSaleId: original.saleId }),
      );
  },
  recordSubstitution: async () => {
    const original = await recordedOriginal();
    const input = await saleInput({
      counterparty: { taxId: "B12345674", legalName: "Customer Ltd", countryCode: "ES" },
    });
    return (seat) =>
      withTransaction(venue.db, (tx) =>
        seat.recordSubstitution(tx, input, { substitutedSaleIds: [original.saleId] }),
      );
  },
};

describe.each(Object.keys(writers))("the seat's %s behind the start clock gate", (name) => {
  it("throws clock.unconfirmed while the start waits, writing no record, and writes one once confirmed", async () => {
    const write = await writers[name]!();
    const state = startClockState();
    const seat = gateSeatOnStartClock(
      venue.backend,
      startClockGateHolds(
        state,
        () => true,
        () => false,
      ),
    );
    const before = fiscalRecordCount(venue);

    const error = await captureError(() => write(seat));

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: "clock.unconfirmed", params: {} });
    // The table's triggers refuse every update and delete, so an unchanged count is unchanged rows.
    expect(fiscalRecordCount(venue)).toBe(before);

    state.confirm("by_person", {});
    await write(seat);

    expect(fiscalRecordCount(venue)).toBe(before + 1);
  });
});

const OVERRIDE = () => ({ personId: venue.adminId, pin: "1234" });

function productIdOf(name: string): string {
  const [row] = venue.db.all<{ id: string }>(sql`select id from products where name = ${name}`);
  return row!.id;
}

const tarta = () => [{ menuItemId: counter.offerFor(productIdOf("Tarta")), quantity: "1" }];

function rowCount(table: string, where = sql`1 = 1`): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from ${sql.identifier(table)} where ${where}`,
  );
  return row!.n;
}

function moneyState() {
  return {
    records: rowCount("registros_facturacion"),
    sales: rowCount("sales"),
    tenders: rowCount("tenders"),
    payments: rowCount("payments"),
    billPayments: rowCount("bill_payments"),
    billRefunds: rowCount("bill_payment_refunds"),
    tenderRefunds: rowCount("tender_refunds"),
    providerRefunds: rowCount("payment_refunds"),
    adjustments: rowCount("adjustments"),
    departures: rowCount("unpaid_departures"),
    transferClosures: rowCount("transfer_closures"),
    holdOutcomes: rowCount("payment_hold_outcomes"),
    settledRefunds:
      rowCount("bill_payment_refunds", sql`state <> 'pending'`) +
      rowCount("tender_refunds", sql`state <> 'pending'`),
    drawerJobs: rowCount("print_jobs", sql`kind = 'drawer'`),
    printJobs: rowCount("print_jobs"),
    collects: venue.card.collectCalls.length,
    refundSends: venue.card.refundCalls.length,
    lookups: venue.card.lookupCalls.length,
    abandonedAsks: venue.card.abandonedAttemptCalls.length,
    orders: venue.db.all(
      sql`select id, status, revision, payment_attempt_at from working_orders order by id`,
    ),
    parties: venue.db.all(sql`select id, state, revision from parties order by id`),
    billPaymentStates: venue.db.all(sql`select id, state from bill_payments order by id`),
    providerPayments: venue.db.all(sql`select id, state from payments order by id`),
    lines: venue.db.all(sql`select * from working_order_lines order by id`),
  };
}

type Counted = Exclude<
  keyof ReturnType<typeof moneyState>,
  "orders" | "parties" | "billPaymentStates" | "providerPayments" | "lines"
>;

interface MoneyRoute {
  send: (app: Hono) => Promise<Answer>;
  /** What the confirmed request adds to: the control's proof that the refusal had work to stop. */
  grows: Counted[];
}

const as = (app: Hono, method: string, path: string, body?: unknown) =>
  send(app, venue.cookie, method, path, body);

function cashPart(amount: string) {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "cash",
    tendered: amount,
    applied: amount,
    tip: "0.00",
  };
}

function readerPart(amount: string) {
  return {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "card",
    entry: "reader",
    applied: amount,
    tip: "0.00",
  };
}

/** A Paella bill (35.00) with one part payment taken through the ungated routes. */
async function billPaid(body: Record<string, unknown>) {
  const billId = await tabWith(venue, "Paella");
  const paid = await as(venue.app, "POST", `/api/working-orders/${billId}/payments`, body);
  expect(paid.status).toBe(200);
  return { billId, paymentId: (paid.json.payment as { id: string }).id };
}

function billRefund(billId: string, paymentId: string) {
  const body = {
    submissionId: randomUUID(),
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "Overcharged",
    override: OVERRIDE(),
  };
  return (app: Hono) =>
    as(app, "POST", `/api/working-orders/${billId}/payments/${paymentId}/refunds`, body);
}

/** A Paella bill paid whole, which files its sale; answers the sale and its one tender. */
async function soldWhole(method: "cash" | "card") {
  const { billId } = await billPaid(method === "cash" ? cashPart("35.00") : readerPart("35.00"));
  const [tender] = await inTx(venue, (tx) =>
    tx
      .select({ saleId: tenders.saleId, tenderId: tenders.id })
      .from(tenders)
      .innerJoin(sales, eq(sales.id, tenders.saleId))
      .where(eq(sales.workingOrderId, billId)),
  );
  return tender!;
}

function tenderRefund(saleId: string, tenderId: string) {
  const body = {
    submissionId: randomUUID(),
    tenderId,
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "Overcharged",
    override: OVERRIDE(),
  };
  return (app: Hono) => as(app, "POST", `/api/transactions/${saleId}/refunds`, body);
}

/** A counter order of one Tarta, parked by the operator; filed and placed when `issued`. */
async function counterOrder(issued: boolean): Promise<string> {
  const id = randomUUID();
  const deps = { db: venue.db, backend: venue.backend, clock: venue.clock };
  await parkOrder(deps, venue.cfg, {
    id,
    lines: tarta(),
    zoneId: counter.zoneId,
    operatorId: venue.operatorId,
  });
  if (issued) {
    const admitted = { ...deps, admission: testTradingAdmission() };
    await issueOrderInvoice(admitted, venue.cfg, id, venue.operatorId);
    await placeOrder(admitted, venue.cfg, id, venue.operatorId);
  }
  return id;
}

const LOST = { kind: "uncertain", reason: "timeout" } as const;

const revisionOf = (billId: string) =>
  venue.db.all<{ revision: number }>(
    sql`select revision from working_orders where id = ${billId}`,
  )[0]!.revision;

/** A party of two 3.00 dishes sent to the kitchen, 3.00 of it paid: taking line 1 off settles it. */
async function halfPaidParty(started: boolean) {
  const [dish] = venue.db.all<{ name: string }>(
    sql`select name from products where unit_price = 300 order by id limit 1`,
  );
  const { tabId } = await seatedWith(venue, dish!.name, dish!.name);
  expect(
    (await as(venue.app, "POST", `/api/working-orders/${tabId}/payments`, cashPart("3.00"))).status,
  ).toBe(200);
  if (started) {
    const [item] = venue.db.all<{ id: string }>(sql`
      select t.id from ticket_items t join working_order_lines l on l.id = t.working_order_line_id
      where l.working_order_id = ${tabId} and l.line_no = 1`);
    await inTx(venue, (tx) => advanceTicketItem(tx, venue.cfg, item!.id, "preparing"));
  }
  return tabId;
}

/** Line 1 of `billId`, one Caña, raised to two with 3.00 paid: cutting it back to one settles it. */
async function halfPaidBeers(billId: string) {
  const raised = await as(venue.app, "PUT", `/api/working-orders/${billId}/lines/1`, {
    portionLineNos: [],
    revision: revisionOf(billId),
    expectedEdit: await readBillEditState(venue.db, billId),
    quantity: "2",
  });
  expect(raised.status).toBe(200);
  expect(
    (await as(venue.app, "POST", `/api/working-orders/${billId}/payments`, cashPart("3.00")))
      .status,
  ).toBe(200);
  return billId;
}

async function settlingCancelItem(billId: string, approver = false): Promise<MoneyRoute> {
  const reasonId = await inTx(venue, cancelReasonId);
  const { path, body } = await cancelItemRequest(venue.db, billId, 1, "1", {
    reasonId,
    ...(approver ? { approver: OVERRIDE() } : {}),
  });
  return { send: (app) => as(app, "POST", path, body), grows: ["sales", "records"] };
}

// Each row builds its own order, bill or sale, so rows never share one.
const moneyRoutes: Record<string, () => Promise<MoneyRoute>> = {
  "POST /api/pay, a counter card sale with no saved order": async () => {
    const id = randomUUID();
    return {
      send: (app) => as(app, "POST", "/api/pay", { id, lines: tarta(), zoneId: counter.zoneId }),
      grows: ["collects", "payments", "sales", "records"],
    };
  },
  "POST /api/pay, a card payment of a stored open order": async () => {
    const id = await counterOrder(false);
    return {
      send: (app) => as(app, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId }),
      grows: ["collects", "payments", "sales", "records"],
    };
  },
  "POST /api/pay, a card payment of an order whose invoice was filed": async () => {
    const id = await counterOrder(true);
    return {
      send: (app) => as(app, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId }),
      grows: ["collects", "payments", "tenders"],
    };
  },
  "POST /api/pay, a bill that owes nothing": async () => {
    const { tabId } = await seatedWith(venue, "Caña");
    await giveAway(venue, tabId, 1);
    return {
      send: (app) => as(app, "POST", "/api/pay", { id: tabId, lines: [] }),
      grows: ["sales", "records"],
    };
  },
  "POST /api/sales, a cash sale": async () => {
    const id = randomUUID();
    return {
      send: (app) =>
        as(app, "POST", "/api/sales", {
          workingOrderId: id,
          zoneId: counter.zoneId,
          lines: tarta(),
          tender: { method: "cash", amount: "18.00" },
        }),
      grows: ["sales", "tenders", "records", "drawerJobs"],
    };
  },
  "POST /api/working-orders/:id/collect, cash for a filed order": async () => {
    const id = await counterOrder(true);
    return {
      send: (app) =>
        as(app, "POST", `/api/working-orders/${id}/collect`, {
          tender: { method: "cash", amount: "18.00" },
        }),
      grows: ["tenders", "drawerJobs"],
    };
  },
  "a bill's card part payment": async () => {
    const billId = await tabWith(venue, "Paella");
    const body = readerPart("10.00");
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${billId}/payments`, body),
      grows: ["collects", "billPayments"],
    };
  },
  "a bill's cash part payment": async () => {
    const billId = await tabWith(venue, "Paella");
    const body = cashPart("10.00");
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${billId}/payments`, body),
      grows: ["billPayments", "drawerJobs"],
    };
  },
  "a new cash bill refund": async () => {
    const { billId, paymentId } = await billPaid(cashPart("10.00"));
    return { send: billRefund(billId, paymentId), grows: ["billRefunds", "drawerJobs"] };
  },
  "a new connected card bill refund": async () => {
    const { billId, paymentId } = await billPaid(readerPart("10.00"));
    return { send: billRefund(billId, paymentId), grows: ["billRefunds", "refundSends"] };
  },
  "a pending connected card bill refund sent again": async () => {
    const { billId, paymentId } = await billPaid(readerPart("10.00"));
    const resend = billRefund(billId, paymentId);
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    expect((await resend(venue.app)).json).toMatchObject({ refund: { state: "pending" } });
    return { send: resend, grows: ["lookups"] };
  },
  "a new connected card tender refund": async () => {
    const { saleId, tenderId } = await soldWhole("card");
    return { send: tenderRefund(saleId, tenderId), grows: ["tenderRefunds", "refundSends"] };
  },
  "a new cash tender refund": async () => {
    const { saleId, tenderId } = await soldWhole("cash");
    return { send: tenderRefund(saleId, tenderId), grows: ["tenderRefunds", "drawerJobs"] };
  },
  "a pending connected card tender refund sent again": async () => {
    const { saleId, tenderId } = await soldWhole("card");
    const resend = tenderRefund(saleId, tenderId);
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    expect((await resend(venue.app)).json).toMatchObject({ state: "pending" });
    return { send: resend, grows: ["lookups"] };
  },
  "the retry of a pending tender refund": async () => {
    const { saleId, tenderId } = await soldWhole("card");
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    const asked = await tenderRefund(saleId, tenderId)(venue.app);
    expect(asked.json).toMatchObject({ state: "pending" });
    const refundId = asked.json.id as string;
    return {
      send: (app) =>
        as(app, "POST", `/api/tender-refunds/${refundId}/retry`, { override: OVERRIDE() }),
      grows: ["lookups"],
    };
  },
  "an unpaid departure": async () => {
    const { partyId } = await seatedWith(venue, "Red wine bottle");
    const [party] = venue.db.all<{ revision: number }>(
      sql`select revision from parties where id = ${partyId}`,
    );
    const body = {
      expectedPartyRevision: party!.revision,
      reason: "Left without paying",
      override: OVERRIDE(),
    };
    return {
      send: (app) => as(app, "POST", `/api/parties/${partyId}/unpaid-departure`, body),
      grows: ["departures", "records"],
    };
  },
  "a close by bank transfer": async () => {
    const id = await counterOrder(false);
    const [order] = await inTx(venue, (tx) =>
      tx
        .select({ revision: workingOrders.revision, invoiceType: workingOrders.invoiceType })
        .from(workingOrders)
        .where(eq(workingOrders.id, id)),
    );
    const body = {
      submissionId: randomUUID(),
      expectedRevision: order!.revision,
      expectedEdit: null,
      expectedTotal: "18.00",
      invoiceType: order!.invoiceType,
      recipient: null,
      receiptLanguage: venue.cfg.locale,
      delivery: null,
      partyFinish: null,
    };
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${id}/close-by-transfer`, body),
      grows: ["transferClosures", "records"],
    };
  },
  "a cancel's credit of an order whose invoice was filed": async () => {
    const id = await counterOrder(true);
    const body = { reason: "Wrong order", override: OVERRIDE() };
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${id}/cancel`, body),
      grows: ["sales", "records"],
    };
  },
  "an adjustment that settles a part-paid bill": async () => {
    const billId = await halfPaidParty(false);
    const reasonId = await inTx(
      venue,
      async (tx) => (await createAdjustmentReason(tx, REASONS.house)).id,
    );
    const body = {
      ...(await cancelBody(venue.db, billId, 1)),
      reasonId,
      approver: OVERRIDE(),
      action: "discount_amount",
      amount: "3.00",
    };
    return {
      send: (app) => as(app, "POST", `/api/working-orders/${billId}/adjustments`, body),
      grows: ["adjustments", "sales", "records"],
    };
  },
  "a Cancel item that settles a part-paid bill": async () =>
    settlingCancelItem(await halfPaidParty(false)),
  "a Cancel item of a dish the kitchen started that settles a part-paid bill": async () =>
    settlingCancelItem(await halfPaidParty(true), true),
  "a partial Cancel item that settles a part-paid bill": async () =>
    settlingCancelItem(await halfPaidBeers(await groupedTabWith(venue, "Caña"))),
  "a held-order Save that settles a part-paid bill": async () => {
    const billId = await halfPaidBeers(await tabWith(venue, "Caña"));
    const dishes = venue.db.all<{ id: string }>(sql`
      select id from working_order_lines
      where working_order_id = ${billId} and parent_line_id is null order by line_no`);
    const body = {
      revision: revisionOf(billId),
      expectedEdit: await readBillEditState(venue.db, billId),
      lines: heldRow(
        dishes.map((line) => line.id),
        "1",
        { menuItemId: venue.offerFor("Caña") },
      ),
    };
    return {
      send: (app) => as(app, "PUT", `/api/working-orders/${billId}`, body),
      grows: ["sales", "records"],
    };
  },
};

describe("the till's money routes behind the start clock gate", () => {
  it.each(Object.keys(moneyRoutes))(
    "%s: refuses clock.unconfirmed while the start waits, moving and writing nothing, and is served once confirmed",
    async (name) => {
      const route = await moneyRoutes[name]!();
      const state = startClockState();
      const app = venue.appWith({
        backend: gateSeatOnStartClock(
          venue.backend,
          startClockGateHolds(
            state,
            () => true,
            () => false,
          ),
        ),
      });
      const before = moneyState();

      const refused = await route.send(app);

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ code: "clock.unconfirmed", params: {} });
      expect(moneyState()).toEqual(before);

      state.confirm("by_person", {});
      const served = await route.send(app);

      expect(served.status).toBe(200);
      const after = moneyState();
      for (const counted of route.grows)
        expect(after[counted], counted).toBeGreaterThan(before[counted]);
    },
  );
});

function paymentsApp(backend: FiscalBackend): Hono {
  // The fake card provider, offered under the Stripe seat so the dashboard counts it connected.
  const fakeSeat: CardProviderContribution = {
    ...createStripeCardProvider((() => {
      throw new Error("clock-unconfirmed-gate.test: the seat's own Stripe SDK is never built");
    }) as unknown as MakeStripe),
    providerId: "fake",
  };
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      isPrimary: () => true,
      admission: testTradingAdmission(),
      db: venue.db,
      backend,
      clock: venue.clock,
      cfg: venue.cfg,
      ring: RING,
      environment: "preproduction",
      pool: venue.pool,
      providers: [fakeSeat],
    },
    () => {},
  );
  return app;
}

const manager = (app: Hono, path: string, body: unknown = {}) =>
  send(app, managerCookie, "POST", path, body);

const confirmedBy = (outcome: string) => ({ outcome, note: "Seen at the provider", pin: "1234" });

/** A Paella bill's card part payment whose reader stopped answering, left pending. */
async function stalledBillPayment(amount: string) {
  const billId = await tabWith(venue, "Paella");
  venue.card.stallNextCollect();
  await as(venue.app, "POST", `/api/working-orders/${billId}/payments`, readerPart(amount));
  const [row] = venue.db.all<{ id: string; paymentRef: string }>(sql`
    select bp.id, p.payment_ref as paymentRef from bill_payments bp
    join payments p on p.bill_payment_id = bp.id
    where bp.working_order_id = ${billId} and bp.state = 'pending'
  `);
  return row!;
}

/** A refund of 5.00 the provider made but whose answer was lost, left pending; its row's id. */
async function pendingRefund(kind: "bill" | "tender"): Promise<string> {
  venue.card.scriptNextRefund({ made: "completed", answer: LOST });
  if (kind === "bill") {
    const { billId, paymentId } = await billPaid(readerPart("10.00"));
    await billRefund(billId, paymentId)(venue.app);
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ id: billPaymentRefunds.id, state: billPaymentRefunds.state })
        .from(billPaymentRefunds)
        .where(eq(billPaymentRefunds.billPaymentId, paymentId)),
    );
    expect(row!.state).toBe("pending");
    return row!.id;
  }
  const { saleId, tenderId } = await soldWhole("card");
  await tenderRefund(saleId, tenderId)(venue.app);
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ id: tenderRefunds.id, state: tenderRefunds.state })
      .from(tenderRefunds)
      .where(eq(tenderRefunds.saleId, saleId)),
  );
  expect(row!.state).toBe("pending");
  return row!.id;
}

const NOT_CHARGED = { outcome: "failed", cancelledAtProvider: true } as const;

// Each row builds its own payment, hold or refund, so rows never share one.
const dashboardResolutions: Record<string, () => Promise<MoneyRoute>> = {
  "a stuck card payment's resolve": async () => {
    const orderId = await tabWith(venue, "Caña");
    await withTransaction(venue.db, async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(venue.deviceId),
        workingOrderId: brandWorkingOrderId(orderId),
        nodeId: venue.cfg.nodeId,
        provider: "fake",
        paymentRef: randomUUID(),
        amount: decimal("3.00"),
      });
      await tx
        .update(workingOrders)
        .set({ paymentAttemptAt: venue.clock.now().instant.toISOString() })
        .where(eq(workingOrders.id, orderId));
    });
    const [stuck] = venue.db.all<{ id: string }>(
      sql`select id from payments where working_order_id = ${orderId}`,
    );
    return {
      send: async (app) => {
        venue.card.scriptAbandonedAttempt(NOT_CHARGED);
        const answer = await manager(app, `/management-api/payments/stuck/${stuck!.id}/resolve`);
        venue.card.scriptAbandonedAttempt({ outcome: "unknown", reason: "unreachable" });
        return answer;
      },
      grows: ["abandonedAsks"],
    };
  },
  "a stuck bill payment's resolve": async () => {
    const { id } = await stalledBillPayment("10.00");
    return {
      send: async (app) => {
        venue.card.scriptAbandonedAttempt(NOT_CHARGED);
        const answer = await manager(app, `/management-api/payments/bill-payments/${id}/resolve`);
        venue.card.scriptAbandonedAttempt({ outcome: "unknown", reason: "unreachable" });
        return answer;
      },
      grows: ["abandonedAsks"],
    };
  },
  "a stuck bill payment's confirmed outcome": async () => {
    const { id, paymentRef } = await stalledBillPayment("35.00");
    await withTransaction(venue.db, (tx) => failAttempting(tx, { provider: "fake", paymentRef }));
    const path = `/management-api/payments/bill-payments/${id}/attest`;
    return {
      send: (app) => manager(app, path, confirmedBy("received")),
      grows: ["sales", "tenders", "records"],
    };
  },
  "a held payment's outcome": async () => {
    const id = randomUUID();
    const paid = await as(venue.app, "POST", "/api/pay", {
      id,
      lines: tarta(),
      zoneId: counter.zoneId,
    });
    expect(paid.status).toBe(200);
    const [payment] = venue.db.all<{ id: string }>(
      sql`select id from payments where working_order_id = ${id}`,
    );
    await withTransaction(venue.db, (tx) =>
      recordHold(tx, {
        paymentId: payment!.id,
        providerAmount: decimal("1.80"),
        foundAt: venue.clock.now().instant,
      }),
    );
    const [hold] = venue.db.all<{ id: string }>(
      sql`select id from payment_holds where payment_id = ${payment!.id}`,
    );
    const body = { outcome: "kept", note: "Kept", pin: "1234" };
    return {
      send: (app) => manager(app, `/management-api/payments/held/${hold!.id}/outcome`, body),
      grows: ["holdOutcomes"],
    };
  },
  "a pending bill refund's resolve": async () => {
    const id = await pendingRefund("bill");
    return {
      send: (app) => manager(app, `/management-api/payments/bill-refunds/${id}/resolve`),
      grows: ["lookups", "settledRefunds"],
    };
  },
  "a pending bill refund's confirmed outcome": async () => {
    const id = await pendingRefund("bill");
    const path = `/management-api/payments/bill-refunds/${id}/attest`;
    return {
      send: (app) => manager(app, path, confirmedBy("completed")),
      grows: ["settledRefunds"],
    };
  },
  "a pending tender refund's resolve": async () => {
    const id = await pendingRefund("tender");
    return {
      send: (app) => manager(app, `/management-api/payments/tender-refunds/${id}/resolve`),
      grows: ["lookups", "settledRefunds"],
    };
  },
  "a pending tender refund's confirmed outcome": async () => {
    const id = await pendingRefund("tender");
    const path = `/management-api/payments/tender-refunds/${id}/attest`;
    return {
      send: (app) => manager(app, path, confirmedBy("completed")),
      grows: ["settledRefunds"],
    };
  },
};

describe("the dashboard's payment resolutions behind the start clock gate", () => {
  it.each(Object.keys(dashboardResolutions))(
    "%s: refuses clock.unconfirmed while the start waits, moving and writing nothing, and is served once confirmed",
    async (name) => {
      const route = await dashboardResolutions[name]!();
      const state = startClockState();
      const app = paymentsApp(
        gateSeatOnStartClock(
          venue.backend,
          startClockGateHolds(
            state,
            () => true,
            () => false,
          ),
        ),
      );
      const before = moneyState();

      const refused = await route.send(app);

      expect(refused.status).toBe(409);
      expect(refused.json).toEqual({ code: "clock.unconfirmed", params: {} });
      expect(moneyState()).toEqual(before);

      state.confirm("by_person", {});
      const served = await route.send(app);

      expect(served.status).toBe(200);
      const after = moneyState();
      for (const counted of route.grows)
        expect(after[counted], counted).toBeGreaterThan(before[counted]);
    },
  );
});

// The routes check first; these reach the confirmed-outcome writers' own check (`clockStopsRefund`).
const confirmedOutcomes = {
  "a bill refund's confirmed outcome, written by attestCardRefund": {
    kind: "bill",
    attest: attestCardRefund,
  },
  "a tender refund's confirmed outcome, written by attestTenderRefund": {
    kind: "tender",
    attest: attestTenderRefund,
  },
} as const;

describe("a manager's confirmed refund outcome behind the start clock gate", () => {
  it.each(Object.keys(confirmedOutcomes) as (keyof typeof confirmedOutcomes)[])(
    "%s: throws clock.unconfirmed while the start waits, settling nothing, and settles once confirmed",
    async (name) => {
      const { kind, attest } = confirmedOutcomes[name];
      const id = await pendingRefund(kind);
      const state = startClockState();
      const deps = {
        db: venue.db,
        backend: gateSeatOnStartClock(
          venue.backend,
          startClockGateHolds(
            state,
            () => true,
            () => false,
          ),
        ),
        admission: testTradingAdmission(),
        clock: venue.clock,
        cfg: venue.cfg,
        refundProviderFor: (provider: string) => venue.pool.get(provider),
      };
      const confirmed = { attestedBy: venue.adminId, note: "Seen at the provider" };
      const before = moneyState();

      const error = await captureError(() => attest(deps, id, "completed", confirmed));

      expect(error).toMatchObject({ code: "clock.unconfirmed", params: {} });
      expect(moneyState()).toEqual(before);

      state.confirm("by_person", {});
      const settled = await attest(deps, id, "completed", confirmed);

      expect(settled.state).toBe("completed");
      expect(moneyState().settledRefunds).toBe(before.settledRefunds + 1);
    },
  );
});

/** Refund loop deps on the gate's seat, given the gate as boot gives it, `minutesOn` ahead so each
 * pending refund is due for a lookup. */
function loopOn(holds: () => boolean, minutesOn: number) {
  const base = venue.clock.now();
  const later = { ...base, instant: new Date(base.instant.getTime() + minutesOn * 60_000) };
  return {
    db: venue.db,
    backend: gateSeatOnStartClock(venue.backend, holds),
    admission: testTradingAdmission(),
    clock: { ...venue.clock, now: () => later },
    cfg: venue.cfg,
    refundProviderFor: (provider: string) => venue.pool.get(provider),
    clockUnconfirmed: holds,
  };
}

const refundLoops = {
  "the tender-refund loop": { kind: "tender", pass: recoverTenderRefunds },
  "the bill-refund half of the pass": { kind: "bill", pass: settlePendingBillPayments },
} as const;

describe("a refund loop whose wait for the time begins during the provider's lookup", () => {
  it.each(Object.keys(refundLoops) as (keyof typeof refundLoops)[])(
    "%s leaves the refund pending, and settles it once confirmed",
    async (name) => {
      const { kind, pass } = refundLoops[name];
      await pendingRefund(kind);
      const state = startClockState();
      let filing = false;
      const holds = startClockGateHolds(
        state,
        () => filing,
        () => false,
      );
      const card = venue.card as unknown as { lookupRefund: (query: unknown) => Promise<unknown> };
      const lookup = card.lookupRefund.bind(venue.card);
      const spy = vi.spyOn(card, "lookupRefund").mockImplementation(async (query) => {
        const answer = await lookup(query);
        filing = true;
        return answer;
      });
      const before = moneyState();

      try {
        await pass(loopOn(holds, 1));
      } finally {
        spy.mockRestore();
      }

      expect(filing).toBe(true);
      expect(moneyState()).toMatchObject({
        refundSends: before.refundSends,
        settledRefunds: before.settledRefunds,
        providerRefunds: before.providerRefunds,
      });

      state.confirm("by_person", {});
      await pass(loopOn(holds, 10));

      expect(moneyState().settledRefunds).toBeGreaterThan(before.settledRefunds);
    },
  );
});

describe("money already moved while the start waits", () => {
  it("a card charged as the gate turns on says so, and Pay records it without charging again once confirmed", async () => {
    const id = randomUUID();
    const before = moneyState();
    const state = startClockState();
    // The box counts as filing records only once the reader has collected, so the route's own
    // check lets the charge through and the sale's record is the first thing the gate refuses.
    const collected = () => venue.card.collectCalls.length > before.collects;
    const app = venue.appWith({
      backend: gateSeatOnStartClock(
        venue.backend,
        startClockGateHolds(state, collected, () => false),
      ),
    });
    const payments = () =>
      venue.db.all(
        sql`select state, sale_id is not null as filed from payments where working_order_id = ${id}`,
      );

    const charged = await as(app, "POST", "/api/pay", {
      id,
      lines: tarta(),
      zoneId: counter.zoneId,
    });

    expect(charged.status).toBe(507);
    expect(charged.json).toEqual({
      code: "sale.charged_not_recorded",
      params: { workingOrderId: id, reason: "clock_unconfirmed" },
    });
    expect(payments()).toEqual([{ state: "captured", filed: 0 }]);
    expect(moneyState()).toMatchObject({ collects: before.collects + 1, records: before.records });

    state.confirm("by_person", {});
    const paid = await as(app, "POST", "/api/pay", { id, lines: [], zoneId: counter.zoneId });

    expect(paid.status).toBe(200);
    expect(paid.json.outcome).toBe("captured");
    expect(payments()).toEqual([{ state: "captured", filed: 1 }]);
    expect(moneyState()).toMatchObject({
      collects: before.collects + 1,
      records: before.records + 1,
    });
  });

  it("the webhook stores a hosted payment, with no seat to refuse it", async () => {
    // The webhook takes no fiscal seat (`WebhookDeps`), so no gate can stand in front of it.
    const orderId = await tabWith(venue, "Caña");
    const sessionId = `cs_${randomUUID()}`;
    await withTransaction(venue.db, (tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(venue.deviceId),
        workingOrderId: brandWorkingOrderId(orderId),
        nodeId: venue.cfg.nodeId,
        provider: "stripe",
        paymentRef: randomUUID(),
        externalRef: sessionId,
        amount: decimal("3.00"),
      }),
    );
    const app = new Hono();
    mountWebhook(
      app,
      {
        db: venue.db,
        ring: RING,
        nodeId: venue.cfg.nodeId,
        admission: testTradingAdmission(),
        environment: "preproduction",
        makeStripe: () => verifyingStripe(),
      },
      () => {},
    );
    const body = stripeSessionEvent({
      type: "checkout.session.completed",
      sessionId,
      amountTotalMinor: 300,
      created: Math.floor(Date.now() / 1000),
    });

    const res = await app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signStripeBody(body, "whsec_gate") },
      body,
    });

    expect(res.status).toBe(200);
    expect(venue.db.all(sql`select state from payments where external_ref = ${sessionId}`)).toEqual(
      [{ state: "captured" }],
    );
  });
});
