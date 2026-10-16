import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  billPayments,
  billPaymentRefunds,
  incidents,
  withTransaction,
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
import {
  beginSettledTenderRefund,
  refundSettledTender,
  type TenderRefundDeps,
} from "./tender-refunds.js";
import {
  claimTenderRefund,
  resumeTenderRefund,
  tenderRefundIsLive,
} from "./tender-refund-sends.js";
import { recoverTenderRefunds, runTenderRefundRecoveryLoop } from "./tender-refund-recovery.js";
import type { RefundAnswer, RefundLookup } from "@waitron/payments";
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
async function target(
  method: "cash" | "card" = "cash",
  provider = "manual",
  tip = 0,
  billDerived = false,
) {
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
  const bill = billDerived
    ? (
        await store.db
          .insert(billPayments)
          .values({
            workingOrderId: orderId,
            submissionId: randomUUID(),
            fingerprint: "pre",
            kind: "contribution",
            method: "card",
            applied: 1000,
            tip,
            state: "received",
            requestedBy: personId,
            source: "device",
            deviceId: cfg.origin.deviceId,
            receivedAt: AT,
          })
          .returning()
      )[0]!
    : undefined;
  const [tender] = await store.db
    .insert(tenders)
    .values({
      saleId: sale!.id,
      billPaymentId: bill?.id,
      method,
      amount: 1000 + tip,
      tipAmount: tip,
      settledAt: AT,
    })
    .returning();
  await store.db.insert(saleSettlements).values({ saleId: sale!.id, settledAt: AT });
  const paymentRef = randomUUID();
  if (method === "card")
    await store.db.insert(payments).values({
      saleId: sale!.id,
      billPaymentId: bill?.id,
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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LOST: RefundAnswer = { kind: "uncertain", reason: "network" };
const SENT: RefundAnswer = {
  kind: "outcome",
  outcome: "completed",
  providerRefundRef: "event-1",
  providerStatus: "succeeded",
};
async function connected(tip = 0, billDerived = false) {
  const t = await target("card", "fake", tip, billDerived);
  const provider = new FakePaymentProvider(store.db);
  deps.refundProviderFor = async () => provider;
  return { t, provider };
}
async function row(id: string) {
  return (await store.db.select().from(tenderRefunds).where(eq(tenderRefunds.id, id)))[0]!;
}

describe("settled-tender connected refund orchestration", () => {
  it("commits pending and its send stamp before I/O, with exact money and a stable attempt key", async () => {
    const { t, provider } = await connected(100);
    const before = await originalFacts();
    const capturesBefore = (await store.db.select().from(payments)).map((row) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== "state" && key !== "updatedAt"),
      ),
    );
    const send = vi.spyOn(provider, "sendRefund").mockImplementation(async (sent) => {
      const persisted = await row(sent.refundId);
      expect(persisted).toMatchObject({
        state: "pending",
        sentAt: AT,
        sendCount: 1,
        appliedAmount: 1000,
        tipAmount: 100,
      });
      // A separate writer must be able to commit while the provider is answering.
      await withTransaction(store.db, async () => {});
      expect(sent).toEqual({
        processorRef: t.paymentRef,
        amount: "11.00",
        refundId: persisted.id,
        idempotencyKey: `tr_${persisted.id}`,
      });
      return SENT;
    });
    const result = await refundSettledTender(
      deps,
      cfg,
      t.saleId,
      request(t, { appliedAmount: "10.00", tipAmount: "1.00" }),
      operator(),
    );
    expect(result.state).toBe("completed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(
      (await store.db.select().from(payments)).map((row) =>
        Object.fromEntries(
          Object.entries(row).filter(([key]) => key !== "state" && key !== "updatedAt"),
        ),
      ),
    ).toEqual(capturesBefore);
    expect(await row(result.id)).toMatchObject({
      state: "completed",
      completedAt: AT,
      providerRefundRef: "event-1",
      providerStatus: "completed",
    });
    expect(await store.db.select().from(paymentRefunds)).toMatchObject([
      {
        paymentRef: t.paymentRef,
        amount: 1100,
        state: "succeeded",
        authorizedBy: personId,
        providerRefundRef: "event-1",
      },
    ]);
    expect(await originalFacts()).toEqual(before);
    expect(await store.db.select().from(printJobs)).toEqual([]);
  });
  it("replays a completed network return without another send or evidence row", async () => {
    const { t, provider } = await connected();
    const req = request(t);
    const first = await refundSettledTender(deps, cfg, t.saleId, req, operator());
    expect(first.state).toBe("completed");
    expect(await refundSettledTender(deps, cfg, t.saleId, req, operator())).toEqual(first);
    expect(provider.refundCalls).toHaveLength(1);
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
    expect(tenderRefundIsLive(store.db, first.id)).toBe(false);
  });
  it("never sends or looks up a completed cash return", async () => {
    const t = await target();
    deps.refundProviderFor = async () => {
      throw new Error("cash called provider");
    };
    expect((await refundSettledTender(deps, cfg, t.saleId, request(t), operator())).state).toBe(
      "completed",
    );
    expect(await store.db.select().from(drawerOpens)).toHaveLength(1);
  });
  it("keeps a thrown send pending, then resolves by lookup without sending again", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: "completed", answer: "throw" });
    const req = request(t);
    const first = await refundSettledTender(deps, cfg, t.saleId, req, operator());
    expect(first.state).toBe("pending");
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect((await refundSettledTender(deps, cfg, t.saleId, req, operator())).state).toBe(
      "completed",
    );
    expect(provider.refundCalls).toHaveLength(1);
    expect(provider.lookupCalls).toHaveLength(1);
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
  });
  it.each([
    [
      "definite failure",
      {
        kind: "outcome",
        outcome: "failed",
        providerRefundRef: "failed-1",
        providerStatus: "failed",
      },
      "failed",
    ],
    [
      "pending record",
      {
        kind: "outcome",
        outcome: "pending",
        providerRefundRef: "pending-1",
        providerStatus: "pending",
      },
      "pending",
    ],
    ["documented first refusal", { kind: "refused", documented: true, httpStatus: 400 }, "failed"],
    ["undocumented refusal", { kind: "refused", documented: false, httpStatus: 400 }, "pending"],
    ["network uncertainty", LOST, "pending"],
  ] as const)("records %s only as its evidence permits", async (_label, answer, expected) => {
    const { t, provider } = await connected();
    vi.spyOn(provider, "sendRefund").mockResolvedValue(answer);
    const result = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect(result.state).toBe(expected);
    expect(await row(result.id)).toMatchObject({
      state: expected,
      failedAt: expected === "failed" ? AT : null,
      completedAt: null,
      sendCount: 1,
    });
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([
      { outcome: expected === "failed" ? "refused" : "pending" },
    ]);
  });
  it("looks up an accepted answer immediately and records its matched outcome", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: "completed", answer: { kind: "accepted" } });
    expect((await refundSettledTender(deps, cfg, t.saleId, request(t), operator())).state).toBe(
      "completed",
    );
    expect(provider.lookupCalls).toHaveLength(1);
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
  });
  it("persists the provider's before-send refs and uses its processor reference", async () => {
    const { t, provider } = await connected();
    await store.db
      .update(payments)
      .set({ externalRef: "processor-1" })
      .where(eq(payments.paymentRef, t.paymentRef));
    provider.existingRefundRefs = async (ref) => {
      expect(ref).toBe("processor-1");
      expect(await store.db.select().from(tenderRefunds)).toMatchObject([
        { state: "pending", sentAt: null, sendCount: 0 },
      ]);
      return ["preexisting"];
    };
    vi.spyOn(provider, "sendRefund").mockImplementation(async () => {
      expect(await store.db.select().from(tenderRefunds)).toMatchObject([
        { refsBeforeSend: ["preexisting"], sendCount: 1 },
      ]);
      return { kind: "accepted" };
    });
    provider.scriptLookups({ kind: "none" });
    const result = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect(result.state).toBe("pending");
    expect(provider.lookupCalls).toEqual([
      {
        processorRef: "processor-1",
        refundId: result.id,
        amount: "2.00",
        sentAt: new Date(AT),
        refsBeforeSend: ["preexisting"],
        excludeRefs: [],
      },
    ]);
  });
  it.each(["none", "unreachable", "ambiguous"] as const)(
    "loop lookup %s retains the reservation and never sends",
    async (kind) => {
      const { t, provider } = await connected();
      provider.scriptNextRefund({ made: false, answer: LOST });
      const result = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
      provider.scriptLookups(kind === "ambiguous" ? { kind, candidates: 2 } : { kind });
      expect((await resumeTenderRefund(deps, result.id, "loop")).state).toBe("pending");
      expect(provider.refundCalls).toHaveLength(1);
      await expect(run(t, request(t))).rejects.toMatchObject({ code: "tender.refund_in_progress" });
      expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    },
  );
  it("resends only after an empty lookup inside the key window and preserves the key", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: false, answer: LOST });
    const result = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect((await resumeTenderRefund(deps, result.id, "retry")).state).toBe("completed");
    expect(provider.lookupCalls).toHaveLength(1);
    expect(provider.refundCalls).toHaveLength(2);
    expect(provider.refundCalls[1]).toEqual(provider.refundCalls[0]);
    expect(await row(result.id)).toMatchObject({ sendCount: 2, sentAt: AT });
  });
  it.each([null, 0] as const)("does not resend without an open key window (%s)", async (window) => {
    const { t, provider } = await connected();
    provider.refundResendWindowMs = window;
    provider.scriptNextRefund({ made: false, answer: LOST });
    const result = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect((await resumeTenderRefund(deps, result.id, "retry")).state).toBe("pending");
    expect(provider.refundCalls).toHaveLength(1);
  });
  it("does not release a reservation on a documented refusal of a later send", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: false, answer: LOST });
    const result = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    provider.scriptNextRefund({
      made: false,
      answer: { kind: "refused", documented: true, httpStatus: 400 },
    });
    expect((await resumeTenderRefund(deps, result.id, "retry")).state).toBe("pending");
    expect(await row(result.id)).toMatchObject({ state: "pending", sendCount: 2, failedAt: null });
  });
  it("a loop fails a never-sent intent without contacting a provider", async () => {
    const { t, provider } = await connected();
    const pending = await run(t);
    const send = vi.spyOn(provider, "sendRefund");
    expect((await resumeTenderRefund(deps, pending.id, "loop")).state).toBe("failed");
    expect(send).not.toHaveBeenCalled();
    expect(provider.lookupCalls).toEqual([]);
    expect(await row(pending.id)).toMatchObject({ failedAt: AT, sentAt: null, sendCount: 0 });
  });
  it("returns pending at ten seconds while holding ownership until a late send settles", async () => {
    const { t, provider } = await connected();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const release = provider.holdNextRefund();
    let entered!: () => void;
    const called = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const send = provider.sendRefund.bind(provider);
    vi.spyOn(provider, "sendRefund").mockImplementation((request) => {
      const result = send(request);
      entered();
      return result;
    });
    const requestPromise = refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    await called;
    expect(provider.refundCalls).toHaveLength(1);
    const id = provider.refundCalls[0]!.refundId;
    let answered = false;
    void requestPromise.then(() => {
      answered = true;
    });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(answered).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await requestPromise).state).toBe("pending");
    expect(tenderRefundIsLive(store.db, id)).toBe(true);
    expect((await resumeTenderRefund(deps, id, "manager")).state).toBe("pending");
    expect(provider.lookupCalls).toEqual([]);
    expect(provider.refundCalls).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(tenderRefundIsLive(store.db, id)).toBe(false));
    expect(await row(id)).toMatchObject({
      state: "completed",
      providerRefundRef: expect.any(String),
    });
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
  });
});

describe("settled-tender refund evidence and interruption boundaries", () => {
  it("holds the fresh reservation before a recovery pass can see the commit", async () => {
    const { t } = await connected();
    const original = store.db.withWriteLock.bind(store.db);
    let checked = false;
    vi.spyOn(store.db, "withWriteLock").mockImplementation(async (body) => {
      const result = await original(body);
      const [pending] = await store.db.select().from(tenderRefunds);
      if (!checked && pending?.state === "pending" && pending.sentAt === null) {
        checked = true;
        expect(tenderRefundIsLive(store.db, pending.id)).toBe(true);
        expect((await resumeTenderRefund(deps, pending.id, "loop")).state).toBe("pending");
      }
      return result;
    });
    expect((await refundSettledTender(deps, cfg, t.saleId, request(t), operator())).state).toBe(
      "completed",
    );
    expect(checked).toBe(true);
  });
  it("records terminal provider evidence and attendance in one rollback boundary", async () => {
    const { t } = await connected();
    const pending = await run(t);
    const broken: TenderRefundDeps = {
      ...deps,
      attendance: async (tx, fact) => {
        expect(fact.outcome).toBe("qualified");
        expect(await tx.select().from(tenderRefunds)).toMatchObject([{ state: "completed" }]);
        expect(await tx.select().from(paymentRefunds)).toHaveLength(1);
        throw new Error("late attendance write failed");
      },
    };
    await expect(resumeTenderRefund(broken, pending.id, "retry")).rejects.toThrow(
      "late attendance write failed",
    );
    expect(await row(pending.id)).toMatchObject({
      state: "pending",
      sentAt: AT,
      sendCount: 1,
      providerRefundRef: null,
    });
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect((await resumeTenderRefund(deps, pending.id, "loop")).state).toBe("completed");
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([
      { outcome: "qualifying" },
    ]);
  });
  it("retains a pending provider event and completes that same event on lookup", async () => {
    const { t, provider } = await connected();
    vi.spyOn(provider, "sendRefund").mockResolvedValue({
      kind: "outcome",
      outcome: "pending",
      providerRefundRef: "inflight",
      providerStatus: "pending",
    });
    const first = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect(await row(first.id)).toMatchObject({
      state: "pending",
      providerRefundRef: "inflight",
      providerStatus: "pending",
    });
    provider.scriptLookups({
      kind: "match",
      providerRefundRef: "inflight",
      outcome: "completed",
      providerStatus: "succeeded",
    });
    expect((await resumeTenderRefund(deps, first.id, "loop")).state).toBe("completed");
    expect(await store.db.select().from(paymentRefunds)).toMatchObject([
      { providerRefundRef: "inflight", amount: 200 },
    ]);
  });
  it("retains the first pending event and raises an incident on a conflicting event", async () => {
    const { t, provider } = await connected();
    vi.spyOn(provider, "sendRefund").mockResolvedValue({
      kind: "outcome",
      outcome: "pending",
      providerRefundRef: "first-event",
      providerStatus: "pending",
    });
    const first = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    provider.scriptLookups({
      kind: "match",
      providerRefundRef: "other-event",
      outcome: "completed",
      providerStatus: "succeeded",
    });
    expect((await resumeTenderRefund(deps, first.id, "loop")).state).toBe("pending");
    expect(await row(first.id)).toMatchObject({
      providerRefundRef: "first-event",
      state: "pending",
    });
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect(await store.db.select().from(incidents)).toMatchObject([
      {
        code: "payment.tender_refund_outcome_conflict",
        params: { refundId: first.id, saleId: t.saleId, providerRefundRef: "other-event" },
      },
    ]);
  });
  it("does not attribute an event already held by a failed settled-tender refund", async () => {
    const { t, provider } = await connected();
    vi.spyOn(provider, "sendRefund").mockResolvedValue({
      kind: "outcome",
      outcome: "failed",
      providerRefundRef: "attributed-failure",
      providerStatus: "failed",
    });
    const failed = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect(failed.state).toBe("failed");
    vi.spyOn(provider, "sendRefund").mockResolvedValue(SENT);
    provider.scriptLookups({
      kind: "match",
      providerRefundRef: "attributed-failure",
      outcome: "completed",
      providerStatus: "succeeded",
    });
    // Start separately to exercise the lookup path, which must union all ledgers' references.
    const next = await run(t);
    await store.db
      .update(tenderRefunds)
      .set({ sentAt: AT, sendCount: 1 })
      .where(eq(tenderRefunds.id, next.id));
    expect((await resumeTenderRefund(deps, next.id, "loop")).state).toBe("pending");
    expect(provider.lookupCalls.at(-1)!.excludeRefs).toEqual(["attributed-failure"]);
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect(await store.db.select().from(incidents)).toMatchObject([
      { code: "payment.tender_refund_outcome_conflict" },
    ]);
  });
  it("excludes pre-invoice and provider evidence from the same bill-derived capture only", async () => {
    const { t, provider } = await connected(0, true);
    const [payment] = await store.db
      .select()
      .from(payments)
      .where(eq(payments.paymentRef, t.paymentRef));
    // A new settled sale can point to its already received bill tender before settlement.
    const pending = await run(t);
    await store.db.insert(billPaymentRefunds).values({
      billPaymentId: payment!.billPaymentId!,
      submissionId: randomUUID(),
      fingerprint: "failed-pre",
      appliedAmount: 100,
      reason: "pre",
      authorizedBy: personId,
      requestedBy: personId,
      source: "device",
      deviceId: cfg.origin.deviceId,
      state: "failed",
      failedAt: AT,
      providerRefundRef: "pre-failed",
    });
    await store.db.insert(paymentRefunds).values({
      paymentId: payment!.id,
      provider: "fake",
      paymentRef: t.paymentRef,
      amount: 100,
      state: "failed",
      providerRefundRef: "provider-failed",
    });
    const other = await connected();
    const [otherPayment] = await store.db
      .select()
      .from(payments)
      .where(eq(payments.paymentRef, other.t.paymentRef));
    await store.db.insert(paymentRefunds).values({
      paymentId: otherPayment!.id,
      provider: "fake",
      paymentRef: other.t.paymentRef,
      amount: 100,
      state: "failed",
      providerRefundRef: "unrelated",
    });
    deps.refundProviderFor = async () => provider;
    await store.db
      .update(tenderRefunds)
      .set({ sentAt: AT, sendCount: 1 })
      .where(eq(tenderRefunds.id, pending.id));
    const pendingRow = await row(pending.id);
    await store.db.insert(tenderRefunds).values({
      ...pendingRow,
      id: randomUUID(),
      submissionId: randomUUID(),
      state: "failed",
      failedAt: AT,
      providerRefundRef: "post-failed",
    });
    provider.scriptLookups({ kind: "none" });
    expect((await resumeTenderRefund(deps, pending.id, "loop")).state).toBe("pending");
    expect([...provider.lookupCalls.at(-1)!.excludeRefs].sort()).toEqual([
      "post-failed",
      "pre-failed",
      "provider-failed",
    ]);
  });
  it("returns pending on a lookup deadline, retains ownership, and applies late evidence once", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: false, answer: LOST });
    const pending = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release!: (answer: RefundLookup) => void;
    const hold = new Promise<RefundLookup>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(provider, "lookupRefund").mockImplementation(() => hold);
    const retry = resumeTenderRefund(deps, pending.id, "retry");
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await retry).state).toBe("pending");
    expect(tenderRefundIsLive(store.db, pending.id)).toBe(true);
    expect((await resumeTenderRefund(deps, pending.id, "loop")).state).toBe("pending");
    release({
      kind: "match",
      providerRefundRef: "late-lookup",
      outcome: "completed",
      providerStatus: "succeeded",
    });
    await vi.waitFor(() => expect(tenderRefundIsLive(store.db, pending.id)).toBe(false));
    expect(await row(pending.id)).toMatchObject({
      state: "completed",
      providerRefundRef: "late-lookup",
    });
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
    expect(provider.refundCalls).toHaveLength(1);
  });
  it("does not send after a before-send lookup exceeded the response deadline", async () => {
    const { t, provider } = await connected();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release!: (refs: string[]) => void;
    const hold = new Promise<string[]>((resolve) => {
      release = resolve;
    });
    let entered = false;
    provider.existingRefundRefs = () => {
      entered = true;
      return hold;
    };
    const begun = refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    await vi.waitFor(() => expect(entered).toBe(true));
    await vi.advanceTimersByTimeAsync(10_000);
    const pending = await begun;
    expect(pending.state).toBe("pending");
    expect(tenderRefundIsLive(store.db, pending.id)).toBe(true);
    release([]);
    await vi.waitFor(() => expect(tenderRefundIsLive(store.db, pending.id)).toBe(false));
    expect(provider.refundCalls).toEqual([]);
    expect(await row(pending.id)).toMatchObject({ sentAt: null, sendCount: 0, state: "pending" });
  });
  it("does not resend after a late empty lookup", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: false, answer: LOST });
    const pending = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let release!: (answer: RefundLookup) => void;
    const hold = new Promise<RefundLookup>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(provider, "lookupRefund").mockImplementation(() => hold);
    const retry = resumeTenderRefund(deps, pending.id, "retry");
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await retry).state).toBe("pending");
    release({ kind: "none" });
    await vi.waitFor(() => expect(tenderRefundIsLive(store.db, pending.id)).toBe(false));
    expect(provider.refundCalls).toHaveLength(1);
    expect(await row(pending.id)).toMatchObject({ sendCount: 1, state: "pending" });
  });
  it.each(["missing", "wrong", "throwing"] as const)(
    "preserves sent money with a %s adapter",
    async (kind) => {
      const { t, provider } = await connected();
      provider.scriptNextRefund({ made: false, answer: LOST });
      const pending = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
      const reads = vi.spyOn(provider, "lookupRefund");
      deps.refundProviderFor = async () => {
        if (kind === "throwing") throw new Error("provider unavailable");
        if (kind === "missing") return undefined;
        Object.defineProperty(provider, "provider", { value: "other" });
        return provider;
      };
      expect((await resumeTenderRefund(deps, pending.id, "retry")).state).toBe("pending");
      expect(reads).not.toHaveBeenCalled();
      expect(provider.refundCalls).toHaveLength(1);
      expect(tenderRefundIsLive(store.db, pending.id)).toBe(false);
    },
  );
  it("keeps both callers on one live sender when the same request is submitted together", async () => {
    const { t, provider } = await connected();
    const release = provider.holdNextRefund();
    const req = request(t);
    const first = refundSettledTender(deps, cfg, t.saleId, req, operator());
    await vi.waitFor(() => expect(provider.refundCalls).toHaveLength(1));
    const second = await refundSettledTender(deps, cfg, t.saleId, req, operator());
    expect(second.state).toBe("pending");
    expect(provider.refundCalls).toHaveLength(1);
    release();
    expect((await first).state).toBe("completed");
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
  });
});

describe("settled-tender send deadline and terminal controls", () => {
  it("does not send when its send stamp waited behind a writer past the deadline", async () => {
    const { t, provider } = await connected();
    const pending = await run(t);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let refsEntered = false;
    let releaseRefs!: (refs: string[]) => void;
    const refs = new Promise<string[]>((resolve) => {
      releaseRefs = resolve;
    });
    provider.existingRefundRefs = () => {
      refsEntered = true;
      return refs;
    };
    const work = resumeTenderRefund(deps, pending.id, "retry");
    await vi.waitFor(() => expect(refsEntered).toBe(true));
    let locked = false;
    let unlock!: () => void;
    const lockHeld = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const writer = withTransaction(store.db, async () => {
      locked = true;
      await lockHeld;
    });
    await vi.waitFor(() => expect(locked).toBe(true));
    releaseRefs([]);
    // Let the sender reach the held queue without running its deadline.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await work).state).toBe("pending");
    expect(tenderRefundIsLive(store.db, pending.id)).toBe(true);
    unlock();
    await writer;
    await vi.waitFor(() => expect(tenderRefundIsLive(store.db, pending.id)).toBe(false));
    expect(provider.refundCalls).toEqual([]);
    expect(await row(pending.id)).toMatchObject({ sentAt: null, sendCount: 0 });
  });
  it("raises a conflict for a late success after a terminal failure without rewriting either ledger", async () => {
    const { t, provider } = await connected();
    const release = provider.holdNextRefund();
    const work = refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    await vi.waitFor(() => expect(provider.refundCalls).toHaveLength(1));
    const id = provider.refundCalls[0]!.refundId;
    await store.db
      .update(tenderRefunds)
      .set({ state: "failed", failedAt: AT })
      .where(eq(tenderRefunds.id, id));
    release();
    expect((await work).state).toBe("failed");
    expect(await row(id)).toMatchObject({
      state: "failed",
      completedAt: null,
      providerRefundRef: null,
    });
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    expect(await store.db.select().from(incidents)).toMatchObject([
      { code: "payment.tender_refund_outcome_conflict", params: { refundId: id } },
    ]);
  });
  it("releases definitively failed money for a new attempt with a new stable key", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: "failed", answer: "made" });
    const first = await refundSettledTender(
      deps,
      cfg,
      t.saleId,
      request(t, { appliedAmount: "10.00" }),
      operator(),
    );
    expect(first.state).toBe("failed");
    const second = await refundSettledTender(
      deps,
      cfg,
      t.saleId,
      request(t, { appliedAmount: "10.00" }),
      operator(),
    );
    expect(second.state).toBe("completed");
    expect(provider.refundCalls.map((c) => c.idempotencyKey)).toEqual([
      `tr_${first.id}`,
      `tr_${second.id}`,
    ]);
    expect(await store.db.select().from(paymentRefunds)).toMatchObject([{ amount: 1000 }]);
  });
  it.each(["partial", "whole"] as const)(
    "respects provider partial-refund capability for a %s return",
    async (kind) => {
      const { t, provider } = await connected();
      provider.capabilities.partialRefund = false;
      const result = refundSettledTender(
        deps,
        cfg,
        t.saleId,
        request(t, { appliedAmount: kind === "partial" ? "2.00" : "10.00" }),
        operator(),
      );
      if (kind === "partial") {
        await expect(result).rejects.toMatchObject({ code: "tender.refund_unavailable" });
        await noEffects();
        expect(provider.refundCalls).toEqual([]);
      } else {
        expect((await result).state).toBe("completed");
        expect(provider.refundCalls).toHaveLength(1);
      }
    },
  );
  it.each([-1, 86_400_000, 86_400_001])(
    "never resends at an expired or negative key age (%s ms)",
    async (age) => {
      const { t, provider } = await connected();
      provider.scriptNextRefund({ made: false, answer: LOST });
      const pending = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
      deps.clock = createTrustedClock({
        deviceId: cfg.origin.deviceId,
        monotonic: () => 0,
        wallClock: () => Date.parse(AT) + age,
        degradedAfterSeconds: 300,
      });
      expect((await resumeTenderRefund(deps, pending.id, "manager")).state).toBe("pending");
      expect(provider.lookupCalls).toHaveLength(1);
      expect(provider.refundCalls).toHaveLength(1);
    },
  );
});

it("refuses an unknown settled-tender refund by its own domain code", async () => {
  await expect(resumeTenderRefund(deps, randomUUID(), "retry")).rejects.toMatchObject({
    code: "tender.refund_not_found",
  });
});

describe("settled-tender refund scheduled recovery", () => {
  function at(offset: number) {
    deps.clock = createTrustedClock({
      deviceId: cfg.origin.deviceId,
      monotonic: () => 0,
      wallClock: () => Date.parse(AT) + offset,
      degradedAfterSeconds: 300,
    });
  }
  async function abandoned(sent = true) {
    const { t, provider } = await connected();
    const refund = await run(t);
    if (sent)
      await store.db
        .update(tenderRefunds)
        .set({ sentAt: AT, sendCount: 1 })
        .where(eq(tenderRefunds.id, refund.id));
    return { t, provider, refund };
  }
  it("returns no scheduled work when only completed cash returns exist", async () => {
    await run(await target());
    expect(await recoverTenderRefunds(deps)).toEqual({ pending: 0, nextDueAt: null });
    expect(await store.db.select().from(drawerOpens)).toHaveLength(1);
  });
  it("fails an abandoned unsent intent without contacting a provider or opening a drawer", async () => {
    const { refund, provider } = await abandoned(false);
    expect(await recoverTenderRefunds(deps)).toEqual({ pending: 0, nextDueAt: null });
    expect(await row(refund.id)).toMatchObject({
      state: "failed",
      failedAt: AT,
      sentAt: null,
      sendCount: 0,
    });
    expect(provider.lookupCalls).toEqual([]);
    expect(provider.refundCalls).toEqual([]);
    expect(await store.db.select().from(drawerOpens)).toEqual([]);
    expect(await store.db.select().from(attendanceOperationFacts)).toMatchObject([
      { key: refund.id, outcome: "refused" },
    ]);
  });
  it("recovers provider acceptance after a lost answer, recording the return once without resending", async () => {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: "completed", answer: "throw" });
    const refund = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    expect(refund.state).toBe("pending");
    const before = await originalFacts();
    expect(await recoverTenderRefunds(deps)).toEqual({ pending: 0, nextDueAt: null });
    expect(await row(refund.id)).toMatchObject({
      state: "completed",
      completedAt: AT,
      lastLookupAt: AT,
      nextRetryAt: null,
    });
    expect(provider.refundCalls).toHaveLength(1);
    expect(provider.lookupCalls).toHaveLength(1);
    expect(await store.db.select().from(paymentRefunds)).toMatchObject([
      { amount: 200, state: "succeeded" },
    ]);
    expect(await recoverTenderRefunds(deps)).toEqual({ pending: 0, nextDueAt: null });
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
    expect(await originalFacts()).toEqual(before);
  });
  it.each(["none", "ambiguous", "unreachable"] as const)(
    "retains a sent reservation on %s evidence and persists the next lookup",
    async (kind) => {
      const { refund, provider } = await abandoned();
      vi.spyOn(provider, "lookupRefund").mockResolvedValue(
        kind === "ambiguous" ? { kind, candidates: 2 } : { kind },
      );
      expect(await recoverTenderRefunds(deps)).toEqual({
        pending: 1,
        nextDueAt: new Date("2026-10-16T12:01:00.000Z"),
      });
      expect(await row(refund.id)).toMatchObject({
        state: "pending",
        lastLookupAt: AT,
        nextRetryAt: "2026-10-16T12:01:00.000Z",
        sendCount: 1,
      });
      await recoverTenderRefunds({ ...deps });
      expect(provider.lookupRefund).toHaveBeenCalledTimes(1);
      at(60_000);
      await recoverTenderRefunds({ ...deps });
      expect(provider.lookupRefund).toHaveBeenCalledTimes(2);
      expect(provider.refundCalls).toEqual([]);
      expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    },
  );
  it.each([
    [300_000, 75_000],
    [2_400_000, 600_000],
    [28_800_000, 1_800_000],
  ])("backs off an unresolved send aged %s ms by %s ms", async (age, gap) => {
    const { refund, provider } = await abandoned();
    vi.spyOn(provider, "lookupRefund").mockResolvedValue({ kind: "unreachable" });
    at(age);
    const expected = new Date(Date.parse(AT) + age + gap);
    expect(await recoverTenderRefunds(deps)).toEqual({ pending: 1, nextDueAt: expected });
    expect(await row(refund.id)).toMatchObject({
      lastLookupAt: new Date(Date.parse(AT) + age).toISOString(),
      nextRetryAt: expected.toISOString(),
    });
    at(age + gap - 1);
    await recoverTenderRefunds(deps);
    expect(provider.lookupRefund).toHaveBeenCalledTimes(1);
    at(age + gap);
    await recoverTenderRefunds(deps);
    expect(provider.lookupRefund).toHaveBeenCalledTimes(2);
  });
  it("retries after the clock moves behind the persisted lookup time", async () => {
    const { provider } = await abandoned();
    vi.spyOn(provider, "lookupRefund").mockResolvedValue({ kind: "unreachable" });
    await recoverTenderRefunds(deps);
    at(-1000);
    await recoverTenderRefunds(deps);
    expect(provider.lookupRefund).toHaveBeenCalledTimes(2);
    expect(provider.refundCalls).toEqual([]);
  });
  it("processes only 50 due rows in stable id order and schedules the remaining batch immediately", async () => {
    const ids: string[] = [];
    const provider = new FakePaymentProvider(store.db);
    const lookup = vi.spyOn(provider, "lookupRefund").mockResolvedValue({ kind: "unreachable" });
    for (let i = 0; i < 51; i++) {
      const t = await target("card", "fake");
      deps.refundProviderFor = async () => provider;
      ids.push((await run(t)).id);
    }
    await store.db.update(tenderRefunds).set({ sentAt: AT, sendCount: 1 });
    expect(await recoverTenderRefunds(deps)).toEqual({ pending: 51, nextDueAt: new Date(AT) });
    expect(lookup.mock.calls.map(([q]) => q.refundId)).toEqual(ids.sort().slice(0, 50));
    expect(await recoverTenderRefunds(deps)).toEqual({
      pending: 51,
      nextDueAt: new Date("2026-10-16T12:01:00.000Z"),
    });
    expect(lookup.mock.calls.map(([q]) => q.refundId)).toEqual(ids);
    expect(provider.refundCalls).toEqual([]);
  });
  it("skips a live resolver without starving the next due batch or marking an unsent row failed", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 51; i++) ids.push((await abandoned(false)).refund.id);
    ids.sort();
    const releases = ids.slice(0, 50).map((id) => claimTenderRefund(store.db, id));
    try {
      expect(await recoverTenderRefunds(deps)).toEqual({ pending: 51, nextDueAt: new Date(AT) });
      expect(await recoverTenderRefunds(deps)).toEqual({
        pending: 50,
        nextDueAt: new Date("2026-10-16T12:01:00.000Z"),
      });
      expect(await row(ids[0]!)).toMatchObject({
        state: "pending",
        sentAt: null,
        lastLookupAt: null,
      });
      expect(await row(ids[50]!)).toMatchObject({ state: "failed" });
    } finally {
      for (const release of releases) release();
    }
  });
  it("raises one unresolved alert after an hour even before the next provider lookup is due", async () => {
    const { refund, provider } = await abandoned();
    vi.spyOn(provider, "lookupRefund").mockResolvedValue({ kind: "unreachable" });
    at(59 * 60_000);
    expect((await recoverTenderRefunds(deps)).nextDueAt).toEqual(
      new Date("2026-10-16T13:00:00.001Z"),
    );
    expect(await store.db.select().from(incidents)).toEqual([]);
    at(60 * 60_000 + 1);
    expect((await recoverTenderRefunds(deps)).nextDueAt).toEqual(
      new Date("2026-10-16T13:13:45.000Z"),
    );
    expect(provider.lookupRefund).toHaveBeenCalledTimes(1);
    expect(await store.db.select().from(incidents)).toMatchObject([
      {
        code: "payment.tender_refund_unresolved",
        severity: "warning",
        params: { refundId: refund.id, saleId: refund.saleId, amount: "2.00", pendingSince: AT },
      },
    ]);
    at(90 * 60_000);
    await recoverTenderRefunds(deps);
    expect(await store.db.select().from(incidents)).toHaveLength(1);
    expect(provider.refundCalls).toEqual([]);
  });
  it("isolates an evidence-write failure while another due return completes", async () => {
    const { refund: first } = await abandoned();
    const { refund: second, provider } = await abandoned();
    vi.spyOn(provider, "lookupRefund").mockImplementation(async (q) => ({
      kind: "match",
      outcome: "completed",
      providerRefundRef: q.refundId,
      providerStatus: "succeeded",
    }));
    deps.attendance = async (tx, fact) => {
      if (fact.key === first.id) throw new Error("attendance unavailable");
      return recordAttendanceFact(tx, fact);
    };
    await expect(recoverTenderRefunds(deps)).rejects.toThrow("refund recovery");
    expect(await row(first.id)).toMatchObject({
      state: "pending",
      nextRetryAt: "2026-10-16T12:01:00.000Z",
    });
    expect(await row(second.id)).toMatchObject({ state: "completed" });
    expect(await store.db.select().from(paymentRefunds)).toMatchObject([
      { providerRefundRef: second.id },
    ]);
    expect(provider.refundCalls).toEqual([]);
  });
});

it("does not raise an unresolved incident for an old refund settled by this recovery pass", async () => {
  const { t, provider } = await connected();
  provider.scriptNextRefund({ made: "completed", answer: "throw" });
  await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
  deps.clock = createTrustedClock({
    deviceId: cfg.origin.deviceId,
    monotonic: () => 0,
    wallClock: () => Date.parse(AT) + 3_600_001,
    degradedAfterSeconds: 300,
  });
  expect(await recoverTenderRefunds(deps)).toEqual({ pending: 0, nextDueAt: null });
  expect(await store.db.select().from(incidents)).toEqual([]);
});

describe("settled-tender refund recovery loop lifetime", () => {
  async function pending() {
    const { t, provider } = await connected();
    provider.scriptNextRefund({ made: false, answer: LOST });
    const refund = await refundSettledTender(deps, cfg, t.saleId, request(t), operator());
    return { provider, refund };
  }
  it("recovers at startup and sleeps no more than a minute before discovering new work", async () => {
    const { provider, refund } = await pending();
    const control = new AbortController();
    const sleeps: number[] = [];
    let offset = 0;
    deps.clock = createTrustedClock({
      deviceId: cfg.origin.deviceId,
      monotonic: () => 0,
      wallClock: () => Date.parse(AT) + offset,
      degradedAfterSeconds: 300,
    });
    await runTenderRefundRecoveryLoop({
      ...deps,
      signal: control.signal,
      isPrimary: () => true,
      onError: (error) => {
        throw error;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        offset += ms;
        if (sleeps.length === 2) control.abort();
      },
    });
    expect(provider.lookupCalls).toHaveLength(2);
    expect(sleeps).toEqual([60_000, 60_000]);
    expect(await row(refund.id)).toMatchObject({
      state: "pending",
      lastLookupAt: "2026-10-16T12:01:00.000Z",
    });
    expect(provider.refundCalls).toHaveLength(1);
  });
  it("does no recovery while this node is not primary", async () => {
    const { provider, refund } = await pending();
    const control = new AbortController();
    const sleeps: number[] = [];
    await runTenderRefundRecoveryLoop({
      ...deps,
      signal: control.signal,
      isPrimary: () => false,
      onError: (error) => {
        throw error;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        control.abort();
      },
    });
    expect(sleeps).toEqual([60_000]);
    expect(provider.lookupCalls).toEqual([]);
    expect(await row(refund.id)).toMatchObject({ lastLookupAt: null, nextRetryAt: null });
  });
  it("reports a failed pass and still schedules the next pass", async () => {
    const { provider, refund } = await pending();
    vi.spyOn(provider, "lookupRefund").mockResolvedValue({
      kind: "match",
      outcome: "completed",
      providerRefundRef: "late",
      providerStatus: "succeeded",
    });
    deps.attendance = async () => {
      throw new Error("attendance unavailable");
    };
    const control = new AbortController();
    const errors: unknown[] = [];
    const sleeps: number[] = [];
    await runTenderRefundRecoveryLoop({
      ...deps,
      signal: control.signal,
      isPrimary: () => true,
      onError: (error) => errors.push(error),
      sleep: async (ms) => {
        sleeps.push(ms);
        control.abort();
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(AggregateError);
    expect(sleeps).toEqual([60_000]);
    expect(await row(refund.id)).toMatchObject({ state: "pending" });
  });
  it("drains a lookup's actual late evidence on stop, after its response deadline", async () => {
    const { provider, refund } = await pending();
    vi.useFakeTimers();
    const control = new AbortController();
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(provider, "lookupRefund").mockImplementation(async () => {
      enter();
      await held;
      return {
        kind: "match",
        outcome: "completed",
        providerRefundRef: "late",
        providerStatus: "succeeded",
      };
    });
    let stopped = false;
    const work = runTenderRefundRecoveryLoop({
      ...deps,
      signal: control.signal,
      isPrimary: () => true,
      onError: (error) => {
        throw error;
      },
      sleep: async () => {
        throw new Error("stopped loop must not sleep");
      },
    }).then(() => {
      stopped = true;
    });
    try {
      await Promise.race([entered, work]);
      expect(provider.lookupRefund).toHaveBeenCalledTimes(1);
      control.abort();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(stopped).toBe(false);
      expect(tenderRefundIsLive(store.db, refund.id)).toBe(true);
      release();
      await work;
      expect(await row(refund.id)).toMatchObject({ state: "completed", providerRefundRef: "late" });
      expect(tenderRefundIsLive(store.db, refund.id)).toBe(false);
      expect(stopped).toBe(true);
    } finally {
      release();
      control.abort();
      await work;
    }
  });
});

it("contains a failed recovery sleep and does not run a pass after an already-aborted start", async () => {
  const control = new AbortController();
  const error = new Error("sleep failed");
  const errors: unknown[] = [];
  let sleeps = 0;
  await runTenderRefundRecoveryLoop({
    ...deps,
    signal: control.signal,
    isPrimary: () => true,
    onError: (failure) => errors.push(failure),
    sleep: async () => {
      sleeps++;
      if (sleeps === 1) throw error;
      control.abort();
    },
  });
  expect(sleeps).toBe(2);
  expect(errors).toEqual([error]);
  const t = await target("card", "fake");
  const provider = new FakePaymentProvider(store.db);
  deps.refundProviderFor = async () => provider;
  const pending = await run(t);
  await runTenderRefundRecoveryLoop({
    ...deps,
    signal: control.signal,
    isPrimary: () => true,
    onError: (failure) => {
      throw failure;
    },
  });
  expect(await row(pending.id)).toMatchObject({ state: "pending", nextRetryAt: null });
  expect(provider.lookupCalls).toEqual([]);
});
