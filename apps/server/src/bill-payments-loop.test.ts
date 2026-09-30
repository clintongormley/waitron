import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPayments, incidents, type SingletonRole } from "@waitron/db";
import { insertCapturedPayment, insertFailedPayment, payments } from "@waitron/payments";
import { centsToDecimal, decimal, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import type { BillPaymentsPass } from "./bill-payments-loop.js";
import { withPendingBillPayments } from "./boot.js";
import type { Logger } from "./logger.js";
import type { PassReport } from "./pass.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";
import { cancelBody } from "./testing/cancel-line.js";

// The loop's half of a card bill payment (bill payments design §5.4, §8 tests 13 and 16): a pending
// payment nothing in this process drives is settled from its provider row, never from its age.
let venue: BillVenue;

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
  },
});

const settle = () =>
  settlePendingBillPayments({
    db: venue.db,
    backend: venue.backend,
    clock: venue.clock,
    cfg: venue.cfg,
  });

function cardContribution(billId: string, amount: string) {
  return send(venue.app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method: "card",
    entry: "reader",
    applied: amount,
    tip: "0.00",
  });
}

function balance(billId: string) {
  return send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/payments`);
}

/** What a crash straight after P1 leaves: a pending card payment no provider was asked about. */
async function strandedPending(billId: string, applied: number, tip = 0): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .insert(billPayments)
      .values({
        workingOrderId: billId,
        submissionId: randomUUID(),
        fingerprint: "stranded",
        kind: "contribution",
        method: "card",
        applied,
        tip,
        state: "pending",
        requestedBy: venue.operatorId,
        tillId: venue.device2TillId,
      })
      .returning({ id: billPayments.id }),
  );
  return row!.id;
}

/** The bill payments and refunds the database still holds pending. */
function stillPending(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select (select count(*) from bill_payments where state = 'pending')
             + (select count(*) from bill_payment_refunds where state = 'pending') as n`,
  );
  return row!.n;
}

async function stateOf(billPaymentId: string): Promise<string> {
  const [row] = await inTx(venue, (tx) =>
    tx
      .select({ state: billPayments.state })
      .from(billPayments)
      .where(eq(billPayments.id, billPaymentId)),
  );
  return row!.state;
}

/** A pending card payment of `applied` cents whose provider row captured that amount. */
async function capturedPending(billId: string, applied: number): Promise<string> {
  const id = await strandedPending(billId, applied);
  await inTx(venue, (tx) =>
    insertCapturedPayment(tx, {
      workingOrderId: brandWorkingOrderId(billId),
      provider: "fake",
      paymentRef: `captured-${randomUUID()}`,
      amount: centsToDecimal(applied),
      settledAt: new Date(),
      billPaymentId: id,
    }),
  );
  return id;
}

/** Runs `fn` while the database refuses a sale of this bill, as an invoice that cannot be issued. */
async function refusingSalesOf<T>(billId: string, fn: () => Promise<T>): Promise<T> {
  // A trigger body takes no bound value, so the id is written into it.
  venue.db.run(
    sql.raw(
      `create trigger refuse_one_sale before insert on sales ` +
        `when new.working_order_id = '${billId}' begin select raise(abort, 'refused for the test'); end`,
    ),
  );
  try {
    return await fn();
  } finally {
    venue.db.run(sql`drop trigger refuse_one_sale`);
  }
}

async function incidentsOf(code: string, tillId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ params: incidents.params })
      .from(incidents)
      .where(and(eq(incidents.code, code), eq(incidents.tillId, tillId))),
  );
}

async function mismatchIncidents(tillId: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ params: incidents.params })
      .from(incidents)
      .where(
        and(eq(incidents.code, "payment.bill_capture_mismatch"), eq(incidents.tillId, tillId)),
      ),
  );
}

describe("recovery after a crash (design §8 test 13)", () => {
  it("finalises a card the provider captured, once, issuing the invoice it completes", async () => {
    const billId = await tabWith(venue, "Paella");
    venue.card.crashNextCollect("captured");

    const crashed = await cardContribution(billId, "35.00");
    const [payment] = await paymentRows(venue, billId);
    const first = await settle();
    const second = await settle();

    expect(crashed.status).toBe(500);
    expect(payment).toMatchObject({ state: "pending" });
    expect(first).toMatchObject({ received: 1 });
    expect(second).toMatchObject({ received: 0, failed: 0 });
    expect(await stateOf(payment!.id)).toBe("received");
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(registroCount(venue, billId)).toBe(1);
    expect(await tendersOfBill(venue, billId)).toMatchObject([
      { method: "card", amount: 3500, billPaymentId: payment!.id, saleTillId: venue.deviceTillId },
    ]);
    const [provided] = await inTx(venue, (tx) =>
      tx
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.billPaymentId, payment!.id)),
    );
    expect(provided!.saleId).not.toBeNull();
  });

  it("leaves a card whose provider row is still attempting pending, holding the bill", async () => {
    const billId = await tabWith(venue, "Paella", "Tarta");
    venue.card.crashNextCollect("attempting");
    await cardContribution(billId, "20.00");
    const [payment] = await paymentRows(venue, billId);

    const pass = await settle();
    const voided = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/adjustments`,
      await cancelBody(venue.db, billId, 2),
    );

    expect(pass).toMatchObject({ received: 0, failed: 0 });
    expect(pass.pending).toBe(await stillPending());
    expect(pass.pending).toBeGreaterThanOrEqual(1);
    expect(await stateOf(payment!.id)).toBe("pending");
    expect((await balance(billId)).json).toMatchObject({ reserved: "20.00" });
    expect(voided.status).toBe(409);
    expect(voided.json).toMatchObject({ code: "order.payment_in_flight" });
    expect(registroCount(venue, billId)).toBe(0);
  });

  it("files nothing for a capture of another amount, keeps it pending, and raises one alert", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await strandedPending(billId, 3000, 500);
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: brandWorkingOrderId(billId),
        provider: "fake",
        paymentRef: `mismatch-${randomUUID()}`,
        amount: decimal("30.00"),
        settledAt: new Date(),
        billPaymentId: id,
      }),
    );

    const first = await settle();
    const second = await settle();

    expect(first).toMatchObject({ received: 0, mismatched: 1 });
    expect(second).toMatchObject({ received: 0, mismatched: 1 });
    expect(await stateOf(id)).toBe("pending");
    expect(registroCount(venue, billId)).toBe(0);
    const raised = await mismatchIncidents(venue.device2TillId);
    expect(raised).toHaveLength(1);
    expect(raised[0]!.params).toMatchObject({
      billPaymentId: id,
      workingOrderId: billId,
      captured: "30.00",
      expected: "35.00",
    });
  });
});

describe("the loop's own edges", () => {
  it("dates a capture whose provider row carries no time at the pass", async () => {
    const billId = await tabWith(venue, "Paella", "Tarta");
    const id = await strandedPending(billId, 1000);
    const paymentRef = `untimed-${randomUUID()}`;
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        workingOrderId: brandWorkingOrderId(billId),
        provider: "fake",
        paymentRef,
        amount: decimal("10.00"),
        settledAt: new Date(),
        billPaymentId: id,
      }),
    );
    venue.db.run(sql`update payments set settled_at = null where payment_ref = ${paymentRef}`);
    const before = Date.now();

    const pass = await settle();

    expect(pass).toMatchObject({ received: 1 });
    const [row] = await inTx(venue, (tx) =>
      tx
        .select({ receivedAt: billPayments.receivedAt })
        .from(billPayments)
        .where(eq(billPayments.id, id)),
    );
    expect(Date.parse(row!.receivedAt!)).toBeGreaterThanOrEqual(before - 1000);
  });

  it("reports a payment it could not settle and carries on with the next", async () => {
    const stuckBill = await tabWith(venue, "Paella");
    const stuck = await strandedPending(stuckBill, 1000);
    const freeBill = await tabWith(venue, "Paella");
    const free = await strandedPending(freeBill, 1000);
    // A trigger body takes no bound value, so the id is written into it.
    venue.db.run(
      sql.raw(
        `create trigger refuse_one_bill_payment before update on bill_payments ` +
          `when old.id = '${stuck}' begin select raise(abort, 'refused for the test'); end`,
      ),
    );
    let pass;
    try {
      pass = await settle();
    } finally {
      venue.db.run(sql`drop trigger refuse_one_bill_payment`);
    }

    expect(pass.errors).toEqual([
      { billPaymentId: stuck, error: expect.stringContaining("refused for the test") },
    ]);
    expect(await stateOf(stuck)).toBe("pending");
    expect(await stateOf(free)).toBe("failed");
    await settle();
  });

  it("raises one alert for a captured card whose invoice cannot be issued, leaving it pending", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await capturedPending(billId, 3500);
    let first, second;
    await refusingSalesOf(billId, async () => {
      first = await settle();
      second = await settle();
    });

    expect(first!.errors).toEqual([
      { billPaymentId: id, error: expect.stringContaining("refused for the test") },
    ]);
    expect(second!.errors).toHaveLength(1);
    expect(await stateOf(id)).toBe("pending");
    expect(registroCount(venue, billId)).toBe(0);
    const raised = await incidentsOf("payment.bill_settle_failed", venue.device2TillId);
    expect(raised).toEqual([
      {
        params: {
          billPaymentId: id,
          workingOrderId: billId,
          amount: "35.00",
          errorCode: "unknown",
        },
      },
    ]);
    await settle();
    expect(await stateOf(id)).toBe("received");
  });

  it("raises no such alert for a payment no card was charged for", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await strandedPending(billId, 1000);
    const before = await incidentsOf("payment.bill_settle_failed", venue.device2TillId);
    venue.db.run(
      sql.raw(
        `create trigger refuse_one_bill_payment before update on bill_payments ` +
          `when old.id = '${id}' begin select raise(abort, 'refused for the test'); end`,
      ),
    );
    try {
      await settle();
    } finally {
      venue.db.run(sql`drop trigger refuse_one_bill_payment`);
    }

    expect(await incidentsOf("payment.bill_settle_failed", venue.device2TillId)).toEqual(before);
    await settle();
  });

  it("reports an alert it could not record beside the failure, and carries on with the next", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await capturedPending(billId, 3500);
    const freeBill = await tabWith(venue, "Paella");
    const free = await strandedPending(freeBill, 1000);
    venue.db.run(
      sql.raw(
        `create trigger refuse_incidents before insert on incidents ` +
          `when new.code = 'payment.bill_settle_failed' ` +
          `begin select raise(abort, 'no alert for the test'); end`,
      ),
    );
    let pass;
    try {
      pass = await refusingSalesOf(billId, settle);
    } finally {
      venue.db.run(sql`drop trigger refuse_incidents`);
    }

    expect(pass.errors).toEqual([
      { billPaymentId: id, error: expect.stringContaining("refused for the test") },
      { billPaymentId: id, error: expect.stringContaining("no alert for the test") },
    ]);
    expect(await stateOf(free)).toBe("failed");
    await settle();
  });
});

describe("a pending card with no provider row (design §8 test 16)", () => {
  it("is failed by the loop, releasing its reservation", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await strandedPending(billId, 2000);

    const pass = await settle();

    expect(pass).toMatchObject({ failed: 1 });
    expect(await stateOf(id)).toBe("failed");
    expect((await balance(billId)).json).toMatchObject({ reserved: "0.00", outstanding: "35.00" });
  });

  it("stays pending when its provider row says failed: that word is not trusted", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await strandedPending(billId, 2000);
    await inTx(venue, (tx) =>
      insertFailedPayment(tx, {
        workingOrderId: brandWorkingOrderId(billId),
        provider: "fake",
        paymentRef: `failed-${randomUUID()}`,
        amount: decimal("20.00"),
        billPaymentId: id,
      }),
    );

    const pass = await settle();

    expect(pass).toMatchObject({ received: 0, failed: 0 });
    expect(await stateOf(id)).toBe("pending");
  });

  it("is left alone while its card is at a reader in this process", async () => {
    const billId = await tabWith(venue, "Paella");
    const release = venue.card.holdNextCollect();
    const calls = venue.card.collectCalls.length;
    const paying = cardContribution(billId, "20.00");
    await vi.waitFor(() => expect(venue.card.collectCalls.length).toBe(calls + 1));
    const [payment] = await paymentRows(venue, billId);

    const pass = await settle();
    const during = await stateOf(payment!.id);
    release();
    const paid = await paying;

    expect(pass).toMatchObject({ failed: 0 });
    expect(during).toBe("pending");
    expect(paid.json).toMatchObject({ outcome: "received" });
  });
});

describe("withPendingBillPayments", () => {
  const report = { ran: [] } as unknown as PassReport;
  const primary = () => "primary" as const;

  it("settles nothing on a node that is not the singleton primary, reading the role each pass", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await strandedPending(billId, 2000);
    let role: SingletonRole = "secondary";
    const pass = withPendingBillPayments(
      () => Promise.resolve(report),
      settle,
      () => role,
      () => {},
    );

    expect(await pass(new Date())).toBe(report);
    const onSecondary = await stateOf(id);
    role = "primary";
    await pass(new Date());

    expect(onSecondary).toBe("pending");
    expect(await stateOf(id)).toBe("failed");
  });

  it("runs the settle after the pass and answers the pass's own report", async () => {
    const order: string[] = [];
    const lines: unknown[][] = [];
    const log: Logger = (...args) => void lines.push(args);
    const pass = withPendingBillPayments(
      () => {
        order.push("pass");
        return Promise.resolve(report);
      },
      () => {
        order.push("settle");
        return Promise.resolve({
          received: 1,
          failed: 2,
          mismatched: 0,
          refundsCompleted: 0,
          refundsFailed: 0,
          refundsUnresolved: 0,
          pending: 0,
          errors: [],
        });
      },
      primary,
      log,
    );

    expect(await pass(new Date())).toBe(report);
    expect(order).toEqual(["pass", "settle"]);
    expect(lines).toEqual([
      [
        "info",
        "bill_payment.settled",
        {
          received: 1,
          failed: 2,
          mismatched: 0,
          refundsCompleted: 0,
          refundsFailed: 0,
          refundsUnresolved: 0,
        },
      ],
    ]);
  });

  const passOf = (counts: Partial<BillPaymentsPass>): BillPaymentsPass => ({
    received: 0,
    failed: 0,
    mismatched: 0,
    refundsCompleted: 0,
    refundsFailed: 0,
    refundsUnresolved: 0,
    pending: 0,
    errors: [],
    ...counts,
  });

  it("logs nothing for a pass that only finds a capture of another amount still unresolved", async () => {
    const lines: unknown[][] = [];
    const log: Logger = (...args) => void lines.push(args);
    const pass = withPendingBillPayments(
      () => Promise.resolve(report),
      () => Promise.resolve(passOf({ mismatched: 1, pending: 1 })),
      primary,
      log,
    );

    await pass(new Date());

    expect(lines).toEqual([]);
  });

  it("comes back within a minute while a payment or refund is pending, and never later than the pass asked", async () => {
    const now = new Date("2026-09-27T12:00:00.000Z");
    const inHour = { ran: [], nextDueAt: new Date("2026-09-27T13:00:00.000Z") };
    const inTenSeconds = { ran: [], nextDueAt: new Date("2026-09-27T12:00:10.000Z") };
    const idle = { ran: [], nextDueAt: null };
    const wrap = (inner: object, pending: number) =>
      withPendingBillPayments(
        () => Promise.resolve(inner as unknown as PassReport),
        () => Promise.resolve(passOf({ pending })),
        primary,
        () => {},
      )(now);

    expect((await wrap(inHour, 1)).nextDueAt).toEqual(new Date("2026-09-27T12:01:00.000Z"));
    expect((await wrap(idle, 2)).nextDueAt).toEqual(new Date("2026-09-27T12:01:00.000Z"));
    expect((await wrap(inTenSeconds, 1)).nextDueAt).toEqual(inTenSeconds.nextDueAt);
    expect(await wrap(inHour, 0)).toBe(inHour);
    expect(await wrap(idle, 0)).toBe(idle);
  });

  it("logs a settle that throws, or a payment it could not settle, and never changes the report", async () => {
    const lines: unknown[][] = [];
    const log: Logger = (...args) => void lines.push(args);
    const throwing = withPendingBillPayments(
      () => Promise.resolve(report),
      () => Promise.reject(new Error("boom")),
      primary,
      log,
    );
    const partial = withPendingBillPayments(
      () => Promise.resolve(report),
      () =>
        Promise.resolve({
          received: 0,
          failed: 0,
          mismatched: 0,
          refundsCompleted: 0,
          refundsFailed: 0,
          refundsUnresolved: 3,
          pending: 0,
          errors: [{ billPaymentId: "bp-1", error: "Error: nope" }],
        }),
      primary,
      log,
    );

    expect(await throwing(new Date())).toBe(report);
    expect(await partial(new Date())).toBe(report);
    expect(lines).toEqual([
      ["warn", "bill_payment.settle_failed", { error: "Error: boom" }],
      ["warn", "bill_payment.settle_failed", { billPaymentId: "bp-1", error: "Error: nope" }],
    ]);
  });
});
