import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import Stripe from "stripe";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, it } from "vitest";
import { incidents, locations, locationBusinessDaySettings, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { authorizeManager, persons, startManagementSession } from "@waitron/identity";
import { loadKeyRing, putCredential } from "@waitron/credentials";
import { insertInitiated } from "@waitron/payments";
import { decimal } from "@waitron/shared";
import { zonePaymentVenue } from "./testing/zone-payment-venue.js";
import { confirmVenueZone } from "./venue-zone-repair.js";
import { takeBillPayment, takeReaderBillPayment } from "./bill-payments.js";
import { mountWebhook } from "./webhook.js";

const RECORDED = "2026-10-15T00:00:00.000Z";
const BEHIND = "2026-10-14T23:30:00.000Z";
const suite = useVenueDb({
  migrations: migrationOptionsFor(manifestSets(), null),
  timeoutMs: 60_000,
});
let v: Awaited<ReturnType<typeof zonePaymentVenue>>;
let token: string;
let manager: string;
const scope = () => ({ nodeId: v.cfg.nodeId, locationId: v.cfg.locationId });
const reading = (offsetMinutes = 0) => ({ instant: new Date(BEHIND), offsetMinutes });
const inTx = <T>(fn: Parameters<typeof withTransaction<T>>[1]) => withTransaction(suite.db, fn);
const clockStop = (offsetMinutes = 0) =>
  inTx((tx) => v.backend.clockBehindLatestRecord(tx, reading(offsetMinutes)));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(RECORDED) });
  v = await zonePaymentVenue(suite.db);
  v.set(RECORDED);
  const id = await v.bill();
  const paid = await takeBillPayment(v.deps, v.cfg, id, await v.request(id, "cash"), v.operator);
  expect(paid.invoice).toMatchObject({ issuedAt: RECORDED, issuedOffsetMinutes: 120 });
  v.set(BEHIND);
  const [person] = await suite.db
    .insert(persons)
    .values({ displayName: "Zone manager", role: "manager" })
    .returning();
  manager = person!.id;
  token = (await inTx((tx) => startManagementSession(tx, { personId: manager }))).token;
  await suite.db
    .update(locations)
    .set({ timeZone: "Invalid/Zone" })
    .where(eq(locations.id, v.cfg.locationId));
  v.deps.admission.repairOnly("invalid");
});
afterEach(() => vi.useRealTimers());

async function repairZone() {
  const answer = await inTx((tx) =>
    confirmVenueZone(
      tx,
      scope(),
      token,
      {
        timeZone: "Europe/Madrid",
        expectedClockRevision: 0,
        confirmed: true,
      },
      new Date(BEHIND),
    ),
  );
  v.deps.admission.requireRestart();
  return answer;
}
function savedFacts() {
  return Object.fromEntries(
    [
      "registros_facturacion",
      "sales",
      "tenders",
      "invoice_series",
      "cadenas",
      "clock_checks",
      "clock_confirmations",
      "persons",
      "management_sessions",
    ].map((name) => [
      name,
      suite.db.all(sql`select * from ${sql.identifier(name)} order by rowid`),
    ]),
  );
}
async function newPayment() {
  const id = await v.bill();
  const request = await v.request(id, "cash");
  return () => takeBillPayment(v.deps, v.cfg, id, request, v.operator);
}

it("confirming the zone preserves the exact clock stop, all saved facts and manager permissions", async () => {
  const expected = {
    clockAt: BEHIND,
    offsetMinutes: 0,
    lastRecordAt: RECORDED,
    lastRecordOffsetMinutes: 120,
  };
  expect(await clockStop()).toEqual(expected);
  const before = savedFacts();
  expect(
    await inTx((tx) =>
      authorizeManager(tx, { managementSessionId: token, permission: "system.manage" }),
    ),
  ).toEqual({ authorizedBy: manager, role: "manager" });
  expect(await repairZone()).toEqual({
    repaired: true,
    clockRevision: 1,
    admission: "restart_required",
  });
  expect(savedFacts()).toEqual(before);
  expect(v.deps.clock.now().instant.toISOString()).toBe(BEHIND);
  expect(await clockStop()).toEqual(expected);
  expect(await clockStop(840)).toEqual({ ...expected, offsetMinutes: 840 });
  expect(await clockStop(-720)).toEqual({ ...expected, offsetMinutes: -720 });
  expect(await suite.db.select().from(locationBusinessDaySettings)).toEqual([
    { locationId: v.cfg.locationId, revision: 1 },
  ]);
  expect(
    await suite.db.select().from(incidents).where(eq(incidents.code, "venue.time_zone_repaired")),
  ).toEqual([expect.objectContaining({ acknowledgedBy: manager, acknowledgedAt: BEHIND })]);
  const pay = await newPayment();
  await expect(pay()).rejects.toMatchObject({
    code: "venue.time_zone_not_ready",
    params: { reason: "restart_required" },
  });
  v.deps.admission.admit();
  await expect(pay()).rejects.toMatchObject({ code: "clock.behind_chain", params: expected });
  const cardId = await v.bill();
  const collects = v.card.collectCalls.length;
  await expect(
    takeReaderBillPayment(v.deps, v.cfg, cardId, await v.request(cardId, "card"), v.operator),
  ).rejects.toMatchObject({ code: "clock.behind_chain", params: expected });
  expect(v.card.collectCalls).toHaveLength(collects);

  expect(
    await inTx((tx) =>
      authorizeManager(tx, { managementSessionId: token, permission: "system.manage" }),
    ),
  ).toEqual({ authorizedBy: manager, role: "manager" });
  const clock = {
    ...v.deps.clock,
    now: () => ({ ...v.deps.clock.now(), instant: new Date("2024-10-27T12:00:00Z") }),
  };
  const id = await v.bill();
  await expect(
    takeBillPayment({ ...v.deps, clock }, v.cfg, id, await v.request(id, "cash"), v.operator),
  ).rejects.toMatchObject({ code: "clock.unusable" });
  expect(savedFacts()).toEqual(before);
});

it("an actual clock confirmation leaves the invalid-zone stop and all invoice facts in place", async () => {
  expect(await clockStop()).not.toBeNull();
  const fiscal = savedFacts();
  const answer = await inTx((tx) =>
    v.backend.confirmClockStop!(tx, {
      reading: reading(),
      nodeId: v.cfg.nodeId,
      boot: { id: null, ms: 300_000 },
      witnesses: [
        {
          kind: "authority",
          id: "synthetic-aeat",
          boxAt: BEHIND,
          witnessAt: BEHIND,
          uncertaintyMs: 0,
        },
      ],
    }),
  );
  expect(answer.confirmation).not.toBeNull();
  expect(await clockStop()).toBeNull();
  expect(v.deps.admission.snapshot()).toEqual({ state: "invalid" });
  expect(
    (await suite.db.select().from(locations).where(eq(locations.id, v.cfg.locationId)))[0]!
      .timeZone,
  ).toBe("Invalid/Zone");
  const before = v.snapshot();
  const pay = await newPayment();
  await expect(pay()).rejects.toMatchObject({
    code: "venue.time_zone_not_ready",
    params: { reason: "invalid" },
  });
  expect(v.snapshot()).toEqual(before);
  for (const name of ["registros_facturacion", "sales", "tenders", "invoice_series", "cadenas"])
    expect(savedFacts()[name]).toEqual(fiscal[name]);
});

it("the signed hosted-payment exception to the clock stop cannot bypass zone admission", async () => {
  const id = await v.bill();
  const sessionId = `cs_${randomUUID()}`;
  const secret = "whsec_zone_clock_synthetic";
  const ring = loadKeyRing({
    WAITRON_CREDENTIALS_KEY: Buffer.alloc(32, 17).toString("base64"),
    WAITRON_CREDENTIALS_KEY_VERSION: "1",
  });
  await inTx(async (tx) => {
    await insertInitiated(tx, {
      origin: v.cfg.origin,
      workingOrderId: id,
      provider: "stripe",
      paymentRef: randomUUID(),
      externalRef: sessionId,
      amount: decimal("12.10"),
    });
    await putCredential(tx, ring, {
      purpose: "payments.stripe",
      value: {
        secretKey: "sk_test_zone_clock",
        webhookSecret: secret,
        successUrl: "https://example.test/ok",
        cancelUrl: "https://example.test/cancel",
      },
    });
  });
  const app = new Hono();
  mountWebhook(
    app,
    {
      db: suite.db,
      ring,
      nodeId: v.cfg.nodeId,
      admission: v.deps.admission,
      environment: "preproduction",
      makeStripe: (key) => new Stripe(key),
    },
    () => {},
  );
  const body = JSON.stringify({
    id: "evt_zone_clock",
    object: "event",
    type: "checkout.session.completed",
    created: Date.parse(BEHIND) / 1000,
    data: { object: { id: sessionId, object: "checkout.session", amount_total: 1210 } },
  });
  const signature = new Stripe("sk_test_zone_clock").webhooks.generateTestHeaderString({
    payload: body,
    secret,
  });
  const post = () =>
    app.request("/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": signature },
      body,
    });
  const before = v.snapshot();
  expect(await clockStop()).not.toBeNull();
  expect((await post()).status).toBe(500);
  expect(v.snapshot()).toEqual(before);
  await repairZone();
  expect((await post()).status).toBe(500);
  expect(v.snapshot()).toEqual(before);
  v.deps.admission.admit();
  expect(await clockStop()).not.toBeNull();
  expect((await post()).status).toBe(200);
  const [payment] = suite.db.all(
    sql`select state, settled_at from payments where external_ref = ${sessionId}`,
  );
  expect(payment).toEqual({ state: "captured", settled_at: BEHIND });
});

it("a repaired zone still stops a reader before money moves while the clock is behind", async () => {
  await repairZone();
  v.deps.admission.admit();
  const id = await v.bill();
  const request = await v.request(id, "card");
  const before = v.snapshot();
  const collects = v.card.collectCalls.length;
  await expect(takeReaderBillPayment(v.deps, v.cfg, id, request, v.operator)).rejects.toMatchObject(
    { code: "clock.behind_chain" },
  );
  expect(v.card.collectCalls).toHaveLength(collects);
  expect(v.snapshot()).toEqual(before);
});
