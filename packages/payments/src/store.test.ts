import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  CORE_MIGRATIONS,
  UNIQUE_VIOLATION,
  billPayments,
  captureError,
  engineErrorMessage,
  nodes,
  refusalOn,
  tills,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { cardReaders } from "./schema/card-readers.js";
import { paymentRefunds } from "./schema/payment-refunds.js";
import { payments } from "./schema/payments.js";
import {
  assertReversible,
  associatePaymentWithSale,
  captureAttempting,
  claimAcceptedOffline,
  existingReferences,
  expireInitiated,
  failAttempting,
  findCapturedPaymentForWorkingOrder,
  findCapturedPaymentForWorkingOrderAnyProvider,
  findPaymentByBillPayment,
  findPaymentsByBillPayments,
  findPaymentByRef,
  getPaymentByRef,
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  insertInitiated,
  listAcceptedOffline,
  listAttempting,
  listReconcilable,
  markReconcileRemediated,
  recordFailedRefund,
  recordRefund,
  recordVoid,
  recordedRefundRefs,
  hasPaymentWithExternalRef,
  settleForwarded,
  settleInitiated,
  stampAttemptingRef,
} from "./store.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";
import type { Seeded } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // Child before parent: `payment_refunds` points at `payments`.
  await suite.db.execute(sql`delete from payment_refunds`);
  await suite.db.execute(sql`delete from payments`);
});

const SETTLED = new Date("2026-07-22T10:00:00Z");

async function seedTenant() {
  return seedWorkingOrder(suite.db, freshNif());
}

async function capture(seeded: Seeded, paymentRef: string, amount = "10.00") {
  const key = { provider: "fake", paymentRef };
  await suite.db.transaction((tx) =>
    insertCapturedPayment(tx, {
      origin: deviceOrigin(seeded.deviceId),
      workingOrderId: seeded.workingOrderId,
      provider: "fake",
      paymentRef,
      amount: decimal(amount),
      settledAt: SETTLED,
    }),
  );
  return key;
}

async function getRow(key: { provider: string; paymentRef: string }) {
  return suite.db.transaction((tx) => getPaymentByRef(tx, key));
}

/** A second node, because `seedSale` always plants its `invoice_series` at code "A" for the node it
 * is given, and the series is keyed `(node_id, code)`. */
async function seedSecondSale(seeded: Seeded): Promise<string> {
  const [till] = (
    await suite.db.execute<{ location_id: string }>(
      sql`select location_id from tills where id = ${seeded.tillId}`,
    )
  ).rows;
  const [till2] = await suite.db
    .insert(tills)
    .values({ locationId: till.location_id, name: "Till 2" })
    .returning({ id: tills.id });
  const [node2] = await suite.db
    .insert(nodes)
    .values({ locationId: till.location_id, name: "Node 2" })
    .returning({ id: nodes.id });
  return seedSale(suite.db, { ...seeded, tillId: till2!.id, nodeId: node2!.id });
}

describe("insertCapturedPayment", () => {
  it("stores the source and device the payment was started on", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p-origin");
    const rows = await suite.db.execute<{ source: string | null; device_id: string | null }>(
      sql`select source, device_id from payments where payment_ref = ${key.paymentRef}`,
    );
    expect(rows.rows[0]).toEqual({ source: "device", device_id: seeded.deviceId });
  });

  it("inserts state=captured with a non-null settledAt", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p1");
    const row = await getRow(key);
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).not.toBeNull();
    expect(row?.amount).toBe("10.00");
    expect(row?.saleId).toBeNull();
  });
});

describe("insertFailedPayment", () => {
  it("inserts state=failed with a null settledAt", async () => {
    const seeded = await seedTenant();
    const key = { provider: "fake", paymentRef: "p2" };
    await suite.db.transaction((tx) =>
      insertFailedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "p2",
        amount: decimal("10.00"),
      }),
    );
    const row = await getRow(key);
    expect(row?.state).toBe("failed");
    expect(row?.settledAt).toBeNull();
  });
});

describe("recordVoid", () => {
  it("reverses a captured payment to voided", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p3");
    const result = await suite.db.transaction((tx) => recordVoid(tx, key));
    expect(result.state).toBe("voided");
    const row = await getRow(key);
    expect(row?.state).toBe("voided");
  });

  it("throws payment.not_voidable for a payment not in the captured state", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p4");
    // Fully refund first so the payment is no longer `captured`.
    await suite.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.00") }));
    const error = await suite.db.transaction((tx) => recordVoid(tx, key)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const key = { provider: "fake", paymentRef: "unknown" };
    const error = await suite.db.transaction((tx) => recordVoid(tx, key)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("recordRefund", () => {
  it("refunds the full amount, setting state=refunded and inserting a payment_refunds row", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p5", "20.00");
    const result = await suite.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    expect(result.state).toBe("refunded");
    const row = await getRow(key);
    expect(row?.state).toBe("refunded");
    const refunds = await suite.db.execute<{ amount: number }>(
      sql`select amount from payment_refunds where payment_ref = ${"p5"}`,
    );
    expect(refunds.rows).toHaveLength(1);
    // Read straight from the column: the stored count of cents for 20.00.
    expect(refunds.rows[0].amount).toBe(2000);
  });

  it("writes authorized_by when supplied, and NULL when omitted", async () => {
    const seeded = await seedTenant();
    const authorizer = "11111111-1111-1111-1111-111111111111";
    const withKey = await capture(seeded, "auth-with", "20.00");
    await suite.db.transaction((tx) =>
      recordRefund(tx, { ...withKey, amount: decimal("20.00"), authorizedBy: authorizer }),
    );
    const withoutKey = await capture(seeded, "auth-without", "20.00");
    await suite.db.transaction((tx) =>
      recordRefund(tx, { ...withoutKey, amount: decimal("20.00") }),
    );
    const rows = await suite.db.execute<{ payment_ref: string; authorized_by: string | null }>(
      sql`select payment_ref, authorized_by from payment_refunds order by payment_ref`,
    );
    expect(rows.rows).toEqual([
      { payment_ref: "auth-with", authorized_by: authorizer },
      { payment_ref: "auth-without", authorized_by: null },
    ]);
  });

  it("a partial refund sets partially_refunded, then a second refund reaching the total sets refunded", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p6", "20.00");
    const first = await suite.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("12.00") }),
    );
    expect(first.state).toBe("partially_refunded");
    expect((await getRow(key))?.state).toBe("partially_refunded");

    const second = await suite.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("8.00") }),
    );
    expect(second.state).toBe("refunded");
    expect((await getRow(key))?.state).toBe("refunded");
  });

  it("throws payment.refund_exceeds_capture when the running total would exceed the capture", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p7", "10.00");
    const error = await suite.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.01") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.refund_exceeds_capture when a second refund would push the running total over", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p8", "10.00");
    await suite.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("6.00") }));
    const error = await suite.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("5.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.not_refundable for a voided payment", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p9");
    await suite.db.transaction((tx) => recordVoid(tx, key));
    const error = await suite.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("throws payment.not_refundable for a failed payment", async () => {
    const seeded = await seedTenant();
    const key = { provider: "fake", paymentRef: "p10" };
    await suite.db.transaction((tx) =>
      insertFailedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "p10",
        amount: decimal("10.00"),
      }),
    );
    const error = await suite.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const key = { provider: "fake", paymentRef: "unknown" };
    const error = await suite.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("assertReversible", () => {
  it("does not throw for a captured payment, for either kind", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r1");
    await expect(
      suite.db.transaction((tx) => assertReversible(tx, { ...key, kind: "void" })),
    ).resolves.toBeUndefined();
    await expect(
      suite.db.transaction((tx) => assertReversible(tx, { ...key, kind: "refund" })),
    ).resolves.toBeUndefined();
  });

  it("void throws payment.not_voidable when the payment is not captured (e.g. already fully refunded)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r2");
    await suite.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.00") }));
    const error = await suite.db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "void" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
  });

  it("refund throws payment.not_refundable for a voided payment", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r3");
    await suite.db.transaction((tx) => recordVoid(tx, key));
    const error = await suite.db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "refund" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("refund throws payment.refund_exceeds_capture when the running succeeded total + requested would exceed the capture", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r4", "20.00");
    await suite.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("12.00") }));
    // A full-amount pre-check against the original capture, with 12.00 already succeeded-refunded.
    const error = await suite.db
      .transaction((tx) =>
        assertReversible(tx, { ...key, kind: "refund", amount: decimal("20.00") }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const key = { provider: "fake", paymentRef: "unknown" };
    const error = await suite.db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "void" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("associatePaymentWithSale", () => {
  it("sets sale_id, observable via getPaymentByRef", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p11");
    const saleId = await seedSale(suite.db, seeded);
    await suite.db.transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId }));
    const row = await getRow(key);
    expect(row?.saleId).toBe(saleId);
  });

  it("stamps reader_id when supplied, in the same write-once UPDATE as sale_id", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p12r");
    const saleId = await seedSale(suite.db, seeded);
    const [reader] = await suite.db
      .insert(cardReaders)
      .values({ provider: "stripe", providerRef: "tmr_stamp", name: "Front counter" })
      .returning({ id: cardReaders.id });
    const readerId = reader!.id;
    await suite.db.transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId, readerId }));
    const [row] = (
      await suite.db.execute<{ reader_id: string | null }>(sql`
        select reader_id from payments
        where provider = ${key.provider} and payment_ref = ${key.paymentRef}`)
    ).rows;
    expect(row!.reader_id).toBe(readerId);
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const saleId = await seedSale(suite.db, seeded);
    const key = { provider: "fake", paymentRef: "unknown" };
    const error = await suite.db
      .transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });

  it("throws payment.already_associated when the payment is already linked to a sale, and does not re-point it", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p13");
    const firstSaleId = await seedSale(suite.db, seeded);
    const secondSaleId = await seedSecondSale(seeded);
    await suite.db.transaction((tx) =>
      associatePaymentWithSale(tx, { ...key, saleId: firstSaleId }),
    );

    const error = await suite.db
      .transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId: secondSaleId }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.already_associated");
    expect((error as AppError).params).toEqual({ paymentRef: "p13", saleId: firstSaleId });

    // The failed re-association left the original link untouched.
    const row = await getRow(key);
    expect(row?.saleId).toBe(firstSaleId);
  });
});

describe("getPaymentByRef", () => {
  it("returns undefined for an unknown ref", async () => {
    const row = await getRow({
      provider: "fake",
      paymentRef: "unknown",
    });
    expect(row).toBeUndefined();
  });
});

describe("findPaymentByRef", () => {
  it("returns the row for a known ref", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "p12");
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", "p12"));
    expect(row?.state).toBe("captured");
    expect(row?.amount).toBe("10.00");
  });

  it("returns undefined for an unknown ref", async () => {
    await seedTenant();
    const row = await suite.db.transaction((tx) => findPaymentByRef(tx, "fake", "unknown"));
    expect(row).toBeUndefined();
  });
});

describe("findCapturedPaymentForWorkingOrder", () => {
  // This asserts the STATE filter and column projection only. The REPLAY branch (a non-null
  // `saleId`) is asserted in store.card-and-replay.test.ts.
  it("returns a captured payment for the working order, ignoring non-captured states", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const key = {
      origin: deviceOrigin(s.deviceId),
      provider: "stripe",
      workingOrderId: s.workingOrderId,
    };
    // A failed attempt must NOT match (a legitimately-declined card is re-chargeable).
    await suite.db.transaction((tx) =>
      insertFailedPayment(tx, { ...key, paymentRef: "f1", amount: decimal("5.00") }),
    );
    expect(
      await suite.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key)),
    ).toBeUndefined();
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "c1",
        amount: decimal("12.10"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
        externalRef: "pi_x",
      }),
    );
    const found = await suite.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found).toMatchObject({
      paymentRef: "c1",
      amount: "12.10",
      saleId: null,
      externalRef: "pi_x",
      state: "captured",
    });
  });

  it("matches an accepted_offline payment that is still unassociated (saleId null)", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const key = {
      origin: deviceOrigin(s.deviceId),
      provider: "stripe",
      workingOrderId: s.workingOrderId,
    };
    await suite.db.transaction((tx) =>
      insertAcceptedOffline(tx, {
        ...key,
        paymentRef: "o1",
        amount: decimal("8.00"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
      }),
    );
    const found = await suite.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found).toMatchObject({ paymentRef: "o1", state: "accepted_offline", saleId: null });
  });

  it("returns undefined when the only payment is attempting (the lost-T2 window is not yet captured)", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const key = {
      origin: deviceOrigin(s.deviceId),
      provider: "stripe",
      workingOrderId: s.workingOrderId,
    };
    await suite.db.transaction((tx) =>
      insertAttempting(tx, { ...key, paymentRef: "a1", amount: decimal("9.00") }),
    );
    expect(
      await suite.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key)),
    ).toBeUndefined();
  });

  it("returns the MOST RECENT captured row if the one-capture-per-order invariant is ever violated", async () => {
    // No constraint stops two captured rows for one working order.
    const s = await seedWorkingOrder(suite.db, freshNif());
    const key = {
      origin: deviceOrigin(s.deviceId),
      provider: "stripe",
      workingOrderId: s.workingOrderId,
    };
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "older",
        amount: decimal("5.00"),
        settledAt: new Date("2026-07-24T09:00:00Z"),
      }),
    );
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "newer",
        amount: decimal("7.00"),
        settledAt: new Date("2026-07-24T11:00:00Z"),
      }),
    );
    const found = await suite.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found?.paymentRef).toBe("newer");
  });

  it("prefers a genuinely settled row over a captured row with settled_at NULL", async () => {
    // The store's own insert helpers cannot write a captured row with a NULL `settled_at`, so this
    // seeds one directly. It does NOT pin `nulls last`: this engine already sorts NULL last under
    // `desc`, so the case passes without the clause.
    const s = await seedWorkingOrder(suite.db, freshNif());
    const key = {
      origin: deviceOrigin(s.deviceId),
      provider: "stripe",
      workingOrderId: s.workingOrderId,
    };
    await suite.db.insert(payments).values({
      workingOrderId: key.workingOrderId,
      source: "device",
      deviceId: s.deviceId,
      provider: key.provider,
      paymentRef: "null-settled",
      // Whole cents: 300 is 3.00.
      amount: 300,
      state: "captured",
      settledAt: null,
    });
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "real-settled",
        amount: decimal("4.00"),
        settledAt: new Date("2026-07-24T10:00:00Z"),
      }),
    );
    const found = await suite.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found?.paymentRef).toBe("real-settled");
  });
});

describe("insertCapturedPayment external_ref", () => {
  it("persists external_ref when provided", async () => {
    const seeded = await seedTenant();
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "ext1",
        amount: decimal("10.00"),
        settledAt: SETTLED,
        externalRef: "OP-42",
      }),
    );
    const rows = await suite.db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext1"}`,
    );
    expect(rows.rows[0].external_ref).toBe("OP-42");
  });

  it("leaves external_ref null when omitted", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ext2");
    const rows = await suite.db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext2"}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});

describe("attempting lifecycle", () => {
  it("insertAttempting writes state=attempting, settledAt null", async () => {
    const seeded = await seedTenant();
    await suite.db.transaction((tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "a1",
        amount: decimal("12.10"),
      }),
    );
    const row = await getRow({ provider: "fake", paymentRef: "a1" });
    expect(row?.state).toBe("attempting");
    expect(row?.settledAt).toBeNull();
  });

  it("captureAttempting advances attempting -> captured with settledAt + external_ref", async () => {
    const seeded = await seedTenant();
    const key = { provider: "fake", paymentRef: "a2" };
    await suite.db.transaction((tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(seeded.deviceId),
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
      }),
    );
    const settledAt = new Date("2026-07-23T10:00:00Z");
    const result = await suite.db.transaction((tx) =>
      captureAttempting(tx, { ...key, settledAt, externalRef: "pi_123" }),
    );
    expect(result.state).toBe("captured");
    const rows = await suite.db.execute<{
      state: string;
      external_ref: string | null;
      settled_at: string | null;
    }>(sql`select state, external_ref, settled_at from payments where payment_ref = ${"a2"}`);
    expect(rows.rows[0]).toMatchObject({ state: "captured", external_ref: "pi_123" });
    expect(rows.rows[0].settled_at).not.toBeNull();
  });

  it("failAttempting advances attempting -> failed", async () => {
    const seeded = await seedTenant();
    const key = { provider: "fake", paymentRef: "a3" };
    await suite.db.transaction((tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(seeded.deviceId),
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
      }),
    );
    const result = await suite.db.transaction((tx) => failAttempting(tx, key));
    expect(result.state).toBe("failed");
    expect((await getRow(key))?.state).toBe("failed");
  });

  it("captureAttempting throws payment.not_found when there is no attempting row", async () => {
    const key = { provider: "fake", paymentRef: "nope" };
    const err = await suite.db
      .transaction((tx) =>
        captureAttempting(tx, { ...key, settledAt: new Date(), externalRef: "pi_x" }),
      )
      .catch((e: unknown) => e);
    expect((err as AppError).code).toBe("payment.not_found");
  });
});

describe("externalRef on read-back + failed refunds", () => {
  it("getPaymentByRef returns externalRef", async () => {
    const seeded = await seedTenant();
    const key = { provider: "fake", paymentRef: "e1" };
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("10.00"),
        settledAt: SETTLED,
        externalRef: "pi_ext",
      }),
    );
    const row = await getRow(key);
    expect(row?.externalRef).toBe("pi_ext");
  });

  it("recordFailedRefund inserts a failed refund row and leaves the payment captured", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "e2", "20.00");
    await suite.db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }));
    expect((await getRow(key))?.state).toBe("captured");
    const refunds = await suite.db.execute<{ state: string }>(
      sql`select state from payment_refunds where payment_ref = ${"e2"}`,
    );
    expect(refunds.rows).toEqual([{ state: "failed" }]);
  });

  it("recordFailedRefund writes authorized_by when supplied, and NULL when omitted", async () => {
    const seeded = await seedTenant();
    const authorizer = "22222222-2222-2222-2222-222222222222";
    const withKey = await capture(seeded, "fauth-with", "20.00");
    await suite.db.transaction((tx) =>
      recordFailedRefund(tx, { ...withKey, amount: decimal("5.00"), authorizedBy: authorizer }),
    );
    const withoutKey = await capture(seeded, "fauth-without", "20.00");
    await suite.db.transaction((tx) =>
      recordFailedRefund(tx, { ...withoutKey, amount: decimal("5.00") }),
    );
    const rows = await suite.db.execute<{ payment_ref: string; authorized_by: string | null }>(
      sql`select payment_ref, authorized_by from payment_refunds
          where state = 'failed' order by payment_ref`,
    );
    expect(rows.rows).toEqual([
      { payment_ref: "fauth-with", authorized_by: authorizer },
      { payment_ref: "fauth-without", authorized_by: null },
    ]);
  });

  it("recordRefund ignores a prior FAILED refund when summing (a failed refund does not consume the balance)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "e3", "20.00");
    await suite.db.transaction((tx) =>
      recordFailedRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    // A full succeeded refund must still be allowed — the failed one didn't consume anything.
    const result = await suite.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    expect(result.state).toBe("refunded");
  });

  it("recordFailedRefund throws payment.not_found for an unknown ref", async () => {
    const key = { provider: "fake", paymentRef: "no-such-ref" };
    const error = await suite.db
      .transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("listAcceptedOffline", () => {
  it("listAcceptedOffline returns this provider's accepted_offline rows without locking them", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    await suite.db.transaction((tx) =>
      insertAcceptedOffline(tx, {
        origin: deviceOrigin(s.deviceId),
        workingOrderId: s.workingOrderId,
        provider: "fake",
        paymentRef: "lst-1",
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-24T10:00:00Z"),
      }),
    );
    const listed = await suite.db.transaction((tx) => listAcceptedOffline(tx, "fake"));
    expect(listed.map((r) => r.paymentRef)).toContain("lst-1");
    expect(listed.find((r) => r.paymentRef === "lst-1")?.saleId).toBeNull();
  });
});

describe("claimAcceptedOffline", () => {
  it("returns this provider's accepted_offline rows and writes nothing to any payment row", async () => {
    const s = await seedWorkingOrder(suite.db, freshNif());
    const order = { origin: deviceOrigin(s.deviceId), workingOrderId: s.workingOrderId };
    await suite.db.transaction(async (tx) => {
      await insertAcceptedOffline(tx, {
        ...order,
        provider: "fake",
        paymentRef: "clm-mine",
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-24T10:00:00Z"),
      });
      await insertAcceptedOffline(tx, {
        ...order,
        provider: "other",
        paymentRef: "clm-other-provider",
        amount: decimal("11.00"),
        settledAt: new Date("2026-07-24T10:00:00Z"),
      });
      await insertFailedPayment(tx, {
        ...order,
        provider: "fake",
        paymentRef: "clm-other-state",
        amount: decimal("12.00"),
      });
    });
    const allRows = () => suite.db.select().from(payments).orderBy(payments.paymentRef);
    const before = await allRows();

    const claimed = await suite.db.transaction((tx) => claimAcceptedOffline(tx, "fake"));

    expect(claimed.map((r) => r.paymentRef)).toEqual(["clm-mine"]);
    // Every column, not just `state`: the forward pass reads these rows and advances them through
    // its own state-guarded updates, so the selection itself must leave them byte-for-byte alone.
    expect(await allRows()).toEqual(before);
  });
});

describe("Mode 3 initiated lifecycle", () => {
  const HOSTED = "hosted-abc";
  const SETTLED_AT = new Date("2026-07-24T12:00:00Z");

  async function initiate(seeded: Seeded, externalRef = HOSTED, paymentRef = "pay-1") {
    await suite.db.transaction((tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef,
        externalRef,
        amount: decimal("12.10"),
      }),
    );
    return { provider: "fake", paymentRef };
  }

  it("insertInitiated writes state=initiated, settledAt null, external_ref set", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    const row = await getRow(key);
    expect(row?.state).toBe("initiated");
    expect(row?.settledAt).toBeNull();
    expect(row?.externalRef).toBe(HOSTED);
  });

  it("settleInitiated advances initiated -> captured, sets settledAt, and returns the row", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    const settled = await suite.db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: HOSTED, settledAt: SETTLED_AT }),
    );
    expect(settled).not.toBeNull();
    expect(settled?.workingOrderId).toBe(seeded.workingOrderId);
    expect(settled?.amount).toBe("12.10");
    expect(settled?.paymentRef).toBe("pay-1");
    const row = await getRow(key);
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).not.toBeNull();
  });

  it("settleInitiated is idempotent: a second call returns null and does not re-settle", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    await suite.db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: HOSTED, settledAt: SETTLED_AT }),
    );
    const firstSettledAt = (await getRow(key))?.settledAt;
    const second = await suite.db.transaction((tx) =>
      settleInitiated(tx, {
        provider: "fake",
        externalRef: HOSTED,
        settledAt: new Date("2026-07-24T13:00:00Z"),
      }),
    );
    expect(second).toBeNull();
    // A redelivered settle with a LATER timestamp must not move settled_at.
    const row = await getRow(key);
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).toBe(firstSettledAt);
  });

  it("expireInitiated advances initiated -> failed and is idempotent", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    await suite.db.transaction((tx) =>
      expireInitiated(tx, { provider: "fake", externalRef: HOSTED }),
    );
    expect((await getRow(key))?.state).toBe("failed");
    // Second call is a no-op (state is no longer `initiated`) — does not throw, leaves `failed`.
    await suite.db.transaction((tx) =>
      expireInitiated(tx, { provider: "fake", externalRef: HOSTED }),
    );
    const row = await getRow(key);
    expect(row?.state).toBe("failed");
    expect(row?.settledAt).toBeNull();
  });

  it("the partial unique index rejects a second initiated row with the same (provider, external_ref)", async () => {
    const seeded = await seedTenant();
    await initiate(seeded, HOSTED, "pay-1");
    // This engine names the index's COLUMNS, not the index; the pair is what tells this refusal from
    // `payments_provider_ref_key`'s (provider, payment_ref), hence `toBe` on the whole string.
    const error = await captureError(() => initiate(seeded, HOSTED, "pay-2"));
    expect(engineErrorMessage(error)).toBe(
      "UNIQUE constraint failed: payments.provider, payments.external_ref",
    );
  });

  it("the partial unique index does NOT constrain manual/null external_ref rows", async () => {
    const seeded = await seedTenant();
    // Two manual rows sharing a hand-keyed external_ref: allowed (provider = 'manual' is excluded).
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "manual",
        paymentRef: "m-1",
        amount: decimal("5.00"),
        externalRef: "OP-777",
        settledAt: SETTLED,
      }),
    );
    await expect(
      suite.db.transaction((tx) =>
        insertCapturedPayment(tx, {
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: seeded.workingOrderId,
          provider: "manual",
          paymentRef: "m-2",
          amount: decimal("6.00"),
          externalRef: "OP-777",
          settledAt: SETTLED,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});

const PERIOD = { from: new Date("2026-07-22T00:00:00Z"), to: new Date("2026-07-23T00:00:00Z") };

/** Sets a seeded working order's status. `settled` also needs `settled_at` (the biconditional
 * CHECK `working_orders_settled_at_ck`); `abandoned` must leave it null. */
async function setOrderStatus(
  seeded: Seeded,
  status: "open" | "settled" | "abandoned",
): Promise<void> {
  await suite.db.execute(sql`
    update working_orders
    set status = ${status}, settled_at = ${status === "settled" ? sql`now()` : null}
    where id = ${seeded.workingOrderId}`);
}

describe("listReconcilable", () => {
  it("returns captured rows settled inside the period, joined to their working order", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "in-period");
    const rows = await suite.db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paymentRef: "in-period",
      state: "captured",
      amount: "10.00",
      saleId: null,
      workingOrderId: seeded.workingOrderId,
      workingOrderStatus: "open",
      reconcileRemediatedAt: null,
    });
    expect(rows[0].auditedAt).toBe(rows[0].settledAt);
  });

  it("returns settled rows too — the forwarded-offline state the orphan rule also reaches", async () => {
    // `settled` can be an orphan with NO reversal path, which is why the sweep's claim gate tests
    // the state; that gate only means something if this query admits the state.
    const seeded = await seedTenant();
    await suite.db.transaction(async (tx) => {
      await insertAcceptedOffline(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "forwarded",
        amount: decimal("12.00"),
        settledAt: SETTLED,
      });
      await settleForwarded(tx, {
        provider: "fake",
        paymentRef: "forwarded",
      });
    });
    const rows = await suite.db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentRef: "forwarded", state: "settled", amount: "12.00" });
    expect(rows[0].auditedAt).toBe(rows[0].settledAt);
  });

  it("merges its two state arms back into one created_at ordering", async () => {
    // The `initiated` row is created FIRST but comes back from the SECOND query, so a plain
    // concatenation would report it last.
    const seeded = await seedTenant();
    await suite.db.transaction((tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "first-pending",
        amount: decimal("7.00"),
        externalRef: "ext-order",
      }),
    );
    await suite.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "second-held",
        amount: decimal("8.00"),
        settledAt: new Date(),
      }),
    );
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const rows = await suite.db.transaction((tx) => listReconcilable(tx, "fake", now));
    expect(rows.map((r) => r.paymentRef)).toEqual(["first-pending", "second-held"]);
  });

  it("excludes rows settled outside the period", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "outside");
    const later = { from: new Date("2026-07-23T00:00:00Z"), to: new Date("2026-07-24T00:00:00Z") };
    expect(await suite.db.transaction((tx) => listReconcilable(tx, "fake", later))).toEqual([]);
  });

  it("excludes another provider's rows", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ours");
    expect(await suite.db.transaction((tx) => listReconcilable(tx, "other", PERIOD))).toEqual([]);
  });

  it("includes initiated rows by created_at and reports auditedAt from it", async () => {
    const seeded = await seedTenant();
    await suite.db.transaction((tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "pending",
        amount: decimal("7.00"),
        externalRef: "ext-pending",
      }),
    );
    // created_at is the insert time, so the period is around now rather than the fixture day.
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const rows = await suite.db.transaction((tx) => listReconcilable(tx, "fake", now));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentRef: "pending", state: "initiated", settledAt: null });
    expect(rows[0].auditedAt).not.toBeNull();
  });

  it("excludes failed and accepted_offline rows (forward's queue, not reconcile's)", async () => {
    const seeded = await seedTenant();
    await suite.db.transaction(async (tx) => {
      await insertFailedPayment(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "nope",
        amount: decimal("3.00"),
      });
      await insertAcceptedOffline(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "queued",
        amount: decimal("4.00"),
        settledAt: SETTLED,
      });
    });
    expect(await suite.db.transaction((tx) => listReconcilable(tx, "fake", PERIOD))).toEqual([]);
  });

  it("reports the working order status the orphan rule reads", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "abandoned-one");
    await setOrderStatus(seeded, "abandoned");
    const rows = await suite.db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    expect(rows[0].workingOrderStatus).toBe("abandoned");
  });
});

describe("existingReferences", () => {
  /** `existingReferences` is unbounded by state and settlement time; only `provider` +
   * `externalRef` matter. */
  async function seedReference(seeded: Seeded, paymentRef: string, externalRef: string) {
    await suite.db.transaction((tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef,
        amount: decimal("5.00"),
        externalRef,
      }),
    );
  }

  it("returns the subset of references that match, across multiple local rows", async () => {
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init", "ext-1");
    await seedReference(seeded, "r-init2", "ext-2");
    const found = await suite.db.transaction((tx) =>
      existingReferences(tx, "fake", ["nope", "ext-1", "ext-2"]),
    );
    expect(found).toEqual(new Set(["ext-1", "ext-2"]));
  });

  it("matches a record whose reference is not first in the query list", async () => {
    // A batched implementation keyed on `references[0]` alone (rather than every reference in the
    // list) would miss this — the query list here deliberately puts the matching reference last.
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init3", "ext-3");
    const found = await suite.db.transaction((tx) =>
      existingReferences(tx, "fake", ["ghost-a", "ghost-b", "ext-3"]),
    );
    expect(found).toEqual(new Set(["ext-3"]));
  });

  it("is empty for unknown references, an empty list, and another provider", async () => {
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init4", "ext-4");
    expect(await suite.db.transaction((tx) => existingReferences(tx, "fake", ["ghost"]))).toEqual(
      new Set(),
    );
    expect(await suite.db.transaction((tx) => existingReferences(tx, "fake", []))).toEqual(
      new Set(),
    );
    expect(await suite.db.transaction((tx) => existingReferences(tx, "other", ["ext-4"]))).toEqual(
      new Set(),
    );
  });

  it("chunks the IN list — a match past the first chunk boundary is still found", async () => {
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init5", "ext-5");
    // 1000 non-matching references fill the first chunk exactly (CHUNK_SIZE); "ext-5" lands in the
    // second chunk, so this only passes if every chunk is actually queried.
    const references = [...Array.from({ length: 1000 }, (_, i) => `ghost-${i}`), "ext-5"];
    const found = await suite.db.transaction((tx) => existingReferences(tx, "fake", references));
    expect(found).toEqual(new Set(["ext-5"]));
  });
});

describe("markReconcileRemediated", () => {
  it("stamps the marker once and refuses a second stamp", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "orphan-1");
    const at = new Date("2026-07-25T08:00:00Z");
    expect(await suite.db.transaction((tx) => markReconcileRemediated(tx, { ...key, at }))).toBe(
      true,
    );
    expect(await suite.db.transaction((tx) => markReconcileRemediated(tx, { ...key, at }))).toBe(
      false,
    );
    const rows = await suite.db.transaction((tx) => listReconcilable(tx, "fake", PERIOD));
    // The exact passed timestamp, not just non-null — a bug stamping now() instead of `at` would
    // still pass a `.not.toBeNull()` check.
    expect(new Date(rows[0].reconcileRemediatedAt!).toISOString()).toBe(at.toISOString());
  });

  it("returns false for a payment that does not exist", async () => {
    const at = new Date("2026-07-25T08:00:00Z");
    expect(
      await suite.db.transaction((tx) =>
        markReconcileRemediated(tx, {
          provider: "fake",
          paymentRef: "ghost",
          at,
        }),
      ),
    ).toBe(false);
  });
});

describe("hasPaymentWithExternalRef", () => {
  it("is true for a (provider, external_ref) a payment row carries, in any state", async () => {
    const seeded = await seedTenant();
    await suite.db.transaction((tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "res-1",
        externalRef: "hosted-res-1",
        amount: decimal("10.00"),
      }),
    );
    expect(await hasPaymentWithExternalRef(suite.db, "fake", "hosted-res-1")).toBe(true);
    // A row already past `initiated` still counts: the webhook reads that as a redelivery.
    await suite.db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: "hosted-res-1", settledAt: SETTLED }),
    );
    expect(await hasPaymentWithExternalRef(suite.db, "fake", "hosted-res-1")).toBe(true);
  });

  it("is false for a reference no local row carries, or one held under another provider", async () => {
    const seeded = await seedTenant();
    await suite.db.transaction((tx) =>
      insertInitiated(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "res-2",
        externalRef: "hosted-res-2",
        amount: decimal("10.00"),
      }),
    );
    expect(await hasPaymentWithExternalRef(suite.db, "fake", "nothing-ever-initiated-this")).toBe(
      false,
    );
    expect(await hasPaymentWithExternalRef(suite.db, "stripe", "hosted-res-2")).toBe(false);
  });
});

describe("listAttempting / stampAttemptingRef", () => {
  it("lists only this provider's attempting rows, oldest first, with their poll key", async () => {
    const t = await seedWorkingOrder(suite.db, freshNif());
    await suite.db.transaction(async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        workingOrderId: t.workingOrderId,
        provider: "sumup",
        paymentRef: "ref-a",
        amount: decimal("10.00"),
      });
      await insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        workingOrderId: t.workingOrderId,
        provider: "sumup",
        paymentRef: "ref-b",
        amount: decimal("11.00"),
      });
      await insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        workingOrderId: t.workingOrderId,
        provider: "stripe",
        paymentRef: "ref-c",
        amount: decimal("12.00"),
      });
      await captureAttempting(tx, {
        provider: "sumup",
        paymentRef: "ref-b",
        settledAt: new Date(),
        externalRef: "txn_b",
      });
      await stampAttemptingRef(tx, { provider: "sumup", paymentRef: "ref-a" }, "ctx_a");
    });
    const rows = await suite.db.transaction((tx) => listAttempting(tx, "sumup"));
    expect(rows.map((r) => [r.paymentRef, r.externalRef, r.amount])).toEqual([
      ["ref-a", "ctx_a", "10.00"],
    ]);
    expect(rows[0]!.workingOrderId).toBe(t.workingOrderId);
    expect(typeof rows[0]!.createdAt).toBe("string");
  });

  it("stampAttemptingRef touches only a row still attempting (a captured row keeps its refundable id)", async () => {
    const t = await seedWorkingOrder(suite.db, freshNif());
    const key = { provider: "sumup", paymentRef: "ref-e" };
    await suite.db.transaction(async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        ...key,
        workingOrderId: t.workingOrderId,
        amount: decimal("5.00"),
      });
      await captureAttempting(tx, { ...key, settledAt: new Date(), externalRef: "txn_e" });
      await stampAttemptingRef(tx, key, "ctx_late");
    });
    const row = await suite.db.transaction((tx) => getPaymentByRef(tx, key));
    expect(row!.externalRef).toBe("txn_e");
  });
  it("stampAttemptingRef reports whether it stamped: true on an attempting row, false once resolved", async () => {
    const t = await seedWorkingOrder(suite.db, freshNif());
    const key = { provider: "stripe", paymentRef: "ref-f" };
    const [stamped, late, missing] = await suite.db.transaction(async (tx) => {
      await insertAttempting(tx, {
        origin: deviceOrigin(t.deviceId),
        ...key,
        workingOrderId: t.workingOrderId,
        amount: decimal("5.00"),
      });
      const first = await stampAttemptingRef(tx, key, "pi_f");
      await failAttempting(tx, key);
      const second = await stampAttemptingRef(tx, key, "pi_f_late");
      const none = await stampAttemptingRef(
        tx,
        { provider: "stripe", paymentRef: "no-such-ref" },
        "pi_x",
      );
      return [first, second, none];
    });
    expect([stamped, late, missing]).toEqual([true, false, false]);
  });
});

describe("the link from a provider payment to its bill payment", () => {
  /** A bill payment on the seeded order, which a `payments` row may name. */
  async function billPayment(seeded: Seeded): Promise<string> {
    const [row] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: seeded.workingOrderId,
        source: "device",
        deviceId: seeded.deviceId,
        submissionId: `submission-${Math.random()}`,
        fingerprint: "fingerprint",
        kind: "contribution",
        method: "card",
        applied: 1000,
        state: "pending",
        requestedBy: "11111111-1111-1111-1111-111111111111",
      })
      .returning({ id: billPayments.id });
    return row!.id;
  }

  async function storedLink(paymentRef: string): Promise<string | null> {
    const rows = await suite.db.execute<{ bill_payment_id: string | null }>(
      sql`select bill_payment_id from payments where payment_ref = ${paymentRef}`,
    );
    return rows.rows[0]!.bill_payment_id;
  }

  it.each([
    ["insertAttempting", insertAttempting],
    ["insertCapturedPayment", insertCapturedPayment],
    ["insertAcceptedOffline", insertAcceptedOffline],
    ["insertFailedPayment", insertFailedPayment],
  ] as const)("%s writes the bill payment it was given", async (name, insert) => {
    const seeded = await seedTenant();
    const billPaymentId = await billPayment(seeded);
    await suite.db.transaction((tx) =>
      insert(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: name,
        amount: decimal("10.00"),
        settledAt: SETTLED,
        billPaymentId,
      }),
    );
    expect(await storedLink(name)).toBe(billPaymentId);
  });

  it("leaves the link null for a payment of a whole order", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "whole-order");
    expect(await storedLink("whole-order")).toBeNull();
  });

  it("findPaymentByBillPayment returns the provider's row for that bill payment, and nothing for another", async () => {
    const seeded = await seedTenant();
    const billPaymentId = await billPayment(seeded);
    const other = await billPayment(seeded);
    await capture(seeded, "unlinked");
    await suite.db.transaction((tx) =>
      insertAttempting(tx, {
        origin: deviceOrigin(seeded.deviceId),
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "linked",
        amount: decimal("12.50"),
        billPaymentId,
      }),
    );
    const found = await suite.db.transaction((tx) => findPaymentByBillPayment(tx, billPaymentId));
    expect(found).toMatchObject({
      provider: "fake",
      paymentRef: "linked",
      state: "attempting",
      amount: "12.50",
      saleId: null,
    });
    expect(await suite.db.transaction((tx) => findPaymentByBillPayment(tx, other))).toBeUndefined();
  });

  it("findPaymentsByBillPayments returns each named bill payment's provider row, by its id", async () => {
    const seeded = await seedTenant();
    const first = await billPayment(seeded);
    const second = await billPayment(seeded);
    const none = await billPayment(seeded);
    const unnamed = await billPayment(seeded);
    await capture(seeded, "unlinked");
    for (const [billPaymentId, paymentRef, amount] of [
      [first, "first", "12.50"],
      [second, "second", "7.25"],
      [unnamed, "unnamed", "3.00"],
    ] as const) {
      await suite.db.transaction((tx) =>
        insertAttempting(tx, {
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: seeded.workingOrderId,
          provider: "fake",
          paymentRef,
          amount: decimal(amount),
          billPaymentId,
        }),
      );
    }

    const found = await suite.db.transaction((tx) =>
      findPaymentsByBillPayments(tx, [first, second, none]),
    );

    expect([...found.keys()].sort()).toEqual([first, second].sort());
    expect(found.get(first)).toEqual(
      await suite.db.transaction((tx) => findPaymentByBillPayment(tx, first)),
    );
    expect(found.get(second)).toMatchObject({ paymentRef: "second", amount: "7.25" });
    expect(await suite.db.transaction((tx) => findPaymentsByBillPayments(tx, []))).toEqual(
      new Map(),
    );
  });

  it("refuses a second provider payment for the same bill payment", async () => {
    const seeded = await seedTenant();
    const billPaymentId = await billPayment(seeded);
    const attempt = (paymentRef: string) =>
      suite.db.transaction((tx) =>
        insertAttempting(tx, {
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: seeded.workingOrderId,
          provider: "fake",
          paymentRef,
          amount: decimal("10.00"),
          billPaymentId,
        }),
      );
    await attempt("first");
    const error = await captureError(() => attempt("second"));
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "payments", columns: ["bill_payment_id"] }),
    ).toBe(true);
  });

  it("names an existing bill payment", async () => {
    const seeded = await seedTenant();
    const error = await captureError(() =>
      suite.db.transaction((tx) =>
        insertAttempting(tx, {
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: seeded.workingOrderId,
          provider: "fake",
          paymentRef: "dangling",
          amount: decimal("10.00"),
          billPaymentId: "dddddddd-0000-4000-8000-0000000000ff",
        }),
      ),
    );
    expect(engineErrorMessage(error)).toBe("FOREIGN KEY constraint failed");
  });

  it("recordedRefundRefs lists the refund ids recorded against that bill payment's row, oldest first", async () => {
    const seeded = await seedTenant();
    const billPaymentId = await billPayment(seeded);
    const other = await billPayment(seeded);
    const linked = async (paymentRef: string, link: string | undefined) => {
      await suite.db.transaction((tx) =>
        insertCapturedPayment(tx, {
          origin: deviceOrigin(seeded.deviceId),
          workingOrderId: seeded.workingOrderId,
          provider: "fake",
          paymentRef,
          amount: decimal("30.00"),
          settledAt: SETTLED,
          billPaymentId: link,
        }),
      );
      return { provider: "fake", paymentRef };
    };
    const mine = await linked("mine", billPaymentId);
    const theirs = await linked("theirs", other);
    const unlinked = await linked("unlinked", undefined);
    const refund = (key: { provider: string; paymentRef: string }, ref?: string) =>
      suite.db.transaction((tx) =>
        recordRefund(tx, { ...key, amount: decimal("5.00"), providerRefundRef: ref }),
      );
    // Written in the opposite order to their dates, so only the ordering by date puts them right.
    await refund(mine, "re_later");
    await refund(mine, "re_earlier");
    await refund(mine);
    await refund(theirs, "re_theirs");
    await refund(unlinked, "re_unlinked");
    await suite.db.execute(
      sql`update payment_refunds set created_at = '2026-07-22T10:05:00.000Z' where provider_refund_ref = 're_later'`,
    );
    await suite.db.execute(
      sql`update payment_refunds set created_at = '2026-07-22T10:01:00.000Z' where provider_refund_ref = 're_earlier'`,
    );

    const refs = await suite.db.transaction((tx) => recordedRefundRefs(tx, billPaymentId));

    expect(refs).toEqual(["re_earlier", "re_later"]);
    expect(await suite.db.transaction((tx) => recordedRefundRefs(tx, other))).toEqual([
      "re_theirs",
    ]);
  });
});

describe("recordRefund: the provider's refund id", () => {
  it("is written when given, and null when not", async () => {
    const seeded = await seedTenant();
    const withRef = await capture(seeded, "ref-with", "20.00");
    await suite.db.transaction((tx) =>
      recordRefund(tx, { ...withRef, amount: decimal("5.00"), providerRefundRef: "re_123" }),
    );
    const withoutRef = await capture(seeded, "ref-without", "20.00");
    await suite.db.transaction((tx) =>
      recordRefund(tx, { ...withoutRef, amount: decimal("5.00") }),
    );
    const rows = await suite.db.execute<{
      payment_ref: string;
      provider_refund_ref: string | null;
    }>(sql`select payment_ref, provider_refund_ref from payment_refunds order by payment_ref`);
    expect(rows.rows).toEqual([
      { payment_ref: "ref-with", provider_refund_ref: "re_123" },
      { payment_ref: "ref-without", provider_refund_ref: null },
    ]);
  });
});

describe("rows written within one millisecond", () => {
  const AT = "2026-07-24T10:00:00.000Z";
  const COUNT = 6;

  /** Ids, and references, that sort against the order they are made in, so a tie broken by
   * either gives the reverse of the writing order. */
  function descending(prefix = "") {
    let made = 0;
    return () => `${prefix}${(0xffffffff - made++).toString(16)}${randomUUID().slice(8)}`;
  }

  /** `COUNT` payments in `state` on one order, all created at `AT`; returns their references in
   * the order they were written. Their settled times run backwards, against that order. */
  async function writePayments(
    seeded: Seeded,
    state: "captured" | "accepted_offline" | "attempting",
    settledAt: (written: number) => string | null,
  ): Promise<string[]> {
    const id = descending();
    const ref = descending("ref-");
    const refs: string[] = [];
    for (let written = 0; written < COUNT; written++) {
      const paymentRef = ref();
      await suite.db.insert(payments).values({
        id: id(),
        workingOrderId: seeded.workingOrderId,
        source: "device",
        deviceId: seeded.deviceId,
        provider: "fake",
        paymentRef,
        amount: 100 * (written + 1),
        state,
        settledAt: settledAt(written),
        createdAt: AT,
        updatedAt: AT,
      });
      refs.push(paymentRef);
    }
    return refs;
  }

  it("findCapturedPaymentForWorkingOrder keeps the payment written last when they settled together", async () => {
    const seeded = await seedTenant();
    const refs = await writePayments(seeded, "captured", () => AT);

    const found = await suite.db.transaction((tx) =>
      findCapturedPaymentForWorkingOrder(tx, {
        provider: "fake",
        workingOrderId: seeded.workingOrderId,
      }),
    );

    expect(found?.paymentRef).toBe(refs.at(-1));
  });

  it("findCapturedPaymentForWorkingOrderAnyProvider keeps the payment written last when they settled together", async () => {
    const seeded = await seedTenant();
    const refs = await writePayments(seeded, "captured", () => AT);

    const found = await suite.db.transaction((tx) =>
      findCapturedPaymentForWorkingOrderAnyProvider(tx, { workingOrderId: seeded.workingOrderId }),
    );

    expect(found?.paymentRef).toBe(refs.at(-1));
  });

  it("listAcceptedOffline and claimAcceptedOffline list the payments in the order they were written", async () => {
    const seeded = await seedTenant();
    const refs = await writePayments(seeded, "accepted_offline", (written) =>
      new Date(Date.parse(AT) + COUNT - written).toISOString(),
    );

    const listed = await suite.db.transaction((tx) => listAcceptedOffline(tx, "fake"));
    const claimed = await suite.db.transaction((tx) => claimAcceptedOffline(tx, "fake"));

    expect(listed.map((row) => row.paymentRef)).toEqual(refs);
    expect(claimed.map((row) => row.paymentRef)).toEqual(refs);
  });

  it("listAttempting lists the payments in the order they were written", async () => {
    const seeded = await seedTenant();
    const refs = await writePayments(seeded, "attempting", () => null);

    const listed = await suite.db.transaction((tx) => listAttempting(tx, "fake"));

    expect(listed.map((row) => row.paymentRef)).toEqual(refs);
  });

  it("recordedRefundRefs lists the refunds in the order they were written", async () => {
    const seeded = await seedTenant();
    const [bill] = await suite.db
      .insert(billPayments)
      .values({
        workingOrderId: seeded.workingOrderId,
        source: "device",
        deviceId: seeded.deviceId,
        submissionId: randomUUID(),
        fingerprint: "fingerprint",
        kind: "contribution",
        method: "card",
        applied: 10_000,
        state: "pending",
        requestedBy: "11111111-1111-1111-1111-111111111111",
      })
      .returning({ id: billPayments.id });
    const [payment] = await suite.db
      .insert(payments)
      .values({
        workingOrderId: seeded.workingOrderId,
        source: "device",
        deviceId: seeded.deviceId,
        provider: "fake",
        paymentRef: "refunded",
        amount: 10_000,
        state: "partially_refunded",
        settledAt: AT,
        billPaymentId: bill!.id,
      })
      .returning({ id: payments.id });
    const id = descending();
    const ref = descending("re_");
    const refs: string[] = [];
    for (let written = 0; written < COUNT; written++) {
      const providerRefundRef = ref();
      await suite.db.insert(paymentRefunds).values({
        id: id(),
        paymentId: payment!.id,
        provider: "fake",
        paymentRef: "refunded",
        amount: 100,
        state: "succeeded",
        providerRefundRef,
        createdAt: AT,
      });
      refs.push(providerRefundRef);
    }

    expect(await suite.db.transaction((tx) => recordedRefundRefs(tx, bill!.id))).toEqual(refs);
  });
});
