import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
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
import { locationId } from "@waitron/shared";
import type { TillConfig } from "./till-config.js";
import { readRefundableTenders } from "./tender-refund-balance.js";

const AT = "2026-10-16T08:00:00.000Z";
const PERSON = "cccccccc-0000-4000-8000-000000000001";
const store = useVenueDb({
  migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS],
  resetPerTest: true,
});
let cfg: TillConfig;
let deviceId: string;
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
  ({ deviceId } = await seedDevice(db, { locationId: placeId }));
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
    locale: "en-GB",
    invoiceLocales: ["en-GB"],
    tipsEnabled: true,
    simplifiedInvoiceLimit: null,
  };
  number = 0;
});

async function invoice(values: Partial<typeof sales.$inferInsert> = {}) {
  const [sale] = await store.db
    .insert(sales)
    .values({
      source: "device",
      deviceId,
      nodeId: cfg.nodeId,
      seriesId,
      invoiceNumber: ++number,
      issuedAt: AT,
      issuedOffsetMinutes: 0,
      total: 1000,
      vatBreakdown: [],
      locale: "en-GB",
      invoiceLocales: ["en-GB"],
      fiscalBackend: "none",
      fiscalState: "not_applicable",
      ...values,
    })
    .returning();
  return sale!.id;
}
async function paid(
  method: typeof tenders.$inferInsert.method = "cash",
  tip = 100,
  values: Partial<typeof tenders.$inferInsert> = {},
) {
  const saleId = await invoice();
  const [tender] = await store.db
    .insert(tenders)
    .values({ saleId, method, amount: 1000 + tip, tipAmount: tip, settledAt: AT, ...values })
    .returning();
  await store.db.insert(saleSettlements).values({ saleId, settledAt: AT });
  return { saleId, tenderId: tender!.id };
}
async function capture(saleId: string, values: Partial<typeof payments.$inferInsert> = {}) {
  const [row] = await store.db
    .insert(payments)
    .values({
      saleId,
      workingOrderId: orderId,
      source: "device",
      deviceId,
      provider: "fake",
      paymentRef: randomUUID(),
      externalRef: randomUUID(),
      state: "captured",
      amount: 1100,
      cardLast4: "0042",
      ...values,
    })
    .returning();
  return row!;
}
async function refund(
  target: { saleId: string; tenderId: string },
  values: Partial<typeof tenderRefunds.$inferInsert> = {},
) {
  const [row] = await store.db
    .insert(tenderRefunds)
    .values({
      ...target,
      submissionId: randomUUID(),
      fingerprint: "request",
      appliedAmount: 200,
      tipAmount: 0,
      reason: "Goodwill",
      requestedBy: PERSON,
      authorizedBy: PERSON,
      source: "device",
      deviceId,
      nodeId: cfg.nodeId,
      locationId: cfg.locationId,
      method: "cash",
      state: "completed",
      completedAt: AT,
      ...values,
    })
    .returning();
  return row!;
}
const read = (saleId: string, config = cfg) =>
  withTransaction(store.db, (tx) => readRefundableTenders(tx, config, saleId));

describe("settled-tender refundable balances", () => {
  it("reads applied cash and tip separately from immutable tender facts without changing invoice rows", async () => {
    const target = await paid();
    const beforeSale = await store.db.select().from(sales);
    const beforeTender = await store.db.select().from(tenders);
    const beforeSettlement = await store.db.select().from(saleSettlements);
    expect(await read(target.saleId)).toEqual([
      {
        tenderId: target.tenderId,
        method: "cash",
        last4: null,
        appliedRemaining: "10.00",
        tipRemaining: "1.00",
        pendingRefundId: null,
        manual: false,
      },
    ]);
    expect(await store.db.select().from(sales)).toEqual(beforeSale);
    expect(await store.db.select().from(tenders)).toEqual(beforeTender);
    expect(await store.db.select().from(saleSettlements)).toEqual(beforeSettlement);
  });

  it("reserves pending and completed returns, ignores failed returns, and exposes the pending attempt", async () => {
    const target = await paid();
    await refund(target);
    await refund(target, { appliedAmount: 300, state: "failed", completedAt: null, failedAt: AT });
    const pending = await refund(target, {
      appliedAmount: 400,
      state: "pending",
      completedAt: null,
    });
    expect(await read(target.saleId)).toEqual([
      {
        tenderId: target.tenderId,
        method: "cash",
        last4: null,
        appliedRemaining: "4.00",
        tipRemaining: "1.00",
        pendingRefundId: pending.id,
        manual: false,
      },
    ]);
  });

  it("keeps a fully reserved pending attempt discoverable and omits a fully completed return", async () => {
    const pendingTarget = await paid();
    const pending = await refund(pendingTarget, {
      appliedAmount: 1000,
      tipAmount: 100,
      state: "pending",
      completedAt: null,
    });
    expect(await read(pendingTarget.saleId)).toEqual([
      {
        tenderId: pendingTarget.tenderId,
        method: "cash",
        last4: null,
        appliedRemaining: "0.00",
        tipRemaining: "0.00",
        pendingRefundId: pending.id,
        manual: false,
      },
    ]);
    const completed = await paid();
    await refund(completed, { appliedAmount: 1000, tipAmount: 100 });
    expect(await read(completed.saleId)).toEqual([]);
  });

  it.each(["voucher", "transfer", "other"] as const)(
    "does not offer the unsupported %s tender",
    async (method) => {
      const target = await paid(method);
      expect(await read(target.saleId)).toEqual([]);
    },
  );

  it("does not offer an unsettled invoice even with a recorded partial tender", async () => {
    const saleId = await invoice();
    await store.db.insert(tenders).values({ saleId, method: "cash", amount: 500, settledAt: AT });
    expect(await read(saleId)).toEqual([]);
  });

  it("does not offer a voided invoice", async () => {
    const target = await paid();
    await store.db
      .insert(saleVoids)
      .values({ saleId: target.saleId, reason: "Duplicate", voidedBy: PERSON, voidedAt: AT });
    expect(await read(target.saleId)).toEqual([]);
  });

  it("keeps another location's sale and a nonexistent sale out of scope", async () => {
    const target = await paid();
    await expect(
      read(target.saleId, { ...cfg, locationId: locationId(randomUUID()) }),
    ).rejects.toMatchObject({ code: "sale.not_found" });
    await expect(read(randomUUID())).rejects.toMatchObject({ code: "sale.not_found" });
    expect(await read(target.saleId)).toHaveLength(1);
  });

  it("reads connected and manual cards from their original capture, retaining leading-zero digits", async () => {
    const connected = await paid("card");
    await capture(connected.saleId);
    expect(await read(connected.saleId)).toEqual([
      {
        tenderId: connected.tenderId,
        method: "card",
        last4: "0042",
        appliedRemaining: "10.00",
        tipRemaining: "1.00",
        pendingRefundId: null,
        manual: false,
      },
    ]);
    const manual = await paid("card");
    await capture(manual.saleId, { provider: "manual", cardLast4: null });
    expect(await read(manual.saleId)).toEqual([
      {
        tenderId: manual.tenderId,
        method: "card",
        last4: null,
        appliedRemaining: "10.00",
        tipRemaining: "1.00",
        pendingRefundId: null,
        manual: true,
      },
    ]);
  });

  it.each(["attempting", "failed", "accepted_offline", "initiated", "declined", "voided"] as const)(
    "does not offer a card whose only provider row is %s",
    async (state) => {
      const target = await paid("card");
      await capture(target.saleId, { state });
      expect(await read(target.saleId)).toEqual([]);
    },
  );

  it("does not guess between direct captures or between two direct card tenders", async () => {
    const ambiguous = await paid("card");
    await capture(ambiguous.saleId);
    await capture(ambiguous.saleId);
    expect(await read(ambiguous.saleId)).toEqual([]);
    const split = await invoice();
    await store.db.insert(tenders).values([
      { saleId: split, method: "card", amount: 500, settledAt: AT },
      { saleId: split, method: "card", amount: 500, settledAt: AT },
    ]);
    await store.db.insert(saleSettlements).values({ saleId: split, settledAt: AT });
    await capture(split, { amount: 1000 });
    expect(await read(split)).toEqual([]);
  });

  it("does not offer a direct card without a capture or with a different original charged amount", async () => {
    const missing = await paid("card");
    expect(await read(missing.saleId)).toEqual([]);
    const mismatched = await paid("card");
    await capture(mismatched.saleId, { amount: 500 });
    expect(await read(mismatched.saleId)).toEqual([]);
    const matched = await paid("card");
    await capture(matched.saleId);
    expect(await read(matched.saleId)).toMatchObject([
      { appliedRemaining: "10.00", tipRemaining: "1.00" },
    ]);
  });

  it("bounds a provider-only return that crosses from applied money into the tip", async () => {
    const target = await paid("card");
    const payment = await capture(target.saleId, { state: "partially_refunded" });
    await store.db.insert(paymentRefunds).values({
      paymentId: payment.id,
      provider: payment.provider,
      paymentRef: payment.paymentRef,
      amount: 1050,
      state: "succeeded",
    });
    expect(await read(target.saleId)).toMatchObject([
      { appliedRemaining: "0.00", tipRemaining: "0.50" },
    ]);
  });

  it("keeps a resolved card capture's pending ledger attempt discoverable for recovery", async () => {
    const target = await paid("card");
    const payment = await capture(target.saleId, { state: "refunded" });
    const pending = await refund(target, {
      method: "card",
      provider: payment.provider,
      providerPaymentRef: payment.paymentRef,
      state: "pending",
      completedAt: null,
      appliedAmount: 1000,
      tipAmount: 100,
    });
    expect(await read(target.saleId)).toEqual([
      {
        tenderId: target.tenderId,
        method: "card",
        last4: "0042",
        appliedRemaining: "0.00",
        tipRemaining: "0.00",
        pendingRefundId: pending.id,
        manual: false,
      },
    ]);
  });

  it("reads a paid F1 independently of whether the customer has a tax identity", async () => {
    const saleId = await invoice({
      counterpartyTaxId: "B12345674",
      counterpartyLegalName: "Customer SL",
      counterpartyCountryCode: "ES",
      counterpartyAddress: "Calle Mayor 1",
    });
    await store.db.insert(tenders).values({ saleId, method: "cash", amount: 1000, settledAt: AT });
    await store.db.insert(saleSettlements).values({ saleId, settledAt: AT });
    expect(await read(saleId)).toMatchObject([
      { method: "cash", appliedRemaining: "10.00", tipRemaining: "0.00" },
    ]);
  });

  it("keeps each mixed cash and bill-linked card balance on the selected tender", async () => {
    const saleId = await invoice();
    const [cash] = await store.db
      .insert(tenders)
      .values({ saleId, method: "cash", amount: 200, settledAt: AT })
      .returning();
    const targets: { tenderId: string; last4: string; paymentRef: string }[] = [];
    for (const [amount, last4] of [
      [300, "1234"],
      [500, "0042"],
    ] as const) {
      const [bill] = await store.db
        .insert(billPayments)
        .values({
          workingOrderId: orderId,
          submissionId: randomUUID(),
          fingerprint: "bill",
          kind: "contribution",
          method: "card",
          applied: amount,
          tip: 0,
          state: "received",
          receivedAt: AT,
          requestedBy: PERSON,
          source: "device",
          deviceId,
        })
        .returning();
      const [tender] = await store.db
        .insert(tenders)
        .values({ saleId, method: "card", amount, settledAt: AT, billPaymentId: bill!.id })
        .returning();
      const payment = await capture(saleId, { billPaymentId: bill!.id, amount, cardLast4: last4 });
      targets.push({ tenderId: tender!.id, last4, paymentRef: payment.paymentRef });
    }
    await store.db.insert(saleSettlements).values({ saleId, settledAt: AT });
    const pending = await refund(
      { saleId, tenderId: targets[0]!.tenderId },
      {
        method: "card",
        provider: "fake",
        providerPaymentRef: targets[0]!.paymentRef,
        appliedAmount: 100,
        state: "pending",
        completedAt: null,
      },
    );
    const rows = await read(saleId);
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row.tenderId === cash!.id)).toMatchObject({
      method: "cash",
      last4: null,
      appliedRemaining: "2.00",
      pendingRefundId: null,
    });
    expect(rows.find((row) => row.tenderId === targets[0]!.tenderId)).toMatchObject({
      method: "card",
      last4: "1234",
      appliedRemaining: "2.00",
      pendingRefundId: pending.id,
    });
    expect(rows.find((row) => row.tenderId === targets[1]!.tenderId)).toMatchObject({
      method: "card",
      last4: "0042",
      appliedRemaining: "5.00",
      pendingRefundId: null,
    });
  });

  it("counts an already recorded provider return once when it mirrors the completed tender refund", async () => {
    const target = await paid("card");
    const payment = await capture(target.saleId, { state: "partially_refunded" });
    await refund(target, {
      method: "card",
      provider: payment.provider,
      providerPaymentRef: payment.paymentRef,
      providerRefundRef: "re_done",
    });
    await store.db.insert(paymentRefunds).values({
      paymentId: payment.id,
      provider: payment.provider,
      paymentRef: payment.paymentRef,
      amount: 200,
      state: "succeeded",
      providerRefundRef: "re_done",
    });
    expect(await read(target.saleId)).toMatchObject([
      { appliedRemaining: "8.00", tipRemaining: "1.00" },
    ]);
  });

  it("reserves provider-only returns, excludes failed provider evidence and never makes a negative balance", async () => {
    const target = await paid("card");
    const payment = await capture(target.saleId, { state: "partially_refunded" });
    await store.db.insert(paymentRefunds).values([
      {
        paymentId: payment.id,
        provider: "fake",
        paymentRef: payment.paymentRef,
        amount: 400,
        state: "succeeded",
      },
      {
        paymentId: payment.id,
        provider: "fake",
        paymentRef: payment.paymentRef,
        amount: 600,
        state: "failed",
      },
    ]);
    expect(await read(target.saleId)).toMatchObject([
      { appliedRemaining: "6.00", tipRemaining: "1.00" },
    ]);
    await store.db.insert(paymentRefunds).values({
      paymentId: payment.id,
      provider: "fake",
      paymentRef: payment.paymentRef,
      amount: 700,
      state: "succeeded",
    });
    expect(await read(target.saleId)).toEqual([]);
  });

  it("does not offer remaining money when the provider row says the capture was fully refunded", async () => {
    const target = await paid("card");
    await capture(target.saleId, { state: "refunded" });
    expect(await read(target.saleId)).toEqual([]);
  });

  it("uses bill-payment identity to keep mixed cards and their already-net tenders separate", async () => {
    const saleId = await invoice();
    const [bill] = await store.db
      .insert(billPayments)
      .values({
        workingOrderId: orderId,
        submissionId: randomUUID(),
        fingerprint: "bill",
        kind: "contribution",
        method: "card",
        applied: 1200,
        tip: 100,
        state: "received",
        receivedAt: AT,
        requestedBy: PERSON,
        source: "device",
        deviceId,
      })
      .returning();
    await store.db.insert(billPaymentRefunds).values({
      billPaymentId: bill!.id,
      submissionId: randomUUID(),
      fingerprint: "before-invoice",
      appliedAmount: 200,
      tipAmount: 0,
      reason: "Before invoice",
      authorizedBy: PERSON,
      requestedBy: PERSON,
      source: "device",
      deviceId,
      state: "completed",
      completedAt: AT,
      providerRefundRef: "re_old",
    });
    const [tender] = await store.db
      .insert(tenders)
      .values({
        saleId,
        method: "card",
        amount: 1100,
        tipAmount: 100,
        settledAt: AT,
        billPaymentId: bill!.id,
      })
      .returning();
    await store.db.insert(saleSettlements).values({ saleId, settledAt: AT });
    const payment = await capture(saleId, {
      billPaymentId: bill!.id,
      amount: 1300,
      state: "partially_refunded",
    });
    await store.db.insert(paymentRefunds).values({
      paymentId: payment.id,
      provider: "fake",
      paymentRef: payment.paymentRef,
      amount: 200,
      state: "succeeded",
      providerRefundRef: "re_old",
    });
    await capture(saleId, { state: "failed", cardLast4: "9999" });
    expect(await read(saleId)).toEqual([
      {
        tenderId: tender!.id,
        method: "card",
        last4: "0042",
        appliedRemaining: "10.00",
        tipRemaining: "1.00",
        pendingRefundId: null,
        manual: false,
      },
    ]);
    expect(
      await store.db
        .select()
        .from(billPaymentRefunds)
        .where(eq(billPaymentRefunds.billPaymentId, bill!.id)),
    ).toHaveLength(1);
  });
});

describe("cash refund balance without the optional payments module", () => {
  const core = useVenueDb({ migrations: [CORE_MIGRATIONS] });
  it("reads a cash-only balance when the optional payment tables are absent", async () => {
    const db = core.db;
    await seedTenant(db);
    await db.insert(locations).values({
      id: cfg.locationId,
      name: "Cash venue",
      invoiceLocales: ["en-GB"],
      operationDescription: "Meals",
    });
    const nodeId = await seedNode(db, cfg.locationId);
    const device = await seedDevice(db, { locationId: cfg.locationId });
    const [series] = await db
      .insert(invoiceSeries)
      .values({ nodeId, code: "CA", purpose: "standard" })
      .returning();
    const [sale] = await db
      .insert(sales)
      .values({
        source: "device",
        deviceId: device.deviceId,
        nodeId,
        seriesId: series!.id,
        invoiceNumber: 1,
        issuedAt: AT,
        issuedOffsetMinutes: 0,
        total: 1000,
        vatBreakdown: [],
        locale: "en-GB",
        invoiceLocales: ["en-GB"],
        fiscalBackend: "none",
        fiscalState: "not_applicable",
      })
      .returning();
    const [tender] = await db
      .insert(tenders)
      .values({ saleId: sale!.id, method: "cash", amount: 1100, tipAmount: 100, settledAt: AT })
      .returning();
    await db.insert(saleSettlements).values({ saleId: sale!.id, settledAt: AT });
    expect(
      db.all(
        sql`select name from sqlite_master where type = 'table' and name in ('payments', 'payment_refunds')`,
      ),
    ).toEqual([]);
    expect(
      await withTransaction(db, (tx) => readRefundableTenders(tx, { ...cfg, nodeId }, sale!.id)),
    ).toEqual([
      {
        tenderId: tender!.id,
        method: "cash",
        last4: null,
        appliedRemaining: "10.00",
        tipRemaining: "1.00",
        pendingRefundId: null,
        manual: false,
      },
    ]);
  });
});
