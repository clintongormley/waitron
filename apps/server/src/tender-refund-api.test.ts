import { randomUUID } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  devices,
  deviceProfiles,
  drawerOpens,
  locations,
  nodes,
  sales,
  saleLines,
  saleSettlements,
  saleSubstitutions,
  tenders,
  tenderRefunds,
  printJobs,
  workingOrders,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { deviceProfileAdmissionPersons, persons, sessions } from "@waitron/identity";
import { payments } from "@waitron/payments";
import { setProfileServiceAccess, zoneServicePolicies } from "@waitron/venue-service";
import {
  billlessSale,
  collect,
  placedIssuedBill,
  provisionOrderVenue,
  type OrderVenue,
} from "./testing/order-venue.js";
import { inTx, send } from "./testing/bill-venue.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
let venue: OrderVenue;
let sequence: number;
beforeEach(async () => {
  venue = await provisionOrderVenue(store.db);
  sequence = 900_000;
});

const ask = (tenderId: string, patch: Partial<TenderRefundRequest> = {}): TenderRefundRequest => ({
  submissionId: randomUUID(),
  tenderId,
  appliedAmount: "2.00",
  tipAmount: "0.00",
  reason: "Goodwill",
  cashConfirmed: true,
  ...patch,
});
const create = (saleId: string, body: unknown, cookie = venue.supervisorTill) =>
  send(venue.app, cookie, "POST", `/api/transactions/${saleId}/refunds`, body);
const list = (saleId: string, cookie = venue.cookie) =>
  send(venue.app, cookie, "GET", `/api/transactions/${saleId}/refundable-tenders`);
const status = (id: string, cookie = venue.cookie) =>
  send(venue.app, cookie, "GET", `/api/tender-refunds/${id}`);
const retry = (id: string, body: unknown = {}, cookie = venue.supervisorTill) =>
  send(venue.app, cookie, "POST", `/api/tender-refunds/${id}/retry`, body);
async function profile() {
  return (await store.db.select().from(devices).where(eq(devices.id, venue.deviceId)))[0]!
    .deviceProfileId;
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
async function originalFacts() {
  return inTx(venue, async (tx) => ({
    sales: await tx.select().from(sales),
    lines: await tx.select().from(saleLines),
    tenders: await tx.select().from(tenders),
    settlements: await tx.select().from(saleSettlements),
    fiscal: (await tx.execute(sql`select * from registros_facturacion order by id`)).rows,
  }));
}
async function effects() {
  return inTx(venue, async (tx) => ({
    refunds: await tx.select().from(tenderRefunds),
    drawers: await tx.select().from(drawerOpens),
    prints: await tx.select().from(printJobs),
  }));
}
async function pendingCard() {
  const t = await target("card");
  venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
  const result = await create(t.saleId, ask(t.tenderId));
  expect(result.status).toBe(200);
  expect(result.json.state).toBe("pending");
  return { ...t, refundId: result.json.id as string };
}

it("reads refundable money for admitted staff, completes cash once and preserves the filed invoice", async () => {
  const saleId = await billlessSale(venue);
  const [tender] = await store.db.select().from(tenders).where(eq(tenders.saleId, saleId));
  const before = await originalFacts(),
    prior = await effects();
  const available = await list(saleId.toUpperCase());
  expect(available).toMatchObject({
    status: 200,
    json: [
      {
        tenderId: tender!.id,
        method: "cash",
        appliedRemaining: "12.10",
        tipRemaining: "0.00",
        pendingRefundId: null,
      },
    ],
  });
  const req = ask(tender!.id),
    paid = await create(saleId.toUpperCase(), req);
  expect(paid).toMatchObject({
    status: 200,
    json: {
      saleId,
      tenderId: tender!.id,
      state: "completed",
      appliedAmount: "2.00",
      tipAmount: "0.00",
    },
  });
  const id = paid.json.id as string,
    after = await effects();
  expect(after.refunds).toHaveLength(prior.refunds.length + 1);
  expect(after.drawers).toHaveLength(prior.drawers.length + 1);
  expect(after.prints.filter((row) => row.kind === "drawer")).toHaveLength(
    prior.prints.filter((row) => row.kind === "drawer").length + 1,
  );
  expect(await status(id.toUpperCase())).toEqual(paid);
  expect(await create(saleId, req)).toEqual(paid);
  expect(await retry(id)).toEqual(paid);
  expect(await effects()).toEqual(after);
  expect(await originalFacts()).toEqual(before);
  expect(await list(saleId)).toMatchObject({ status: 200, json: [{ appliedRemaining: "10.10" }] });
});

it("requires sale.refund or a valid approving PIN without restricting staff reads", async () => {
  const t = await target();
  const req = ask(t.tenderId);
  expect((await list(t.saleId)).status).toBe(200);
  expect(await create(t.saleId, req, venue.cookie)).toMatchObject({
    status: 403,
    json: { code: "authorization.not_permitted" },
  });
  expect(
    await create(
      t.saleId,
      { ...req, override: { personId: venue.adminId, pin: "0000" } },
      venue.cookie,
    ),
  ).toMatchObject({ status: 401, json: { code: "pin.invalid" } });
  expect((await effects()).refunds).toHaveLength(0);
  expect(
    await create(
      t.saleId,
      { ...req, override: { personId: venue.adminId, pin: "1234" } },
      venue.cookie,
    ),
  ).toMatchObject({ status: 200, json: { state: "completed" } });
});

it("connected retries keep the original reservation and key and look up before sending", async () => {
  const t = await pendingCard(),
    before = await originalFacts();
  expect(await list(t.saleId)).toMatchObject({
    status: 200,
    json: [{ pendingRefundId: t.refundId, appliedRemaining: "8.00" }],
  });
  expect(venue.card.refundCalls).toHaveLength(1);
  expect(await retry(t.refundId, {}, venue.cookie)).toMatchObject({
    status: 403,
    json: { code: "authorization.not_permitted" },
  });
  expect(venue.card.lookupCalls).toHaveLength(0);
  venue.card.scriptLookups({ kind: "none" });
  expect(await retry(t.refundId.toUpperCase())).toMatchObject({
    status: 200,
    json: { id: t.refundId, state: "completed" },
  });
  expect(venue.card.lookupCalls).toHaveLength(1);
  expect(venue.card.refundCalls.map((call) => call.idempotencyKey)).toEqual([
    `tr_${t.refundId}`,
    `tr_${t.refundId}`,
  ]);
  expect((await effects()).refunds).toHaveLength(1);
  expect((await effects()).drawers).toHaveLength(0);
  expect(await originalFacts()).toEqual(before);
});

it.each([
  "missing",
  "ended",
  "device",
  "deleted",
  "moved",
  "retired",
  "admission",
  "suspended",
] as const)(
  "refuses %s session/device/profile access on list, create, status and retry",
  async (kind) => {
    const t = await pendingCard();
    const profileId = await profile();
    let cookie = venue.supervisorTill;
    let code = "device.unauthorized",
      http = 401;
    if (kind === "missing") {
      cookie = "";
      code = "session.required";
    }
    if (kind === "ended") {
      await store.db.update(sessions).set({ endedAt: new Date().toISOString() });
      code = "session.required";
    }
    if (kind === "device")
      await store.db.update(devices).set({ active: false }).where(eq(devices.id, venue.deviceId));
    if (kind === "deleted")
      await store.db
        .update(devices)
        .set({ deletedAt: new Date().toISOString() })
        .where(eq(devices.id, venue.deviceId));
    if (kind === "retired")
      await store.db
        .update(deviceProfiles)
        .set({ retiredAt: new Date().toISOString() })
        .where(eq(deviceProfiles.id, profileId));
    if (kind === "moved") {
      const [place] = await store.db
        .select()
        .from(locations)
        .where(eq(locations.id, venue.cfg.locationId));
      const id = randomUUID();
      await store.db.insert(locations).values({ ...place!, id, name: "Elsewhere" });
      await store.db.update(devices).set({ locationId: id }).where(eq(devices.id, venue.deviceId));
    }
    if (kind === "admission") {
      await store.db
        .insert(deviceProfileAdmissionPersons)
        .values({ deviceProfileId: profileId, personId: venue.supervisorId, admitted: false });
      code = "device_profile.not_admitted";
      http = 403;
    }
    if (kind === "suspended") {
      await store.db
        .update(persons)
        .set({ status: "suspended" })
        .where(eq(persons.id, venue.supervisorId));
      code = "device_profile.not_admitted";
      http = 403;
    }
    const before = await effects();
    for (const answer of [
      await list(t.saleId, cookie),
      await create(t.saleId, ask(t.tenderId), cookie),
      await status(t.refundId, cookie),
      await retry(t.refundId, {}, cookie),
    ])
      expect(answer).toMatchObject({ status: http, json: { code } });
    expect(venue.card.refundCalls).toHaveLength(1);
    expect(venue.card.lookupCalls).toHaveLength(0);
    expect(await effects()).toEqual(before);
  },
);

it("checks every original source zone for all four routes and admits them once allowed", async () => {
  const first = await placedIssuedBill(venue, "Caña");
  expect((await collect(venue, first, "3.00")).status).toBe(200);
  const [source] = await store.db.select().from(sales).where(eq(sales.workingOrderId, first));
  const t = await pendingCard();
  await store.db
    .insert(saleSubstitutions)
    .values({ substitutionSaleId: t.saleId, substitutedSaleId: source!.id });
  const profileId = await profile(),
    [policy] = await store.db
      .select()
      .from(zoneServicePolicies)
      .where(eq(zoneServicePolicies.zoneId, venue.counterZone));
  await inTx(venue, (tx) =>
    setProfileServiceAccess(tx, venue.cfg, profileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.zoneId],
      startingZoneId: venue.zoneId,
    }),
  );
  const before = await effects();
  for (const answer of [
    await list(t.saleId),
    await create(t.saleId, ask(t.tenderId)),
    await status(t.refundId),
    await retry(t.refundId),
  ])
    expect(answer).toMatchObject({ status: 403, json: { code: "service_zone.not_allowed" } });
  expect(await effects()).toEqual(before);
  expect(venue.card.lookupCalls).toHaveLength(0);
  await inTx(venue, (tx) =>
    setProfileServiceAccess(tx, venue.cfg, profileId, {
      departmentId: policy!.departmentId,
      allowedZoneIds: [venue.zoneId, venue.counterZone],
      startingZoneId: venue.zoneId,
    }),
  );
  expect((await list(t.saleId)).status).toBe(200);
  expect((await status(t.refundId)).status).toBe(200);
  expect((await retry(t.refundId)).status).toBe(200);
});

it("scopes status and retry by the original sale's location", async () => {
  const t = await target();
  const [place] = await store.db
    .select()
    .from(locations)
    .where(eq(locations.id, venue.cfg.locationId));
  const otherLocation = randomUUID(),
    otherNode = randomUUID();
  await store.db.insert(locations).values({ ...place!, id: otherLocation, name: "Other" });
  await store.db.insert(nodes).values({ id: otherNode, locationId: otherLocation, name: "Other" });
  const [sale] = await store.db.select().from(sales).where(eq(sales.id, t.saleId));
  const foreign = randomUUID(),
    foreignTender = randomUUID(),
    refundId = randomUUID();
  await store.db.insert(sales).values({
    ...sale!,
    id: foreign,
    nodeId: otherNode,
    invoiceNumber: ++sequence,
    workingOrderId: null,
  });
  await store.db.insert(tenders).values({
    id: foreignTender,
    saleId: foreign,
    method: "cash",
    amount: 1000,
    settledAt: new Date().toISOString(),
  });
  await store.db.insert(tenderRefunds).values({
    id: refundId,
    saleId: foreign,
    tenderId: foreignTender,
    submissionId: randomUUID(),
    fingerprint: "foreign",
    appliedAmount: 100,
    reason: "Return",
    requestedBy: venue.supervisorId,
    authorizedBy: venue.supervisorId,
    source: "device",
    deviceId: venue.deviceId,
    nodeId: otherNode,
    locationId: otherLocation,
    method: "cash",
    state: "completed",
    completedAt: new Date().toISOString(),
  });
  const before = await effects();
  for (const answer of [
    await list(foreign),
    await create(foreign, ask(foreignTender)),
    await status(refundId),
    await retry(refundId),
  ])
    expect(answer).toMatchObject({ status: 404, json: { code: "sale.not_found" } });
  expect(await effects()).toEqual(before);
});

it.each(["cash", "manual", "connected"] as const)(
  "%s creation and retry require the tender's current capability",
  async (kind) => {
    const t = await target(kind === "cash" ? "cash" : "card", kind === "manual");
    const id = randomUUID(),
      manual = kind === "manual";
    await store.db.insert(tenderRefunds).values({
      id,
      saleId: t.saleId,
      tenderId: t.tenderId,
      submissionId: randomUUID(),
      fingerprint: "existing",
      appliedAmount: 100,
      reason: "Return",
      requestedBy: venue.supervisorId,
      authorizedBy: venue.supervisorId,
      source: "device",
      deviceId: venue.deviceId,
      nodeId: venue.cfg.nodeId,
      locationId: venue.cfg.locationId,
      method: kind === "cash" ? "cash" : "card",
      manual,
      state: "completed",
      completedAt: new Date().toISOString(),
      ...(kind === "connected"
        ? {
            provider: "fake",
            providerPaymentRef: (
              await store.db.select().from(payments).where(eq(payments.saleId, t.saleId))
            )[0]!.paymentRef,
          }
        : {}),
    });
    const profileId = await profile();
    await store.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, profileId));
    const before = await effects();
    const code = kind === "cash" ? "device.cash_not_allowed" : "device.forbidden_action";
    for (const answer of [
      await create(
        t.saleId,
        ask(t.tenderId, {
          manualConfirmed: manual,
          override: { personId: venue.adminId, pin: "1234" },
        }),
      ),
      await retry(id),
    ])
      expect(answer).toMatchObject({ status: 403, json: { code } });
    expect(await effects()).toEqual(before);
  },
);

it.each([null, [], "bad", 42].map((body) => ({ body })))(
  "refuses a nonobject create/retry body $body",
  async ({ body }) => {
    const t = await pendingCard(),
      before = await effects();
    for (const answer of [await create(t.saleId, body), await retry(t.refundId, body)])
      expect(answer).toMatchObject({
        status: 400,
        json: { code: "management.request_invalid", params: { field: "body" } },
      });
    expect(await effects()).toEqual(before);
  },
);
it.each(["cashConfirmed", "manualConfirmed", "override"])(
  "refuses explicit null %s before any refund",
  async (field) => {
    const t = await target();
    expect(await create(t.saleId, { ...ask(t.tenderId), [field]: null })).toMatchObject({
      status: 400,
      json: { code: "management.request_invalid", params: { field } },
    });
    expect((await effects()).refunds).toHaveLength(0);
  },
);
it("returns domain not-found responses for malformed and unknown path identities", async () => {
  for (const id of ["bad", randomUUID()]) {
    for (const answer of [await list(id), await create(id, ask(randomUUID()))])
      expect(answer).toMatchObject({ status: 404, json: { code: "sale.not_found" } });
    for (const answer of [await status(id), await retry(id)])
      expect(answer).toMatchObject({ status: 404, json: { code: "tender.refund_not_found" } });
  }
});
it("requires manual-terminal confirmation and an approving PIN without asking a provider", async () => {
  const profileId = await profile(),
    [p] = await store.db.select().from(deviceProfiles).where(eq(deviceProfiles.id, profileId));
  await store.db
    .update(deviceProfiles)
    .set({ capabilities: [...(p!.capabilities as string[]), "hand-keyed-card-payment"] })
    .where(eq(deviceProfiles.id, profileId));
  const t = await target("card", true),
    req = ask(t.tenderId, { manualConfirmed: true });
  expect(await create(t.saleId, req)).toMatchObject({
    status: 400,
    json: { code: "tender.manual_refund_pin_required" },
  });
  const result = await create(t.saleId, {
    ...req,
    override: { personId: venue.adminId, pin: "1234" },
  });
  expect(result).toMatchObject({ status: 200, json: { state: "completed" } });
  expect(venue.card.refundCalls).toHaveLength(0);
  expect((await effects()).drawers).toHaveLength(0);
  const before = await effects();
  expect(
    await retry(result.json.id as string, { override: { personId: venue.adminId, pin: "1234" } }),
  ).toEqual(result);
  expect(await effects()).toEqual(before);
});

it.each(["list", "status"] as const)(
  "%s reads are passive and require no payment capability",
  async (route) => {
    const t = await target();
    const saved = await create(t.saleId, ask(t.tenderId));
    expect(saved.status).toBe(200);
    const profileId = await profile(),
      seen = "2020-01-01T00:00:00.000Z";
    await store.db
      .update(deviceProfiles)
      .set({ capabilities: [] })
      .where(eq(deviceProfiles.id, profileId));
    await store.db.update(devices).set({ lastSeenAt: seen }).where(eq(devices.id, venue.deviceId));
    expect(
      (await (route === "list" ? list(t.saleId) : status(saved.json.id as string))).status,
    ).toBe(200);
    expect(
      (await store.db.select().from(devices).where(eq(devices.id, venue.deviceId)))[0]!.lastSeenAt,
    ).toBe(seen);
  },
);

it.each(["list", "status"] as const)(
  "%s rechecks the session and profile after queued writes",
  async (route) => {
    const t = await target();
    const saved = await create(t.saleId, ask(t.tenderId));
    expect(saved.status).toBe(200);
    const lock = store.db.withWriteLock.bind(store.db);
    let calls = 0;
    const spy = vi.spyOn(store.db, "withWriteLock").mockImplementation(async (body) => {
      calls += 1;
      if (calls === 2)
        await withTransaction(store.db, (tx) =>
          tx.update(sessions).set({ endedAt: new Date().toISOString() }),
        );
      return lock(body);
    });
    try {
      const answer = await (route === "list" ? list(t.saleId) : status(saved.json.id as string));
      expect(answer).toMatchObject({ status: 401, json: { code: "session.required" } });
      expect(calls).toBe(3);
    } finally {
      spy.mockRestore();
    }
  },
);

it("competing retry requests cannot send while another resolver owns the attempt", async () => {
  const t = await pendingCard();
  venue.card.scriptLookups({ kind: "none" });
  const release = venue.card.holdNextRefund();
  const first = retry(t.refundId);
  try {
    await vi.waitFor(() => expect(venue.card.refundCalls).toHaveLength(2));
    expect(await retry(t.refundId)).toMatchObject({
      status: 200,
      json: { id: t.refundId, state: "pending" },
    });
    expect(venue.card.refundCalls).toHaveLength(2);
    expect(venue.card.lookupCalls).toHaveLength(1);
  } finally {
    release();
    await first;
  }
  expect(await status(t.refundId)).toMatchObject({ status: 200, json: { state: "completed" } });
});

it("retains a lost-answer submission and refuses a changed or competing request", async () => {
  const t = await target("card"),
    req = ask(t.tenderId);
  venue.card.scriptNextRefund({ made: false, answer: { kind: "uncertain", reason: "network" } });
  const pending = await create(t.saleId, req);
  expect(pending).toMatchObject({ status: 200, json: { state: "pending" } });
  venue.card.scriptLookups({ kind: "unreachable" });
  expect(await create(t.saleId, req)).toEqual(pending);
  expect(await create(t.saleId, { ...req, reason: "Changed" })).toMatchObject({
    status: 409,
    json: { code: "submission.id_reused" },
  });
  expect(await create(t.saleId, ask(t.tenderId))).toMatchObject({
    status: 409,
    json: { code: "tender.refund_in_progress" },
  });
  expect(venue.card.refundCalls).toHaveLength(1);
  expect((await effects()).refunds).toHaveLength(1);
});

it.each(["", "{broken"])(
  "refuses malformed raw JSON %j as body on create and retry",
  async (body) => {
    const t = await pendingCard();
    for (const path of [
      `/api/transactions/${t.saleId}/refunds`,
      `/api/tender-refunds/${t.refundId}/retry`,
    ]) {
      const response = await venue.app.request(path, {
        method: "POST",
        headers: { cookie: venue.supervisorTill, "Content-Type": "application/json" },
        body,
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "management.request_invalid", params: { field: "body" } },
      });
    }
    expect(venue.card.refundCalls).toHaveLength(1);
  },
);

it("does not expose a refund command or its reads on a shared kitchen display", async () => {
  const t = await pendingCard();
  const [shared] = await store.db
    .insert(deviceProfiles)
    .values({ name: "Kitchen", formFactor: "kds", capabilities: ["integrated-card-payment"] })
    .returning();
  await store.db
    .update(devices)
    .set({ deviceProfileId: shared!.id })
    .where(eq(devices.id, venue.deviceId));
  const before = await effects();
  for (const answer of [
    await list(t.saleId),
    await create(t.saleId, ask(t.tenderId)),
    await status(t.refundId),
    await retry(t.refundId),
  ])
    expect(answer).toMatchObject({ status: 403, json: { code: "device.forbidden_action" } });
  expect(await effects()).toEqual(before);
  expect(venue.card.refundCalls).toHaveLength(1);
  expect(venue.card.lookupCalls).toHaveLength(0);
});
it("records the requesting session's device, including when it differs from the invoice's device", async () => {
  const t = await target();
  const result = await create(
    t.saleId,
    ask(t.tenderId, { override: { personId: venue.adminId, pin: "1234" } }),
    venue.cookie2,
  );
  expect(result).toMatchObject({ status: 200, json: { state: "completed" } });
  const saved = await effects();
  expect(saved.refunds).toHaveLength(1);
  expect(saved.refunds[0]).toMatchObject({
    source: "device",
    deviceId: venue.device2Id,
    requestedBy: venue.operatorId,
    authorizedBy: venue.adminId,
  });
  expect(saved.drawers).toHaveLength(1);
  expect(saved.drawers[0]).toMatchObject({
    deviceId: venue.device2Id,
    tenderRefundId: result.json.id,
  });
});
it.each([
  { field: "appliedAmount", value: "2.001" },
  { field: "appliedAmount", value: "-2.00" },
  { field: "appliedAmount", value: 2 },
  { field: "tipAmount", value: null },
  { field: "reason", value: " " },
  { field: "reason", value: 5 },
  { field: "submissionId", value: "bad" },
  { field: "tenderId", value: null },
  { field: "cashConfirmed", value: "true" },
  { field: "manualConfirmed", value: [true] },
])("refuses invalid $field=$value without a refund or provider call", async ({ field, value }) => {
  const t = await target();
  expect(await create(t.saleId, { ...ask(t.tenderId), [field]: value })).toMatchObject({
    status: 400,
    json: { code: "management.request_invalid", params: { field } },
  });
  expect((await effects()).refunds).toHaveLength(0);
  expect(venue.card.refundCalls).toHaveLength(0);
});
