import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTransaction, workingOrders } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import {
  createPinThrottle,
  hashPin,
  persons,
  PIN_THROTTLE_FREE_ATTEMPTS,
  startManagementSession,
} from "@waitron/identity";
import { loadKeyRing } from "@waitron/credentials";
import { currentIncidentsOf, markIncidentHandled, recordIncidentOnce } from "@waitron/core";
import { FakeFiscalBackend } from "@waitron/fiscal/src/testing/fake-backend.js";
import { decimal, deviceOrigin, locationId, nodeId } from "@waitron/shared";
import {
  getPaymentByRef,
  insertCapturedPayment,
  recordHold,
  refreshHeldAlert,
} from "@waitron/payments";
import { seedWorkingOrder } from "@waitron/payments/test/seed.js";
import { MANAGEMENT_COOKIE } from "@waitron/server-kit";
import { mountPaymentsApi } from "./payments-api.js";
import { systemClock } from "./till-backend.js";
import { watchDerivationsAndLock, watchedOrder } from "./testing/watched-scrypt.js";

vi.mock("node:crypto", async (importOriginal) =>
  (await import("./testing/watched-scrypt.js")).watchedCrypto(await importOriginal()),
);

const suite = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });

const HELD = "payment.reconcile_held";
const sink = {
  raise: recordIncidentOnce,
  current: currentIncidentsOf,
  handle: markIncidentHandled,
};

let nifCounter = 0;

async function setup() {
  nifCounter += 1;
  const seeded = await seedWorkingOrder(suite.db, `${String(30_000_000 + nifCounter)}K`);
  const [manager] = await suite.db
    .insert(persons)
    .values({ displayName: "The Manager", role: "manager", pinHash: hashPin("1234") })
    .returning({ id: persons.id });
  const [staff] = await suite.db
    .insert(persons)
    .values({ displayName: "The Clerk", role: "staff", pinHash: hashPin("5678") })
    .returning({ id: persons.id });
  const sessions = await withTransaction(suite.db, async (tx) => ({
    manager: (await startManagementSession(tx, { personId: manager!.id })).token,
    staff: (await startManagementSession(tx, { personId: staff!.id })).token,
  }));
  const app = new Hono();
  mountPaymentsApi(
    app,
    {
      db: suite.db,
      backend: new FakeFiscalBackend(suite.db),
      clock: systemClock(),
      cfg: {
        nodeId: nodeId(seeded.nodeId),
        locationId: locationId(seeded.locationId),
        locale: "es-ES",
        invoiceLocales: ["es-ES"],
        tipsEnabled: false,
        simplifiedInvoiceLimit: null,
      },
      ring: loadKeyRing({
        WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64"),
        WAITRON_CREDENTIALS_KEY_VERSION: "1",
      }),
      environment: "preproduction",
      providers: [],
      pool: {
        get: async () => {
          throw new Error("recording a held payment's outcome never reaches a provider");
        },
        evict: () => {},
      },
      pinThrottle: createPinThrottle({ now: () => 1_000_000 }),
    },
    () => {},
  );
  return {
    seeded,
    app,
    managerId: manager!.id,
    managerCookie: `${MANAGEMENT_COOKIE}=${sessions.manager}`,
    staffCookie: `${MANAGEMENT_COOKIE}=${sessions.staff}`,
  };
}

type Venue = Awaited<ReturnType<typeof setup>>;

let orderNumber = 40;

/** A card payment on its own order, captured for `amount`, held because the provider paid out
 * `providerAmount`. */
async function aHeldPayment(
  v: Venue,
  opts: { amount: string; providerAmount: string; settledAt: string; foundAt: string },
) {
  orderNumber += 1;
  const paymentRef = `pr_${randomUUID()}`;
  return withTransaction(suite.db, async (tx) => {
    const [order] = await tx
      .insert(workingOrders)
      .values({
        source: "device",
        deviceId: v.seeded.deviceId,
        locationId: v.seeded.locationId,
        orderNumber,
      })
      .returning({ id: workingOrders.id });
    await insertCapturedPayment(tx, {
      origin: deviceOrigin(v.seeded.deviceId),
      workingOrderId: order!.id,
      provider: "stripe",
      paymentRef,
      amount: decimal(opts.amount),
      settledAt: new Date(opts.settledAt),
    });
    const payment = (await getPaymentByRef(tx, { provider: "stripe", paymentRef }))!;
    expect(
      await recordHold(tx, {
        paymentId: payment.id,
        providerAmount: decimal(opts.providerAmount),
        foundAt: new Date(opts.foundAt),
      }),
    ).toBe("written");
    const [hold] = suite.db.all<{ id: string }>(
      sql`select id from payment_holds where payment_id = ${payment.id}`,
    );
    return { holdId: hold!.id, paymentRef, orderNumber };
  });
}

/** Two held payments found on different days, the later one created first, and the alert the
 * payments check raised for them. */
async function twoHeld(v: Venue) {
  const later = await aHeldPayment(v, {
    amount: "20.00",
    providerAmount: "18.00",
    settledAt: "2026-10-16T21:00:00.000Z",
    foundAt: "2026-10-18T03:00:00.000Z",
  });
  const earlier = await aHeldPayment(v, {
    amount: "12.10",
    providerAmount: "1.21",
    settledAt: "2026-10-15T20:30:00.000Z",
    foundAt: "2026-10-17T03:00:00.000Z",
  });
  await withTransaction(suite.db, (tx) =>
    refreshHeldAlert(tx, sink, { now: new Date("2026-10-18T03:00:00.000Z"), by: null }),
  );
  return { earlier, later };
}

function list(v: Venue, cookie = v.managerCookie) {
  return v.app.request("/management-api/payments/held", { headers: { cookie } });
}

function outcomePath(holdId: string) {
  return `/management-api/payments/held/${holdId}/outcome`;
}

function post(v: Venue, path: string, body: unknown, cookie = v.managerCookie) {
  return v.app.request(path, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorOf(res: Response) {
  return ((await res.json()) as { error: { code: string; params?: unknown } }).error;
}

function outcomeRows() {
  return suite.db.all<{ hold_id: string; outcome: string; note: string | null; person_id: string }>(
    sql`select hold_id, outcome, note, person_id from payment_hold_outcomes order by recorded_at, id`,
  );
}

function heldAlerts() {
  return suite.db
    .all<{ id: string; params: string; acknowledged_by: string | null }>(
      sql`select id, params, acknowledged_by from incidents where code = ${HELD}
          order by detected_at, id`,
    )
    .map((row) => ({
      id: row.id,
      refs: (JSON.parse(row.params) as { payments: { paymentRef: string }[] }).payments.map(
        (p) => p.paymentRef,
      ),
      handledBy: row.acknowledged_by,
    }));
}

describe("GET /management-api/payments/held", () => {
  it("lists every held payment oldest first, with both amounts and the order number", async () => {
    const v = await setup();
    const { earlier, later } = await twoHeld(v);

    const res = await list(v);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        holdId: earlier.holdId,
        paymentRef: earlier.paymentRef,
        provider: "stripe",
        orderNumber: earlier.orderNumber,
        settledAt: "2026-10-15T20:30:00.000Z",
        amount: "12.10",
        providerAmount: "1.21",
      },
      {
        holdId: later.holdId,
        paymentRef: later.paymentRef,
        provider: "stripe",
        orderNumber: later.orderNumber,
        settledAt: "2026-10-16T21:00:00.000Z",
        amount: "20.00",
        providerAmount: "18.00",
      },
    ]);
  });

  it("refuses a session without payments.manage", async () => {
    const v = await setup();
    await twoHeld(v);

    const res = await list(v, v.staffCookie);

    expect(res.status).toBe(403);
    expect((await errorOf(res)).code).toBe("authorization.not_permitted");
  });
});

describe("POST /management-api/payments/held/:id/outcome", () => {
  it("records a refund at the provider with its note, names the manager and replaces the alert", async () => {
    const v = await setup();
    const { earlier, later } = await twoHeld(v);
    const [before] = heldAlerts();

    const res = await post(v, outcomePath(earlier.holdId), {
      outcome: "refunded_at_provider",
      note: "  Refunded 10.89 in the Stripe dashboard  ",
      pin: "1234",
    });

    expect(res.status).toBe(200);
    expect(outcomeRows()).toEqual([
      {
        hold_id: earlier.holdId,
        outcome: "refunded_at_provider",
        note: "Refunded 10.89 in the Stripe dashboard",
        person_id: v.managerId,
      },
    ]);
    expect(((await (await list(v)).json()) as { holdId: string }[]).map((h) => h.holdId)).toEqual([
      later.holdId,
    ]);
    expect(heldAlerts()).toEqual([
      { id: before!.id, refs: [earlier.paymentRef, later.paymentRef], handledBy: v.managerId },
      { id: expect.any(String), refs: [later.paymentRef], handledBy: null },
    ]);
  });

  it("records a kept payment with no note as null and closes the alert when it was the last", async () => {
    const v = await setup();
    const held = await aHeldPayment(v, {
      amount: "9.00",
      providerAmount: "9.90",
      settledAt: "2026-10-15T20:30:00.000Z",
      foundAt: "2026-10-17T03:00:00.000Z",
    });
    await withTransaction(suite.db, (tx) =>
      refreshHeldAlert(tx, sink, { now: new Date("2026-10-17T03:00:00.000Z"), by: null }),
    );

    const res = await post(v, outcomePath(held.holdId), { outcome: "kept", pin: "1234" });

    expect(res.status).toBe(200);
    expect(outcomeRows()).toEqual([
      { hold_id: held.holdId, outcome: "kept", note: null, person_id: v.managerId },
    ]);
    expect(await (await list(v)).json()).toEqual([]);
    expect(heldAlerts()).toEqual([
      { id: expect.any(String), refs: [held.paymentRef], handledBy: v.managerId },
    ]);
  });

  it("stores a note of only spaces as null", async () => {
    const v = await setup();
    const { earlier } = await twoHeld(v);

    const res = await post(v, outcomePath(earlier.holdId), {
      outcome: "kept",
      note: "   ",
      pin: "1234",
    });

    expect(res.status).toBe(200);
    expect(outcomeRows().map((row) => row.note)).toEqual([null]);
  });

  describe("refuses, writing nothing", () => {
    async function refused(
      body: (held: { holdId: string }) => { path?: string; body: unknown; cookie?: "staff" },
    ) {
      const v = await setup();
      const { earlier } = await twoHeld(v);
      const alertsBefore = heldAlerts();
      const req = body(earlier);
      const res = await post(
        v,
        req.path ?? outcomePath(earlier.holdId),
        req.body,
        req.cookie === "staff" ? v.staffCookie : v.managerCookie,
      );
      expect(outcomeRows()).toEqual([]);
      expect(heldAlerts()).toEqual(alertsBefore);
      return { res, v };
    }

    it("a staff session with that person's own PIN", async () => {
      const { res } = await refused(() => ({
        body: { outcome: "kept", pin: "5678" },
        cookie: "staff",
      }));
      expect(res.status).toBe(403);
      expect((await errorOf(res)).code).toBe("authorization.not_permitted");
    });

    it("a wrong PIN", async () => {
      const { res } = await refused(() => ({ body: { outcome: "kept", pin: "9999" } }));
      expect(res.status).toBe(401);
      expect(await errorOf(res)).toEqual({ code: "pin.invalid", params: {} });
    });

    it("too many wrong PINs, even once the right one is sent", async () => {
      const v = await setup();
      const { earlier } = await twoHeld(v);
      const alertsBefore = heldAlerts();
      for (let i = 0; i <= PIN_THROTTLE_FREE_ATTEMPTS; i += 1) {
        const wrong = await post(v, outcomePath(earlier.holdId), { outcome: "kept", pin: "9999" });
        expect(wrong.status).toBe(401);
      }

      const res = await post(v, outcomePath(earlier.holdId), { outcome: "kept", pin: "1234" });

      expect(res.status).toBe(429);
      expect((await errorOf(res)).code).toBe("pin.throttled");
      expect(outcomeRows()).toEqual([]);
      expect(heldAlerts()).toEqual(alertsBefore);
    });

    it("an unknown outcome", async () => {
      const { res } = await refused(() => ({ body: { outcome: "lost", pin: "1234" } }));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({
        code: "management.request_invalid",
        params: { field: "outcome" },
      });
    });

    it("a note that is not text", async () => {
      const { res } = await refused(() => ({ body: { outcome: "kept", note: 7, pin: "1234" } }));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({
        code: "management.request_invalid",
        params: { field: "note" },
      });
    });

    it("a note sent as null", async () => {
      const { res } = await refused(() => ({ body: { outcome: "kept", note: null, pin: "1234" } }));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toEqual({
        code: "management.request_invalid",
        params: { field: "note" },
      });
    });

    it("an unknown hold", async () => {
      const unknown = randomUUID();
      const { res } = await refused(() => ({
        path: outcomePath(unknown),
        body: { outcome: "kept", pin: "1234" },
      }));
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toEqual({
        code: "payment.hold_not_found",
        params: { holdId: unknown },
      });
    });

    it("an id that is not a UUID", async () => {
      const { res } = await refused(() => ({
        path: outcomePath("not-a-uuid"),
        body: { outcome: "kept", pin: "1234" },
      }));
      expect(res.status).toBe(400);
      expect((await errorOf(res)).code).toBe("shared.invalid_id");
    });

    it("a second outcome for the same hold", async () => {
      const v = await setup();
      const { earlier } = await twoHeld(v);
      const first = await post(v, outcomePath(earlier.holdId), {
        outcome: "kept",
        note: "first",
        pin: "1234",
      });
      expect(first.status).toBe(200);
      const outcomesBefore = outcomeRows();
      const alertsBefore = heldAlerts();

      const res = await post(v, outcomePath(earlier.holdId), {
        outcome: "refunded_at_provider",
        pin: "1234",
      });

      expect(res.status).toBe(409);
      expect(await errorOf(res)).toEqual({
        code: "payment.hold_already_recorded",
        params: { holdId: earlier.holdId },
      });
      expect(outcomeRows()).toEqual(outcomesBefore);
      expect(heldAlerts()).toEqual(alertsBefore);
    });
  });
});

describe("the held payment outcome checks the manager's PIN before the write lock is taken", () => {
  afterEach(async () => {
    await watchedOrder();
  });

  const anotherWriter = () => withTransaction(suite.db, (tx) => tx.execute(sql`select 1`));

  it("records the outcome while another writer commits during the PIN check", async () => {
    const v = await setup();
    const { earlier } = await twoHeld(v);
    watchDerivationsAndLock(suite.db, "1234", anotherWriter, anotherWriter, anotherWriter);

    const res = await post(v, outcomePath(earlier.holdId), { outcome: "kept", pin: "1234" });

    expect(res.status).toBe(200);
    expect(await watchedOrder()).toEqual(["writer", "derived"]);
    expect(outcomeRows()).toEqual([
      { hold_id: earlier.holdId, outcome: "kept", note: null, person_id: v.managerId },
    ]);
  });

  it("derives no key for a session without payments.manage", async () => {
    const v = await setup();
    const { earlier } = await twoHeld(v);
    watchDerivationsAndLock(suite.db, "5678", anotherWriter);

    const res = await post(
      v,
      outcomePath(earlier.holdId),
      { outcome: "kept", pin: "5678" },
      v.staffCookie,
    );

    expect(res.status).toBe(403);
    expect(await watchedOrder()).toEqual([]);
  });

  it("derives no key for a PIN that is not text", async () => {
    const v = await setup();
    const { earlier } = await twoHeld(v);
    watchDerivationsAndLock(suite.db, "1234", anotherWriter);

    const res = await post(v, outcomePath(earlier.holdId), { outcome: "kept", pin: 1234 });

    expect(res.status).toBe(401);
    expect(await errorOf(res)).toEqual({ code: "pin.invalid", params: {} });
    expect(await watchedOrder()).toEqual([]);
  });
});
