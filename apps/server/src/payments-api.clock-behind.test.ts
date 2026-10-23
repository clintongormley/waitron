import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { withTransaction, workingOrders } from "@waitron/db";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import type { TrustedClock } from "@waitron/fiscal";
import { startManagementSession } from "@waitron/identity";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { decimal, workingOrderId as brandWorkingOrderId } from "@waitron/shared";
import { insertAttempting, type CardProviderContribution } from "@waitron/payments";
import { createStripeCardProvider, type MakeStripe } from "@waitron/payments-stripe";
import { provisionBillVenue, send, tabWith, type BillVenue } from "./testing/bill-venue.js";
import { mountPaymentsApi } from "./payments-api.js";
import { orderDeviceOrigin } from "./testing/session-device.js";
import { systemClock } from "./till-backend.js";
import "./errors.js";

let venue: BillVenue;
let managerCookie: string;

// Every case reads NOW, the latest record's time, and builds each clock from it. Only the setup
// records a sale.
useVenueDb({
  resetPerTest: false,
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
  setup: async (db) => {
    venue = await provisionBillVenue(db);
    const billId = await tabWith(venue, "Paella");
    const settled = await send(
      venue.app,
      venue.cookie,
      "POST",
      `/api/working-orders/${billId}/payments`,
      {
        submissionId: randomUUID(),
        kind: "contribution",
        amount: "35.00",
        method: "cash",
        tendered: "35.00",
        applied: "35.00",
        tip: "0.00",
      },
    );
    if (settled.status !== 200) throw new Error(`setup sale answered ${settled.status}`);
    const session = await withTransaction(db, (tx) =>
      startManagementSession(tx, { personId: venue.adminId }),
    );
    managerCookie = `${MANAGEMENT_COOKIE}=${session.token}`;
    await withTransaction(db, (tx) =>
      putCredential(tx, RING, {
        purpose: "payments.stripe",
        value: {
          secretKey: "sk_test_ok",
          webhookSecret: "whsec_x",
          successUrl: "https://x/s",
          cancelUrl: "https://x/c",
        },
      }),
    );
  },
});

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const RING = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});

// The fake provider served under the Stripe seat's credential, so a stuck payment of it is asked.
const fakeSeat: CardProviderContribution = {
  ...createStripeCardProvider((() => {
    throw new Error("payments-api.clock-behind.test: the seat's own Stripe SDK is never built");
  }) as unknown as MakeStripe),
  providerId: "fake",
};

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

function paymentsAt(ms: number): Hono {
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: venue.db,
      backend: venue.backend,
      clock: clockAt(ms),
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

const attest = (outcome: string) => ({ outcome, note: "Checked at the provider", pin: "1234" });

const ROUTES: {
  name: string;
  path: (id: string) => string;
  body?: Record<string, unknown>;
  /** What the route answers for an unknown id once past the check. */
  next: { status: number; code: string };
}[] = [
  {
    name: "stuck resolve",
    path: (id) => `/management-api/payments/stuck/${id}/resolve`,
    next: { status: 409, code: "payment.not_stuck" },
  },
  {
    name: "bill payment resolve",
    path: (id) => `/management-api/payments/bill-payments/${id}/resolve`,
    next: { status: 404, code: "bill.payment_not_found" },
  },
  {
    name: "bill payment attest",
    path: (id) => `/management-api/payments/bill-payments/${id}/attest`,
    next: { status: 404, code: "bill.payment_not_found" },
    body: attest("received"),
  },
  {
    name: "held outcome",
    path: (id) => `/management-api/payments/held/${id}/outcome`,
    next: { status: 404, code: "payment.hold_not_found" },
    body: { outcome: "kept", note: "Kept", pin: "1234" },
  },
  {
    name: "bill refund resolve",
    path: (id) => `/management-api/payments/bill-refunds/${id}/resolve`,
    next: { status: 404, code: "bill.refund_not_found" },
  },
  {
    name: "bill refund attest",
    path: (id) => `/management-api/payments/bill-refunds/${id}/attest`,
    next: { status: 404, code: "bill.refund_not_found" },
    body: attest("completed"),
  },
  {
    name: "tender refund resolve",
    path: (id) => `/management-api/payments/tender-refunds/${id}/resolve`,
    next: { status: 404, code: "tender.refund_not_found" },
  },
  {
    name: "tender refund attest",
    path: (id) => `/management-api/payments/tender-refunds/${id}/attest`,
    next: { status: 404, code: "tender.refund_not_found" },
    body: attest("completed"),
  },
];

describe.each(ROUTES)("$name", ({ path, body, next }) => {
  const post = (app: Hono, cookie: string) =>
    send(app, cookie, "POST", path(randomUUID()), body ?? {});

  it("refuses clock.behind_chain while the clock reads a day behind the latest record", async () => {
    const behind = nowMs() - DAY;
    const answer = await post(paymentsAt(behind), managerCookie);
    expect(answer).toEqual({ status: 409, json: behindChain(behind) });
  });

  it("asks for a session first, saying nothing about the records", async () => {
    const answer = await post(paymentsAt(nowMs() - DAY), "");
    expect(answer.status).toBe(401);
    expect(answer.json.code).toBe("management_session.required");
  });

  it("goes past the check a minute behind the latest record", async () => {
    const answer = await post(paymentsAt(nowMs() - MINUTE), managerCookie);
    expect(answer.status).toBe(next.status);
    expect(answer.json.code).toBe(next.code);
  });
});

it("refuses clock.unusable with 409 under a clock in 2001", async () => {
  const answer = await send(
    paymentsAt(Date.parse("2001-06-01T10:00:00.000Z")),
    managerCookie,
    "POST",
    `/management-api/payments/bill-refunds/${randomUUID()}/resolve`,
    {},
  );
  expect(answer).toEqual({
    status: 409,
    json: {
      code: "clock.unusable",
      params: { clockAt: "2001-06-01T10:00:00.000Z", offsetMinutes: 60 },
    },
  });
});

it("asks the provider nothing about a real stuck payment while the clock reads behind, and asks it a minute behind", async () => {
  const orderId = await tabWith(venue, "Caña");
  const origin = await orderDeviceOrigin(venue.db, orderId);
  await withTransaction(venue.db, async (tx) =>
    insertAttempting(tx, {
      origin,
      workingOrderId: brandWorkingOrderId(orderId),
      provider: "fake",
      paymentRef: randomUUID(),
      amount: decimal("3.00"),
    }),
  );
  await venue.db
    .update(workingOrders)
    .set({ paymentAttemptAt: new Date(nowMs() - MINUTE).toISOString() })
    .where(eq(workingOrders.id, orderId));
  const [stuck] = venue.db.all<{ id: string }>(
    sql`select id from payments where working_order_id = ${orderId}`,
  );
  const collects = venue.card.collectCalls.length;
  const asked = venue.card.abandonedAttemptCalls.length;

  const behind = nowMs() - DAY;
  const answer = await send(
    paymentsAt(behind),
    managerCookie,
    "POST",
    `/management-api/payments/stuck/${stuck!.id}/resolve`,
  );

  expect(answer).toEqual({ status: 409, json: behindChain(behind) });
  expect(venue.card.collectCalls.length).toBe(collects);
  expect(venue.card.abandonedAttemptCalls.length).toBe(asked);
  const [row] = venue.db.all<{ state: string }>(
    sql`select state from payments where id = ${stuck!.id}`,
  );
  expect(row!.state).toBe("attempting");

  const inside = await send(
    paymentsAt(nowMs() - MINUTE),
    managerCookie,
    "POST",
    `/management-api/payments/stuck/${stuck!.id}/resolve`,
  );
  expect(inside.json.code).toBe("payment.outcome_unknown");
  expect(venue.card.abandonedAttemptCalls.length).toBe(asked + 1);
  expect(venue.card.collectCalls.length).toBe(collects);
});
