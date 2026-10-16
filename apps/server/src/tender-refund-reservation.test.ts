import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  billPaymentRefunds,
  billPayments,
  invoiceSeries,
  locations,
  saleSettlements,
  sales,
  saleVoids,
  tenderRefunds,
  tenders,
  withTransaction,
  workingOrders,
} from "@waitron/db";
import { seedDevice, seedNode, seedTenant } from "@waitron/db/testing/seed.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { PAYMENTS_MIGRATIONS, payments } from "@waitron/payments";
import { paymentRefunds } from "@waitron/payments/src/schema/payment-refunds.js";
import { deviceOrigin, locationId } from "@waitron/shared";
import type { DeviceRequestConfig } from "./till-config.js";
import type { TenderRefundRequest } from "./tender-refund-types.js";
import { reserveTenderRefund } from "./tender-refund-reservation.js";

const AT = "2026-10-16T08:00:00.000Z";
const ACTOR = {
  requestedBy: "cccccccc-0000-4000-8000-000000000001",
  authorizedBy: "cccccccc-0000-4000-8000-000000000002",
};
const store = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  resetPerTest: true,
});
let cfg: DeviceRequestConfig;
let seriesId: string;
let orderId: string;
let number: number;
beforeEach(async () => {
  const db = store.db;
  await seedTenant(db);
  const [place] = await db
    .insert(locations)
    .values({ name: "Refund venue", invoiceLocales: ["en-GB"], operationDescription: "Meals" })
    .returning();
  const placeId = locationId(place!.id);
  const nodeId = await seedNode(db, placeId);
  const { deviceId } = await seedDevice(db, { locationId: placeId });
  const [series] = await db
    .insert(invoiceSeries)
    .values({ nodeId, code: "TR", purpose: "standard" })
    .returning();
  seriesId = series!.id;
  const [order] = await db
    .insert(workingOrders)
    .values({ source: "device", deviceId, nodeId, locationId: placeId, orderNumber: 1 })
    .returning();
  orderId = order!.id;
  cfg = {
    nodeId,
    locationId: placeId,
    origin: deviceOrigin(deviceId),
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: true,
    simplifiedInvoiceLimit: null,
  };
  number = 0;
});

async function paid(
  method: typeof tenders.$inferInsert.method = "cash",
  options: {
    bill?: boolean;
    provider?: string;
    state?: typeof payments.$inferInsert.state;
    saleId?: string;
    settle?: boolean;
    total?: number;
    netApplied?: number;
  } = {},
) {
  const sale =
    options.saleId === undefined
      ? (
          await store.db
            .insert(sales)
            .values({
              source: "device",
              deviceId: cfg.origin.deviceId,
              nodeId: cfg.nodeId,
              seriesId,
              invoiceNumber: ++number,
              issuedAt: AT,
              issuedOffsetMinutes: 0,
              total: options.total ?? options.netApplied ?? 1000,
              vatBreakdown: [],
              locale: "en-GB",
              invoiceLocales: ["en-GB"],
              fiscalBackend: "none",
              fiscalState: "not_applicable",
            })
            .returning()
        )[0]!
      : { id: options.saleId };
  let billPaymentId: string | null = null;
  if (options.bill) {
    const [billPayment] = await store.db
      .insert(billPayments)
      .values({
        workingOrderId: orderId,
        submissionId: randomUUID(),
        fingerprint: "paid",
        kind: "contribution",
        method: method as "cash" | "card",
        applied: 1000,
        tip: 100,
        state: "received",
        source: "device",
        deviceId: cfg.origin.deviceId,
        requestedBy: ACTOR.requestedBy,
        receivedAt: AT,
      })
      .returning();
    billPaymentId = billPayment!.id;
  }
  const [tender] = await store.db
    .insert(tenders)
    .values({
      saleId: sale!.id,
      method,
      amount: (options.netApplied ?? 1000) + 100,
      tipAmount: 100,
      settledAt: AT,
      billPaymentId,
    })
    .returning();
  if (options.saleId === undefined && options.settle !== false)
    await store.db.insert(saleSettlements).values({ saleId: sale!.id, settledAt: AT });
  const capture =
    method !== "card"
      ? undefined
      : (
          await store.db
            .insert(payments)
            .values({
              saleId: sale!.id,
              billPaymentId,
              workingOrderId: orderId,
              source: "device",
              deviceId: cfg.origin.deviceId,
              provider: options.provider ?? "fake",
              paymentRef: randomUUID(),
              externalRef: randomUUID(),
              state: options.state ?? "captured",
              amount: 1100,
              cardLast4: "0042",
            })
            .returning()
        )[0]!;
  return { saleId: sale!.id, tenderId: tender!.id, billPaymentId, capture };
}
function request(tenderId: string, patch: Partial<TenderRefundRequest> = {}): TenderRefundRequest {
  return {
    submissionId: randomUUID(),
    tenderId,
    appliedAmount: "2.00",
    tipAmount: "0.00",
    reason: "Goodwill",
    cashConfirmed: true,
    ...patch,
  };
}
const reserve = (saleId: string, req: TenderRefundRequest, config = cfg) =>
  withTransaction(store.db, (tx) => reserveTenderRefund(tx, config, saleId, req, ACTOR, AT));
const rows = () => store.db.select().from(tenderRefunds);
async function prior(
  target: Awaited<ReturnType<typeof paid>>,
  patch: Partial<typeof tenderRefunds.$inferInsert> = {},
) {
  return (
    await store.db
      .insert(tenderRefunds)
      .values({
        saleId: target.saleId,
        tenderId: target.tenderId,
        submissionId: randomUUID(),
        fingerprint: "older",
        appliedAmount: 300,
        tipAmount: 0,
        reason: "Older return",
        ...ACTOR,
        source: "device",
        deviceId: cfg.origin.deviceId,
        nodeId: cfg.nodeId,
        locationId: cfg.locationId,
        method: target.capture === undefined ? "cash" : "card",
        provider: target.capture?.provider,
        providerPaymentRef: target.capture?.paymentRef,
        state: "completed",
        createdAt: AT,
        completedAt: AT,
        ...patch,
      })
      .returning()
  )[0]!;
}

describe("settled-tender reservation inside the caller's transaction", () => {
  it("stores cents and provenance without changing the invoice, tender, settlement or provider rows", async () => {
    const target = await paid();
    const snapshot = {
      sales: await store.db.select().from(sales),
      tenders: await store.db.select().from(tenders),
      settlements: await store.db.select().from(saleSettlements),
      captures: await store.db.select().from(payments),
    };
    const req = request(target.tenderId);
    const result = await reserve(target.saleId, req);
    expect(result.replayed).toBe(false);
    expect(result.refund).toMatchObject({
      saleId: target.saleId,
      tenderId: target.tenderId,
      submissionId: req.submissionId,
      appliedAmount: 200,
      tipAmount: 0,
      reason: "Goodwill",
      ...ACTOR,
      source: "device",
      deviceId: cfg.origin.deviceId,
      nodeId: cfg.nodeId,
      locationId: cfg.locationId,
      method: "cash",
      manual: false,
      provider: null,
      providerPaymentRef: null,
      state: "pending",
      createdAt: AT,
      completedAt: null,
      sentAt: null,
      sendCount: 0,
    });
    expect(result.refund.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.refund.fingerprint).not.toBe("");
    expect(await rows()).toEqual([result.refund]);
    expect(await store.db.select().from(sales)).toEqual(snapshot.sales);
    expect(await store.db.select().from(tenders)).toEqual(snapshot.tenders);
    expect(await store.db.select().from(saleSettlements)).toEqual(snapshot.settlements);
    expect(await store.db.select().from(payments)).toEqual(snapshot.captures);
  });

  it("replays normalized amounts/reason without storing credentials or reserving twice", async () => {
    const target = await paid();
    const req = request(target.tenderId, {
      appliedAmount: "02",
      reason: "  Goodwill  ",
      override: { personId: ACTOR.authorizedBy, pin: "4321" },
    });
    const first = await reserve(target.saleId, req);
    const second = await reserve(target.saleId, {
      ...req,
      appliedAmount: "2.0",
      reason: "Goodwill",
      override: { personId: ACTOR.requestedBy, pin: "9999" },
    });
    expect(second).toEqual({ refund: first.refund, replayed: true });
    expect(first.refund).not.toHaveProperty("override");
    expect(first.refund).not.toHaveProperty("pin");
    expect(await rows()).toHaveLength(1);
  });

  it.each([
    { appliedAmount: "3.00" },
    { tipAmount: "1.00" },
    { reason: "Different" },
    { cashConfirmed: false },
    { manualConfirmed: true },
  ])("refuses reused submission identity with changed request %j", async (patch) => {
    const target = await paid();
    const req = request(target.tenderId);
    await reserve(target.saleId, req);
    await expect(reserve(target.saleId, { ...req, ...patch })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
    expect(await rows()).toHaveLength(1);
  });

  it("does not replay a submission against a different tender", async () => {
    const target = await paid("cash", { settle: false, total: 2000 });
    const [other] = await store.db
      .insert(tenders)
      .values({ saleId: target.saleId, method: "cash", amount: 1000, settledAt: AT })
      .returning();
    await store.db.insert(saleSettlements).values({ saleId: target.saleId, settledAt: AT });
    const req = request(target.tenderId);
    await reserve(target.saleId, req);
    await expect(reserve(target.saleId, { ...req, tenderId: other!.id })).rejects.toMatchObject({
      code: "submission.id_reused",
    });
  });

  it("replays a terminal attempt without making a new reservation", async () => {
    const target = await paid();
    const req = request(target.tenderId);
    const first = await reserve(target.saleId, req);
    await store.db
      .update(tenderRefunds)
      .set({ state: "failed", failedAt: AT })
      .where(eq(tenderRefunds.id, first.refund.id));
    expect((await reserve(target.saleId, req)).refund.state).toBe("failed");
    expect(await rows()).toHaveLength(1);
  });

  it("canonicalizes submission and tender UUIDs before replay matching", async () => {
    const target = await paid();
    const req = request(target.tenderId);
    const first = await reserve(target.saleId, req);
    expect(
      await reserve(target.saleId, {
        ...req,
        submissionId: req.submissionId.toUpperCase(),
        tenderId: req.tenderId.toUpperCase(),
      }),
    ).toEqual({ refund: first.refund, replayed: true });
  });

  it("keeps the same submission key independent across different sales", async () => {
    const first = await paid();
    const second = await paid();
    const req = request(first.tenderId);
    const a = await reserve(first.saleId, req);
    const b = await reserve(second.saleId, { ...req, tenderId: second.tenderId });
    expect(a.refund.id).not.toBe(b.refund.id);
    expect(await rows()).toHaveLength(2);
  });

  it("replays a completed attempt without consuming the remaining balance", async () => {
    const target = await paid();
    const req = request(target.tenderId);
    const first = await reserve(target.saleId, req);
    await store.db
      .update(tenderRefunds)
      .set({ state: "completed", completedAt: AT })
      .where(eq(tenderRefunds.id, first.refund.id));
    const replay = await reserve(target.saleId, req);
    expect(replay.replayed).toBe(true);
    expect(replay.refund).toMatchObject({
      id: first.refund.id,
      state: "completed",
      appliedAmount: 200,
    });
    expect(await rows()).toHaveLength(1);
  });

  it("serializes competing submissions and refuses the second even if some money remains", async () => {
    const target = await paid();
    const answers = await Promise.allSettled([
      reserve(target.saleId, request(target.tenderId)),
      reserve(target.saleId, request(target.tenderId)),
    ]);
    expect(answers.filter((answer) => answer.status === "fulfilled")).toHaveLength(1);
    expect(answers.find((answer) => answer.status === "rejected")).toMatchObject({
      reason: { code: "tender.refund_in_progress" },
    });
    expect(await rows()).toHaveLength(1);
  });

  it("rolls the reservation back with the caller's failed transaction", async () => {
    const target = await paid();
    await expect(
      withTransaction(store.db, async (tx) => {
        await reserveTenderRefund(tx, cfg, target.saleId, request(target.tenderId), ACTOR, AT);
        throw new Error("caller failed");
      }),
    ).rejects.toThrow("caller failed");
    expect(await rows()).toEqual([]);
  });

  it.each([
    ["appliedAmount", "-1"],
    ["appliedAmount", "1.001"],
    ["appliedAmount", "1e2"],
    ["appliedAmount", "1000000000000.00"],
    ["appliedAmount", null],
    ["appliedAmount", ["2"]],
    ["tipAmount", "-0.01"],
    ["tipAmount", "0.001"],
    ["reason", "  "],
    ["reason", "x".repeat(501)],
    ["submissionId", "same"],
    ["tenderId", "missing"],
    ["cashConfirmed", null],
    ["manualConfirmed", "true"],
  ])("refuses malformed %s before writing", async (field, value) => {
    const target = await paid();
    await expect(
      reserve(target.saleId, {
        ...request(target.tenderId),
        [field]: value,
      } as TenderRefundRequest),
    ).rejects.toMatchObject({ code: "management.request_invalid", params: { field } });
    expect(await rows()).toEqual([]);
  });

  it("refuses a zero total", async () => {
    const target = await paid();
    await expect(
      reserve(target.saleId, request(target.tenderId, { appliedAmount: "0" })),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "appliedAmount" },
    });
  });
  it("refuses a combined amount beyond the money bound", async () => {
    const target = await paid();
    await expect(
      reserve(
        target.saleId,
        request(target.tenderId, { appliedAmount: "999999999999.99", tipAmount: "0.01" }),
      ),
    ).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "appliedAmount" },
    });
  });

  it.each([false, undefined])(
    "requires explicit cash handover confirmation (%s)",
    async (cashConfirmed) => {
      const target = await paid();
      await expect(
        reserve(target.saleId, request(target.tenderId, { cashConfirmed })),
      ).rejects.toMatchObject({
        code: "management.request_invalid",
        params: { field: "cashConfirmed" },
      });
      expect(await rows()).toEqual([]);
    },
  );

  it.each(["unpaid", "voided", "unsupported", "wrong-tender"])(
    "refuses %s sales/tenders",
    async (kind) => {
      const target = await paid(kind === "unsupported" ? "voucher" : "cash", {
        settle: kind !== "unpaid",
      });
      if (kind === "voided")
        await store.db
          .insert(saleVoids)
          .values({ saleId: target.saleId, reason: "Void", voidedAt: AT });
      const req = request(kind === "wrong-tender" ? randomUUID() : target.tenderId);
      await expect(reserve(target.saleId, req)).rejects.toMatchObject({
        code: "tender.refund_unavailable",
      });
      expect(await rows()).toEqual([]);
    },
  );

  it("refuses a sale in a different location", async () => {
    const target = await paid();
    await expect(
      reserve(target.saleId, request(target.tenderId), {
        ...cfg,
        locationId: locationId(randomUUID()),
      }),
    ).rejects.toMatchObject({ code: "sale.not_found" });
    expect(await rows()).toEqual([]);
  });

  it.each([
    { appliedAmount: "10.01" },
    { appliedAmount: "5.00", tipAmount: "1.00" },
    { appliedAmount: "10.00", tipAmount: "0.50" },
  ])("enforces applied and whole-tip ceilings %j", async (patch) => {
    const target = await paid();
    await expect(reserve(target.saleId, request(target.tenderId, patch))).rejects.toMatchObject({
      code: "tender.refund_exceeds_payment",
      params: { tenderId: target.tenderId, applied: "10.00", tip: "1.00" },
    });
    expect(await rows()).toEqual([]);
  });

  it("permits the full applied remainder with its whole tip", async () => {
    const target = await paid();
    await prior(target);
    const result = await reserve(
      target.saleId,
      request(target.tenderId, { appliedAmount: "7.00", tipAmount: "1.00" }),
    );
    expect(result.refund).toMatchObject({ appliedAmount: 700, tipAmount: 100 });
  });
  it("permits returning a tip after all applied money was returned", async () => {
    const target = await paid();
    await prior(target, { appliedAmount: 1000 });
    expect(
      (
        await reserve(
          target.saleId,
          request(target.tenderId, { appliedAmount: "0.00", tipAmount: "1.00" }),
        )
      ).refund,
    ).toMatchObject({ appliedAmount: 0, tipAmount: 100 });
  });
  it("does not spend completed reservations and releases failed reservations", async () => {
    const target = await paid();
    await prior(target, { appliedAmount: 800 });
    await prior(target, { appliedAmount: 200, state: "failed", completedAt: null, failedAt: AT });
    await expect(
      reserve(target.saleId, request(target.tenderId, { appliedAmount: "2.01" })),
    ).rejects.toMatchObject({ code: "tender.refund_exceeds_payment" });
    expect((await reserve(target.saleId, request(target.tenderId))).refund.appliedAmount).toBe(200);
  });

  it.each([false, true])(
    "reserves the original direct/bill-linked capture (bill=%s)",
    async (bill) => {
      const target = await paid("card", { bill });
      const answer = await reserve(target.saleId, request(target.tenderId));
      expect(answer.refund).toMatchObject({
        method: "card",
        manual: false,
        provider: "fake",
        providerPaymentRef: target.capture!.paymentRef,
        state: "pending",
        sentAt: null,
        sendCount: 0,
      });
      expect(await store.db.select().from(paymentRefunds)).toEqual([]);
    },
  );

  it("reserves independent mixed-card tenders through their bill-payment associations", async () => {
    const first = await paid("card", { bill: true, settle: false, total: 2000 });
    const second = await paid("card", { bill: true, saleId: first.saleId });
    await store.db.insert(saleSettlements).values({ saleId: first.saleId, settledAt: AT });
    const a = await reserve(first.saleId, request(first.tenderId));
    const b = await reserve(first.saleId, request(second.tenderId));
    expect(a.refund.providerPaymentRef).toBe(first.capture!.paymentRef);
    expect(b.refund.providerPaymentRef).toBe(second.capture!.paymentRef);
  });

  it("refuses a capture already reserved by another tender's pending row", async () => {
    const target = await paid("card");
    const other = await paid("card");
    await prior(other, {
      state: "pending",
      completedAt: null,
      providerPaymentRef: target.capture!.paymentRef,
    });
    await expect(reserve(target.saleId, request(target.tenderId))).rejects.toMatchObject({
      code: "tender.refund_in_progress",
    });
    expect(await rows()).toHaveLength(1);
  });

  it("does not double-subtract completed ledger returns mirrored by provider evidence", async () => {
    const target = await paid("card", { state: "partially_refunded" });
    await prior(target, { providerRefundRef: "already-returned" });
    await store.db.insert(paymentRefunds).values({
      paymentId: target.capture!.id,
      provider: "fake",
      paymentRef: target.capture!.paymentRef,
      amount: 300,
      state: "succeeded",
      providerRefundRef: "already-returned",
    });
    const before = await store.db.select().from(payments);
    const refund = await reserve(
      target.saleId,
      request(target.tenderId, { appliedAmount: "7.00", tipAmount: "1.00" }),
    );
    expect(refund.refund).toMatchObject({ appliedAmount: 700, tipAmount: 100 });
    expect(await store.db.select().from(payments)).toEqual(before);
    expect(await store.db.select().from(paymentRefunds)).toHaveLength(1);
  });

  it("does not subtract pre-invoice returns already netted into the original bill tender", async () => {
    const target = await paid("card", { bill: true, state: "partially_refunded", netApplied: 700 });
    await store.db.insert(billPaymentRefunds).values({
      billPaymentId: target.billPaymentId!,
      submissionId: randomUUID(),
      fingerprint: "old",
      appliedAmount: 300,
      tipAmount: 0,
      reason: "Before invoice",
      ...ACTOR,
      source: "device",
      deviceId: cfg.origin.deviceId,
      state: "completed",
      completedAt: AT,
      providerRefundRef: "preinvoice",
    });
    await store.db.insert(paymentRefunds).values({
      paymentId: target.capture!.id,
      provider: "fake",
      paymentRef: target.capture!.paymentRef,
      amount: 300,
      state: "succeeded",
      providerRefundRef: "preinvoice",
    });
    const before = await store.db.select().from(billPayments);
    const refund = await reserve(
      target.saleId,
      request(target.tenderId, { appliedAmount: "7.00", tipAmount: "1.00" }),
    );
    expect(refund.refund).toMatchObject({ appliedAmount: 700, tipAmount: 100 });
    expect(await store.db.select().from(billPayments)).toEqual(before);
    expect(await store.db.select().from(billPaymentRefunds)).toHaveLength(1);
  });

  it("refuses direct card capture ambiguity", async () => {
    const target = await paid("card");
    const capture = target.capture!;
    await store.db.insert(payments).values({
      ...capture,
      id: randomUUID(),
      paymentRef: randomUUID(),
      externalRef: randomUUID(),
    });
    await expect(reserve(target.saleId, request(target.tenderId))).rejects.toMatchObject({
      code: "tender.refund_unavailable",
    });
    expect(await rows()).toEqual([]);
  });
  it("refuses a direct capture with a different original amount", async () => {
    const target = await paid("card");
    await store.db
      .update(payments)
      .set({ amount: 1200 })
      .where(eq(payments.id, target.capture!.id));
    await expect(reserve(target.saleId, request(target.tenderId))).rejects.toMatchObject({
      code: "tender.refund_unavailable",
    });
  });
  it("refuses a settled provider projection that the existing reversal gate does not admit", async () => {
    const target = await paid("card", { state: "settled" });
    await expect(reserve(target.saleId, request(target.tenderId))).rejects.toMatchObject({
      code: "payment.not_refundable",
    });
    expect(await rows()).toEqual([]);
  });

  it("uses provider evidence to limit the remaining card money", async () => {
    const target = await paid("card");
    await store.db.insert(paymentRefunds).values({
      paymentId: target.capture!.id,
      provider: "fake",
      paymentRef: target.capture!.paymentRef,
      amount: 900,
      state: "succeeded",
      authorizedBy: ACTOR.authorizedBy,
      providerRefundRef: "outside-return",
    });
    await expect(
      reserve(target.saleId, request(target.tenderId, { appliedAmount: "1.01" })),
    ).rejects.toMatchObject({ code: "tender.refund_exceeds_payment" });
    expect(
      (await reserve(target.saleId, request(target.tenderId, { appliedAmount: "1.00" }))).refund
        .appliedAmount,
    ).toBe(100);
  });

  it("requires explicit manual-terminal confirmation and records no connected provider target", async () => {
    const target = await paid("card", { provider: "manual" });
    await expect(reserve(target.saleId, request(target.tenderId))).rejects.toMatchObject({
      code: "management.request_invalid",
      params: { field: "manualConfirmed" },
    });
    const answer = await reserve(
      target.saleId,
      request(target.tenderId, { manualConfirmed: true }),
    );
    expect(answer.refund).toMatchObject({
      manual: true,
      provider: null,
      providerPaymentRef: null,
      state: "pending",
    });
    expect(await store.db.select().from(paymentRefunds)).toEqual([]);
  });

  it("refuses a pending pre-invoice refund on the same capture", async () => {
    const target = await paid("card", { bill: true });
    await store.db.insert(billPaymentRefunds).values({
      billPaymentId: target.billPaymentId!,
      submissionId: randomUUID(),
      fingerprint: "older",
      appliedAmount: 100,
      tipAmount: 0,
      reason: "Older",
      ...ACTOR,
      source: "device",
      deviceId: cfg.origin.deviceId,
      state: "pending",
    });
    await expect(reserve(target.saleId, request(target.tenderId))).rejects.toMatchObject({
      code: "tender.refund_in_progress",
    });
    expect(await rows()).toEqual([]);
  });
});

describe("cash reservation without the optional payments module", () => {
  const cashOnly = useVenueDb({ migrations: [CORE_MIGRATIONS], resetPerTest: true });
  it("reserves cash in a database with no provider tables", async () => {
    const db = cashOnly.db;
    await seedTenant(db);
    const [place] = await db
      .insert(locations)
      .values({ name: "Cash venue", invoiceLocales: ["en-GB"], operationDescription: "Meals" })
      .returning();
    const cashLocationId = locationId(place!.id);
    const cashNodeId = await seedNode(db, cashLocationId);
    const { deviceId } = await seedDevice(db, { locationId: cashLocationId });
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId: cashNodeId, code: "CASH", purpose: "standard" })
      .returning();
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId,
        nodeId: cashNodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 0,
        total: 500,
        vatBreakdown: [],
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning();
    const [tender] = await db
      .insert(tenders)
      .values({ saleId: sale!.id, method: "cash", amount: 500, settledAt: AT })
      .returning();
    await db.insert(saleSettlements).values({ saleId: sale!.id, settledAt: AT });
    const answer = await withTransaction(db, (tx) =>
      reserveTenderRefund(
        tx,
        { ...cfg, nodeId: cashNodeId, locationId: cashLocationId, origin: deviceOrigin(deviceId) },
        sale!.id,
        request(tender!.id),
        ACTOR,
        AT,
      ),
    );
    expect(answer.refund).toMatchObject({
      saleId: sale!.id,
      tenderId: tender!.id,
      method: "cash",
      appliedAmount: 200,
      state: "pending",
      provider: null,
    });
    expect(await db.select().from(tenderRefunds)).toEqual([answer.refund]);
  });
});
