import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  deviceProfilePrinters,
  deviceProfiles,
  devices,
  drawerOpens,
  invoiceSeries,
  locations,
  printers,
  printJobs,
  saleSettlements,
  sales,
  tenderRefunds,
  tenders,
  workingOrders,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { createTrustedClock } from "@waitron/fiscal";
import {
  createPinThrottle,
  hashPin,
  hashSessionToken,
  persons,
  sessions,
  type PinAttempts,
} from "@waitron/identity";
import { manifestSets, migrationOptionsFor } from "@waitron/migrations";
import { payments } from "@waitron/payments";
import { deviceOrigin, locationId } from "@waitron/shared";
import { attendanceOperationFacts } from "@waitron/workforce";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { FakePaymentProvider } from "@waitron/payments/src/testing/fake-provider.js";
import { recordAttendanceFact } from "./attendance-capture.js";
import { beginSettledTenderRefund, type TenderRefundDeps } from "./tender-refunds.js";
import type { DeviceRequestConfig } from "./till-config.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";

const store = useVenueDb({ migrations: migrationOptionsFor(manifestSets(), null) });
const AT = "2026-10-16T12:00:00.000Z";
const PIN = "4567";
const HASH = hashPin(PIN);
let cfg: DeviceRequestConfig;
let personId: string;
let managerId: string;
let sessionId: string;
let profileId: string;
let drawerId: string;
let seriesId: string;
let attempts: PinAttempts;
let counter: number;
let deps: TenderRefundDeps;
beforeEach(async () => {
  const db = store.db;
  await seedTenant(db);
  const [place] = await db
    .insert(locations)
    .values({ name: "Returns", invoiceLocales: ["en-GB"], operationDescription: "Meals" })
    .returning();
  const placeId = locationId(place!.id);
  const nodeId = await seedNode(db, placeId);
  const device = await seedDevice(db, {
    locationId: placeId,
    capabilities: [
      "take-cash",
      "open-cash-drawer",
      "hand-keyed-card-payment",
      "integrated-card-payment",
    ],
  });
  profileId = device.profileId;
  cfg = {
    nodeId,
    locationId: placeId,
    origin: deviceOrigin(device.deviceId),
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: true,
    simplifiedInvoiceLimit: null,
  };
  const people = await db
    .insert(persons)
    .values([
      { displayName: "Requester", role: "supervisor", pinHash: HASH },
      { displayName: "Approver", role: "manager", pinHash: HASH },
    ])
    .returning();
  personId = people[0]!.id;
  managerId = people[1]!.id;
  const [session] = await db
    .insert(sessions)
    .values({ personId, deviceId: device.deviceId, tokenHash: hashSessionToken(randomUUID()) })
    .returning();
  sessionId = session!.id;
  attempts = { throttle: createPinThrottle(), slot: `override:${device.deviceId}` };
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "TR", purpose: "standard" })
    .returning();
  seriesId = series!.id;
  const [printer] = await db
    .insert(printers)
    .values({
      locationId: placeId,
      name: "Drawer",
      transport: "cloud_poll",
      pollId: randomUUID(),
      hasCashDrawer: true,
    })
    .returning();
  drawerId = printer!.id;
  await db.insert(deviceProfilePrinters).values({
    deviceProfileId: profileId,
    printerId: drawerId,
    role: "cash_drawer",
    isDefault: true,
    position: 0,
  });
  deps = {
    db,
    clock: createTrustedClock({
      deviceId: device.deviceId,
      monotonic: () => 0,
      wallClock: () => Date.parse(AT),
      degradedAfterSeconds: 300,
    }),
    attendance: recordAttendanceFact,
  };
  counter = 0;
});
async function target(method: "cash" | "card" = "cash", provider = "manual", tip = 0) {
  const orderId = randomUUID();
  await store.db.insert(workingOrders).values({
    id: orderId,
    source: "device",
    deviceId: cfg.origin.deviceId,
    nodeId: cfg.nodeId,
    locationId: cfg.locationId,
    orderNumber: ++counter,
  });
  const [sale] = await store.db
    .insert(sales)
    .values({
      source: "device",
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
      seriesId,
      invoiceNumber: counter,
      workingOrderId: orderId,
      issuedAt: "2026-10-15T09:00:00.000Z",
      issuedOffsetMinutes: 0,
      total: 1000,
      vatBreakdown: [],
      locale: "en-GB",
      invoiceLocales: ["en-GB"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
    })
    .returning();
  const [tender] = await store.db
    .insert(tenders)
    .values({ saleId: sale!.id, method, amount: 1000 + tip, tipAmount: tip, settledAt: AT })
    .returning();
  await store.db.insert(saleSettlements).values({ saleId: sale!.id, settledAt: AT });
  const paymentRef = randomUUID();
  if (method === "card")
    await store.db.insert(payments).values({
      saleId: sale!.id,
      workingOrderId: orderId,
      source: "device",
      deviceId: cfg.origin.deviceId,
      provider,
      paymentRef,
      amount: 1000 + tip,
      state: "captured",
    });
  return { saleId: sale!.id, tenderId: tender!.id, paymentRef };
}
type Target = Awaited<ReturnType<typeof target>>;
function request(t: Target, patch: Partial<TenderRefundRequest> = {}): TenderRefundRequest {
  return {
    submissionId: randomUUID(),
    tenderId: t.tenderId,
    appliedAmount: "2.00",
    tipAmount: "0.00",
    reason: "Goodwill",
    cashConfirmed: true,
    ...patch,
  };
}
const operator = () => ({ personId, sessionId, attempts });
const override = () => ({ personId: managerId, pin: PIN });
const run = (t: Target, req = request(t), dependency = deps) =>
  beginSettledTenderRefund(dependency, cfg, t.saleId, req, operator());
async function originalFacts() {
  return {
    sales: await store.db.select().from(sales),
    tenders: await store.db.select().from(tenders),
    settlements: await store.db.select().from(saleSettlements),
    orders: await store.db.select().from(workingOrders),
    series: await store.db.select().from(invoiceSeries),
  };
}
async function noEffects() {
  expect(await store.db.select().from(tenderRefunds)).toEqual([]);
  expect(await store.db.select().from(drawerOpens)).toEqual([]);
  expect(await store.db.select().from(printJobs)).toEqual([]);
  expect(await store.db.select().from(paymentRefunds)).toEqual([]);
  expect(await store.db.select().from(attendanceOperationFacts)).toEqual([]);
}

describe("settled-tender refund command local transaction", () => {
  it("completes confirmed cash, its attendance and audited drawer without changing the invoice", async () => {
    const t = await target();
    const before = await originalFacts();
    const result = await run(t);
    expect(result).toEqual({
      id: expect.any(String),
      saleId: t.saleId,
      tenderId: t.tenderId,
      state: "completed",
      appliedAmount: "2.00",
      tipAmount: "0.00",
      createdAt: AT,
      completedAt: AT,
    });
    expect(await store.db.select().from(tenderRefunds)).toMatchObject([
      {
        id: result.id,
        state: "completed",
        requestedBy: personId,
        authorizedBy: personId,
        completedAt: AT,
        appliedAmount: 200,
      },
    ]);
    expect(await store.db.select().from(drawerOpens)).toMatchObject([
      {
        tenderRefundId: result.id,
        saleId: t.saleId,
        personId,
        authorizedBy: personId,
        printerId: drawerId,
      },
    ]);
    expect(await store.db.select().from(printJobs)).toMatchObject([
      { kind: "drawer", printerId: drawerId },
    ]);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([
      {
        source: "refund",
        key: result.id,
        personId,
        locationId: cfg.locationId,
        kind: "payment",
        at: AT,
        outcome: "qualifying",
      },
    ]);
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect(await originalFacts()).toEqual(before);
  });
  it("replays the same completed cash return without another audit, drawer or attendance call", async () => {
    const t = await target();
    const req = request(t, { appliedAmount: "10.00" });
    const first = await run(t, req);
    const snapshot = {
      refunds: await store.db.select().from(tenderRefunds),
      drawers: await store.db.select().from(drawerOpens),
      jobs: await store.db.select().from(printJobs),
      attendance: await store.db.select().from(attendanceOperationFacts),
    };
    const failIfCalled: TenderRefundDeps = {
      ...deps,
      attendance: async () => {
        throw new Error("repeated attendance");
      },
    };
    expect(await run(t, req, failIfCalled)).toEqual(first);
    expect({
      refunds: await store.db.select().from(tenderRefunds),
      drawers: await store.db.select().from(drawerOpens),
      jobs: await store.db.select().from(printJobs),
      attendance: await store.db.select().from(attendanceOperationFacts),
    }).toEqual(snapshot);
  });
  it("rolls back completion, drawer audit/job and attendance together", async () => {
    const t = await target();
    const before = await originalFacts();
    let reached = false;
    await expect(
      run(t, request(t), {
        ...deps,
        attendance: async (tx, fact) => {
          expect(await tx.select().from(tenderRefunds)).toMatchObject([
            { state: "completed", id: fact.key },
          ]);
          expect(await tx.select().from(drawerOpens)).toHaveLength(1);
          expect(await tx.select().from(printJobs)).toHaveLength(1);
          await recordAttendanceFact(tx, fact);
          reached = true;
          throw new Error("attendance failed");
        },
      }),
    ).rejects.toThrow("attendance failed");
    expect(reached).toBe(true);
    await noEffects();
    expect(await originalFacts()).toEqual(before);
  });
  it("records the actual approving manager in the cash audit", async () => {
    const t = await target();
    await store.db.update(persons).set({ role: "staff" }).where(eq(persons.id, personId));
    const result = await run(t, request(t, { override: override() }));
    expect(await store.db.select().from(drawerOpens)).toMatchObject([
      { tenderRefundId: result.id, personId, authorizedBy: managerId, viaOverride: true },
    ]);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([{ personId }]);
  });
  it("does not return cash without confirmation", async () => {
    const t = await target();
    await expect(run(t, request(t, { cashConfirmed: false }))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "cashConfirmed" },
    });
    await noEffects();
  });
  it.each(["permission", "session", "device", "cash-policy"] as const)(
    "does not complete cash after %s is revoked",
    async (part) => {
      const t = await target();
      if (part === "permission")
        await store.db.update(persons).set({ role: "staff" }).where(eq(persons.id, personId));
      if (part === "session")
        await store.db.update(sessions).set({ endedAt: AT }).where(eq(sessions.id, sessionId));
      if (part === "device")
        await store.db
          .update(devices)
          .set({ active: false })
          .where(eq(devices.id, cfg.origin.deviceId));
      if (part === "cash-policy")
        await store.db
          .update(deviceProfiles)
          .set({ capabilities: [] })
          .where(eq(deviceProfiles.id, profileId));
      const code = {
        permission: "authorization.not_permitted",
        session: "session.required",
        device: "device.unauthorized",
        "cash-policy": "device.cash_not_allowed",
      }[part];
      await expect(run(t)).rejects.toMatchObject({ code });
      await noEffects();
    },
  );
  it("completes cash without a drawer job when the profile has no drawer permission", async () => {
    const t = await target();
    await store.db
      .update(deviceProfiles)
      .set({ capabilities: ["take-cash"] })
      .where(eq(deviceProfiles.id, profileId));
    expect((await run(t)).state).toBe("completed");
    expect(await store.db.select().from(drawerOpens)).toEqual([]);
    expect(await store.db.select().from(printJobs)).toEqual([]);
    expect(await store.db.select().from(attendanceOperationFacts)).toHaveLength(1);
  });
  it("serializes duplicate cash clicks as one completed return", async () => {
    const t = await target();
    const req = request(t);
    const results = await Promise.all([run(t, req), run(t, req)]);
    expect(results[1]).toEqual(results[0]);
    expect(await store.db.select().from(tenderRefunds)).toHaveLength(1);
    expect(await store.db.select().from(drawerOpens)).toHaveLength(1);
    expect(await store.db.select().from(printJobs)).toHaveLength(1);
    expect(await store.db.select().from(attendanceOperationFacts)).toHaveLength(1);
  });
  it("concurrent different requests cannot return more cash than the original tender", async () => {
    const t = await target();
    const results = await Promise.allSettled([
      run(t, request(t, { appliedAmount: "7.00" })),
      run(t, request(t, { appliedAmount: "7.00" })),
    ]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(results[1]).toMatchObject({ reason: { code: "tender.refund_exceeds_payment" } });
    expect(await store.db.select().from(tenderRefunds)).toMatchObject([
      { state: "completed", appliedAmount: 700 },
    ]);
    expect(await store.db.select().from(printJobs)).toHaveLength(1);
  });
  it("refuses altered request identity after completion", async () => {
    const t = await target();
    const req = request(t);
    await run(t, req);
    await expect(run(t, { ...req, reason: "Different" })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
    expect(await store.db.select().from(printJobs)).toHaveLength(1);
  });
  it("completes a confirmed manual-terminal return with one local evidence row and no provider or drawer call", async () => {
    const t = await target("card", "manual", 100);
    const before = await originalFacts();
    const req = request(t, {
      appliedAmount: "10.00",
      tipAmount: "1.00",
      manualConfirmed: true,
      override: override(),
    });
    const localDeps = {
      ...deps,
      refundProviderFor: async () => {
        throw new Error("manual provider lookup");
      },
    };
    const result = await run(t, req, localDeps);
    expect(result).toMatchObject({
      state: "completed",
      appliedAmount: "10.00",
      tipAmount: "1.00",
      completedAt: AT,
    });
    expect(await store.db.select().from(paymentRefunds)).toMatchObject([
      {
        provider: "manual",
        paymentRef: t.paymentRef,
        amount: 1100,
        state: "succeeded",
        authorizedBy: managerId,
      },
    ]);
    expect(await store.db.select().from(payments)).toMatchObject([
      { paymentRef: t.paymentRef, state: "refunded", amount: 1100 },
    ]);
    expect(await store.db.select().from(tenderRefunds)).toMatchObject([
      { authorizedBy: managerId, manual: true },
    ]);
    expect(await store.db.select().from(drawerOpens)).toEqual([]);
    expect(await store.db.select().from(printJobs)).toEqual([]);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([
      { key: result.id, personId, outcome: "qualifying" },
    ]);
    expect(await originalFacts()).toEqual(before);
    expect(await run(t, req, localDeps)).toEqual(result);
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
  });
  it.each(["pin", "confirmation"] as const)(
    "a manual-terminal command requires %s before writing money",
    async (part) => {
      const t = await target("card");
      await expect(
        run(t, request(t, part === "pin" ? { manualConfirmed: true } : { override: override() })),
      ).rejects.toMatchObject({
        code: part === "pin" ? "tender.manual_refund_pin_required" : "management.request_invalid",
      });
      await noEffects();
    },
  );
  it("rolls back manual provider evidence if attendance fails", async () => {
    const t = await target("card");
    let reached = false;
    await expect(
      run(t, request(t, { manualConfirmed: true, override: override() }), {
        ...deps,
        attendance: async (tx, fact) => {
          expect(await tx.select().from(paymentRefunds)).toMatchObject([
            { amount: 200, state: "succeeded" },
          ]);
          await recordAttendanceFact(tx, fact);
          reached = true;
          throw new Error("attendance failed");
        },
      }),
    ).rejects.toThrow("attendance failed");
    expect(reached).toBe(true);
    await noEffects();
    expect(await store.db.select().from(payments)).toMatchObject([
      { state: "captured", amount: 1000 },
    ]);
  });
  it("can record a local return without an attendance recorder", async () => {
    const t = await target();
    const withoutAttendance = { db: deps.db, clock: deps.clock };
    expect((await run(t, request(t), withoutAttendance)).state).toBe("completed");
    expect(await store.db.select().from(attendanceOperationFacts)).toEqual([]);
    expect(await store.db.select().from(printJobs)).toHaveLength(1);
  });
  it("checks connected refund capability before committing a reservation", async () => {
    const t = await target("card", "missing");
    await expect(run(t)).rejects.toMatchObject({ code: "tender.refund_unavailable" });
    await noEffects();
  });
  it.each(["wrong-provider", "missing-send"] as const)(
    "does not reserve against a %s adapter",
    async (kind) => {
      const t = await target("card", kind === "wrong-provider" ? "other" : "fake");
      const provider = new FakePaymentProvider(store.db);
      if (kind === "missing-send")
        Object.defineProperty(provider, "sendRefund", { value: undefined });
      await expect(
        run(t, request(t), { ...deps, refundProviderFor: async () => provider }),
      ).rejects.toMatchObject({ code: "tender.refund_unavailable" });
      await noEffects();
    },
  );
  it("manual partial returns count local evidence and the refund ledger only once", async () => {
    const t = await target("card");
    const local = (appliedAmount: string) =>
      run(t, request(t, { appliedAmount, manualConfirmed: true, override: override() }));
    expect((await local("2.00")).state).toBe("completed");
    expect((await local("3.00")).state).toBe("completed");
    expect((await local("5.00")).state).toBe("completed");
    expect(await store.db.select({ amount: paymentRefunds.amount }).from(paymentRefunds)).toEqual([
      { amount: 200 },
      { amount: 300 },
      { amount: 500 },
    ]);
    expect(await store.db.select().from(tenderRefunds)).toHaveLength(3);
    await expect(local("0.01")).rejects.toMatchObject({ code: "tender.refund_unavailable" });
    expect(await store.db.select().from(printJobs)).toEqual([]);
  });
  it("pending replays remain discoverable without another provider lookup or attendance record", async () => {
    const t = await target("card", "fake");
    const provider = new FakePaymentProvider(store.db);
    const req = request(t);
    const first = await run(t, req, { ...deps, refundProviderFor: async () => provider });
    expect(
      await run(t, req, {
        ...deps,
        refundProviderFor: async () => {
          throw new Error("repeat lookup");
        },
        attendance: async () => {
          throw new Error("repeat attendance");
        },
      }),
    ).toEqual(first);
    expect(await store.db.select().from(tenderRefunds)).toHaveLength(1);
    expect(await store.db.select().from(attendanceOperationFacts)).toHaveLength(1);
  });
  it("keeps a connected-capable command pending without fabricating returned money", async () => {
    const t = await target("card", "fake");
    const before = await originalFacts();
    const provider = new FakePaymentProvider(store.db);
    const result = await run(t, request(t), {
      ...deps,
      refundProviderFor: async (name) => (name === "fake" ? provider : undefined),
    });
    expect(result).toMatchObject({ state: "pending", completedAt: null });
    expect(await store.db.select().from(tenderRefunds)).toMatchObject([
      { id: result.id, state: "pending", sentAt: null, sendCount: 0 },
    ]);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([
      { key: result.id, outcome: "pending" },
    ]);
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect(await store.db.select().from(printJobs)).toEqual([]);
    expect(await originalFacts()).toEqual(before);
    expect(provider.refundCalls).toEqual([]);
  });
});
