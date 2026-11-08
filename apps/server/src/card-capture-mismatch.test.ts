import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { incidents, sales, withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments, readerPaymentInProgress } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { ownsEveryPayment } from "@waitron/payments/test/seed.js";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { FakeSumUp } from "@waitron/payments-sumup/src/testing/fake-sumup.js";
import { decimal } from "@waitron/shared";
import { getBillBalance } from "./bill-payments.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { recoverAutomaticCardPayments } from "./pending-card-recovery.js";
import { releaseStalePaymentAttempts } from "./till-sale.js";
import {
  paymentRows,
  provisionBillVenue,
  fiscalRecordCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
} from "./testing/bill-venue.js";
import { testTradingAdmission } from "./testing/trading-admission.js";

const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60000,
});
const poll = { maxAttempts: 1, intervalMs: 0, sleep: () => Promise.resolve() };

for (const providerId of ["stripe", "sumup"]) {
  it.each(["whole order", "bill contribution"])(
    `${providerId} mismatch keeps a %s unpaid, locked and on its reader through recovery`,
    async (path) => {
      const venue = await provisionBillVenue(suite.db);
      let provider: PaymentProvider;
      if (providerId === "stripe") {
        const client = new FakeStripe();
        const read = client.retrievePaymentIntent.bind(client);
        vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (id) => ({
          ...(await read(id)),
          status: "succeeded",
          amountReceived: 3400,
        }));
        provider = new StripeTerminalProvider({ db: suite.db, client, captureAlerts, poll });
      } else {
        const client = new FakeSumUp();
        const find = client.findTransaction.bind(client);
        vi.spyOn(client, "findTransaction").mockImplementation(async (query) => {
          const answer = await find(query);
          return answer === null
            ? null
            : { ...answer, status: "SUCCESSFUL", amount: decimal("34.00") };
        });
        provider = new SumUpCloudProvider({
          db: suite.db,
          client,
          captureAlerts,
          incidents: captureAlerts.raise,
          poll,
        });
      }
      const collect = vi.spyOn(provider, "collect");
      const refund = vi.spyOn(provider, "refund");
      const voidPayment = vi.spyOn(provider, "void");
      const routed: PaymentProvider = Object.assign(Object.create(provider) as PaymentProvider, {
        collect: (params: Parameters<PaymentProvider["collect"]>[0]) =>
          provider.collect({ ...params, readerRef: "rdr_test" }),
      });
      vi.spyOn(venue.pool, "get").mockResolvedValue(routed);
      const id = await tabWith(venue, "Paella");
      const request = () =>
        path === "whole order"
          ? send(venue.app, venue.cookie, "POST", "/api/pay", {
              id,
              lines: [],
              zoneId: venue.zoneId,
            })
          : send(venue.app, venue.cookie, "POST", `/api/working-orders/${id}/payments`, {
              submissionId: randomUUID(),
              kind: "contribution",
              amount: "35.00",
              method: "card",
              entry: "reader",
              applied: "35.00",
              tip: "0.00",
            });
      const answer = await request();
      expect(answer.status).toBe(200);
      expect(answer.json.outcome).toBe("capture_mismatch");
      expect(await statusOf(venue, id)).toBe("open");
      const [payment] = await suite.db
        .select()
        .from(payments)
        .where(eq(payments.workingOrderId, id));
      expect(payment).toMatchObject({
        state: "attempting",
        amount: 3500,
        saleId: null,
        settledAt: null,
      });
      expect(payment!.readerId).not.toBeNull();
      expect(
        await withTransaction(suite.db, (tx) =>
          readerPaymentInProgress(tx, payment!.readerId!, venue.device2Id),
        ),
      ).toBe(true);
      expect(
        await provider.resolvePending(venue.clock.now().instant, await ownsEveryPayment(suite.db)),
      ).toEqual({ nextDueAt: null, forwarded: 0, declined: 0, incidentsRaised: 0 });
      await settlePendingBillPayments({ ...venue, admission: testTradingAdmission() });
      expect(
        await recoverAutomaticCardPayments({
          ...venue,
          admission: testTradingAdmission(),
          pool: { get: async () => provider },
        }),
      ).toEqual({ filed: 0, errors: [] });
      await releaseStalePaymentAttempts(suite.db);
      const again = await request();
      expect(again.status).toBe(409);
      expect(again.json.code).toBe("reader.payment_in_progress");
      expect(again.json.params).toMatchObject({ recoveryUrl: "/manage/payments" });
      expect(collect).toHaveBeenCalledTimes(1);
      expect(refund).not.toHaveBeenCalled();
      expect(voidPayment).not.toHaveBeenCalled();
      expect(await suite.db.select().from(sales).where(eq(sales.workingOrderId, id))).toEqual([]);
      expect(fiscalRecordCount(venue, id)).toBe(0);
      expect(await tendersOfBill(venue, id)).toEqual([]);
      expect(await statusOf(venue, id)).toBe("open");
      if (path === "bill contribution")
        expect((await paymentRows(venue, id)).map((row) => row.state)).toEqual(["pending"]);
      else {
        const [order] = await suite.db.select().from(workingOrders).where(eq(workingOrders.id, id));
        expect(order!.paymentAttemptAt).not.toBeNull();
      }
      const alerts = await suite.db
        .select()
        .from(incidents)
        .where(eq(incidents.code, "payment.capture_mismatch"));
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.params).toMatchObject({
        payments: [{ requestedAmount: "35.00", reportedAmount: "34.00" }],
      });
    },
  );
}

it.each(["stripe", "sumup"])(
  "%s partial mismatch stops further cash and cards on the bill and new charges through its reader",
  async (providerId) => {
    const venue = await provisionBillVenue(suite.db);
    let provider: PaymentProvider;
    let starts: () => number;
    if (providerId === "stripe") {
      const client = new FakeStripe();
      const create = vi.spyOn(client, "createPaymentIntent");
      starts = () => create.mock.calls.length;
      const read = client.retrievePaymentIntent.bind(client);
      vi.spyOn(client, "retrievePaymentIntent").mockImplementation(async (id) => ({
        ...(await read(id)),
        status: "succeeded",
        amountReceived: 900,
      }));
      provider = new StripeTerminalProvider({ db: suite.db, client, captureAlerts, poll });
    } else {
      const client = new FakeSumUp();
      const create = vi.spyOn(client, "createCheckout");
      starts = () => create.mock.calls.length;
      vi.spyOn(client, "findTransaction").mockResolvedValue({
        id: "txn_nine",
        status: "SUCCESSFUL",
        amount: decimal("9.00"),
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
    const pay = (billId: string, method: "cash" | "card", amount: string, cookie = venue.cookie) =>
      send(venue.app, cookie, "POST", `/api/working-orders/${billId}/payments`, {
        submissionId: randomUUID(),
        kind: "contribution",
        amount,
        method,
        applied: amount,
        tip: "0.00",
        ...(method === "cash" ? { tendered: amount } : { entry: "reader" }),
      });
    const initial = await pay(id, "card", "10.00");
    expect(initial.status).toBe(200);
    expect(initial.json).toMatchObject({
      outcome: "capture_mismatch",
      balance: { captureMismatch: true },
    });
    expect(await getBillBalance(venue, id)).toMatchObject({ captureMismatch: true });
    const cash = await pay(id, "cash", "5.00");
    expect(cash.status).toBe(409);
    expect(cash.json.code).toBe("payment.capture_mismatch_unresolved");
    for (const cookie of [venue.cookie, venue.cookie2])
      expect((await pay(id, "card", "5.00", cookie)).status).toBe(409);
    const other = await tabWith(venue, "Paella");
    expect((await pay(other, "card", "5.00")).status).toBe(409);
    expect(starts()).toBe(1);
    expect((await pay(other, "cash", "5.00")).status).toBe(200);
    expect((await paymentRows(venue, other)).filter((row) => row.state === "pending")).toEqual([]);
    expect(fiscalRecordCount(venue, id)).toBe(0);
    expect(await tendersOfBill(venue, id)).toEqual([]);
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
