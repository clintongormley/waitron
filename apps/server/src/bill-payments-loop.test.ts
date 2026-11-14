import { ordersWithUnfiledPayment } from "./till-sale.js";
import { testTradingAdmission } from "./testing/trading-admission.js";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import {
  billPaymentRefunds,
  billPayments,
  incidents,
  printJobs,
  saleReceiptGuests,
  sales,
  type SingletonRole,
  type Transaction,
} from "@waitron/db";
import type { FiscalBackend } from "@waitron/fiscal";
import {
  insertCapturedPayment,
  insertFailedPayment,
  payments,
  recordResolution,
} from "@waitron/payments";
import { createPrinter } from "@waitron/printing";
import {
  centsToDecimal,
  decimal,
  quoteLiteral,
  workingOrderId as brandWorkingOrderId,
} from "@waitron/shared";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import type { BillPaymentsPass } from "./bill-payments-loop.js";
import { withPendingBillPayments } from "./boot.js";
import { clockStopsRefund } from "./bill-refunds.js";
import { startClockState, type StartClockState } from "./start-clock-check.js";
import { gateSeatOnStartClock, startClockGateHolds } from "./start-clock-gate.js";
import { decodeTicket } from "./testing/decode-ticket.js";
import { printSaleReceipt } from "./till-sale.js";
import type { Logger } from "./logger.js";
import type { PassReport } from "./pass.js";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  fiscalRecordCount,
  send,
  statusOf,
  tabWith,
  tendersOfBill,
  type BillVenue,
} from "./testing/bill-venue.js";
import "./errors.js";
import { cancelItemHttp } from "./testing/cancel-line.js";
import { descendingIds } from "./testing/descending-ids.js";

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

function receiptPrinter(name: string) {
  return {
    name,
    transport: "cloud_poll" as const,
    pollId: `poll-${randomUUID()}`,
    hasCashDrawer: false,
  };
}

const settle = () =>
  settlePendingBillPayments({
    admission: testTradingAdmission(),
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
async function strandedPending(
  billId: string,
  applied: number,
  tip = 0,
  device = { deviceId: venue.device2Id },
): Promise<string> {
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
        source: "device",
        deviceId: device.deviceId,
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
async function capturedPending(
  billId: string,
  applied: number,
  device?: { deviceId: string },
): Promise<string> {
  const id = await strandedPending(billId, applied, 0, device);
  await inTx(venue, (tx) =>
    insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
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

/** The loop's alerts name the payment check, never the device that took the payment. */
async function incidentsOf(code: string) {
  return inTx(venue, (tx) =>
    tx
      .select({ params: incidents.params })
      .from(incidents)
      .where(
        and(
          eq(incidents.code, code),
          eq(incidents.source, "payment_check"),
          isNull(incidents.deviceId),
        ),
      ),
  );
}

/** A pending card payment whose provider row captured 30.00 against the 35.00 it was for. */
async function mismatchedPending(billId: string, device?: { deviceId: string }): Promise<string> {
  const id = await strandedPending(billId, 3000, 500, device);
  await inTx(venue, (tx) =>
    insertCapturedPayment(tx, {
      origin: venue.cfg.origin,
      nodeId: venue.cfg.nodeId,
      workingOrderId: brandWorkingOrderId(billId),
      provider: "fake",
      paymentRef: `mismatch-${randomUUID()}`,
      amount: decimal("30.00"),
      settledAt: new Date(),
      billPaymentId: id,
    }),
  );
  return id;
}

describe("recovery after a crash (design §8 test 13)", () => {
  it("finalises a card the provider captured, once, issuing the invoice it completes", async () => {
    const billId = await tabWith(venue, "Paella");
    venue.card.crashNextCollect("captured");

    const crashed = await cardContribution(billId, "35.00");
    const [payment] = await paymentRows(venue, billId);
    expect(await ordersWithUnfiledPayment(venue.db, [billId])).toEqual(new Set([billId]));
    const first = await settle();
    expect(await ordersWithUnfiledPayment(venue.db, [billId])).toEqual(new Set());
    const second = await settle();

    expect(crashed.status).toBe(500);
    expect(payment).toMatchObject({ state: "pending" });
    expect(first).toMatchObject({ received: 1 });
    expect(second).toMatchObject({ received: 0, failed: 0 });
    expect(await stateOf(payment!.id)).toBe("received");
    expect(await statusOf(venue, billId)).toBe("settled");
    expect(fiscalRecordCount(venue, billId)).toBe(1);
    expect(await tendersOfBill(venue, billId)).toMatchObject([
      { method: "card", amount: 3500, billPaymentId: payment!.id, saleDeviceId: venue.deviceId },
    ]);
    const [provided] = await inTx(venue, (tx) =>
      tx
        .select({ saleId: payments.saleId })
        .from(payments)
        .where(eq(payments.billPaymentId, payment!.id)),
    );
    expect(provided!.saleId).not.toBeNull();
  });

  it("files the invoice under the device that took the payment, not the loop's", async () => {
    const billId = await tabWith(venue, "Paella");
    await capturedPending(billId, 3500);
    expect(venue.device2Id).not.toBe(venue.cfg.origin.deviceId);

    await settle();

    expect(
      venue.db.all(sql`select source, device_id from sales where working_order_id = ${billId}`),
    ).toEqual([{ source: "device", device_id: venue.device2Id }]);
  });

  it("leaves a card whose provider row is still attempting pending, holding the bill", async () => {
    const billId = await tabWith(venue, "Paella", "Tarta");
    venue.card.crashNextCollect("attempting");
    await cardContribution(billId, "20.00");
    const [payment] = await paymentRows(venue, billId);

    const pass = await settle();
    const voided = await cancelItemHttp(venue.db, venue.app, venue.cookie, billId, 2);

    expect(pass).toMatchObject({ received: 0, failed: 0 });
    expect(pass.pending).toBe(await stillPending());
    expect(pass.pending).toBeGreaterThanOrEqual(1);
    expect(await stateOf(payment!.id)).toBe("pending");
    expect((await balance(billId)).json).toMatchObject({ reserved: "20.00" });
    expect(voided.status).toBe(409);
    expect(voided.json).toMatchObject({ code: "order.payment_in_flight" });
    expect(fiscalRecordCount(venue, billId)).toBe(0);
  });

  it("records a recovered short capture once, reducing the tip before leaving bill money outstanding", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await mismatchedPending(billId);
    expect(await settle()).toMatchObject({ received: 1 });
    expect(await settle()).toMatchObject({ received: 0 });
    expect(await stateOf(id)).toBe("received");
    expect(
      venue.db.get(sql`select remaining_after as remaining from bill_payments where id = ${id}`),
    ).toEqual({ remaining: 500 });
    expect((await balance(billId)).json).toMatchObject({
      received: "30.00",
      tips: "0.00",
      outstanding: "5.00",
      reserved: "0.00",
    });
    expect(fiscalRecordCount(venue, billId)).toBe(0);
  });

  it("records recovered actual money on two bills independently", async () => {
    venue.db.run(
      sql`update bill_payments set state = 'failed', failed_at = ${new Date().toISOString()} where state = 'pending'`,
    );
    const bills = [await tabWith(venue, "Paella"), await tabWith(venue, "Paella")];
    const first = await mismatchedPending(bills[0]!);
    const second = await mismatchedPending(bills[1]!, { deviceId: venue.deviceId });
    expect(await settle()).toMatchObject({ received: 2 });
    expect([await stateOf(first), await stateOf(second)]).toEqual(["received", "received"]);
    for (const bill of bills)
      expect((await balance(bill)).json).toMatchObject({
        received: "30.00",
        tips: "0.00",
        outstanding: "5.00",
      });
  });
});

describe("the loop's own edges", () => {
  it.each([true, false])(
    "releases a confirmed noncharge only with automatic audit = %s",
    async (automatic) => {
      const billId = await tabWith(venue, "Paella");
      const id = await strandedPending(billId, 2000);
      const paymentRef = randomUUID();
      await inTx(venue, async (tx) => {
        await insertFailedPayment(tx, {
          origin: venue.cfg.origin,
          nodeId: venue.cfg.nodeId,
          workingOrderId: brandWorkingOrderId(billId),
          provider: "stripe",
          paymentRef,
          amount: decimal("20.00"),
          billPaymentId: id,
        });
        const [provided] = await tx
          .select({ id: payments.id })
          .from(payments)
          .where(eq(payments.paymentRef, paymentRef));
        await recordResolution(tx, {
          paymentId: provided!.id,
          workingOrderId: billId,
          personId: automatic ? null : venue.adminId,
          outcome: "failed",
          cancelledAtProvider: true,
          providerStatus: "canceled",
          resolvedAt: venue.clock.now().instant,
        });
      });
      await settle();
      expect(await stateOf(id)).toBe(automatic ? "failed" : "pending");
      expect((await balance(billId)).json).toMatchObject({
        reserved: automatic ? "0.00" : "20.00",
      });
      expect(fiscalRecordCount(venue, billId)).toBe(0);
    },
  );

  it("dates a capture whose provider row carries no time at the pass", async () => {
    const billId = await tabWith(venue, "Paella", "Tarta");
    const id = await strandedPending(billId, 1000);
    const paymentRef = `untimed-${randomUUID()}`;
    await inTx(venue, (tx) =>
      insertCapturedPayment(tx, {
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
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
    expect(fiscalRecordCount(venue, billId)).toBe(0);
    const raised = await incidentsOf("payment.bill_settle_failed");
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
    const before = await incidentsOf("payment.bill_settle_failed");
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

    expect(await incidentsOf("payment.bill_settle_failed")).toEqual(before);
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

describe("the invoice a finished card payment issues", () => {
  it("leaves both completed cards without automatic receipts", async () => {
    const [r1, r2] = await inTx(venue, async (tx) => [
      await createPrinter(tx, receiptPrinter("R1")),
      await createPrinter(tx, receiptPrinter("R2")),
    ]);
    const a = { deviceId: venue.deviceId };
    const b = { deviceId: venue.device2Id };
    const held = venue.db.all<{ id: string; receipt_printer_id: string | null }>(
      sql`select id, receipt_printer_id from devices where id in (${a.deviceId}, ${b.deviceId})`,
    );
    venue.db.run(sql`update devices set receipt_printer_id = ${r1!.id} where id = ${a.deviceId}`);
    venue.db.run(sql`update devices set receipt_printer_id = ${r2!.id} where id = ${b.deviceId}`);
    try {
      const onA = await tabWith(venue, "Paella");
      const onB = await tabWith(venue, "Paella");
      await capturedPending(onA, 3500, a);
      await capturedPending(onB, 3500, b);

      expect(await settle()).toMatchObject({ received: 2 });

      const printed = venue.db.all<{ printer_id: string; kind: string; bill_id: string }>(
        sql`select print_jobs.printer_id, print_jobs.kind, sales.working_order_id as bill_id
            from print_jobs join sales on sales.id = print_jobs.sale_id
            where sales.working_order_id in (${onA}, ${onB})`,
      );
      expect(printed).toEqual([]);
    } finally {
      for (const row of held) {
        venue.db.run(
          sql`update devices set receipt_printer_id = ${row.receipt_printer_id} where id = ${row.id}`,
        );
      }
    }
  });
});

describe("the guests a finished card payment's receipt prints", () => {
  async function countGuests(billId: string, guestCount: number): Promise<void> {
    const [party] = venue.db.all<{ id: string; revision: number }>(
      sql`select parties.id, parties.revision from parties
          join working_orders on working_orders.party_id = parties.id
          where working_orders.id = ${billId}`,
    );
    const counted = await send(venue.app, venue.cookie, "PUT", `/api/parties/${party!.id}/guests`, {
      expectedPartyRevision: party!.revision,
      guestCount,
    });
    expect(counted.status).toBe(200);
  }

  it("stores the party's count when the loop files it, and a Reprint after a change prints that count", async () => {
    const r = await inTx(venue, (tx) => createPrinter(tx, receiptPrinter("Guests")));
    const held = venue.db.all<{ id: string; receipt_printer_id: string | null }>(
      sql`select id, receipt_printer_id from devices where id = ${venue.cfg.origin.deviceId}`,
    );
    venue.db.run(
      sql`update devices set receipt_printer_id = ${r.id} where id = ${venue.cfg.origin.deviceId}`,
    );
    try {
      const billId = await tabWith(venue, "Paella");
      await countGuests(billId, 4);
      await capturedPending(billId, 3500, { deviceId: venue.cfg.origin.deviceId });

      expect(await settle()).toMatchObject({ received: 1 });
      const stored = await inTx(venue, (tx) =>
        tx
          .select({ saleId: sales.id, guests: saleReceiptGuests.guestCount })
          .from(saleReceiptGuests)
          .innerJoin(sales, eq(sales.id, saleReceiptGuests.saleId))
          .where(eq(sales.workingOrderId, billId)),
      );
      expect(stored).toEqual([{ saleId: expect.any(String), guests: 4 }]);

      await printSaleReceipt({ db: venue.db, backend: venue.backend }, venue.cfg, billId, false);
      await countGuests(billId, 6);
      await printSaleReceipt({ db: venue.db, backend: venue.backend }, venue.cfg, billId, true);
      const copies = await inTx(venue, (tx) =>
        tx
          .select({ payload: printJobs.payload })
          .from(printJobs)
          .where(eq(printJobs.saleId, stored[0]!.saleId))
          .orderBy(sql`rowid`),
      );
      expect(copies).toHaveLength(2);
      expect(decodeTicket(copies.at(-1)!.payload)).toContain("4 comensales");
    } finally {
      for (const row of held) {
        venue.db.run(
          sql`update devices set receipt_printer_id = ${row.receipt_printer_id} where id = ${row.id}`,
        );
      }
    }
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
        origin: venue.cfg.origin,
        nodeId: venue.cfg.nodeId,
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

describe("rows written within one millisecond", () => {
  const COUNT = 6;

  /** Runs one pass while the database refuses every change to `ids` in `table`, so each of them
   * lands in the pass's errors, in the order the pass reached it. */
  async function passRefusing(table: string, ids: readonly string[]) {
    // A trigger body takes no bound value, so the ids are written into it.
    venue.db.run(
      sql`create trigger refuse_these before update on ${sql.identifier(table)}
        when old.id in (${sql.raw(ids.map(quoteLiteral).join(", "))})
        begin select raise(abort, 'refused for the test'); end`,
    );
    try {
      return await settle();
    } finally {
      venue.db.run(sql`drop trigger refuse_these`);
    }
  }

  /** A bill payment on each of `bills`, written in that order, all in one millisecond. */
  async function writeBillPayments(bills: readonly string[], state: "pending" | "received") {
    const at = new Date().toISOString();
    const id = descendingIds();
    const written: string[] = [];
    for (const workingOrderId of bills) {
      const [row] = await inTx(venue, (tx) =>
        tx
          .insert(billPayments)
          .values({
            id: id(),
            workingOrderId,
            submissionId: randomUUID(),
            fingerprint: "stranded",
            kind: "contribution",
            method: "card",
            applied: 1000,
            state,
            receivedAt: state === "received" ? at : null,
            requestedBy: venue.operatorId,
            source: "device",
            deviceId: venue.device2Id,
            createdAt: at,
          })
          .returning({ id: billPayments.id }),
      );
      written.push(row!.id);
    }
    return written;
  }

  async function bills(): Promise<string[]> {
    const opened: string[] = [];
    for (let made = 0; made < COUNT; made++) opened.push(await tabWith(venue, "Paella"));
    return opened;
  }

  it("settles the pending card payments in the order they were taken", async () => {
    const taken = await writeBillPayments(await bills(), "pending");

    const pass = await passRefusing("bill_payments", taken);

    expect(pass.errors).toEqual(
      taken.map((billPaymentId) => ({
        billPaymentId,
        error: expect.stringContaining("refused for the test") as unknown,
      })),
    );
    await settle();
  });

  it("settles the pending card refunds in the order they were asked for", async () => {
    // The payments are written the other way round from their refunds.
    const paid = (await writeBillPayments((await bills()).reverse(), "received")).reverse();
    const at = new Date().toISOString();
    const id = descendingIds();
    const asked: string[] = [];
    for (const billPaymentId of paid) {
      const [row] = await inTx(venue, (tx) =>
        tx
          .insert(billPaymentRefunds)
          .values({
            id: id(),
            billPaymentId,
            submissionId: randomUUID(),
            fingerprint: "f",
            appliedAmount: 100,
            reason: "error",
            authorizedBy: venue.operatorId,
            requestedBy: venue.operatorId,
            source: "device",
            deviceId: venue.device2Id,
            state: "pending",
            createdAt: at,
          })
          .returning({ id: billPaymentRefunds.id }),
      );
      asked.push(row!.id);
    }

    const pass = await passRefusing("bill_payment_refunds", asked);

    expect(pass.errors).toEqual(
      asked.map((refundId) => ({
        refundId,
        error: expect.stringContaining("refused for the test") as unknown,
      })),
    );
    await settle();
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
    refundsCompleted: 0,
    refundsFailed: 0,
    refundsUnresolved: 0,
    pending: 0,
    errors: [],
    ...counts,
  });

  it("logs nothing for a pass that only finds a pending payment", async () => {
    const lines: unknown[][] = [];
    const log: Logger = (...args) => void lines.push(args);
    const pass = withPendingBillPayments(
      () => Promise.resolve(report),
      () => Promise.resolve(passOf({ pending: 1 })),
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

describe("a pass while the start's time is unconfirmed", () => {
  /** A pass on the seat behind the start clock gate, wired as boot wires it. */
  function gatedPass(state: StartClockState) {
    const holds = startClockGateHolds(
      state,
      () => true,
      () => false,
    );
    return settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: gateSeatOnStartClock(venue.backend, holds),
      clock: venue.clock,
      cfg: venue.cfg,
      refundProviderFor: (name: string) => venue.pool.get(name),
      clockUnconfirmed: holds,
    });
  }
  const alertsFor = async (id: string) =>
    (await incidentsOf("payment.bill_settle_failed")).filter(
      (row) => (row.params as { billPaymentId?: string }).billPaymentId === id,
    );

  it("leaves a card charged before the start pending with no alert while waiting, and records it once confirmed", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await capturedPending(billId, 3500);
    const state = startClockState();

    const paused = await gatedPass(state);

    expect(await alertsFor(id)).toEqual([]);
    expect(paused.errors).toEqual([]);
    expect(await stateOf(id)).toBe("pending");
    expect(fiscalRecordCount(venue, billId)).toBe(0);

    state.confirm("by_devices", {});
    await gatedPass(state);

    expect(await stateOf(id)).toBe("received");
    expect(fiscalRecordCount(venue, billId)).toBe(1);
    expect(await alertsFor(id)).toEqual([]);
  });

  it("leaves cards pending with no alert when a clock set begins after the pass listed them, and tries no further card", async () => {
    const firstBill = await tabWith(venue, "Paella");
    const first = await capturedPending(firstBill, 3500);
    const secondBill = await tabWith(venue, "Paella");
    const second = await capturedPending(secondBill, 3500);
    const state = startClockState();
    state.confirm("by_devices", {});
    let setting = false;
    const holds = startClockGateHolds(
      state,
      () => true,
      () => setting,
    );
    let seatAsks = 0;
    // The set begins as the first card reaches the seat, after the pass asked the gate.
    const seatHolds = () => {
      seatAsks += 1;
      setting = true;
      return holds();
    };

    const pass = await settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: gateSeatOnStartClock(venue.backend, seatHolds),
      clock: venue.clock,
      cfg: venue.cfg,
      clockUnconfirmed: holds,
    });

    expect(await alertsFor(first)).toEqual([]);
    expect(await alertsFor(second)).toEqual([]);
    expect(seatAsks).toBe(1);
    expect(
      pass.errors.filter((e) => "billPaymentId" in e && [first, second].includes(e.billPaymentId)),
    ).toEqual([]);
    expect(await stateOf(first)).toBe("pending");
    expect(await stateOf(second)).toBe("pending");
    expect(fiscalRecordCount(venue, firstBill) + fiscalRecordCount(venue, secondBill)).toBe(0);

    setting = false;
    await gatedPass(state);

    expect(await stateOf(first)).toBe("received");
    expect(await stateOf(second)).toBe("received");
    expect(fiscalRecordCount(venue, firstBill)).toBe(1);
    expect(fiscalRecordCount(venue, secondBill)).toBe(1);
    expect(await alertsFor(first)).toEqual([]);
    expect(await alertsFor(second)).toEqual([]);
  });

  it("records the card it reached before a clock set began, and takes no further card to the seat", async () => {
    const firstBill = await tabWith(venue, "Paella");
    const first = await capturedPending(firstBill, 3500);
    const secondBill = await tabWith(venue, "Paella");
    const second = await capturedPending(secondBill, 3500);
    const state = startClockState();
    state.confirm("by_devices", {});
    let setting = false;
    const holds = startClockGateHolds(
      state,
      () => true,
      () => setting,
    );
    // The set begins as soon as a sale is recorded, between this card and the next.
    const recordingThenSetting = new Proxy(venue.backend, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property !== "recordSale" || typeof value !== "function") return value;
        return async (...args: unknown[]) => {
          const recorded: unknown = await (value as (...a: unknown[]) => unknown).apply(
            receiver,
            args,
          );
          setting = true;
          return recorded;
        };
      },
    });
    let seatAsksWhileSetting = 0;
    const seatHolds = () => {
      if (setting) seatAsksWhileSetting += 1;
      return holds();
    };

    await settlePendingBillPayments({
      admission: testTradingAdmission(),
      db: venue.db,
      backend: gateSeatOnStartClock(recordingThenSetting, seatHolds),
      clock: venue.clock,
      cfg: venue.cfg,
      clockUnconfirmed: holds,
    });

    expect(await stateOf(first)).toBe("received");
    expect(await stateOf(second)).toBe("pending");
    expect(seatAsksWhileSetting).toBe(0);
    expect(await alertsFor(second)).toEqual([]);

    setting = false;
    await gatedPass(state);

    expect(await stateOf(second)).toBe("received");
    expect(fiscalRecordCount(venue, secondBill)).toBe(1);
  });

  it("leaves a refund pending when the start's time is unconfirmed as its send or outcome is dated", async () => {
    const backend = { assertRecordableAt: vi.fn() };
    const stops = (unconfirmed: boolean) =>
      clockStopsRefund(
        {} as Transaction,
        { backend: backend as unknown as FiscalBackend, clockUnconfirmed: () => unconfirmed },
        null,
        venue.clock.now(),
      );

    await expect(stops(true)).resolves.toBe(true);
    expect(backend.assertRecordableAt).not.toHaveBeenCalled();
    await expect(stops(false)).resolves.toBe(false);
  });

  it("records a card charged before the start at once, with no alert, when the internet confirmed the start", async () => {
    const billId = await tabWith(venue, "Paella");
    const id = await capturedPending(billId, 3500);
    const state = startClockState();
    state.confirm("by_internet", {});

    await gatedPass(state);

    expect(await stateOf(id)).toBe("received");
    expect(await alertsFor(id)).toEqual([]);
  });

  it("leaves a pending refund untouched for a pass while waiting, and completes it once confirmed", async () => {
    const billId = await tabWith(venue, "Paella");
    const paid = await cardContribution(billId, "10.00");
    expect(paid.status).toBe(200);
    const paymentId = (paid.json.payment as { id: string }).id;
    // Refunded at the provider, but the answer is lost, so the refund stays pending.
    venue.card.scriptNextRefund({ made: "completed", answer: "throw" });
    const asked = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      {
        submissionId: randomUUID(),
        appliedAmount: "5.00",
        tipAmount: "0.00",
        reason: "Overcharged",
        override: { personId: venue.adminId, pin: "1234" },
      },
    );
    expect(asked.json).toMatchObject({ refund: { state: "pending" } });
    const rows = () =>
      inTx(venue, (tx) =>
        tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.billPaymentId, paymentId)),
      );
    const [row] = await rows();
    const lookups = venue.card.lookupCalls.length;
    const state = startClockState();

    const paused = await gatedPass(state);

    expect(paused.refundsCompleted).toBe(0);
    expect(await rows()).toEqual([row]);
    expect(venue.card.lookupCalls).toHaveLength(lookups);

    state.confirm("by_devices", {});
    const after = await gatedPass(state);

    expect(after.refundsCompleted).toBe(1);
    expect(await rows()).toMatchObject([{ state: "completed" }]);
  });
});
