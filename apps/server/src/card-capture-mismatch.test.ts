import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import type { PaymentProvider } from "@waitron/payments";
import { captureAlerts } from "@waitron/payments/test/capture-alerts.js";
import { StripeTerminalProvider } from "@waitron/payments-stripe";
import { FakeStripe } from "@waitron/payments-stripe/src/testing/fake-stripe.js";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import { FakeSumUp } from "@waitron/payments-sumup/src/testing/fake-sumup.js";
import { decimal } from "@waitron/shared";
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

it.each(["open", "placed", "invoiced"])(
  "keeps a short whole-order charge on a %s bill and takes the remainder with a new reader key",
  async (mode) => {
    const venue = await provisionBillVenue(suite.db);
    const id = await tabWith(venue, "Paella");
    const deps = { ...venue, admission: testTradingAdmission() };
    if (mode === "invoiced") await issueOrderInvoice(deps, venue.cfg, id, venue.operatorId);
    if (mode !== "open") await placeOrder(deps, venue.cfg, id, venue.operatorId);
    let actual = 3400;
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
      balance: { received: "34.00", outstanding: "1.00" },
      captureWarning: { requestedAmount: "35.00", reportedAmount: "34.00" },
    });
    expect(await statusOf(venue, id)).toBe(mode === "open" ? "open" : "placed");
    expect(fiscalRecordCount(venue, id)).toBe(mode === "invoiced" ? 1 : 0);
    expect(await getBillBalance(venue, id)).toMatchObject({
      received: "34.00",
      outstanding: "1.00",
    });
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
      balance: { status: "settled", received: "35.00", outstanding: "0.00" },
    });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].idempotencyKey).not.toBe(
      create.mock.calls[1]![0].idempotencyKey,
    );
    expect(fiscalRecordCount(venue, id)).toBe(1);
    expect((await tendersOfBill(venue, id)).map((row) => row.amount)).toEqual([3400, 100]);
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
