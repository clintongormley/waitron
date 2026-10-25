import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentRefunds, sales, tenderRefunds, tenders } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { createPinThrottle } from "@waitron/identity";
import type { RefundAnswer } from "@waitron/payments";
import type { RefundScript } from "@waitron/payments/src/testing/fake-provider.js";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import { attestCardRefund } from "./bill-refunds.js";
import { inTx, provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { requestCfg } from "./request-config.js";
import { recoverTenderRefunds } from "./tender-refund-recovery.js";
import { attestTenderRefund } from "./tender-refund-sends.js";
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
    order by fecha_hora_huso_gen_registro desc, id desc
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

/** A bill card refund taken at `ms` and left pending after its one send; answers its rows, and
 * the same request sent again through `app`. */
async function pendingBillRefund(ms: number, script: RefundScript) {
  const billId = await tabWith(venue, "Paella");
  const paid = await pay(at(ms), billId, readerPart("10.00"));
  expect(paid.status).toBe(200);
  const paymentId = (paid.json.payment as { id: string }).id;
  const body = {
    submissionId: randomUUID(),
    appliedAmount: "5.00",
    tipAmount: "0.00",
    reason: "Overcharged",
    override: OVERRIDE(),
  };
  const resend = (app: Hono) =>
    send(
      app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
      body,
    );
  venue.card.scriptNextRefund(script);
  const asked = await resend(at(ms));
  expect(asked.json).toMatchObject({ refund: { state: "pending" } });
  const rowsOf = () =>
    inTx(venue, (tx) =>
      tx.select().from(billPaymentRefunds).where(eq(billPaymentRefunds.billPaymentId, paymentId)),
    );
  return { rowsOf, resend };
}

/** A clock reading `fromMs` until `stepTo` moves it, as a box clock stepping back mid-request. */
function steppingClock(fromMs: number) {
  let instant = fromMs;
  const base = systemClock();
  const clock: TrustedClock = {
    ...base,
    now: () => ({ ...base.now(), instant: new Date(instant), offsetMinutes: 60 }),
  };
  return { clock, stepTo: (ms: number) => void (instant = ms) };
}

/** Runs `step` once the fake provider has answered each `method` call, until the answer is called. */
function stepAfter(method: "lookupRefund" | "sendRefund", step: () => void): () => void {
  const card = venue.card as unknown as Record<typeof method, (query: unknown) => Promise<unknown>>;
  const original = card[method].bind(venue.card);
  const spy = vi.spyOn(card, method).mockImplementation(async (query) => {
    const answer = await original(query);
    step();
    return answer;
  });
  return () => spy.mockRestore();
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
  const { rowsOf } = await pendingBillRefund(now, { made: "completed", answer: "throw" });
  const [row] = await rowsOf();
  const sends = refundSends();
  const providerRefunds = providerRefundCount();

  const paused = await settlePendingBillPayments(loopDeps(clockAt(now - 10 * MINUTE)));

  expect(paused.refundsCompleted).toBe(0);
  expect(await rowsOf()).toEqual([row]);
  expect(providerRefundCount()).toBe(providerRefunds);

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

it("answers a finished refund's retry with its row", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  const done = await tenderRefund(at(now), saleId, refundBody(tenderId));
  expect(done.json).toMatchObject({ state: "completed" });
  const [row] = await tenderRefundRows(saleId);
  const sends = refundSends();

  const answer = await retry(at(now - 10 * MINUTE), row!.id);

  expect(answer.status).toBe(200);
  expect(answer.json).toEqual(done.json);
  expect(refundSends()).toBe(sends);
  expect(await tenderRefundRows(saleId)).toEqual([row]);
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

// The last two cases file a sale ahead of the real clock, so nothing after them sells on it.

it("raises no unresolved alert for a refund an hour old while the clock reads behind", async () => {
  const now = nowMs();
  const { rowsOf } = await pendingBillRefund(now, { made: false, answer: LOST });
  const [row] = await rowsOf();
  await soldAt(now + 120 * MINUTE, "cash");
  const alerts = unresolvedAlerts();

  await settlePendingBillPayments(loopDeps(clockAt(now + 90 * MINUTE)));

  expect(unresolvedAlerts()).toBe(alerts);
  expect(await rowsOf()).toEqual([row]);
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

// In the cases below the clock reads past the latest record when the request or pass begins, and
// steps back behind it while the provider is answering.

it("sends nothing on a tender refund's retry when the clock steps back during its lookup", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  venue.card.scriptNextRefund({ made: false, answer: LOST });
  const asked = await tenderRefund(at(now), saleId, refundBody(tenderId));
  expect(asked.json).toMatchObject({ state: "pending" });
  const [row] = await tenderRefundRows(saleId);
  await soldAt(now + 30 * MINUTE, "cash");
  const { clock, stepTo } = steppingClock(now + 31 * MINUTE);
  const restore = stepAfter("lookupRefund", () => stepTo(now + 10 * MINUTE));
  const sends = refundSends();
  try {
    const answer = await retry(venue.appAt(clock), row!.id);

    expect({ status: answer.status, sends: refundSends() - sends }).toEqual({
      status: 200,
      sends: 0,
    });
    expect(answer.json).toMatchObject({ state: "pending", completedAt: null });
    expect(await tenderRefundRows(saleId)).toMatchObject([
      { state: "pending", sendCount: 1, completedAt: null },
    ]);
  } finally {
    restore();
  }
});

it("sends nothing on a bill refund's resend when the clock steps back during its lookup", async () => {
  const now = nowMs();
  const { rowsOf, resend } = await pendingBillRefund(now, { made: false, answer: LOST });
  await soldAt(now + 30 * MINUTE, "cash");
  const { clock, stepTo } = steppingClock(now + 31 * MINUTE);
  const restore = stepAfter("lookupRefund", () => stepTo(now + 10 * MINUTE));
  const sends = refundSends();
  try {
    const answer = await resend(venue.appAt(clock));

    expect({ status: answer.status, sends: refundSends() - sends }).toEqual({
      status: 200,
      sends: 0,
    });
    expect(await rowsOf()).toMatchObject([{ state: "pending", sendCount: 1, completedAt: null }]);
  } finally {
    restore();
  }
});

it("leaves a tender refund pending when the clock steps back during the loop's lookup", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  venue.card.scriptNextRefund({ made: "completed", answer: "throw" });
  const asked = await tenderRefund(at(now), saleId, refundBody(tenderId));
  expect(asked.json).toMatchObject({ state: "pending" });
  const { clock, stepTo } = steppingClock(now + MINUTE);
  const restore = stepAfter("lookupRefund", () => stepTo(now - 10 * MINUTE));
  try {
    await recoverTenderRefunds(loopDeps(clock));

    expect(await tenderRefundRows(saleId)).toMatchObject([
      { state: "pending", completedAt: null, failedAt: null },
    ]);
  } finally {
    restore();
  }
});

it("leaves a bill refund pending when the clock steps back during the loop's lookup", async () => {
  const now = nowMs();
  const { rowsOf } = await pendingBillRefund(now, { made: "completed", answer: "throw" });
  const providerRefunds = providerRefundCount();
  const { clock, stepTo } = steppingClock(now + MINUTE);
  const restore = stepAfter("lookupRefund", () => stepTo(now - 10 * MINUTE));
  try {
    await settlePendingBillPayments(loopDeps(clock));

    expect(await rowsOf()).toMatchObject([{ state: "pending", completedAt: null, failedAt: null }]);
    expect(providerRefundCount()).toBe(providerRefunds);
  } finally {
    restore();
  }
});

it("leaves a new tender refund pending when the clock steps back while it is sent, and the loop settles it after", async () => {
  const now = nowMs();
  const { saleId, tenderId } = await soldAt(now, "card");
  const { clock, stepTo } = steppingClock(now);
  const restore = stepAfter("sendRefund", () => stepTo(now - 10 * MINUTE));
  const sends = refundSends();
  try {
    const answer = await tenderRefund(venue.appAt(clock), saleId, refundBody(tenderId));

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ state: "pending", completedAt: null });
    expect(refundSends()).toBe(sends + 1);
    expect(await tenderRefundRows(saleId)).toMatchObject([
      { state: "pending", sentAt: new Date(now).toISOString(), completedAt: null },
    ]);
  } finally {
    restore();
  }

  await recoverTenderRefunds(loopDeps(clockAt(now + MINUTE)));

  expect(await tenderRefundRows(saleId)).toMatchObject([
    { state: "completed", completedAt: new Date(now + MINUTE).toISOString() },
  ]);
  expect(refundSends()).toBe(sends + 1);
});

it("refuses a manager's confirmed outcome of a bill or tender refund while the clock reads behind", async () => {
  const now = nowMs();
  const { rowsOf } = await pendingBillRefund(now, { made: false, answer: LOST });
  const [billRow] = await rowsOf();
  const { saleId, tenderId } = await soldAt(now, "card");
  venue.card.scriptNextRefund({ made: false, answer: LOST });
  const asked = await tenderRefund(at(now), saleId, refundBody(tenderId));
  expect(asked.json).toMatchObject({ state: "pending" });
  const [tenderRow] = await tenderRefundRows(saleId);
  const behind = now - 10 * MINUTE;
  const confirmed = { attestedBy: venue.adminId, note: "Seen on the provider's dashboard" };

  await expect(
    attestCardRefund(loopDeps(clockAt(behind)), billRow!.id, "completed", confirmed),
  ).rejects.toMatchObject(behindChain(behind));
  await expect(
    attestTenderRefund(loopDeps(clockAt(behind)), tenderRow!.id, "completed", confirmed),
  ).rejects.toMatchObject(behindChain(behind));

  expect(await rowsOf()).toEqual([billRow]);
  expect(await tenderRefundRows(saleId)).toEqual([tenderRow]);
});
