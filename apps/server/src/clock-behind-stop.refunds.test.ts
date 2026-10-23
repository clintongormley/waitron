import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentRefunds, sales, tenderRefunds, tenders } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { createPinThrottle } from "@waitron/identity";
import type { RefundAnswer } from "@waitron/payments";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { requestCfg } from "./request-config.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { beginSettledTenderRefund } from "./tender-refunds.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;

// Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
// and the whole payments of a Paella bill record sales; every refund is 5.00 of one.
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
const OVERRIDE = () => ({ personId: venue.adminId, pin: "1234" });

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

function cashPart(amount = "35.00") {
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

const readerPart = (amount = "35.00") => ({
  submissionId: randomUUID(),
  kind: "contribution",
  amount,
  method: "card",
  entry: "reader",
  applied: amount,
  tip: "0.00",
});

function pay(app: Hono, billId: string, body: Record<string, unknown>) {
  return send(app, venue.cookie, "POST", `/api/working-orders/${billId}/payments`, body);
}

/** A Paella bill paid whole at `ms`, which files its invoice; answers the sale and its one tender. */
async function soldAt(ms: number, method: "cash" | "card") {
  const billId = await tabWith(venue, "Paella");
  const paid = await pay(at(ms), billId, method === "cash" ? cashPart() : readerPart());
  expect(paid.status).toBe(200);
  const [tender] = await inTx(venue, (tx) =>
    tx
      .select({ saleId: tenders.saleId, tenderId: tenders.id })
      .from(tenders)
      .innerJoin(sales, eq(sales.id, tenders.saleId))
      .where(eq(sales.workingOrderId, billId)),
  );
  return tender!;
}

const refundBody = (tenderId: string, submissionId: string = randomUUID()) => ({
  submissionId,
  tenderId,
  appliedAmount: "5.00",
  tipAmount: "0.00",
  reason: "Overcharged",
  override: OVERRIDE(),
});

function tenderRefund(app: Hono, saleId: string, body: Record<string, unknown>) {
  return send(app, venue.cookie, "POST", `/api/transactions/${saleId}/refunds`, body);
}

function retry(app: Hono, refundId: string) {
  return send(app, venue.cookie, "POST", `/api/tender-refunds/${refundId}/retry`, {
    override: OVERRIDE(),
  });
}

function tenderRefundRows(saleId: string) {
  return inTx(venue, (tx) =>
    tx.select().from(tenderRefunds).where(eq(tenderRefunds.saleId, saleId)),
  );
}

const refundSends = () => venue.card.refundCalls.length;
const lookups = () => venue.card.lookupCalls.length;

function drawerJobs(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from print_jobs where kind = 'drawer'`,
  );
  return row!.n;
}

function providerRefundCount(): number {
  const [row] = venue.db.all<{ n: number }>(sql`select count(*) as n from payment_refunds`);
  return row!.n;
}

function unresolvedAlerts(): number {
  const [row] = venue.db.all<{ n: number }>(
    sql`select count(*) as n from incidents where code = 'payment.refund_unresolved'`,
  );
  return row!.n;
}

const loopDeps = (clock: TrustedClock) => ({
  db: venue.db,
  backend: venue.backend,
  clock,
  cfg: venue.cfg,
  refundProviderFor: (name: string) => venue.pool.get(name),
});

it("the tender-refund loop leaves a pending refund untouched during the stop, and settles it after", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  const [session] = venue.db.all<{ id: string }>(
    sql`select id from sessions where person_id = ${venue.operatorId} and device_id = ${venue.deviceId}`,
  );
  // Reserved and never sent, as a crash before the first send leaves it.
  const reserved = await beginSettledTenderRefund(
    loopDeps(clockAt(now)),
    requestCfg(venue.cfg, { deviceId: venue.deviceId }),
    saleId,
    refundBody(tenderId),
    {
      personId: venue.operatorId,
      sessionId: session!.id,
      attempts: { throttle: createPinThrottle(), slot: `override:${venue.deviceId}` },
    },
  );
  expect(reserved).toMatchObject({ state: "pending" });
  const [row] = await tenderRefundRows(saleId);
  const sends = refundSends();
  const looked = lookups();
  const behind = now - 10 * MINUTE;

  const paused = await recoverTenderRefunds(loopDeps(clockAt(behind)));

  expect(await tenderRefundRows(saleId)).toEqual([row]);
  expect(paused.nextDueAt).toEqual(new Date(behind + MINUTE));
  expect(row).toMatchObject({ state: "pending", failedAt: null });
  expect(refundSends()).toBe(sends);
  expect(lookups()).toBe(looked);

  await recoverTenderRefunds(loopDeps(clockAt(now + MINUTE)));

  expect(await tenderRefundRows(saleId)).toMatchObject([
    { state: "failed", failedAt: new Date(now + MINUTE).toISOString(), sentAt: null },
  ]);
  expect(refundSends()).toBe(sends);
});

it("the bill-refund half of the pass leaves a pending refund untouched during the stop, and settles it after", async () => {
  const now = nowMs();
  const billId = await tabWith(venue, "Paella");
  const paid = await pay(at(now), billId, readerPart("10.00"));
  expect(paid.status).toBe(200);
  const paymentId = (paid.json.payment as { id: string }).id;
  venue.card.scriptNextRefund({ made: "completed", answer: "throw" });
  const asked = await send(
    at(now),
    venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
    {
      submissionId: randomUUID(),
      appliedAmount: "5.00",
      tipAmount: "0.00",
      reason: "Overcharged",
      override: OVERRIDE(),
    },
  );
  expect(asked.json).toMatchObject({ refund: { state: "pending" } });
  const rowsOf = () =>
    inTx(venue, (tx) =>
      tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.billPaymentId, paymentId)),
    );
  const [row] = await rowsOf();
  const sends = refundSends();
  const providerRefunds = providerRefundCount();
  const alerts = unresolvedAlerts();

  const paused = await settlePendingBillPayments(loopDeps(clockAt(now - 10 * MINUTE)));

  expect(paused.refundsCompleted).toBe(0);
  expect(await rowsOf()).toEqual([row]);
  expect(providerRefundCount()).toBe(providerRefunds);
  expect(unresolvedAlerts()).toBe(alerts);

  const after = await settlePendingBillPayments(loopDeps(clockAt(now + MINUTE)));

  expect(after.refundsCompleted).toBe(1);
  expect(await rowsOf()).toMatchObject([{ state: "completed" }]);
  expect(providerRefundCount()).toBe(providerRefunds + 1);
  expect(refundSends()).toBe(sends);
});

it("refuses a connected card refund and sends nothing", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  const behind = now - 10 * MINUTE;
  const sends = refundSends();

  const answer = await tenderRefund(at(behind), saleId, refundBody(tenderId));

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(refundSends()).toBe(sends);
  expect(await tenderRefundRows(saleId)).toEqual([]);
});

it("refuses a cash refund and queues no drawer", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "cash");
  const behind = now - 10 * MINUTE;
  const drawers = drawerJobs();

  const answer = await tenderRefund(at(behind), saleId, refundBody(tenderId));

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(await tenderRefundRows(saleId)).toEqual([]);
  expect(drawerJobs()).toBe(drawers);
});

it("refuses the retry of a pending refund", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  venue.card.scriptNextRefund({ made: false, answer: LOST });
  const asked = await tenderRefund(at(now), saleId, refundBody(tenderId));
  expect(asked.json).toMatchObject({ state: "pending" });
  const [row] = await tenderRefundRows(saleId);
  const behind = now - 10 * MINUTE;
  const sends = refundSends();

  const answer = await retry(at(behind), row!.id);

  expect(answer.status).toBe(409);
  expect(answer.json).toEqual(behindChain(behind));
  expect(refundSends()).toBe(sends);
  expect(await tenderRefundRows(saleId)).toEqual([row]);
});

it("refuses the resend of a pending connected refund and sends nothing", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  venue.card.scriptNextRefund({ made: false, answer: LOST });
  const body = refundBody(tenderId);
  const sends = refundSends();
  const asked = await tenderRefund(at(now), saleId, body);
  expect(asked.json).toMatchObject({ state: "pending" });
  expect(refundSends()).toBe(sends + 1);
  const [row] = await tenderRefundRows(saleId);
  // A later sale moves the stop past the first send, so the resend's clock reads after it, inside
  // the provider's resend window.
  await soldAt(now + 60 * MINUTE, "cash");
  const behind = now + 50 * MINUTE;

  const answer = await tenderRefund(at(behind), saleId, body);

  expect({ status: answer.status, sends: refundSends() - sends }).toEqual({
    status: 409,
    sends: 1,
  });
  expect(answer.json).toEqual(behindChain(behind));
  expect(await tenderRefundRows(saleId)).toEqual([row]);
  expect(row).toMatchObject({ state: "pending", sendCount: 1 });
});

it("answers a finished refund's replay", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "cash");
  const body = refundBody(tenderId);
  const done = await tenderRefund(at(now), saleId, body);
  expect(done.status).toBe(200);
  expect(done.json).toMatchObject({ state: "completed" });
  const drawers = drawerJobs();

  const replay = await tenderRefund(at(now - 10 * MINUTE), saleId, body);

  expect(replay.status).toBe(200);
  expect(replay.json).toEqual(done.json);
  expect(await tenderRefundRows(saleId)).toHaveLength(1);
  expect(drawerJobs()).toBe(drawers);
});

it("sends a connected card refund a minute inside the margin, and refuses one a second further", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  const sends = refundSends();

  const taken = await tenderRefund(at(now - MINUTE), saleId, refundBody(tenderId));
  expect(taken.status).toBe(200);
  expect(taken.json).toMatchObject({ state: "completed" });
  expect(refundSends()).toBe(sends + 1);

  const refused = await tenderRefund(at(now - MINUTE - 1000), saleId, refundBody(tenderId));
  expect(refused.status).toBe(409);
  expect(refused.json).toEqual(behindChain(now - MINUTE - 1000));
  expect(refundSends()).toBe(sends + 1);
  expect(await tenderRefundRows(saleId)).toHaveLength(1);
});
