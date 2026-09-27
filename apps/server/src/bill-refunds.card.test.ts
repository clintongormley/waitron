import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { billPaymentRefunds, incidents, printJobs, withTransaction } from "@waitron/db";
import type { TrustedClock } from "@waitron/fiscal";
import { PIN_THROTTLE_FREE_ATTEMPTS, startManagementSession } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import type { PaymentProvider, RefundAnswer, RefundLookup } from "@waitron/payments";
import { SumUpCloudProvider } from "@waitron/payments-sumup";
import type { SumUpClient, SumUpTransaction } from "@waitron/payments-sumup";
import { AppError, decimal } from "@waitron/shared";
import type { RefundScript } from "@waitron/payments/src/testing/fake-provider.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { settlePendingBillPayments } from "./bill-payments-loop.js";
import {
  refundFingerprint,
  refundOutcome,
  refundProvidersOf,
  resumeCardRefund,
} from "./bill-refunds.js";
import type { RefundProviderFor } from "./bill-refunds.js";
import type { Logger } from "./logger.js";
import { mountPaymentsApi } from "./payments-api.js";
import {
  inTx,
  provisionBillVenue,
  registroCount,
  send,
  statusOf,
  systemClock,
  tabWith,
  tendersOfBill,
  type Answer,
  type BillVenue,
} from "./testing/bill-venue.js";
import { printedLines } from "./testing/decode-ticket.js";
import "./errors.js";

// A card refund of a bill payment that survives an interruption (bill payments design §6b, §8 tests
// 17–23): the refund row is written before the provider is asked, the call is keyed to the row,
// and an outcome is recorded only on evidence. The provider is the test provider behind the reader
// pool, told what to answer and what to have made; every case opens its own bill.
let venue: BillVenue;
let managerCookie: string;

const quiet: Logger = () => {};
const HOUR = 60 * 60 * 1000;
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const session = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: venue.adminId }),
    );
    managerCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
  },
});

/** The system clock moved by `ms`. */
function clockPlus(ms: number): TrustedClock {
  const base = systemClock();
  return {
    ...base,
    now: () => {
      const at = base.now();
      return { ...at, instant: new Date(at.instant.getTime() + ms) };
    },
  };
}

function managerApp(clock: TrustedClock = systemClock()): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: venue.db,
      backend: venue.backend,
      clock,
      cfg: venue.cfg,
      ring: RING,
      environment: "preproduction",
      pool: venue.pool,
      providers: [],
    },
    quiet,
  );
  return app;
}

const bill = (...names: string[]) => tabWith(venue, ...names);

async function pay(
  billId: string,
  method: "cash" | "card",
  amount: string,
  cookie = venue.cookie,
): Promise<{ id: string; answer: Answer }> {
  const answer = await send(venue.app, cookie, "POST", `/api/working-orders/${billId}/payments`, {
    submissionId: randomUUID(),
    kind: "contribution",
    amount,
    method,
    ...(method === "cash" ? { tendered: amount } : { entry: "reader" }),
    applied: amount,
    tip: "0.00",
  });
  return { id: (answer.json.payment as { id: string } | undefined)?.id ?? "", answer };
}

interface RefundAsk {
  submissionId?: string;
  applied: string;
  tip?: string;
  app?: Hono;
  cookie?: string;
}

const REASON = "El cliente pagó de más";

/** A refund request, authorised by the administrator's PIN; answers the request and its id. */
async function refund(billId: string, paymentId: string, ask: RefundAsk) {
  const submissionId = ask.submissionId ?? randomUUID();
  const answer = await send(
    ask.app ?? venue.app,
    ask.cookie ?? venue.cookie,
    "POST",
    `/api/working-orders/${billId}/payments/${paymentId}/refunds`,
    {
      submissionId,
      appliedAmount: ask.applied,
      tipAmount: ask.tip ?? "0.00",
      reason: REASON,
      override: { personId: venue.adminId, pin: "1234" },
    },
  );
  return {
    answer,
    submissionId,
    again: (app?: Hono) => refund(billId, paymentId, { ...ask, submissionId, app }),
  };
}

async function refundRowsOf(paymentId: string) {
  return inTx(venue, (tx) =>
    tx
      .select()
      .from(billPaymentRefunds)
      .where(eq(billPaymentRefunds.billPaymentId, paymentId))
      .orderBy(billPaymentRefunds.createdAt),
  );
}

async function onlyRefundOf(paymentId: string) {
  const rows = await refundRowsOf(paymentId);
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

/** The provider-side refund records, through the payment's `payments` row. */
function providerRefundsOf(billPaymentId: string) {
  return venue.db
    .all<{ amount: number; provider_refund_ref: string | null }>(
      sql`select r.amount, r.provider_refund_ref from payment_refunds r
          join payments p on p.id = r.payment_id
          where p.bill_payment_id = ${billPaymentId} order by r.created_at`,
    )
    .map((row) => ({ amount: row.amount, providerRefundRef: row.provider_refund_ref }));
}

function documentJobs() {
  return inTx(venue, (tx) =>
    tx
      .select({ id: printJobs.id, payload: printJobs.payload })
      .from(printJobs)
      .where(eq(printJobs.kind, "document")),
  );
}

const callsFor = (refundId: string) =>
  venue.card.refundCalls.filter((call) => call.refundId === refundId);

/** The payment's one refund, once its send has reached the provider. */
async function heldSendOf(paymentId: string) {
  let row: Awaited<ReturnType<typeof refundRowsOf>>[number] | undefined;
  await vi.waitFor(async () => {
    [row] = await refundRowsOf(paymentId);
    expect(row === undefined ? [] : callsFor(row.id)).toHaveLength(1);
  });
  return row;
}

const runLoop = (clock: TrustedClock = systemClock()) =>
  settlePendingBillPayments({
    db: venue.db,
    backend: venue.backend,
    clock,
    cfg: venue.cfg,
    refundProviderFor: (name) => venue.pool.get(name),
  });

const LOST: RefundAnswer = { kind: "uncertain", reason: "timeout" };

/**
 * A €40.00 bill (Pulpo €20.00, Croquetas €10.00, Croquetas €10.00) with a €20.00 card payment, and
 * a €5.00 refund of it whose send reached nobody and was answered by a timeout: pending, sent once.
 */
async function pendingRefund(first: RefundScript = { made: false, answer: LOST }) {
  const billId = await bill("Pulpo", "Croquetas", "Croquetas");
  const card = await pay(billId, "card", "20.00");
  venue.card.scriptNextRefund(first);
  const asked = await refund(billId, card.id, { applied: "5.00" });
  const row = await onlyRefundOf(card.id);
  return { billId, paymentId: card.id, refundId: row.id, asked, row };
}

async function withProvider<T>(
  opts: { window?: number | null; lookups?: RefundLookup },
  fn: () => Promise<T>,
): Promise<T> {
  const window = venue.card.refundResendWindowMs;
  if (opts.window !== undefined) venue.card.refundResendWindowMs = opts.window;
  if (opts.lookups !== undefined) venue.card.scriptLookups(opts.lookups);
  try {
    return await fn();
  } finally {
    venue.card.refundResendWindowMs = window;
    venue.card.scriptLookups(null);
  }
}

/** Every refusal of design §8 test 17's list while a refund on the bill is pending. */
async function lockedWrites(billId: string, paymentId: string) {
  const lines = await send(venue.app, venue.cookie, "GET", `/api/working-orders/${billId}/lines`);
  return {
    cash: (await pay(billId, "cash", "5.00")).answer,
    lineEdit: await send(venue.app, venue.cookie, "PUT", `/api/working-orders/${billId}/lines/1`, {
      revision: lines.json.revision,
      note: "sin cebolla",
    }),
    reduction: await send(
      venue.app,
      venue.cookie,
      "DELETE",
      `/api/working-orders/${billId}/lines/2`,
    ),
    move: await send(venue.app, venue.cookie, "POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 3 }],
    }),
    abandon: await send(venue.app, venue.cookie, "DELETE", `/api/working-orders/${billId}`),
    secondRefund: (await refund(billId, paymentId, { applied: "1.00" })).answer,
  };
}

function expectRefusedInProgress(answers: Record<string, Answer>, billId: string) {
  for (const [write, answer] of Object.entries(answers)) {
    expect({ write, status: answer.status, code: answer.json.code }).toEqual({
      write,
      status: 409,
      code: "bill.refund_in_progress",
    });
    expect(answer.json.params).toEqual({ workingOrderId: billId });
  }
}

describe("the evidence table (design §6b)", () => {
  const outcome = (kind: "completed" | "failed" | "pending"): RefundAnswer => ({
    kind: "outcome",
    outcome: kind,
    providerRefundRef: "re_1",
    providerStatus: kind,
  });

  it.each([
    ["no sent_at", { kind: "never_sent" }, "failed"],
    [
      "the refund's own record, completed",
      { kind: "answer", answer: outcome("completed"), sendCount: 2 },
      "completed",
    ],
    [
      "the refund's own record, failed, on a later send",
      { kind: "answer", answer: outcome("failed"), sendCount: 2 },
      "failed",
    ],
    [
      "the refund's own record, pending",
      { kind: "answer", answer: outcome("pending"), sendCount: 1 },
      "pending",
    ],
    [
      "a documented refusal of the only send",
      {
        kind: "answer",
        answer: { kind: "refused", httpStatus: 400, documented: true },
        sendCount: 1,
      },
      "failed",
    ],
    [
      "a documented refusal of a later send",
      {
        kind: "answer",
        answer: { kind: "refused", httpStatus: 401, documented: true },
        sendCount: 2,
      },
      "pending",
    ],
    [
      "an undocumented refusal of the only send",
      {
        kind: "answer",
        answer: { kind: "refused", httpStatus: 409, documented: false },
        sendCount: 1,
      },
      "pending",
    ],
    [
      "accepted with nothing to read",
      { kind: "answer", answer: { kind: "accepted" }, sendCount: 1 },
      "pending",
    ],
    [
      "a timeout",
      { kind: "answer", answer: { kind: "uncertain", reason: "timeout" }, sendCount: 1 },
      "pending",
    ],
    [
      "a server error",
      {
        kind: "answer",
        answer: { kind: "uncertain", reason: "server_error", httpStatus: 503 },
        sendCount: 1,
      },
      "pending",
    ],
    [
      "a lookup match, completed",
      {
        kind: "lookup",
        lookup: {
          kind: "match",
          providerRefundRef: "1",
          outcome: "completed",
          providerStatus: "REFUNDED",
        },
      },
      "completed",
    ],
    [
      "a lookup match, failed",
      {
        kind: "lookup",
        lookup: {
          kind: "match",
          providerRefundRef: "1",
          outcome: "failed",
          providerStatus: "FAILED",
        },
      },
      "failed",
    ],
    [
      "a lookup match, pending",
      {
        kind: "lookup",
        lookup: {
          kind: "match",
          providerRefundRef: "1",
          outcome: "pending",
          providerStatus: "PENDING",
        },
      },
      "pending",
    ],
    ["no match", { kind: "lookup", lookup: { kind: "none" } }, "pending"],
    ["two candidates", { kind: "lookup", lookup: { kind: "ambiguous", candidates: 2 } }, "pending"],
    ["the provider unreachable", { kind: "lookup", lookup: { kind: "unreachable" } }, "pending"],
  ] as const)("%s → %s", (_name, evidence, expected) => {
    expect(refundOutcome(evidence)).toBe(expected);
  });
});

describe("a card refund, sent once (design §6b R1–R3)", () => {
  it("records a refund the provider completed, with its reference, on both records", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");

    const { answer } = await refund(billId, card.id, { applied: "5.00" });

    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      refund: { state: "completed", appliedAmount: "5.00", tipAmount: "0.00" },
      balance: { received: "15.00", outstanding: "25.00" },
    });
    const row = await onlyRefundOf(card.id);
    const [call] = callsFor(row.id);
    expect(call).toEqual({
      processorRef: expect.any(String) as unknown as string,
      amount: "5.00",
      idempotencyKey: `bpr_${row.id}`,
      refundId: row.id,
    });
    expect(row).toMatchObject({ state: "completed", sendCount: 1, tillId: venue.deviceTillId });
    expect(row.sentAt).not.toBeNull();
    expect(row.providerRefundRef).toMatch(/^fake-re-/);
    expect(await providerRefundsOf(card.id)).toEqual([
      { amount: 500, providerRefundRef: row.providerRefundRef },
    ]);
  });

  it("asks for the payment's whole remainder, its tip included, when the payer wants it all back", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "20.00",
        method: "card",
        entry: "reader",
        addedTip: "2.00",
        applied: "20.00",
        tip: "2.00",
      },
    );
    const paymentId = (answer.json.payment as { id: string }).id;

    const back = await refund(billId, paymentId, { applied: "20.00", tip: "2.00" });

    expect(back.answer.json).toMatchObject({
      refund: { state: "completed", appliedAmount: "20.00", tipAmount: "2.00" },
    });
    const row = await onlyRefundOf(paymentId);
    expect(callsFor(row.id).map((call) => call.amount)).toEqual(["22.00"]);
    expect((await providerRefundsOf(paymentId)).map((r) => r.amount)).toEqual([2200]);
  });

  it("refuses a card taken on a terminal Waitron does not drive, writing nothing", async () => {
    const billId = await bill("Pulpo");
    const answer = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "10.00",
        method: "card",
        entry: "manual",
        applied: "10.00",
        tip: "0.00",
      },
    );
    const paymentId = (answer.json.payment as { id: string }).id;
    const calls = venue.card.refundCalls.length;

    const refused = await refund(billId, paymentId, { applied: "5.00" });

    expect(refused.answer.status).toBe(422);
    expect(refused.answer.json).toEqual({ code: "bill.refund_unsupported", params: { paymentId } });
    expect(await refundRowsOf(paymentId)).toEqual([]);
    expect(venue.card.refundCalls).toHaveLength(calls);
  });

  it("refuses a refund the provider's own record no longer allows, before asking it", async () => {
    const billId = await bill("Pulpo", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    venue.db.run(sql`update payments set state = 'voided' where bill_payment_id = ${card.id}`);
    const calls = venue.card.refundCalls.length;

    const refused = await refund(billId, card.id, { applied: "5.00" });

    expect(refused.answer.status).toBe(409);
    expect(refused.answer.json).toMatchObject({
      code: "payment.not_refundable",
      params: { state: "voided" },
    });
    expect(await refundRowsOf(card.id)).toEqual([]);
    expect(venue.card.refundCalls).toHaveLength(calls);
  });
});

describe("design §8 test 17: the provider refunded and the answer was lost", () => {
  it("keeps the bill locked until a retry of the same id finds the refund and completes it, sending nothing more", async () => {
    const { billId, paymentId, refundId, asked, row } = await pendingRefund({
      made: "completed",
      answer: "throw",
    });

    expect(asked.answer.json).toMatchObject({ refund: { state: "pending" } });
    expect(row).toMatchObject({ state: "pending", sendCount: 1 });
    expect(row.sentAt).not.toBeNull();
    expect(await providerRefundsOf(paymentId)).toEqual([]);
    expectRefusedInProgress(await lockedWrites(billId, paymentId), billId);
    expect(await statusOf(venue, billId)).toBe("open");
    expect(registroCount(venue, billId)).toBe(0);

    const retried = await asked.again();

    expect(retried.answer.status).toBe(200);
    expect(retried.answer.json).toMatchObject({ refund: { id: refundId, state: "completed" } });
    expect(callsFor(refundId)).toHaveLength(1);
    const done = await onlyRefundOf(paymentId);
    expect(done).toMatchObject({ state: "completed", sendCount: 1 });
    expect(await providerRefundsOf(paymentId)).toEqual([
      { amount: 500, providerRefundRef: done.providerRefundRef },
    ]);
    expect(done.providerRefundRef).toMatch(/^fake-re-/);
    const cash = await pay(billId, "cash", "5.00");
    expect(cash.answer.status).toBe(200);
  });
});

describe("design §8 test 18: a new id while a refund is pending", () => {
  it("is refused bill.refund_in_progress, and the provider is not asked", async () => {
    const { billId, paymentId } = await pendingRefund();
    const calls = venue.card.refundCalls.length;

    const second = await refund(billId, paymentId, { applied: "2.00" });

    expect(second.answer.status).toBe(409);
    expect(second.answer.json).toEqual({
      code: "bill.refund_in_progress",
      params: { workingOrderId: billId },
    });
    expect(venue.card.refundCalls).toHaveLength(calls);
    expect(await refundRowsOf(paymentId)).toHaveLength(1);
  });

  it("refuses a refund of another payment of the same bill too", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const cash = await pay(billId, "cash", "5.00");
    const card = await pay(billId, "card", "20.00");
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    await refund(billId, card.id, { applied: "5.00" });

    const other = await refund(billId, cash.id, { applied: "5.00" });

    expect(other.answer.status).toBe(409);
    expect(other.answer.json).toEqual({
      code: "bill.refund_in_progress",
      params: { workingOrderId: billId },
    });
    expect(await refundRowsOf(cash.id)).toEqual([]);
  });

  it("leaves another bill of the same party alone", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas", "Caña");
    const split = await send(venue.app, venue.cookie, "POST", `/api/tabs/${billId}/split`, {
      transfers: [{ lineNo: 4 }],
    });
    const otherBill = split.json.checkId as string;
    const card = await pay(billId, "card", "20.00");
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    await refund(billId, card.id, { applied: "5.00" });

    const cash = await pay(otherBill, "cash", "3.00");

    expect(cash.answer.status).toBe(200);
    expect(cash.answer.json).toMatchObject({ outcome: "received" });
  });
});

describe("design §8 test 19: each outcome, through each resolver", () => {
  const match = (
    outcome: "completed" | "failed" | "pending",
    providerStatus: string,
  ): RefundLookup => ({
    kind: "match",
    providerRefundRef: `ref-${randomUUID()}`,
    outcome,
    providerStatus,
  });
  const CASES = [
    ["Stripe succeeded", match("completed", "succeeded"), "completed"],
    ["Stripe failed", match("failed", "failed"), "failed"],
    ["Stripe canceled", match("failed", "canceled"), "failed"],
    ["Stripe pending", match("pending", "pending"), "pending"],
    ["Stripe requires_action", match("pending", "requires_action"), "pending"],
    ["SumUp REFUNDED", match("completed", "REFUNDED"), "completed"],
    ["SumUp SUCCESSFUL", match("completed", "SUCCESSFUL"), "completed"],
    ["SumUp FAILED", match("failed", "FAILED"), "failed"],
    ["SumUp PENDING", match("pending", "PENDING"), "pending"],
    ["no match", { kind: "none" }, "pending"],
    ["two candidate events", { kind: "ambiguous", candidates: 2 }, "pending"],
  ] as const;
  const RESOLVERS = ["a retry of the same id", "the loop", "the manager's resolve"] as const;

  async function resolveBy(
    resolver: (typeof RESOLVERS)[number],
    pending: Awaited<ReturnType<typeof pendingRefund>>,
  ) {
    switch (resolver) {
      case "a retry of the same id":
        return (await pending.asked.again()).answer;
      case "the loop":
        await runLoop();
        return null;
      case "the manager's resolve":
        return send(
          managerApp(),
          managerCookie,
          "POST",
          `/management-api/payments/bill-refunds/${pending.refundId}/resolve`,
        );
    }
  }

  // The resend window is closed for these cases, so none sends; test 21 is where a retry resends.
  it.each(
    CASES.flatMap(([name, lookup, expected]) =>
      RESOLVERS.map((r) => [name, r, lookup, expected] as const),
    ),
  )("%s, by %s", async (_name, resolver, lookup, expected) => {
    const pending = await pendingRefund();
    const calls = venue.card.refundCalls.length;

    const answer = await withProvider({ window: null, lookups: lookup }, () =>
      resolveBy(resolver, pending),
    );

    const row = await onlyRefundOf(pending.paymentId);
    expect(row.state).toBe(expected);
    expect(venue.card.refundCalls).toHaveLength(calls);
    if (expected === "completed") {
      expect(row.providerRefundRef).toBe(
        (lookup as { providerRefundRef: string }).providerRefundRef,
      );
      expect(await providerRefundsOf(pending.paymentId)).toEqual([
        { amount: 500, providerRefundRef: row.providerRefundRef },
      ]);
    } else {
      expect(await providerRefundsOf(pending.paymentId)).toEqual([]);
    }
    const cash = await pay(pending.billId, "cash", "1.00");
    if (expected === "pending") {
      expect(cash.answer.json.code).toBe("bill.refund_in_progress");
    } else {
      expect(cash.answer.status).toBe(200);
    }
    if (resolver === "the manager's resolve") {
      if (expected === "pending") {
        expect(answer!.status).toBe(409);
        expect(answer!.json.code).toBe("bill.refund_outcome_unconfirmed");
      } else {
        expect(answer!.status).toBe(200);
        expect(answer!.json).toEqual({ outcome: expected });
      }
    }
    if (resolver === "a retry of the same id") {
      expect(answer!.status).toBe(200);
      expect(answer!.json).toMatchObject({ refund: { state: expected } });
    }
  });
});

describe("design §8 test 20: the call's own answer, and which answers settle what", () => {
  it("fails the refund on a documented refusal of its first and only send, releasing the lock", async () => {
    const { billId, paymentId, row, asked } = await pendingRefund({
      made: false,
      answer: { kind: "refused", httpStatus: 400, documented: true },
    });

    expect(asked.answer.json).toMatchObject({ refund: { state: "failed" } });
    expect(row).toMatchObject({ state: "failed", sendCount: 1 });
    expect(await providerRefundsOf(paymentId)).toEqual([]);
    expect((await pay(billId, "cash", "5.00")).answer.status).toBe(200);
  });

  it("fails it on a refund record the provider answers failed, on the first send and on a resend", async () => {
    const first = await pendingRefund({
      made: "failed",
      answer: "made",
    });
    const second = await pendingRefund();
    venue.card.scriptNextRefund({ made: "failed", answer: "made" });
    await second.asked.again();

    expect(first.row).toMatchObject({ state: "failed", sendCount: 1 });
    expect(await onlyRefundOf(second.paymentId)).toMatchObject({ state: "failed", sendCount: 2 });
  });

  it.each([
    ["a 401", { kind: "refused", httpStatus: 401, documented: true }],
    ["a 400", { kind: "refused", httpStatus: 400, documented: true }],
    ["a 404", { kind: "refused", httpStatus: 404, documented: true }],
  ] as const)(
    "keeps it pending when %s answers a resend after a lost first send: it answers only that send",
    async (_name, answer) => {
      const { billId, paymentId, refundId, asked } = await pendingRefund();
      venue.card.scriptNextRefund({ made: false, answer });

      const retried = await asked.again();

      expect(retried.answer.json).toMatchObject({ refund: { state: "pending" } });
      expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 2 });
      expect(new Set(callsFor(refundId).map((call) => call.idempotencyKey))).toEqual(
        new Set([`bpr_${refundId}`]),
      );
      expect((await pay(billId, "cash", "1.00")).answer.json.code).toBe("bill.refund_in_progress");
    },
  );

  it.each([
    ["a 500", { kind: "uncertain", reason: "server_error", httpStatus: 500 }],
    ["a 503", { kind: "uncertain", reason: "server_error", httpStatus: 503 }],
    ["a 409", { kind: "refused", httpStatus: 409, documented: false }],
    ["a timeout", { kind: "uncertain", reason: "timeout" }],
  ] as const)(
    "keeps it pending when %s answers the first send or a resend",
    async (_name, answer) => {
      const { paymentId, asked, row } = await pendingRefund({ made: false, answer });
      venue.card.scriptNextRefund({ made: false, answer });
      await asked.again();

      expect(row).toMatchObject({ state: "pending", sendCount: 1 });
      expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 2 });
    },
  );

  it("looks a refund up at once when the provider accepts it without saying what it made", async () => {
    const { paymentId, row, refundId } = await pendingRefund({
      made: "completed",
      answer: { kind: "accepted" },
    });

    expect(row).toMatchObject({ state: "completed", sendCount: 1 });
    expect(venue.card.lookupCalls.filter((q) => q.refundId === refundId)).toHaveLength(1);
    expect(await providerRefundsOf(paymentId)).toHaveLength(1);
  });
});

describe("the provider refunds another refund of the payment already accounts for", () => {
  it("keeps a failed refund's provider reference, so the payment's next refund is not settled by that failure", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    // SumUp's own lookup over a transaction whose one refund event is the first refund's failure,
    // stamped when first read, so after that refund's send.
    let event: NonNullable<SumUpTransaction["refundEvents"]>[number] | undefined;
    const sumup = new SumUpCloudProvider({
      db: venue.db,
      nodeId: venue.cfg.nodeId,
      incidents: () => Promise.resolve(true),
      client: {
        findTransaction: () => {
          event ??= {
            id: "sumup-failed-1",
            status: "FAILED",
            amount: decimal("4.00"),
            timestamp: new Date().toISOString(),
          };
          return Promise.resolve({
            id: "t",
            status: "SUCCESSFUL",
            amount: decimal("20.00"),
            refundEvents: [event],
          });
        },
      } as unknown as SumUpClient,
    });
    const lookups = vi
      .spyOn(venue.card, "lookupRefund")
      .mockImplementation((query) => sumup.lookupRefund(query));
    venue.card.scriptNextRefund({ made: false, answer: { kind: "accepted" } });
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    try {
      await refund(billId, card.id, { applied: "4.00" });
      await refund(billId, card.id, { applied: "4.00" });
      const [, second] = await refundRowsOf(card.id);
      const resumed = await resumeCardRefund(
        {
          db: venue.db,
          clock: systemClock(),
          refundProviderFor: () => Promise.resolve(venue.card),
        },
        second!.id,
        "loop",
      );

      expect(
        (await refundRowsOf(card.id)).map((row) => [row.state, row.providerRefundRef]),
      ).toEqual([
        ["failed", "sumup-failed-1"],
        ["pending", null],
      ]);
      expect(resumed).toMatchObject({ lookup: { kind: "none" } });
      expect(lookups.mock.calls.map(([query]) => query.excludeRefs)).toEqual([
        [],
        ["sumup-failed-1"],
      ]);
    } finally {
      lookups.mockRestore();
    }
  });

  it("excludes the references of the payment's completed and failed refunds, not its own or another payment's", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const other = await pay(billId, "card", "10.00");
    venue.card.scriptNextRefund({ made: "completed", answer: "made" });
    await refund(billId, card.id, { applied: "1.00" });
    venue.card.scriptNextRefund({ made: "failed", answer: "made" });
    await refund(billId, card.id, { applied: "1.00" });
    venue.card.scriptNextRefund({ made: "completed", answer: "made" });
    await refund(billId, other.id, { applied: "1.00" });
    venue.card.scriptNextRefund({ made: "completed", answer: LOST });
    await refund(billId, card.id, { applied: "1.00" });
    const [completed, failed, pending] = await refundRowsOf(card.id);
    // The provider's id may arrive on a refund still pending; it is this refund's own.
    venue.db.run(
      sql`update bill_payment_refunds set provider_refund_ref = 'own-ref' where id = ${pending!.id}`,
    );

    await withProvider({ lookups: { kind: "none" } }, () =>
      resumeCardRefund(
        {
          db: venue.db,
          clock: systemClock(),
          refundProviderFor: () => Promise.resolve(venue.card),
        },
        pending!.id,
        "loop",
      ),
    );

    expect([completed!.state, failed!.state, pending!.state]).toEqual([
      "completed",
      "failed",
      "pending",
    ]);
    expect(new Set(venue.card.lookupCalls.at(-1)!.excludeRefs)).toEqual(
      new Set([completed!.providerRefundRef, failed!.providerRefundRef]),
    );
    expect(failed!.providerRefundRef).toMatch(/^fake-re-/);
  });
});

describe("the provider's refunds read before the first send", () => {
  /** SumUp's own reading and lookup over a transaction whose refund events the test writes. */
  function sumupOver(events: NonNullable<SumUpTransaction["refundEvents"]>) {
    const sumup = new SumUpCloudProvider({
      db: venue.db,
      nodeId: venue.cfg.nodeId,
      incidents: () => Promise.resolve(true),
      client: {
        findTransaction: () =>
          Promise.resolve({
            id: "t",
            status: "SUCCESSFUL",
            amount: decimal("20.00"),
            refundEvents: [...events],
          }),
      } as unknown as SumUpClient,
    });
    const reads = vi.fn((processorRef: string) => sumup.existingRefundRefs(processorRef));
    venue.card.existingRefundRefs = reads;
    const lookups = vi
      .spyOn(venue.card, "lookupRefund")
      .mockImplementation((query) => sumup.lookupRefund(query));
    return {
      reads,
      lookups,
      restore: () => {
        lookups.mockRestore();
        delete venue.card.existingRefundRefs;
      },
    };
  }
  const refunded = (id: string, msBeforeNow: number) => ({
    id,
    status: "REFUNDED",
    amount: decimal("4.00"),
    timestamp: new Date(Date.now() - msBeforeNow).toISOString(),
  });

  it("keeps the reading, and settles a later lookup by it: an earlier refund is never this one, a skewed stamp still is", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const events = [refunded("made-a-minute-before", 60_000)];
    const sumup = sumupOver(events);
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    try {
      await refund(billId, card.id, { applied: "4.00" });
      const [row] = await refundRowsOf(card.id);
      const unseen = await resumeCardRefund(
        {
          db: venue.db,
          clock: systemClock(),
          refundProviderFor: () => Promise.resolve(venue.card),
        },
        row!.id,
        "loop",
      );
      // SumUp stamps the refund our send made 30 s before our own clock's `sent_at`.
      events.push(refunded("ours", Date.now() - Date.parse(row!.sentAt!) + 30_000));
      const seen = await resumeCardRefund(
        {
          db: venue.db,
          clock: systemClock(),
          refundProviderFor: () => Promise.resolve(venue.card),
        },
        row!.id,
        "loop",
      );

      expect(row).toMatchObject({ state: "pending", refsBeforeSend: ["made-a-minute-before"] });
      expect(unseen).toMatchObject({ lookup: { kind: "none" }, refund: { state: "pending" } });
      expect(seen).toMatchObject({
        lookup: { kind: "match", providerRefundRef: "ours" },
        refund: { state: "completed", providerRefundRef: "ours" },
      });
      expect(sumup.lookups.mock.calls.map(([query]) => query.refsBeforeSend)).toEqual([
        ["made-a-minute-before"],
        ["made-a-minute-before"],
      ]);
      expect(sumup.reads).toHaveBeenCalledTimes(1);
    } finally {
      sumup.restore();
    }
  });

  it("reads once, before the first send, and not again before a resend", async () => {
    const { paymentId, refundId, asked } = await pendingRefund();
    const sumup = sumupOver([]);
    try {
      await asked.again();
      expect(sumup.reads).not.toHaveBeenCalled();
      expect(await onlyRefundOf(paymentId)).toMatchObject({ sendCount: 2, refsBeforeSend: null });
      expect(callsFor(refundId)).toHaveLength(2);
    } finally {
      sumup.restore();
    }
  });

  it("sends with no reading when the provider cannot say which refunds exist, and leaves an earlier-stamped one unsettled", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const sumup = sumupOver([refunded("made-a-minute-before", 60_000)]);
    sumup.reads.mockRejectedValueOnce(new Error("sumup unreachable"));
    venue.card.scriptNextRefund({ made: false, answer: { kind: "accepted" } });
    try {
      await refund(billId, card.id, { applied: "4.00" });
      const [row] = await refundRowsOf(card.id);

      expect(row).toMatchObject({ state: "pending", sendCount: 1, refsBeforeSend: null });
      expect(callsFor(row!.id)).toHaveLength(1);
      expect(await sumup.lookups.mock.results[0]!.value).toEqual({
        kind: "ambiguous",
        candidates: 1,
      });
    } finally {
      sumup.restore();
    }
  });
});

describe("design §8 test 21: never sent, sent but not found, and the key window", () => {
  it("fails a refund a crash left with no sent_at, asking the provider nothing", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const [stranded] = await inTx(venue, (tx) =>
      tx
        .insert(billPaymentRefunds)
        .values({
          billPaymentId: card.id,
          submissionId: randomUUID(),
          fingerprint: "stranded",
          appliedAmount: 500,
          reason: "stranded",
          authorizedBy: venue.adminId,
          requestedBy: venue.operatorId,
          tillId: venue.deviceTillId,
          state: "pending",
        })
        .returning(),
    );
    expect((await pay(billId, "cash", "1.00")).answer.json.code).toBe("bill.refund_in_progress");

    const pass = await runLoop();

    expect(pass).toMatchObject({ refundsFailed: 1 });
    expect(await onlyRefundOf(card.id)).toMatchObject({
      id: stranded!.id,
      state: "failed",
      sendCount: 0,
    });
    expect(callsFor(stranded!.id)).toEqual([]);
    expect(venue.card.lookupCalls.filter((q) => q.refundId === stranded!.id)).toEqual([]);
    expect((await pay(billId, "cash", "1.00")).answer.status).toBe(200);
  });

  it("leaves a sent refund it cannot find pending, sending nothing", async () => {
    const { paymentId, refundId } = await pendingRefund();

    await runLoop(clockPlus(HOUR / 2));

    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 1 });
    expect(callsFor(refundId)).toHaveLength(1);
  });

  it("resends with the same key on a retry 23 hours after the first send", async () => {
    const { paymentId, refundId, asked } = await pendingRefund();

    const retried = await asked.again(venue.appAt(clockPlus(23 * HOUR)));

    expect(retried.answer.json).toMatchObject({ refund: { state: "completed" } });
    expect(callsFor(refundId).map((call) => call.idempotencyKey)).toEqual([
      `bpr_${refundId}`,
      `bpr_${refundId}`,
    ]);
    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "completed", sendCount: 2 });
  });

  it("sends nothing on a retry 25 hours after the first send, nor on the manager's resolve", async () => {
    const { billId, paymentId, refundId, asked } = await pendingRefund();
    const later = clockPlus(25 * HOUR);

    const retried = await asked.again(venue.appAt(later));
    const resolved = await send(
      managerApp(later),
      managerCookie,
      "POST",
      `/management-api/payments/bill-refunds/${refundId}/resolve`,
    );

    expect(retried.answer.json).toMatchObject({ refund: { state: "pending" } });
    expect(resolved.status).toBe(409);
    expect(resolved.json).toEqual({
      code: "bill.refund_outcome_unconfirmed",
      params: { refundId, reason: "not_found" },
    });
    expect(callsFor(refundId)).toHaveLength(1);
    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 1 });
    expect((await pay(billId, "cash", "1.00")).answer.json.code).toBe("bill.refund_in_progress");
  });

  it("resends on the manager's resolve inside the window", async () => {
    const { paymentId, refundId } = await pendingRefund();

    const resolved = await send(
      managerApp(clockPlus(HOUR)),
      managerCookie,
      "POST",
      `/management-api/payments/bill-refunds/${refundId}/resolve`,
    );

    expect(resolved.json).toEqual({ outcome: "completed" });
    expect(callsFor(refundId)).toHaveLength(2);
    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "completed", sendCount: 2 });
  });

  it.each([60_000, 23 * HOUR])(
    "never resends for a provider with no safe window, %i ms after the send",
    async (after) => {
      const { paymentId, refundId, asked } = await pendingRefund();

      const retried = await withProvider({ window: null }, () =>
        asked.again(venue.appAt(clockPlus(after))),
      );

      expect(retried.answer.json).toMatchObject({ refund: { state: "pending" } });
      expect(callsFor(refundId)).toHaveLength(1);
      expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 1 });
    },
  );

  it("sends a refund a crash left unsent when its own request is retried", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const submissionId = randomUUID();
    const [stranded] = await inTx(venue, (tx) =>
      tx
        .insert(billPaymentRefunds)
        .values({
          billPaymentId: card.id,
          submissionId,
          fingerprint: refundFingerprint(card.id, "5.00", "0.00", REASON),
          appliedAmount: 500,
          reason: REASON,
          authorizedBy: venue.adminId,
          requestedBy: venue.operatorId,
          tillId: venue.deviceTillId,
          state: "pending",
        })
        .returning(),
    );

    const retried = await refund(billId, card.id, { applied: "5.00", submissionId });

    expect(retried.answer.status).toBe(200);
    expect(retried.answer.json).toMatchObject({ refund: { id: stranded!.id, state: "completed" } });
    expect(callsFor(stranded!.id)).toHaveLength(1);
    expect(await onlyRefundOf(card.id)).toMatchObject({ state: "completed", sendCount: 1 });
  });
});

describe("one resolver at a time", () => {
  it("answers a retry, the manager and the loop 'in progress' while the send is still running", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const release = venue.card.holdNextRefund();
    const submissionId = randomUUID();
    const first = refund(billId, card.id, { applied: "5.00", submissionId });
    const row = await heldSendOf(card.id);
    const calls = venue.card.refundCalls.length;

    const retried = await refund(billId, card.id, { applied: "5.00", submissionId });
    const managed = await send(
      managerApp(),
      managerCookie,
      "POST",
      `/management-api/payments/bill-refunds/${row!.id}/resolve`,
    );
    const listed = await send(
      managerApp(),
      managerCookie,
      "GET",
      "/management-api/payments/bill-refunds",
    );
    const attested = await send(
      managerApp(),
      managerCookie,
      "POST",
      `/management-api/payments/bill-refunds/${row!.id}/attest`,
      { outcome: "failed", note: "El panel no muestra nada", pin: "1234" },
    );
    await runLoop();
    release();
    await first;

    expect(retried.answer.json).toMatchObject({ refund: { id: row!.id, state: "pending" } });
    expect(managed.status).toBe(409);
    expect(managed.json).toEqual({ code: "bill.refund_not_stuck", params: { refundId: row!.id } });
    expect(attested.status).toBe(409);
    expect(attested.json).toEqual({ code: "bill.refund_not_stuck", params: { refundId: row!.id } });
    expect((listed.json as unknown as { refundId: string }[]).map((r) => r.refundId)).not.toContain(
      row!.id,
    );
    expect(venue.card.refundCalls).toHaveLength(calls);
    expect(venue.card.lookupCalls.filter((q) => q.refundId === row!.id)).toEqual([]);
    expect(await onlyRefundOf(card.id)).toMatchObject({ state: "completed", sendCount: 1 });
  });

  it("records nothing, and raises an alert, when a refund made at the provider finds its row already failed", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const release = venue.card.holdNextRefund();
    const asked = refund(billId, card.id, { applied: "5.00" });
    const row = await heldSendOf(card.id);
    venue.db.run(
      sql`update bill_payment_refunds set state = 'failed', failed_at = ${new Date().toISOString()} where id = ${row!.id}`,
    );
    release();
    await asked;

    expect(await onlyRefundOf(card.id)).toMatchObject({ state: "failed", providerRefundRef: null });
    expect(await providerRefundsOf(card.id)).toEqual([]);
    const raised = await inTx(venue, (tx) =>
      tx
        .select({ code: incidents.code, params: incidents.params })
        .from(incidents)
        .where(eq(incidents.code, "payment.refund_outcome_conflict")),
    );
    expect(raised.map((r) => r.params)).toContainEqual(
      expect.objectContaining({
        refundId: row!.id,
        billPaymentId: card.id,
        workingOrderId: billId,
      }),
    );
  });
});

describe("design §8 test 22: the manager needs a confirmed outcome", () => {
  const NOTE = "El panel de SumUp muestra la devolución 11233372107 como REFUNDED";
  const attest = (refundId: string, body: Record<string, unknown>, clock?: TrustedClock) =>
    send(
      managerApp(clock),
      managerCookie,
      "POST",
      `/management-api/payments/bill-refunds/${refundId}/attest`,
      body,
    );

  it("refuses to record failed from an empty lookup, and records a confirmed failure with the note and PIN", async () => {
    const { billId, paymentId, refundId } = await pendingRefund();

    const resolved = await withProvider({ window: null }, () =>
      send(
        managerApp(),
        managerCookie,
        "POST",
        `/management-api/payments/bill-refunds/${refundId}/resolve`,
      ),
    );
    const attested = await attest(refundId, { outcome: "failed", note: NOTE, pin: "1234" });

    expect(resolved.status).toBe(409);
    expect(resolved.json).toEqual({
      code: "bill.refund_outcome_unconfirmed",
      params: { refundId, reason: "not_found" },
    });
    expect(attested.status).toBe(200);
    expect(attested.json).toEqual({ outcome: "failed" });
    expect(await onlyRefundOf(paymentId)).toMatchObject({
      state: "failed",
      attestedBy: venue.adminId,
      attestationNote: NOTE,
    });
    expect(await providerRefundsOf(paymentId)).toEqual([]);
    expect((await pay(billId, "cash", "1.00")).answer.status).toBe(200);
  });

  it("records a confirmed refund with the note and PIN on both records", async () => {
    const { paymentId, refundId } = await pendingRefund();

    const attested = await attest(refundId, { outcome: "completed", note: NOTE, pin: "1234" });

    expect(attested.json).toEqual({ outcome: "completed" });
    expect(await onlyRefundOf(paymentId)).toMatchObject({
      state: "completed",
      attestedBy: venue.adminId,
      attestationNote: NOTE,
      providerRefundRef: null,
    });
    expect(await providerRefundsOf(paymentId)).toEqual([{ amount: 500, providerRefundRef: null }]);
  });

  it.each([
    ["a wrong PIN", { outcome: "failed", note: NOTE, pin: "9999" }, 401, "pin.invalid", {}],
    ["no PIN", { outcome: "failed", note: NOTE }, 401, "pin.invalid", {}],
    [
      "a blank note",
      { outcome: "failed", note: "  ", pin: "1234" },
      400,
      "management.request_invalid",
      { field: "note" },
    ],
    [
      "no note",
      { outcome: "failed", pin: "1234" },
      400,
      "management.request_invalid",
      { field: "note" },
    ],
    [
      "another outcome",
      { outcome: "pending", note: NOTE, pin: "1234" },
      400,
      "management.request_invalid",
      { field: "outcome" },
    ],
  ] as const)("refuses %s and changes nothing", async (_name, body, status, code, params) => {
    const { paymentId, refundId } = await pendingRefund();

    const refused = await attest(refundId, body);

    expect(refused.status).toBe(status);
    expect(refused.json).toEqual({ code, params });
    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", attestedBy: null });
  });

  it("refuses the right PIN once too many wrong ones were entered, and changes nothing", async () => {
    const { paymentId, refundId } = await pendingRefund();
    const app = managerApp();
    const path = `/management-api/payments/bill-refunds/${refundId}/attest`;
    for (let i = 0; i <= PIN_THROTTLE_FREE_ATTEMPTS; i += 1) {
      const wrong = await send(app, managerCookie, "POST", path, {
        outcome: "failed",
        note: NOTE,
        pin: "9999",
      });
      expect(wrong.json).toEqual({ code: "pin.invalid", params: {} });
    }

    const refused = await send(app, managerCookie, "POST", path, {
      outcome: "failed",
      note: NOTE,
      pin: "1234",
    });

    expect(refused.status).toBe(429);
    expect(refused.json).toEqual({
      code: "pin.throttled",
      params: { retryAfterSeconds: expect.any(Number) },
    });
    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", attestedBy: null });
  });

  it("starts the wrong-PIN count again after the right PIN", async () => {
    const { refundId } = await pendingRefund();
    const app = managerApp();
    const path = `/management-api/payments/bill-refunds/${refundId}/attest`;
    const wrong = { outcome: "failed", note: NOTE, pin: "9999" };
    for (let i = 0; i < PIN_THROTTLE_FREE_ATTEMPTS; i += 1) {
      await send(app, managerCookie, "POST", path, wrong);
    }
    const accepted = await send(app, managerCookie, "POST", path, { ...wrong, pin: "1234" });

    const again = await send(app, managerCookie, "POST", path, wrong);
    const right = await send(app, managerCookie, "POST", path, { ...wrong, pin: "1234" });

    expect(accepted.json).toEqual({ outcome: "failed" });
    expect(again.json).toEqual({ code: "pin.invalid", params: {} });
    expect(right.json).toEqual({ code: "bill.refund_not_stuck", params: { refundId } });
  });

  it("refuses to record completed for a refund that never left Waitron, and records its failure", async () => {
    const billId = await bill("Pulpo", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const [stranded] = await inTx(venue, (tx) =>
      tx
        .insert(billPaymentRefunds)
        .values({
          billPaymentId: card.id,
          submissionId: randomUUID(),
          fingerprint: "stranded",
          appliedAmount: 500,
          reason: "stranded",
          authorizedBy: venue.adminId,
          requestedBy: venue.operatorId,
          tillId: venue.deviceTillId,
          state: "pending",
        })
        .returning(),
    );

    const completed = await attest(stranded!.id, { outcome: "completed", note: NOTE, pin: "1234" });
    const failed = await attest(stranded!.id, { outcome: "failed", note: NOTE, pin: "1234" });

    expect(completed.status).toBe(409);
    expect(completed.json).toEqual({
      code: "bill.attestation_contradicted",
      params: { id: stranded!.id, evidence: "never_sent" },
    });
    expect(failed.json).toEqual({ outcome: "failed" });
  });

  it("refuses a refund that is no longer pending, and one it does not know", async () => {
    const { refundId } = await pendingRefund();
    await attest(refundId, { outcome: "failed", note: NOTE, pin: "1234" });
    const unknown = randomUUID();

    const again = await attest(refundId, { outcome: "completed", note: NOTE, pin: "1234" });
    const missing = await attest(unknown, { outcome: "completed", note: NOTE, pin: "1234" });

    expect(again.status).toBe(409);
    expect(again.json).toEqual({ code: "bill.refund_not_stuck", params: { refundId } });
    expect(missing.status).toBe(404);
    expect(missing.json).toEqual({ code: "bill.refund_not_found", params: { refundId: unknown } });
  });

  it("raises the alert for a refund pending over an hour, and not for one under it", async () => {
    // On the second till, which no other case here refunds on: an open alert is raised once per
    // till, so another case's pending refund would otherwise hold the till's one alert.
    const billId = await bill("Pulpo", "Croquetas");
    const card = await pay(billId, "card", "20.00", venue.cookie2);
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    await refund(billId, card.id, { applied: "5.00", cookie: venue.cookie2 });
    const refundId = (await onlyRefundOf(card.id)).id;
    const alerts = () =>
      inTx(venue, (tx) =>
        tx
          .select({ params: incidents.params })
          .from(incidents)
          .where(
            and(
              eq(incidents.code, "payment.refund_unresolved"),
              eq(incidents.tillId, venue.device2TillId),
            ),
          ),
      );

    await runLoop(clockPlus(HOUR - 60_000));
    const underAlerts = await alerts();
    const over = await runLoop(clockPlus(HOUR + 60_000));
    const overAlerts = await alerts();

    expect(underAlerts).toEqual([]);
    expect(over.refundsUnresolved).toBeGreaterThanOrEqual(1);
    expect(overAlerts).toEqual([
      {
        params: expect.objectContaining({
          refundId,
          billPaymentId: card.id,
          workingOrderId: billId,
        }) as unknown,
      },
    ]);
  });

  it("lists the pending refunds nothing is driving, with their payment, bill and send", async () => {
    const { billId, paymentId, refundId } = await pendingRefund();

    const listed = await send(
      managerApp(),
      managerCookie,
      "GET",
      "/management-api/payments/bill-refunds",
    );

    expect(listed.status).toBe(200);
    expect(listed.json as unknown as unknown[]).toContainEqual(
      expect.objectContaining({
        refundId,
        billPaymentId: paymentId,
        workingOrderId: billId,
        provider: "fake",
        appliedAmount: "5.00",
        tipAmount: "0.00",
        sendCount: 1,
      }),
    );
  });
});

describe("the provider a card refund goes back through", () => {
  it("is the practice simulator by its name, else the pooled provider, else none", async () => {
    const simulator = { provider: "simulator" } as PaymentProvider;
    const both = refundProvidersOf({ simulator, pool: venue.pool });
    const poolOnly = refundProvidersOf({ pool: venue.pool });
    const neither = refundProvidersOf({});

    expect(await both("simulator")).toBe(simulator);
    expect(await both("fake")).toBe(venue.card);
    expect(await both("manual")).toBeUndefined();
    expect(await poolOnly("simulator")).toBeUndefined();
    expect(await neither("fake")).toBeUndefined();
  });

  it("is none for a provider no contribution declares, and any other failure to build one surfaces", async () => {
    const failing = (error: unknown) =>
      refundProvidersOf({
        pool: { get: () => Promise.reject(error), evict: () => {} },
      });
    const broken = new Error("credential unreadable");

    expect(
      await failing(new AppError("payment.provider_unknown", { providerId: "redsys" }))("redsys"),
    ).toBeUndefined();
    await expect(failing(broken)("sumup")).rejects.toBe(broken);
  });
});

describe("a refund the provider here cannot answer for", () => {
  const resume = (refundId: string, refundProviderFor?: RefundProviderFor) =>
    resumeCardRefund(
      {
        db: venue.db,
        clock: systemClock(),
        ...(refundProviderFor === undefined ? {} : { refundProviderFor }),
      },
      refundId,
      "manager",
    );

  /** The test provider with only the parts named, so a missing method is missing. */
  function partial(parts: Partial<PaymentProvider>): RefundProviderFor {
    const provider = {
      provider: "fake",
      refundResendWindowMs: venue.card.refundResendWindowMs,
      ...parts,
    } as PaymentProvider;
    return () => Promise.resolve(provider);
  }

  it("answers an unknown refund as not found", async () => {
    const unknown = randomUUID();
    await expect(resume(unknown)).rejects.toMatchObject({
      code: "bill.refund_not_found",
      params: { refundId: unknown },
    });
  });

  it("does nothing to a cash refund, which has no provider to ask", async () => {
    const billId = await bill("Pulpo", "Croquetas");
    const { id: paymentId } = await pay(billId, "cash", "20.00");
    expect((await refund(billId, paymentId, { applied: "5.00" })).answer.status).toBe(200);
    const { id: refundId } = await onlyRefundOf(paymentId);

    const resumed = await resume(refundId, (name) => venue.pool.get(name));

    expect(resumed).toMatchObject({ claimed: false, refund: { id: refundId, state: "completed" } });
  });

  const providers: [string, () => RefundProviderFor | undefined][] = [
    ["no provider is served here", () => undefined],
    ["the provider cannot look refunds up", () => partial({ sendRefund: () => Promise.reject() })],
    [
      "the provider's lookup fails",
      () =>
        partial({
          sendRefund: () => Promise.reject(),
          lookupRefund: () => Promise.reject(new Error("unreachable")),
        }),
    ],
  ];
  it.each(providers)(
    "keeps a sent refund pending and sends nothing when %s",
    async (_name, providerFor) => {
      const { billId, paymentId, refundId } = await pendingRefund();
      const sends = callsFor(refundId).length;

      const resumed = await resume(refundId, providerFor());

      expect(resumed).toMatchObject({
        claimed: true,
        lookup: { kind: "unreachable" },
        resent: false,
        refund: { state: "pending", sendCount: 1 },
      });
      expect(callsFor(refundId)).toHaveLength(sends);
      expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 1 });
      expect((await pay(billId, "cash", "1.00")).answer.json.code).toBe("bill.refund_in_progress");
    },
  );

  it("records the loop's failure to reach a provider against the refund, and carries on", async () => {
    const { paymentId, refundId } = await pendingRefund();

    const pass = await settlePendingBillPayments({
      db: venue.db,
      backend: venue.backend,
      clock: systemClock(),
      cfg: venue.cfg,
      refundProviderFor: () => Promise.reject(new Error("pool down")),
    });

    expect(pass.errors).toContainEqual({ refundId, error: "Error: pool down" });
    expect(await onlyRefundOf(paymentId)).toMatchObject({ state: "pending", sendCount: 1 });
    expect((await runLoop()).errors).not.toContainEqual(expect.objectContaining({ refundId }));
  });

  it("leaves a refund that never left pending when a retry finds no way to send it", async () => {
    const billId = await bill("Pulpo", "Croquetas", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    const [stranded] = await inTx(venue, (tx) =>
      tx
        .insert(billPaymentRefunds)
        .values({
          billPaymentId: card.id,
          submissionId: randomUUID(),
          fingerprint: "stranded",
          appliedAmount: 500,
          reason: "stranded",
          authorizedBy: venue.adminId,
          requestedBy: venue.operatorId,
          tillId: venue.deviceTillId,
          state: "pending",
        })
        .returning(),
    );

    const resumed = await resumeCardRefund(
      { db: venue.db, clock: systemClock(), refundProviderFor: partial({}) },
      stranded!.id,
      "retry",
    );

    expect(resumed).toMatchObject({
      claimed: true,
      lookup: null,
      resent: false,
      refund: { state: "pending", sendCount: 0, sentAt: null },
    });
    expect(await onlyRefundOf(card.id)).toMatchObject({ state: "pending", sendCount: 0 });
  });
});

describe("design §8 test 23: the invoice waits for the refund", () => {
  it("refuses the reduction that would issue it while the refund is pending, then issues one invoice once it completes", async () => {
    const billId = await bill("Botella tinto", "Pulpo", "Croquetas");
    const card = await pay(billId, "card", "30.00");
    await pay(billId, "cash", "20.00");
    venue.card.scriptNextRefund({ made: "completed", answer: LOST });
    await refund(billId, card.id, { applied: "10.00" });

    const reduction = await send(
      venue.app,
      venue.cookie,
      "DELETE",
      `/api/working-orders/${billId}/lines/3`,
    );

    expect(reduction.status).toBe(409);
    expect(reduction.json).toEqual({
      code: "bill.refund_in_progress",
      params: { workingOrderId: billId },
    });
    expect(registroCount(venue, billId)).toBe(0);

    await runLoop();
    const balance = await send(
      venue.app,
      venue.cookie,
      "GET",
      `/api/working-orders/${billId}/payments`,
    );
    expect(balance.json).toMatchObject({ total: "60.00", received: "40.00", outstanding: "20.00" });
    const jobsBefore = new Set((await documentJobs()).map((job) => job.id));
    const last = await pay(billId, "cash", "20.00");

    expect(last.answer.status).toBe(200);
    expect(last.answer.json).toMatchObject({ invoice: { total: "60.00" } });
    expect(registroCount(venue, billId)).toBe(1);
    const tenders = await tendersOfBill(venue, billId);
    expect(tenders.map((t) => [t.method, t.amount]).sort()).toEqual(
      [
        ["card", 2000],
        ["cash", 2000],
        ["cash", 2000],
      ].sort(),
    );
    const tickets = (await documentJobs())
      .filter((job) => !jobsBefore.has(job.id))
      .map((job) => printedLines(job.payload).map((line) => line.trim().replace(/\s+/g, " ")))
      .filter((printed) => printed.some((line) => line.startsWith("TOTAL")));
    expect(tickets).toHaveLength(1);
    const printed = tickets[0]!;
    const start = printed.findIndex((line) => line.startsWith("TOTAL"));
    expect(
      printed.slice(start, printed.indexOf("VERI*FACTU", start) + 1).filter((l) => l !== ""),
    ).toEqual([
      "TOTAL 60,00 €",
      "Tarjeta 30,00 €",
      "Devolución -10,00 €",
      "Efectivo 20,00 €",
      "Efectivo 20,00 €",
      "VERI*FACTU",
    ]);
  });

  it("does not issue the invoice of a bill a pending refund would leave short, whoever asks", async () => {
    const billId = await bill("Pulpo", "Croquetas");
    const card = await pay(billId, "card", "20.00");
    venue.card.scriptNextRefund({ made: false, answer: LOST });
    await refund(billId, card.id, { applied: "10.00" });
    // A write that bypasses every writer's lock: only issuance's own check is left to hold.
    venue.db.run(
      sql`delete from working_order_lines where working_order_id = ${billId} and line_no = 2`,
    );
    const { issueIfFullyPaid } = await import("./bill-payments.js");

    const issued = await inTx(venue, (tx) =>
      issueIfFullyPaid(
        tx,
        { db: venue.db, backend: venue.backend, clock: venue.clock },
        venue.cfg,
        billId,
      ),
    );

    expect(issued).toBeNull();
    expect(registroCount(venue, billId)).toBe(0);
  });
});
