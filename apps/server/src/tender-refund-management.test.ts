import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  sales,
  saleLines,
  tenders,
  saleSettlements,
  tenderRefunds,
  workingOrders,
  drawerOpens,
  printJobs,
  locations,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { managementSessions, persons, PIN_THROTTLE_FREE_ATTEMPTS } from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { payments, type RefundLookup } from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { provisionOrderVenue, type OrderVenue } from "./testing/order-venue.js";
import { inTx, send } from "./testing/bill-venue.js";
import { mountPaymentsApi } from "./payments-api.js";
import {
  claimTenderRefund,
  tenderRefundIsLive,
  attestTenderRefund,
} from "./tender-refund-sends.js";
import { recordAttendanceFact, type AttendanceRecorder } from "./attendance-capture.js";
import {
  watchDerivationsAndLock,
  watchedOrder,
  watchedDerivationCount,
} from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);
const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const ring = loadKeyRing({
  WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
  WAITRON_CREDENTIALS_KEY_VERSION: "1",
});
let venue: OrderVenue;
let app: Hono;
let sequence: number;
let attendance: AttendanceRecorder;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
  sequence = 910_000;
  attendance = recordAttendanceFact;
  app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: store.db,
      cfg: venue.cfg,
      clock: venue.clock,
      backend: venue.backend,
      pool: venue.pool,
      providers: [],
      ring,
      environment: "preproduction",
      attendance: (tx, fact) => attendance(tx, fact),
    },
    () => {},
  );
});
afterEach(() => vi.restoreAllMocks());
const path = (id?: string, action?: string) =>
  `/management-api/payments/tender-refunds${id === undefined ? "" : `/${id}/${action}`}`;
const list = (cookie = venue.adminDashboard) => send(app, cookie, "GET", path());
const resolve = (id: string, cookie = venue.adminDashboard) =>
  send(app, cookie, "POST", path(id, "resolve"), {});
const note = "Provider support confirmed this request's outcome: case 42";
const attest = (
  id: string,
  body: unknown = { outcome: "completed", note, pin: "1234" },
  cookie = venue.adminDashboard,
) => send(app, cookie, "POST", path(id, "attest"), body);
const row = async (id: string) =>
  (await store.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, id)))[0]!;
async function snapshot() {
  return inTx(venue, async (tx) => ({
    refunds: await tx.select().from(tenderRefunds),
    evidence: await tx.select().from(paymentRefunds),
    attendance: (await tx.execute(sql`select * from attendance_operation_facts order by sequence`))
      .rows,
    drawers: await tx.select().from(drawerOpens),
    prints: await tx.select().from(printJobs),
  }));
}
async function originalFacts() {
  return inTx(venue, async (tx) => ({
    sales: await tx.select().from(sales),
    lines: await tx.select().from(saleLines),
    tenders: await tx.select().from(tenders),
    settlements: await tx.select().from(saleSettlements),
    fiscal: (await tx.execute(sql`select * from registros_facturacion order by id`)).rows,
  }));
}
async function target(method: "cash" | "card" = "cash", manual = false) {
  const saleId = randomUUID(),
    tenderId = randomUUID(),
    orderId = randomUUID();
  await inTx(venue, async (tx) => {
    await tx.insert(workingOrders).values({
      id: orderId,
      source: "device",
      deviceId: venue.deviceId,
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
      orderNumber: ++sequence,
    });
    await tx.insert(sales).values({
      id: saleId,
      source: "device",
      deviceId: venue.deviceId,
      nodeId: venue.cfg.nodeId,
      seriesId: venue.seriesId,
      invoiceNumber: ++sequence,
      issuedAt: new Date().toISOString(),
      issuedOffsetMinutes: 0,
      total: 1000,
      vatBreakdown: [],
      locale: "es-ES",
      invoiceLocales: ["es-ES"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
      workingOrderId: orderId,
    });
    await tx
      .insert(tenders)
      .values({ id: tenderId, saleId, method, amount: 1000, settledAt: new Date().toISOString() });
    await tx.insert(saleSettlements).values({ saleId, settledAt: new Date().toISOString() });
    if (method === "card")
      await tx.insert(payments).values({
        saleId,
        source: "device",
        deviceId: venue.deviceId,
        provider: manual ? "manual" : "fake",
        paymentRef: randomUUID(),
        state: "captured",
        amount: 1000,
        workingOrderId: orderId,
      });
  });
  return { saleId, tenderId };
}

async function pending(method: "cash" | "card" = "card", manual = false) {
  const t = await target(method, manual);
  venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
  const created = await send(
    venue.app,
    venue.supervisorTill,
    "POST",
    `/api/transactions/${t.saleId}/refunds`,
    {
      submissionId: randomUUID(),
      tenderId: t.tenderId,
      appliedAmount: "2.00",
      tipAmount: "0.00",
      reason: "Goodwill",
      cashConfirmed: true,
      ...(manual
        ? { manualConfirmed: true, override: { personId: venue.adminId, pin: "1234" } }
        : {}),
    },
  );
  expect(created).toMatchObject({
    status: 200,
    json: { state: method === "card" && !manual ? "pending" : "completed" },
  });
  return { ...t, id: created.json.id as string };
}
async function unsent(locationId = venue.cfg.locationId as string) {
  const t = await target("card"),
    id = randomUUID();
  const [capture] = await store.db.select().from(payments).where(eq(payments.saleId, t.saleId));
  await store.db.insert(tenderRefunds).values({
    id,
    ...t,
    submissionId: randomUUID(),
    fingerprint: "abandoned",
    appliedAmount: 200,
    tipAmount: 0,
    reason: "Goodwill",
    authorizedBy: venue.supervisorId,
    requestedBy: venue.supervisorId,
    source: "device",
    deviceId: venue.deviceId,
    nodeId: venue.cfg.nodeId,
    locationId,
    method: "card",
    provider: "fake",
    providerPaymentRef: capture!.paymentRef,
    state: "pending",
  });
  return { ...t, id };
}

it("lists only this location's unresolved connected returns in stable order, with decimal money and no live resolver", async () => {
  const a = await unsent(),
    b = await pending(),
    c = await pending();
  await pending("cash");
  await pending("card", true);
  const foreignLocation = randomUUID();
  await store.db.insert(locations).values({
    ...(await store.db.select().from(locations))[0]!,
    id: foreignLocation,
    name: "Other",
  });
  await unsent(foreignLocation);
  const expected = await list();
  expect(expected).toMatchObject({
    status: 200,
    json: [
      {
        id: a.id,
        saleId: a.saleId,
        state: "pending",
        appliedAmount: "2.00",
        tipAmount: "0.00",
        completedAt: null,
      },
      { id: b.id, saleId: b.saleId, state: "pending" },
      { id: c.id, saleId: c.saleId, state: "pending" },
    ],
  });
  const release = claimTenderRefund(store.db, b.id);
  try {
    expect((await list()).json).toEqual(
      (expected.json as unknown as { id: string }[]).filter((r) => r.id !== b.id),
    );
  } finally {
    release();
  }
});

it.each(["none", "staff", "expired", "suspended"] as const)(
  "requires an active payments manager on every endpoint (%s)",
  async (kind) => {
    const t = await pending();
    let cookie = venue.adminDashboard,
      http = 403,
      code = "authorization.not_permitted";
    if (kind === "none") {
      cookie = "";
      http = 401;
      code = "management_session.required";
    }
    if (kind === "staff") cookie = venue.staffDashboard;
    if (kind === "expired") {
      await store.db.update(managementSessions).set({ lastSeenAt: "2000-01-01T00:00:00.000Z" });
      http = 401;
      code = "management_session.expired";
    }
    if (kind === "suspended") {
      await store.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, venue.adminId));
      code = "person.suspended";
    }
    const before = await snapshot();
    for (const request of [
      () => list(cookie),
      () => resolve(t.id, cookie),
      () => attest(t.id, undefined, cookie),
    ])
      expect(await request()).toMatchObject({ status: http, json: { code } });
    expect(await snapshot()).toEqual(before);
    expect(venue.card.lookupCalls).toHaveLength(0);
    expect(venue.card.refundCalls).toHaveLength(1);
  },
);

it.each(["completed", "failed"] as const)(
  "records provider %s evidence atomically without another send or fiscal change",
  async (outcome) => {
    const t = await pending(),
      before = await originalFacts();
    venue.card.scriptLookups({
      kind: "match",
      providerRefundRef: "returned-42",
      outcome,
      providerStatus: outcome === "completed" ? "succeeded" : "failed",
    });
    expect(await resolve(t.id.toUpperCase())).toMatchObject({ status: 200, json: { outcome } });
    expect(await row(t.id)).toMatchObject({
      state: outcome,
      providerRefundRef: "returned-42",
      providerStatus: outcome,
      nextRetryAt: null,
      attestedBy: null,
    });
    expect((await snapshot()).evidence).toHaveLength(outcome === "completed" ? 1 : 0);
    expect(venue.card.refundCalls).toHaveLength(1);
    expect(await originalFacts()).toEqual(before);
    const after = await snapshot();
    expect(await resolve(t.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_not_stuck" },
    });
    expect(await attest(t.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_not_stuck" },
    });
    expect(await snapshot()).toEqual(after);
    expect((await list()).json).toEqual([]);
  },
);

it.each([
  { kind: "none" },
  { kind: "unreachable" },
  { kind: "ambiguous", candidates: 2 },
  { kind: "match", providerRefundRef: "pending-42", outcome: "pending", providerStatus: "pending" },
] satisfies RefundLookup[])(
  "retains reservations for unconfirmed evidence %j",
  async (evidence) => {
    const t = await pending();
    venue.card.refundResendWindowMs = null;
    venue.card.scriptLookups(evidence);
    expect(await resolve(t.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_outcome_unconfirmed" },
    });
    expect(await row(t.id)).toMatchObject({
      state: "pending",
      completedAt: null,
      failedAt: null,
      attestedBy: null,
    });
    expect((await snapshot()).evidence).toHaveLength(0);
    expect(venue.card.refundCalls).toHaveLength(1);
    expect(venue.card.lookupCalls).toHaveLength(1);
  },
);

it("resends only the original stable key within the provider window", async () => {
  const t = await pending();
  venue.card.scriptLookups({ kind: "none" });
  expect(await resolve(t.id)).toMatchObject({ status: 200, json: { outcome: "completed" } });
  expect(venue.card.refundCalls.map((c) => c.idempotencyKey)).toEqual([`tr_${t.id}`, `tr_${t.id}`]);
  expect(await row(t.id)).toMatchObject({ state: "completed", sendCount: 2 });
});

it("does not resend at the provider window boundary", async () => {
  const t = await pending();
  venue.card.refundResendWindowMs = 0;
  venue.card.scriptLookups({ kind: "none" });
  expect(await resolve(t.id)).toMatchObject({
    status: 409,
    json: { code: "tender.refund_outcome_unconfirmed" },
  });
  expect(venue.card.refundCalls).toHaveLength(1);
  expect((await row(t.id)).state).toBe("pending");
});

it("fails an abandoned unsent reservation without a provider call", async () => {
  const t = await unsent();
  expect(await resolve(t.id)).toMatchObject({ status: 200, json: { outcome: "failed" } });
  expect(await row(t.id)).toMatchObject({ state: "failed", sentAt: null, sendCount: 0 });
  expect(venue.card.refundCalls).toHaveLength(0);
  expect(venue.card.lookupCalls).toHaveLength(0);
});

it.each(["completed", "failed"] as const)(
  "keeps a PIN-confirmed provider %s attestation with actor, time and trimmed note",
  async (outcome) => {
    const t = await pending(),
      before = await originalFacts(),
      lower = Date.now();
    expect(await attest(t.id, { outcome, note: `  ${note}  `, pin: "1234" })).toMatchObject({
      status: 200,
      json: { outcome },
    });
    const saved = await row(t.id);
    expect(saved).toMatchObject({
      state: outcome,
      attestedBy: venue.adminId,
      attestationNote: note,
      providerRefundRef: null,
      nextRetryAt: null,
    });
    expect(
      Date.parse((outcome === "completed" ? saved.completedAt : saved.failedAt)!),
    ).toBeGreaterThanOrEqual(lower);
    const effects = await snapshot();
    expect(effects.evidence).toHaveLength(outcome === "completed" ? 1 : 0);
    if (outcome === "completed")
      expect(effects.evidence[0]).toMatchObject({ amount: 200, authorizedBy: venue.adminId });
    expect(effects.attendance).toContainEqual(
      expect.objectContaining({
        key: t.id,
        outcome: outcome === "completed" ? "qualifying" : "refused",
      }),
    );
    expect(venue.card.lookupCalls).toHaveLength(0);
    expect(venue.card.refundCalls).toHaveLength(1);
    expect(await originalFacts()).toEqual(before);
  },
);

it.each([
  { outcome: "pending", note, pin: "1234" },
  { outcome: null, note, pin: "1234" },
  { outcome: ["completed"], note, pin: "1234" },
  { outcome: "completed", note: "  ", pin: "1234" },
  { outcome: "completed", note: undefined, pin: "1234" },
])("refuses invalid attestation %j before changing money", async (body) => {
  const t = await pending(),
    before = await snapshot();
  expect(await attest(t.id, body)).toMatchObject({
    status: 400,
    json: { code: "management.request_invalid" },
  });
  expect(await snapshot()).toEqual(before);
});

it.each([undefined, null, 1234, "0000"])("refuses invalid own PIN %j", async (pin) => {
  const t = await pending(),
    before = await snapshot();
  expect(await attest(t.id, { outcome: "completed", note, pin })).toMatchObject({
    status: 401,
    json: { code: "pin.invalid" },
  });
  expect(await snapshot()).toEqual(before);
});

it("cannot attest completion for a request never sent, but can confirm its failure", async () => {
  const t = await unsent(),
    before = await snapshot();
  expect(await attest(t.id)).toMatchObject({
    status: 409,
    json: { code: "tender.attestation_contradicted" },
  });
  expect(await snapshot()).toEqual(before);
  expect(await attest(t.id, { outcome: "failed", note, pin: "1234" })).toMatchObject({
    status: 200,
    json: { outcome: "failed" },
  });
  expect(venue.card.refundCalls).toHaveLength(0);
});

it("refuses another location's return without any provider or money side effect", async () => {
  const other = randomUUID();
  await store.db
    .insert(locations)
    .values({ ...(await store.db.select().from(locations))[0]!, id: other, name: "Other" });
  const t = await unsent(other),
    before = await snapshot();
  expect((await list()).json).toEqual([]);
  for (const request of [() => resolve(t.id), () => attest(t.id)])
    expect(await request()).toMatchObject({
      status: 404,
      json: { code: "tender.refund_not_found" },
    });
  expect(await snapshot()).toEqual(before);
  expect(venue.card.lookupCalls).toHaveLength(0);
  expect(venue.card.refundCalls).toHaveLength(0);
});

it("excludes and refuses a live attempt until its actual resolver releases it", async () => {
  const t = await pending(),
    before = await snapshot(),
    release = claimTenderRefund(store.db, t.id);
  try {
    expect((await list()).json).toEqual([]);
    for (const request of [() => resolve(t.id), () => attest(t.id)])
      expect(await request()).toMatchObject({
        status: 409,
        json: { code: "tender.refund_not_stuck" },
      });
    expect(await snapshot()).toEqual(before);
    expect(venue.card.lookupCalls).toHaveLength(0);
  } finally {
    release();
  }
  expect(await attest(t.id, { outcome: "failed", note, pin: "1234" })).toMatchObject({
    status: 200,
    json: { outcome: "failed" },
  });
});

it("rolls back attestation, provider evidence and terminal state if attendance fails", async () => {
  const t = await pending(),
    before = await snapshot();
  attendance = async () => {
    throw new Error("attendance fault");
  };
  expect((await attest(t.id)).status).toBe(500);
  expect(await snapshot()).toEqual(before);
  attendance = recordAttendanceFact;
  expect((await attest(t.id)).status).toBe(200);
});

it("derives the manager PIN outside the writer and rechecks suspension before recording", async () => {
  const t = await pending(),
    before = await snapshot();
  watchDerivationsAndLock(store.db, "1234", () =>
    withTransaction(store.db, (tx) =>
      tx.update(persons).set({ status: "suspended" }).where(eq(persons.id, venue.adminId)),
    ),
  );
  expect(await attest(t.id)).toMatchObject({ status: 403, json: { code: "person.suspended" } });
  expect(await watchedOrder()).toEqual(["writer", "derived"]);
  expect(await snapshot()).toEqual(before);
});

it("serializes concurrent PIN attempts and stops deriving at the throttle limit", async () => {
  const t = await pending();
  watchDerivationsAndLock(store.db, "0000");
  const answers = await Promise.all(
    Array.from({ length: PIN_THROTTLE_FREE_ATTEMPTS + 2 }, () =>
      attest(t.id, { outcome: "failed", note, pin: "0000" }),
    ),
  );
  expect(answers.filter((r) => r.json.code === "pin.invalid")).toHaveLength(
    PIN_THROTTLE_FREE_ATTEMPTS + 1,
  );
  expect(answers.filter((r) => r.json.code === "pin.throttled")).toHaveLength(1);
  expect(watchedDerivationCount()).toBe(PIN_THROTTLE_FREE_ATTEMPTS + 1);
  expect(await attest(t.id, { outcome: "failed", note, pin: "1234" })).toMatchObject({
    status: 429,
    json: { code: "pin.throttled" },
  });
  expect((await row(t.id)).state).toBe("pending");
});

it("returns missing resource refusals and never touches another refund", async () => {
  const t = await pending(),
    before = await snapshot();
  for (const id of [randomUUID(), "bad-id"])
    for (const request of [() => resolve(id), () => attest(id)])
      expect(await request()).toMatchObject({
        status: id === "bad-id" ? 400 : 404,
        json: { code: id === "bad-id" ? "shared.invalid_id" : "tender.refund_not_found" },
      });
  expect(await snapshot()).toEqual(before);
  expect((await row(t.id)).state).toBe("pending");
});

it("releases its resolver if the authorizing transaction fails to commit", async () => {
  const t = await unsent();
  const original = store.db.withWriteLock;
  const failure = vi.spyOn(store.db, "withWriteLock").mockImplementationOnce((body) =>
    original(async () => {
      await body();
      throw new Error("commit fault");
    }),
  );
  try {
    expect((await resolve(t.id)).status).toBe(500);
    expect(tenderRefundIsLive(store.db, t.id)).toBe(false);
    expect((await row(t.id)).state).toBe("pending");
  } finally {
    failure.mockRestore();
  }
  expect(await resolve(t.id)).toMatchObject({ status: 200, json: { outcome: "failed" } });
});

it("takes one live resolver before provider I/O and refuses competing manager actions", async () => {
  const t = await pending();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((done) => {
    enter = done;
  });
  const held = new Promise<void>((done) => {
    release = done;
  });
  const lookup = vi.spyOn(venue.card, "lookupRefund").mockImplementation(async () => {
    enter();
    await held;
    return {
      kind: "match",
      providerRefundRef: "one-return",
      outcome: "completed",
      providerStatus: "succeeded",
    };
  });
  const first = resolve(t.id);
  try {
    await entered;
    expect((await list()).json).toEqual([]);
    expect(await resolve(t.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_not_stuck" },
    });
    expect(await attest(t.id)).toMatchObject({
      status: 409,
      json: { code: "tender.refund_not_stuck" },
    });
    expect(lookup).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await first;
  }
  expect(await first).toMatchObject({ status: 200, json: { outcome: "completed" } });
  expect((await snapshot()).evidence).toHaveLength(1);
  expect(tenderRefundIsLive(store.db, t.id)).toBe(false);
});

it("uses the transaction-owning confirmed-outcome helper without a second provider send", async () => {
  const t = await pending();
  const result = await attestTenderRefund(
    { db: store.db, clock: venue.clock, attendance: recordAttendanceFact },
    t.id,
    "failed",
    { attestedBy: venue.adminId, note },
  );
  expect(result).toMatchObject({ id: t.id, state: "failed", completedAt: null });
  expect(await row(t.id)).toMatchObject({
    attestedBy: venue.adminId,
    attestationNote: note,
    failedAt: expect.any(String),
  });
  expect(venue.card.refundCalls).toHaveLength(1);
  expect(venue.card.lookupCalls).toHaveLength(0);
});

it.each([null, [], 42, "body", {}])(
  "refuses an attestation without named fields: %j",
  async (body) => {
    const t = await pending(),
      before = await snapshot();
    expect(await attest(t.id, body)).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid" },
    });
    expect(await snapshot()).toEqual(before);
  },
);

it("allows another writer to commit while a valid manager PIN is being derived", async () => {
  const t = await pending();
  watchDerivationsAndLock(store.db, "1234", () =>
    withTransaction(store.db, (tx) => tx.execute(sql`select 1`)),
  );
  expect(await attest(t.id)).toMatchObject({ status: 200, json: { outcome: "completed" } });
  expect(await watchedOrder()).toEqual(["writer", "derived"]);
  expect((await snapshot()).evidence).toHaveLength(1);
});

it("gives a manager the original invoice and provider reference to identify the refund", async () => {
  const t = await pending();
  const [original] = await store.db.select().from(sales).where(eq(sales.id, t.saleId));
  const saved = await row(t.id);
  const result = await list();
  expect(result.status).toBe(200);
  expect(result.json).toEqual([
    expect.objectContaining({
      id: t.id,
      invoiceNumber: `A/${original!.invoiceNumber}`,
      reason: saved.reason,
      provider: "fake",
      providerPaymentRef: saved.providerPaymentRef,
    }),
  ]);
});
