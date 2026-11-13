import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import {
  invoiceSeries,
  sales,
  ticketItems,
  withTransaction,
  workingOrders,
  workingOrderLines,
} from "@waitron/db";
import { currentIncidentsOf, recordCorrection } from "@waitron/core";
import { startManagementSession } from "@waitron/identity";
import { computeDailyClose, currentBusinessDay } from "@waitron/reporting";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments, reconcilePayments } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import { ownsEveryPayment } from "@waitron/payments/test/seed.js";
import { recoverAutomaticCardPayments } from "./pending-card-recovery.js";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { FakeSumUp } from "@waitron/payments-sumup/src/testing/fake-sumup.js";
import { decimal, saleId, seriesId } from "@waitron/shared";
import { getBillBalance } from "./bill-payments.js";
import {
  provisionBillVenue,
  fiscalRecordCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
} from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { placeOrder } from "./testing/order-writer-fixture.js";
import { issueOrderInvoice } from "./testing/issue-order.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60000,
});
const poll = { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() };

it.each([
  { mode: "open", captured: 3400, asked: "35.00", actual: "34.00", records: 0 },
  { mode: "placed", captured: 3400, asked: "35.00", actual: "34.00", records: 0 },
  { mode: "invoiced", captured: 3400, asked: "35.00", actual: "34.00", records: 1 },
  { mode: "corrected", captured: 2900, asked: "30.00", actual: "29.00", records: 1 },
])(
  "keeps a short whole-order charge on a $mode bill and takes the remainder with a new reader key",
  async ({ mode, captured, asked, actual: actualMoney, records }) => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Paella");
    const deps = { ...venue, admission: testTradingAdmission() };
    if (mode === "invoiced" || mode === "corrected")
      await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
    if (mode === "corrected")
      await withTransaction(suite.db, async (tx) => {
        const [original] = await tx
          .select({ id: sales.id })
          .from(sales)
          .where(eq(sales.workingOrderId, id));
        const [series] = await tx
          .select({ id: invoiceSeries.id })
          .from(invoiceSeries)
          .where(eq(invoiceSeries.purpose, "rectificative"));
        const session = await startManagementSession(tx, { personId: venue.adminId });
        await recordCorrection(tx, venue.backend, {
          origin: venue.cfg.origin,
          nodeId: venue.cfg.nodeId,
          seriesId: seriesId(series!.id),
          correctsSaleId: saleId(original!.id),
          total: "-5.00",
          lines: [
            {
              lineNo: 1,
              name: "Price correction",
              descriptions: { "es-ES": "Price correction" },
              quantity: "-1",
              unitPrice: "4.13",
              lineTotal: "-4.13",
              vatRate: "21.00",
            },
          ],
          authz: { managementSessionId: session.token },
          clock: venue.clock,
        });
      });
    if (mode !== "open") await placeOrder(deps, venue.cfg, id, venue.operatorId);
    const sentDishes = await suite.db
      .select({ id: ticketItems.id })
      .from(ticketItems)
      .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
      .where(eq(workingOrderLines.workingOrderId, id));
    if (mode !== "open") expect(sentDishes).toHaveLength(1);
    let actual = captured;
    const client = new FakeStripe();
    const read = client.retrievePaymentIntent.bind(client);
    vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (ref) => ({
      ...(await read(ref)),
      status: "succeeded",
      amountReceived: actual,
    }));
    const create = vi.spyOn(client, "createPaymentIntent");
    const provider = new StripeTerminalProvider({ db: suite.db, client, captureAlerts, poll });
    vi.spyOn(venue.pool, "get").mockResolvedValue(
      Object.assign(Object.create(provider) as PaymentProvider, {
        collect: (params: Parameters<PaymentProvider["collect"]>[0]) =>
          provider.collect({ ...params, readerRef: "rdr_test" }),
      }),
    );
    const taken = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      zoneId: venue.zoneId,
    });
    expect(taken.status).toBe(200);
    expect(taken.json).toMatchObject({
      outcome: "partial",
      balance: { received: actualMoney, outstanding: "1.00" },
      captureWarning: { requestedAmount: asked, reportedAmount: actualMoney },
    });
    const [provided] = await suite.db
      .select()
      .from(payments)
      .where(eq(payments.workingOrderId, id));
    const reverse = vi.fn(async () => {});
    const checked = await reconcilePayments(
      {
        db: suite.db,
        provider: "stripe",
        settlementLagMs: 0,
        report: {
          fetch: async () => [
            {
              references: [provided!.externalRef!],
              amount: decimal(actualMoney),
              settledAt: new Date(provided!.settledAt!),
            },
          ],
        },
        reverse,
        incidents: captureAlerts.raise,
        heldAlerts: { ...captureAlerts, current: currentIncidentsOf },
      },
      {
        from: new Date(Date.parse(provided!.settledAt!) - 1000),
        to: new Date(Date.parse(provided!.settledAt!) + 1000),
      },
      venue.clock.now().instant,
    );
    expect(checked.orphan).toEqual([]);
    expect(reverse).not.toHaveBeenCalled();
    if (mode !== "open") {
      const cancelled = await send(
        venue.app,
        venue.cookie,
        "POST",
        `/api/working-orders/${id}/cancel`,
        { reason: "Guest changed their mind", override: { personId: venue.adminId, pin: "1234" } },
      );
      expect(cancelled.json).toMatchObject({ code: "bill.payments_received" });
      expect(cancelled.status).toBe(409);
    }
    expect(await statusOf(venue, id)).toBe(mode === "open" ? "open" : "placed");
    expect(fiscalRecordCount(venue, id)).toBe(records);
    expect(await getBillBalance(venue, id)).toMatchObject({
      received: actualMoney,
      outstanding: "1.00",
      captureWarning: { requestedAmount: asked, reportedAmount: actualMoney },
    });
    const replay = await send(venue.app, venue.cookie, "POST", "/api/pay", {
      id,
      lines: [],
      zoneId: venue.zoneId,
    });
    expect(replay.status).toBe(200);
    expect(replay.json).toMatchObject({
      outcome: "partial",
      balance: { received: actualMoney, outstanding: "1.00" },
      captureWarning: { requestedAmount: asked, reportedAmount: actualMoney },
    });
    expect(create).toHaveBeenCalledOnce();
    const report = () =>
      withTransaction(suite.db, (tx) =>
        computeDailyClose(tx, {
          nodeIds: [venue.cfg.nodeId],
          cutoverChanges: [],
          timeZone: "Europe/Madrid",
          dayCutover: "05:00",
          businessDay: currentBusinessDay({
            timeZone: "Europe/Madrid",
            dayCutover: "05:00",
            cutoverChanges: [],
          }),
        }),
      );
    expect((await report()).cash).toMatchObject({ tenderTotal: actualMoney, tipTotal: "0.00" });
    const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
    expect(order!.paymentAttemptAt).toBeNull();
    actual = 100;
    const rest = await send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "1.00",
      method: "card",
      entry: "reader",
      applied: "1.00",
      tip: "0.00",
    });
    expect(rest.status).toBe(200);
    expect(rest.json).toMatchObject({
      balance: { status: "settled", received: asked, outstanding: "0.00" },
    });
    if (mode !== "open")
      expect(
        await suite.db
          .select({ id: ticketItems.id })
          .from(ticketItems)
          .innerJoin(workingOrderLines, eq(workingOrderLines.id, ticketItems.workingOrderLineId))
          .where(eq(workingOrderLines.workingOrderId, id)),
      ).toEqual(sentDishes);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].idempotencyKey).not.toBe(
      create.mock.calls[1]![0].idempotencyKey,
    );
    expect(fiscalRecordCount(venue, id)).toBe(Math.max(1, records));
    expect((await tendersOfBill(venue, id)).map((row) => row.amount)).toEqual([captured, 100]);
    expect((await report()).cash).toMatchObject({ tenderTotal: asked, tipTotal: "0.00" });
  },
);

it.each(["stripe", "sumup"])(
  "uses actual money on a %s bill and permits a separate reader payment",
  async (providerId) => {
    const venue = await provisionBillVenue(suite.db);
    const app = venue.app;
    let actual = "9.00";
    let provider: PaymentProvider;
    const keys: string[] = [];
    if (providerId === "stripe") {
      const client = new FakeStripe();
      const create = client.createPaymentIntent.bind(client);
      vi.spyOn(client, "createPaymentIntent").mockImplementation((params) => {
        keys.push(params.idempotencyKey);
        return create(params);
      });
      const read = client.retrievePaymentIntent.bind(client);
      vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (id) => ({
        ...(await read(id)),
        status: "succeeded",
        amountReceived: Number(actual.replace(".", "")),
      }));
      provider = new StripeTerminalProvider({ db: suite.db, client, captureAlerts, poll });
    } else {
      const client = new FakeSumUp();
      const create = client.createCheckout.bind(client);
      vi.spyOn(client, "createCheckout").mockImplementation((params) => {
        keys.push(params.foreignTransactionId);
        return create(params);
      });
      const find = client.findTransaction.bind(client);
      vi.spyOn(client, "findTransaction").mockImplementation(async (query) => {
        const found = await find(query);
        return found === null ? null : { ...found, status: "SUCCESSFUL", amount: decimal(actual) };
      });
      provider = new SumUpCloudProvider({
        db: suite.db,
        client,
        captureAlerts,
        incidents: captureAlerts.raise,
        poll,
      });
    }
    const routed: PaymentProvider = Object.assign(Object.create(provider) as PaymentProvider, {
      collect: (params: Parameters<PaymentProvider["collect"]>[0]) =>
        provider.collect({ ...params, readerRef: "rdr_test" }),
    });
    vi.spyOn(venue.pool, "get").mockResolvedValue(routed);
    const id = await tabWith(venue, "Paella");
    const first = {
      submissionId: randomUUID(),
      kind: "contribution",
      amount: "10.00",
      method: "card",
      entry: "reader",
      applied: "10.00",
      tip: "1.00",
      addedTip: "1.00",
    };
    const pay = (body: object) =>
      send(app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, body);
    const taken = await pay(first);
    expect(taken.status).toBe(200);
    expect(taken.json).toMatchObject({
      payment: { state: "received", applied: "9.00", tip: "0.00" },
      balance: { received: "9.00", outstanding: "26.00", tips: "0.00", reserved: "0.00" },
    });
    const refund = await send(
      app,
      venue.cookie,
      "POST",
      `/api/working-orders/${id}/payments/${(taken.json.payment as { id: string }).id}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "10.00",
        tipAmount: "0.00",
        reason: "Return payment",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(refund.status).toBe(422);
    expect(refund.json).toMatchObject({
      code: "bill.refund_exceeds_payment",
      params: { applied: "9.00" },
    });
    expect((await pay(first)).json).toMatchObject({ payment: { applied: "9.00", tip: "0.00" } });
    expect(keys).toHaveLength(1);
    actual = "26.00";
    const rest = await pay({
      ...first,
      submissionId: randomUUID(),
      amount: "26.00",
      applied: "26.00",
      tip: "0.00",
      addedTip: "0.00",
    });
    expect(rest.status).toBe(200);
    expect(rest.json).toMatchObject({
      balance: { status: "settled", received: "35.00", outstanding: "0.00" },
    });
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
    const stored = await suite.db.select().from(payments).where(eq(payments.workingOrderId, id));
    expect(stored.map((row) => ({ amount: row.amount, requested: row.requestedAmount }))).toEqual([
      { amount: 900, requested: 1100 },
      { amount: 2600, requested: 2600 },
    ]);
  },
);

it("retains a short capture after a lost reader answer and warns the next operator without recharging", async () => {
  const venue = await provisionBillVenue(suite.db);
  const id = await tabWith(venue, "Paella");
  let confirmed = false;
  const client = new FakeStripe();
  const read = client.retrievePaymentIntent.bind(client);
  vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (ref) => ({
    ...(await read(ref)),
    status: confirmed ? "succeeded" : "processing",
    amountReceived: confirmed ? 3400 : 0,
  }));
  const create = vi.spyOn(client, "createPaymentIntent");
  const provider = new StripeTerminalProvider({ db: suite.db, client, captureAlerts, poll });
  vi.spyOn(venue.pool, "get").mockResolvedValue(
    Object.assign(Object.create(provider) as PaymentProvider, {
      collect: (params: Parameters<PaymentProvider["collect"]>[0]) =>
        provider.collect({ ...params, readerRef: "rdr_test" }),
    }),
  );
  const pay = () =>
    send(venue.app, venue.cookie, "POST", "/api/pay", { id, lines: [], zoneId: venue.zoneId });
  expect((await pay()).json).toEqual({ outcome: "timeout" });
  confirmed = true;
  await provider.resolvePending(venue.clock.now().instant, await ownsEveryPayment(suite.db));
  expect(
    await recoverAutomaticCardPayments({ ...venue, admission: testTradingAdmission() }),
  ).toEqual({ filed: 0, errors: [] });
  expect(await statusOf(venue, id)).toBe("open");
  expect(fiscalRecordCount(venue, id)).toBe(0);
  const [unattached] = await suite.db
    .select({ billPaymentId: payments.billPaymentId })
    .from(payments)
    .where(eq(payments.workingOrderId, id));
  expect(unattached).toEqual({ billPaymentId: null });
  expect(await getBillBalance(venue, id)).toMatchObject({
    captureWarning: { requestedAmount: "35.00", reportedAmount: "34.00" },
  });
  const [waiting] = await suite.db
    .select({ mark: workingOrders.paymentAttemptAt })
    .from(workingOrders)
    .where(eq(workingOrders.id, id));
  expect(waiting!.mark).not.toBeNull();

  expect(
    await suite.db
      .select({ amount: payments.amount, requested: payments.requestedAmount })
      .from(payments)
      .where(eq(payments.workingOrderId, id)),
  ).toEqual([{ amount: 3400, requested: 3500 }]);
  expect((await pay()).json).toMatchObject({
    outcome: "partial",
    balance: { received: "34.00", outstanding: "1.00" },
    captureWarning: { requestedAmount: "35.00", reportedAmount: "34.00" },
  });
  expect(create).toHaveBeenCalledOnce();
});
