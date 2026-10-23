import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentRefunds } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import type { RefundAnswer } from "@waitron/payments";
import {
  inTx,
  paymentRows,
  provisionBillVenue,
  send,
  tabWith,
  type BillVenue,
} from "./testing/bill-venue.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;

// Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
// records a sale; every case's payment is a part payment of a 35.00 Paella bill.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const billId = await tabWith(venue, "Paella");
    const settled = await pay(venue.app, billId, cashPart("35.00"));
    if (settled.status !== 200) throw new Error(`setup sale answered ${settled.status}`);
  },
});

const MINUTE = 60_000;
const LOST: RefundAnswer = { kind: "uncertain", reason: "timeout" };

function latest(): { at: Date; offsetMinutes: number } {
  const [row] = venue.db.all<{ at: string; offsetMinutes: number }>(sql`
    select fecha_hora_huso_gen_registro as at, offset_minutos as offsetMinutes
    from registros_facturacion
    order by fecha_hora_huso_gen_registro desc
    limit 1
  `);
  return { at: new Date(row!.at), offsetMinutes: row!.offsetMinutes };
}

const nowMs = () => latest().at.getTime();

function clockAt(ms: number): TrustedClock {
  const base = systemClock();
  const reading = { ...base.now(), instant: new Date(ms), offsetMinutes: 60 };
  return { ...base, now: () => reading };
}

const at = (ms: number) => venue.appAt(clockAt(ms));

function behindChain(clockMs: number) {
  const record = latest();
  return {
    code: "clock.behind_chain",
    params: {
      clockAt: new Date(clockMs).toISOString(),
      offsetMinutes: 60,
      lastRecordAt: record.at.toISOString(),
      lastRecordOffsetMinutes: record.offsetMinutes,
    },
  };
}

function cashPart(amount = "10.00") {
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

const readerPart = () => ({
  submissionId: randomUUID(),
  kind: "contribution",
  amount: "10.00",
  method: "card",
  entry: "reader",
  applied: "10.00",
  tip: "0.00",
});

function pay(app: Hono, billId: string, body: Record<string, unknown>) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, body);
}

function refund(app: Hono, billId: string, paymentId: string, submissionId: string = randomUUID()) {
  return send(
    app,
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
    {
      submissionId,
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Overcharged",
      override: { personId: venue.adminId, pin: "1234" },
    },
  );
}

/** A Paella bill with one part payment taken at `ms`; answers the bill and the payment's id. */
async function paidAt(ms: number, body: Record<string, unknown>) {
  const billId = await tabWith(venue, "Paella");
  const paid = await pay(at(ms), billId, body);
  expect(paid.status).toBe(200);
  return { billId, paymentId: (paid.json.payment as { id: string }).id };
}

const collects = () => venue.card.collectCalls.length;
const refundSends = () => venue.card.refundCalls.length;

function drawerJobs(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from print_jobs where kind = 'drawer'`,
  );
  return row!.n;
}

function refundRowsOf(paymentId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(billPaymentRefunds)
      .where(eq(billPaymentRefunds.billPaymentId, paymentId))
      .orderBy(billPaymentRefunds.createdAt),
  );
}

it("refuses a card payment on a bill before the reader", async () => {
  const behind = nowMs() - 10 * MINUTE;
  const billId = await tabWith(venue, "Paella");
  const before = collects();

  const answer = await pay(at(behind), billId, readerPart());

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(collects()).toBe(before);
  expect(await paymentRows(venue, billId)).toEqual([]);
});

it("refuses a cash part payment and queues no drawer", async () => {
  const behind = nowMs() - 10 * MINUTE;
  const billId = await tabWith(venue, "Paella");
  const drawers = drawerJobs();

  const answer = await pay(at(behind), billId, cashPart());

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(await paymentRows(venue, billId)).toEqual([]);
  expect(drawerJobs()).toBe(drawers);
});

it("refuses a cash bill refund and queues no drawer", async () => {
  const now = nowMs();
  const { billId, paymentId } = await paidAt(now, cashPart());
  const behind = now - 10 * MINUTE;
  const drawers = drawerJobs();

  const answer = await refund(at(behind), billId, paymentId);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(await refundRowsOf(paymentId)).toEqual([]);
  expect(drawerJobs()).toBe(drawers);
});

it("refuses a connected card bill refund and sends nothing", async () => {
  const now = nowMs();
  const { billId, paymentId } = await paidAt(now, readerPart());
  const behind = now - 10 * MINUTE;
  const sends = refundSends();

  const answer = await refund(at(behind), billId, paymentId);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(refundSends()).toBe(sends);
  expect(await refundRowsOf(paymentId)).toEqual([]);
});

it("answers a bill payment's replay", async () => {
  const now = nowMs();
  const billId = await tabWith(venue, "Paella");
  const body = cashPart();
  const first = await pay(at(now), billId, body);
  expect(first.status).toBe(200);
  const drawers = drawerJobs();

  const replay = await pay(at(now - 10 * MINUTE), billId, body);

  expect(replay.status).toBe(200);
  expect((replay.json.payment as { id: string }).id).toBe(
    (first.json.payment as { id: string }).id,
  );
  expect(await paymentRows(venue, billId)).toHaveLength(1);
  expect(drawerJobs()).toBe(drawers);
});

it("answers a finished refund's replay but refuses a pending one's resume", async () => {
  const now = nowMs();
  const behind = now - 10 * MINUTE;

  const cash = await paidAt(now, cashPart());
  const done = await refund(at(now), cash.billId, cash.paymentId);
  expect(done.status).toBe(200);
  expect(done.json).toMatchObject({ refund: { state: "completed" } });
  const doneId = (done.json.refund as { id: string }).id;
  const submissionId = (await refundRowsOf(cash.paymentId))[0]!.submissionId;

  const replayed = await refund(at(behind), cash.billId, cash.paymentId, submissionId);

  expect(replayed.status).toBe(200);
  expect(replayed.json).toMatchObject({ refund: { id: doneId, state: "completed" } });
  expect(await refundRowsOf(cash.paymentId)).toHaveLength(1);

  const card = await paidAt(now, readerPart());
  venue.card.scriptNextRefund({ made: false, answer: LOST });
  const pending = await refund(at(now), card.billId, card.paymentId);
  expect(pending.json).toMatchObject({ refund: { state: "pending" } });
  const [row] = await refundRowsOf(card.paymentId);
  const sends = refundSends();

  const resumed = await refund(at(behind), card.billId, card.paymentId, row!.submissionId);

  expect(resumed.status).toBe(409);
  expect(resumed.json).toEqual(behindChain(behind));
  expect(refundSends()).toBe(sends);
  expect(await refundRowsOf(card.paymentId)).toEqual([row]);
});

it("takes a cash part payment a minute inside the margin, and refuses one a second further", async () => {
  const now = nowMs();
  const billId = await tabWith(venue, "Paella");

  const taken = await pay(at(now - MINUTE), billId, cashPart());
  expect(taken.status).toBe(200);

  const refused = await pay(at(now - MINUTE - 1000), billId, cashPart());
  expect(refused.status).toBe(409);
  expect(refused.json).toEqual(behindChain(now - MINUTE - 1000));
  expect(await paymentRows(venue, billId)).toHaveLength(1);
});
