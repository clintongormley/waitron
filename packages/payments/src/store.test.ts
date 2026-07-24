import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { AppError, decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  assertReversible,
  associatePaymentWithSale,
  captureAttempting,
  failAttempting,
  findPaymentByRef,
  getPaymentByRef,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  recordFailedRefund,
  recordRefund,
  recordVoid,
} from "./store.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";
import type { Seeded } from "../test/seed.js";

let db: Database;

beforeAll(async () => {
  db = await createPgliteDb();
  await runMigrations(db, CORE_MIGRATIONS);
  await runMigrations(db, PAYMENTS_MIGRATIONS);
}, 60_000);

afterAll(async () => {
  await db.close();
});

beforeEach(async () => {
  await db.execute(sql`truncate payment_refunds, payments cascade`);
});

const SETTLED = new Date("2026-07-22T10:00:00Z");

// `beforeEach` truncates payments/payment_refunds only — tenants (and the location/till/
// working_order chain under them) accumulate for the life of the suite, same as
// packages/core/src/record-sale.test.ts's shared PGlite instance. Each test therefore needs its
// own NIF, or the second call to seedWorkingOrder's default "B00000000" collides with the first
// on tenants_nif_key. `freshNif` is shared from ../test/seed.js.

async function seedTenant() {
  return seedWorkingOrder(db, freshNif());
}

/** Inserts a captured payment for `seeded` at `paymentRef` (default "10.00") and returns the key
 * to reuse against every other store call. */
async function capture(seeded: Seeded, paymentRef: string, amount = "10.00") {
  const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef };
  await db.transaction((tx) =>
    insertCapturedPayment(tx, {
      tenantId: seeded.tenantId,
      workingOrderId: seeded.workingOrderId,
      provider: "fake",
      paymentRef,
      amount: decimal(amount),
      settledAt: SETTLED,
    }),
  );
  return key;
}

async function getRow(key: { tenantId: string; provider: string; paymentRef: string }) {
  return db.transaction((tx) => getPaymentByRef(tx, key));
}

/** Seeds a second sale for the SAME tenant as `seeded`, on a second till of that tenant.
 * `associatePaymentWithSale`'s write-once test needs two real sales under one tenant (the
 * composite `payments_sale_fk` requires a payment's `sale_id` to belong to the payment's own
 * tenant), and `seedSale` always plants its `invoice_series` at code "A" for the till it's given —
 * calling it twice against the same till would collide on `invoice_series_till_code_key`. A
 * second till side-steps that without touching `../test/seed.ts`. */
async function seedSecondSale(seeded: Seeded): Promise<string> {
  const [till] = (
    await db.execute<{ location_id: string }>(
      sql`select location_id from tills where id = ${seeded.tillId}`,
    )
  ).rows;
  const till2 = await db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${seeded.tenantId}, ${till.location_id}, 'Till 2') returning id`);
  return seedSale(db, { ...seeded, tillId: till2.rows[0].id });
}

describe("insertCapturedPayment", () => {
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
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "p2" };
    await db.transaction((tx) =>
      insertFailedPayment(tx, {
        tenantId: seeded.tenantId,
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
    const result = await db.transaction((tx) => recordVoid(tx, key));
    expect(result.state).toBe("voided");
    const row = await getRow(key);
    expect(row?.state).toBe("voided");
  });

  it("throws payment.not_voidable for a payment not in the captured state", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p4");
    // Fully refund first so the payment is no longer `captured`.
    await db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.00") }));
    const error = await db.transaction((tx) => recordVoid(tx, key)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await db.transaction((tx) => recordVoid(tx, key)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("recordRefund", () => {
  it("refunds the full amount, setting state=refunded and inserting a payment_refunds row", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p5", "20.00");
    const result = await db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    expect(result.state).toBe("refunded");
    const row = await getRow(key);
    expect(row?.state).toBe("refunded");
    const refunds = await db.execute<{ amount: string }>(
      sql`select amount from payment_refunds where payment_ref = ${"p5"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(refunds.rows).toHaveLength(1);
    expect(refunds.rows[0].amount).toBe("20.00");
  });

  it("a partial refund sets partially_refunded, then a second refund reaching the total sets refunded", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p6", "20.00");
    const first = await db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("12.00") }),
    );
    expect(first.state).toBe("partially_refunded");
    expect((await getRow(key))?.state).toBe("partially_refunded");

    const second = await db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("8.00") }),
    );
    expect(second.state).toBe("refunded");
    expect((await getRow(key))?.state).toBe("refunded");
  });

  it("throws payment.refund_exceeds_capture when the running total would exceed the capture", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p7", "10.00");
    const error = await db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.01") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.refund_exceeds_capture when a second refund would push the running total over", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p8", "10.00");
    await db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("6.00") }));
    const error = await db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("5.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.not_refundable for a voided payment", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p9");
    await db.transaction((tx) => recordVoid(tx, key));
    const error = await db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("throws payment.not_refundable for a failed payment", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "p10" };
    await db.transaction((tx) =>
      insertFailedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "p10",
        amount: decimal("10.00"),
      }),
    );
    const error = await db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await db
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
      db.transaction((tx) => assertReversible(tx, { ...key, kind: "void" })),
    ).resolves.toBeUndefined();
    await expect(
      db.transaction((tx) => assertReversible(tx, { ...key, kind: "refund" })),
    ).resolves.toBeUndefined();
  });

  it("void throws payment.not_voidable when the payment is not captured (e.g. already fully refunded)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r2");
    await db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.00") }));
    const error = await db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "void" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
  });

  it("refund throws payment.not_refundable for a voided payment", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r3");
    await db.transaction((tx) => recordVoid(tx, key));
    const error = await db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "refund" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("refund throws payment.refund_exceeds_capture when the running succeeded total + requested would exceed the capture", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r4", "20.00");
    await db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("12.00") }));
    // A full-amount pre-check against the original capture, with 12.00 already succeeded-refunded.
    const error = await db
      .transaction((tx) =>
        assertReversible(tx, { ...key, kind: "refund", amount: decimal("20.00") }),
      )
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await db
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
    const saleId = await seedSale(db, seeded);
    await db.transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId }));
    const row = await getRow(key);
    expect(row?.saleId).toBe(saleId);
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const saleId = await seedSale(db, seeded);
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await db
      .transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });

  it("throws payment.already_associated when the payment is already linked to a sale, and does not re-point it", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p13");
    const firstSaleId = await seedSale(db, seeded);
    const secondSaleId = await seedSecondSale(seeded);
    await db.transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId: firstSaleId }));

    const error = await db
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
    const seeded = await seedTenant();
    const row = await getRow({
      tenantId: seeded.tenantId,
      provider: "fake",
      paymentRef: "unknown",
    });
    expect(row).toBeUndefined();
  });
});

describe("findPaymentByRef", () => {
  it("returns the row, with tenantId, for a known ref without a tenant filter", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "p12");
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", "p12"));
    expect(row?.tenantId).toBe(seeded.tenantId);
    expect(row?.state).toBe("captured");
    expect(row?.amount).toBe("10.00");
  });

  it("returns undefined for an unknown ref", async () => {
    await seedTenant();
    const row = await db.transaction((tx) => findPaymentByRef(tx, "fake", "unknown"));
    expect(row).toBeUndefined();
  });
});

describe("insertCapturedPayment external_ref", () => {
  it("persists external_ref when provided", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "ext1",
        amount: decimal("10.00"),
        settledAt: SETTLED,
        externalRef: "OP-42",
      }),
    );
    const rows = await db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext1"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBe("OP-42");
  });

  it("leaves external_ref null when omitted", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ext2");
    const rows = await db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});

describe("attempting lifecycle", () => {
  it("insertAttempting writes state=attempting, settledAt null", async () => {
    const seeded = await seedTenant();
    await db.transaction((tx) =>
      insertAttempting(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "a1",
        amount: decimal("12.10"),
      }),
    );
    const row = await getRow({ tenantId: seeded.tenantId, provider: "fake", paymentRef: "a1" });
    expect(row?.state).toBe("attempting");
    expect(row?.settledAt).toBeNull();
  });

  it("captureAttempting advances attempting -> captured with settledAt + external_ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "a2" };
    await db.transaction((tx) =>
      insertAttempting(tx, {
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
      }),
    );
    const settledAt = new Date("2026-07-23T10:00:00Z");
    const result = await db.transaction((tx) =>
      captureAttempting(tx, { ...key, settledAt, externalRef: "pi_123" }),
    );
    expect(result.state).toBe("captured");
    const rows = await db.execute<{
      state: string;
      external_ref: string | null;
      settled_at: string | null;
    }>(
      sql`select state, external_ref, settled_at from payments where payment_ref = ${"a2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0]).toMatchObject({ state: "captured", external_ref: "pi_123" });
    expect(rows.rows[0].settled_at).not.toBeNull();
  });

  it("failAttempting advances attempting -> failed", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "a3" };
    await db.transaction((tx) =>
      insertAttempting(tx, {
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
      }),
    );
    const result = await db.transaction((tx) => failAttempting(tx, key));
    expect(result.state).toBe("failed");
    expect((await getRow(key))?.state).toBe("failed");
  });

  it("captureAttempting throws payment.not_found when there is no attempting row", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "nope" };
    const err = await db
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
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "e1" };
    await db.transaction((tx) =>
      insertCapturedPayment(tx, {
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
    await db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }));
    expect((await getRow(key))?.state).toBe("captured");
    const refunds = await db.execute<{ state: string }>(
      sql`select state from payment_refunds where payment_ref = ${"e2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(refunds.rows).toEqual([{ state: "failed" }]);
  });

  it("recordRefund ignores a prior FAILED refund when summing (a failed refund does not consume the balance)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "e3", "20.00");
    await db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("20.00") }));
    // A full succeeded refund must still be allowed — the failed one didn't consume anything.
    const result = await db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    expect(result.state).toBe("refunded");
  });

  it("recordFailedRefund throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "no-such-ref" };
    const error = await db
      .transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});
