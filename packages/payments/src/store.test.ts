import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, pgErrorMessage } from "@waitron/db";
import { usePgliteDb } from "@waitron/db/testing/lifecycle.js";
import { AppError, decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  assertReversible,
  associatePaymentWithSale,
  captureAttempting,
  existingReferences,
  expireInitiated,
  failAttempting,
  findCapturedPaymentForWorkingOrder,
  findPaymentByRef,
  getPaymentByRef,
  insertAcceptedOffline,
  insertAttempting,
  insertCapturedPayment,
  insertFailedPayment,
  insertInitiated,
  listAcceptedOffline,
  listReconcilable,
  markReconcileRemediated,
  recordFailedRefund,
  recordRefund,
  recordVoid,
  settleForwarded,
  settleInitiated,
  tillsForWorkingOrders,
} from "./store.js";
import { freshNif, seedSale, seedWorkingOrder } from "../test/seed.js";
import type { Seeded } from "../test/seed.js";

const pg = usePgliteDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  await pg.db.execute(sql`truncate payment_refunds, payments cascade`);
});

const SETTLED = new Date("2026-07-22T10:00:00Z");

// `beforeEach` truncates payments/payment_refunds only — tenants (and the location/till/
// working_order chain under them) accumulate for the life of the suite, same as
// packages/core/src/record-sale.test.ts's shared PGlite instance. Each test therefore needs its
// own NIF, or the second call to seedWorkingOrder's default "B00000000" collides with the first
// on tenants_country_tax_id_key. `freshNif` is shared from ../test/seed.js.

async function seedTenant() {
  return seedWorkingOrder(pg.db, freshNif());
}

/** Inserts a captured payment for `seeded` at `paymentRef` (default "10.00") and returns the key
 * to reuse against every other store call. */
async function capture(seeded: Seeded, paymentRef: string, amount = "10.00") {
  const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef };
  await pg.db.transaction((tx) =>
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
  return pg.db.transaction((tx) => getPaymentByRef(tx, key));
}

/** Seeds a second sale for the SAME tenant as `seeded`, on a second till + node of that tenant.
 * `associatePaymentWithSale`'s write-once test needs two real sales under one tenant (the
 * composite `payments_sale_fk` requires a payment's `sale_id` to belong to the payment's own
 * tenant), and `seedSale` always plants its `invoice_series` at code "A" for the node it's given —
 * since the node-id rekey the series is keyed `(tenant_id, node_id, code)`, so calling it twice
 * against the same node would collide on `invoice_series_node_code_key`. A second node
 * side-steps that without touching `../test/seed.ts`. */
async function seedSecondSale(seeded: Seeded): Promise<string> {
  const [till] = (
    await pg.db.execute<{ location_id: string }>(
      sql`select location_id from tills where id = ${seeded.tillId}`,
    )
  ).rows;
  const till2 = await pg.db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${seeded.tenantId}, ${till.location_id}, 'Till 2') returning id`);
  const node2 = await pg.db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name)
    values (${seeded.tenantId}, ${till.location_id}, 'Node 2') returning id`);
  return seedSale(pg.db, { ...seeded, tillId: till2.rows[0].id, nodeId: node2.rows[0].id });
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
    await pg.db.transaction((tx) =>
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
    const result = await pg.db.transaction((tx) => recordVoid(tx, key));
    expect(result.state).toBe("voided");
    const row = await getRow(key);
    expect(row?.state).toBe("voided");
  });

  it("throws payment.not_voidable for a payment not in the captured state", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p4");
    // Fully refund first so the payment is no longer `captured`.
    await pg.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.00") }));
    const error = await pg.db.transaction((tx) => recordVoid(tx, key)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await pg.db.transaction((tx) => recordVoid(tx, key)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("recordRefund", () => {
  it("refunds the full amount, setting state=refunded and inserting a payment_refunds row", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p5", "20.00");
    const result = await pg.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    expect(result.state).toBe("refunded");
    const row = await getRow(key);
    expect(row?.state).toBe("refunded");
    const refunds = await pg.db.execute<{ amount: string }>(
      sql`select amount from payment_refunds where payment_ref = ${"p5"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(refunds.rows).toHaveLength(1);
    expect(refunds.rows[0].amount).toBe("20.00");
  });

  it("writes authorized_by when supplied, and NULL when omitted", async () => {
    const seeded = await seedTenant();
    const authorizer = "11111111-1111-1111-1111-111111111111";
    // With an authorizer (the human gate at the till, #7): the value is persisted verbatim.
    const withKey = await capture(seeded, "auth-with", "20.00");
    await pg.db.transaction((tx) =>
      recordRefund(tx, { ...withKey, amount: decimal("20.00"), authorizedBy: authorizer }),
    );
    // Without one (an automated reconcile/manual refund): the column stays NULL.
    const withoutKey = await capture(seeded, "auth-without", "20.00");
    await pg.db.transaction((tx) => recordRefund(tx, { ...withoutKey, amount: decimal("20.00") }));
    const rows = await pg.db.execute<{ payment_ref: string; authorized_by: string | null }>(
      sql`select payment_ref, authorized_by from payment_refunds
          where tenant_id = ${seeded.tenantId} order by payment_ref`,
    );
    expect(rows.rows).toEqual([
      { payment_ref: "auth-with", authorized_by: authorizer },
      { payment_ref: "auth-without", authorized_by: null },
    ]);
  });

  it("a partial refund sets partially_refunded, then a second refund reaching the total sets refunded", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p6", "20.00");
    const first = await pg.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("12.00") }),
    );
    expect(first.state).toBe("partially_refunded");
    expect((await getRow(key))?.state).toBe("partially_refunded");

    const second = await pg.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("8.00") }),
    );
    expect(second.state).toBe("refunded");
    expect((await getRow(key))?.state).toBe("refunded");
  });

  it("throws payment.refund_exceeds_capture when the running total would exceed the capture", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p7", "10.00");
    const error = await pg.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.01") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.refund_exceeds_capture when a second refund would push the running total over", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p8", "10.00");
    await pg.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("6.00") }));
    const error = await pg.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("5.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.refund_exceeds_capture");
  });

  it("throws payment.not_refundable for a voided payment", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p9");
    await pg.db.transaction((tx) => recordVoid(tx, key));
    const error = await pg.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("throws payment.not_refundable for a failed payment", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "p10" };
    await pg.db.transaction((tx) =>
      insertFailedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "p10",
        amount: decimal("10.00"),
      }),
    );
    const error = await pg.db
      .transaction((tx) => recordRefund(tx, { ...key, amount: decimal("1.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await pg.db
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
      pg.db.transaction((tx) => assertReversible(tx, { ...key, kind: "void" })),
    ).resolves.toBeUndefined();
    await expect(
      pg.db.transaction((tx) => assertReversible(tx, { ...key, kind: "refund" })),
    ).resolves.toBeUndefined();
  });

  it("void throws payment.not_voidable when the payment is not captured (e.g. already fully refunded)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r2");
    await pg.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("10.00") }));
    const error = await pg.db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "void" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_voidable");
  });

  it("refund throws payment.not_refundable for a voided payment", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r3");
    await pg.db.transaction((tx) => recordVoid(tx, key));
    const error = await pg.db
      .transaction((tx) => assertReversible(tx, { ...key, kind: "refund" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_refundable");
  });

  it("refund throws payment.refund_exceeds_capture when the running succeeded total + requested would exceed the capture", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "r4", "20.00");
    await pg.db.transaction((tx) => recordRefund(tx, { ...key, amount: decimal("12.00") }));
    // A full-amount pre-check against the original capture, with 12.00 already succeeded-refunded.
    const error = await pg.db
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
    const error = await pg.db
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
    const saleId = await seedSale(pg.db, seeded);
    await pg.db.transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId }));
    const row = await getRow(key);
    expect(row?.saleId).toBe(saleId);
  });

  it("throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const saleId = await seedSale(pg.db, seeded);
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "unknown" };
    const error = await pg.db
      .transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });

  it("throws payment.already_associated when the payment is already linked to a sale, and does not re-point it", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "p13");
    const firstSaleId = await seedSale(pg.db, seeded);
    const secondSaleId = await seedSecondSale(seeded);
    await pg.db.transaction((tx) => associatePaymentWithSale(tx, { ...key, saleId: firstSaleId }));

    const error = await pg.db
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
    const row = await pg.db.transaction((tx) => findPaymentByRef(tx, "fake", "p12"));
    expect(row?.tenantId).toBe(seeded.tenantId);
    expect(row?.state).toBe("captured");
    expect(row?.amount).toBe("10.00");
  });

  it("returns undefined for an unknown ref", async () => {
    await seedTenant();
    const row = await pg.db.transaction((tx) => findPaymentByRef(tx, "fake", "unknown"));
    expect(row).toBeUndefined();
  });
});

describe("findCapturedPaymentForWorkingOrder", () => {
  // PGlite: this asserts the STATE filter and column projection only — no RLS, no concurrency — so
  // the hermetic superuser target is the right one (CLAUDE.md §4). Tenant isolation is proven on
  // real Postgres in payments.rls.test.ts.
  it("returns a captured payment for the working order, ignoring non-captured states", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const key = { tenantId: s.tenantId, provider: "stripe", workingOrderId: s.workingOrderId };
    // A failed attempt must NOT match (a legitimately-declined card is re-chargeable).
    await pg.db.transaction((tx) =>
      insertFailedPayment(tx, { ...key, paymentRef: "f1", amount: decimal("5.00") }),
    );
    expect(
      await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key)),
    ).toBeUndefined();
    // A captured payment matches, carrying its ref/amount/saleId(null)/externalRef.
    await pg.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "c1",
        amount: decimal("12.10"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
        externalRef: "pi_x",
      }),
    );
    const found = await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found).toMatchObject({
      paymentRef: "c1",
      amount: "12.10",
      saleId: null,
      externalRef: "pi_x",
      state: "captured",
    });
  });

  it("matches an accepted_offline payment too (it chained its sale)", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const key = { tenantId: s.tenantId, provider: "stripe", workingOrderId: s.workingOrderId };
    await pg.db.transaction((tx) =>
      insertAcceptedOffline(tx, {
        ...key,
        paymentRef: "o1",
        amount: decimal("8.00"),
        settledAt: new Date("2026-07-24T12:00:00Z"),
      }),
    );
    const found = await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found).toMatchObject({ paymentRef: "o1", state: "accepted_offline", saleId: null });
  });

  it("returns undefined when the only payment is attempting (the lost-T2 window is not yet captured)", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    const key = { tenantId: s.tenantId, provider: "stripe", workingOrderId: s.workingOrderId };
    await pg.db.transaction((tx) =>
      insertAttempting(tx, { ...key, paymentRef: "a1", amount: decimal("9.00") }),
    );
    expect(
      await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key)),
    ).toBeUndefined();
  });

  it("returns the MOST RECENT captured row if the one-capture-per-order invariant is ever violated", async () => {
    // The design (spec §4) guarantees at most one captured/accepted_offline payment per working
    // order by construction (Task 1's wo_<id> Stripe idempotency key + this very pre-check), not by
    // a DB constraint — nothing stops two rows existing here. `ORDER BY settled_at DESC` is what
    // makes the read deterministic in that case, so this seeds two captured rows out of insertion
    // order (the later-settled one inserted FIRST) and asserts the more recently settled one wins.
    const s = await seedWorkingOrder(pg.db, freshNif());
    const key = { tenantId: s.tenantId, provider: "stripe", workingOrderId: s.workingOrderId };
    await pg.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "older",
        amount: decimal("5.00"),
        settledAt: new Date("2026-07-24T09:00:00Z"),
      }),
    );
    await pg.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        ...key,
        paymentRef: "newer",
        amount: decimal("7.00"),
        settledAt: new Date("2026-07-24T11:00:00Z"),
      }),
    );
    const found = await pg.db.transaction((tx) => findCapturedPaymentForWorkingOrder(tx, key));
    expect(found?.paymentRef).toBe("newer");
  });
});

describe("insertCapturedPayment external_ref", () => {
  it("persists external_ref when provided", async () => {
    const seeded = await seedTenant();
    await pg.db.transaction((tx) =>
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
    const rows = await pg.db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext1"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBe("OP-42");
  });

  it("leaves external_ref null when omitted", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ext2");
    const rows = await pg.db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${"ext2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});

describe("attempting lifecycle", () => {
  it("insertAttempting writes state=attempting, settledAt null", async () => {
    const seeded = await seedTenant();
    await pg.db.transaction((tx) =>
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
    await pg.db.transaction((tx) =>
      insertAttempting(tx, {
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
      }),
    );
    const settledAt = new Date("2026-07-23T10:00:00Z");
    const result = await pg.db.transaction((tx) =>
      captureAttempting(tx, { ...key, settledAt, externalRef: "pi_123" }),
    );
    expect(result.state).toBe("captured");
    const rows = await pg.db.execute<{
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
    await pg.db.transaction((tx) =>
      insertAttempting(tx, {
        ...key,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
      }),
    );
    const result = await pg.db.transaction((tx) => failAttempting(tx, key));
    expect(result.state).toBe("failed");
    expect((await getRow(key))?.state).toBe("failed");
  });

  it("captureAttempting throws payment.not_found when there is no attempting row", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "nope" };
    const err = await pg.db
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
    await pg.db.transaction((tx) =>
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
    await pg.db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }));
    expect((await getRow(key))?.state).toBe("captured");
    const refunds = await pg.db.execute<{ state: string }>(
      sql`select state from payment_refunds where payment_ref = ${"e2"} and tenant_id = ${seeded.tenantId}`,
    );
    expect(refunds.rows).toEqual([{ state: "failed" }]);
  });

  it("recordFailedRefund writes authorized_by when supplied, and NULL when omitted", async () => {
    const seeded = await seedTenant();
    const authorizer = "22222222-2222-2222-2222-222222222222";
    const withKey = await capture(seeded, "fauth-with", "20.00");
    await pg.db.transaction((tx) =>
      recordFailedRefund(tx, { ...withKey, amount: decimal("5.00"), authorizedBy: authorizer }),
    );
    const withoutKey = await capture(seeded, "fauth-without", "20.00");
    await pg.db.transaction((tx) =>
      recordFailedRefund(tx, { ...withoutKey, amount: decimal("5.00") }),
    );
    const rows = await pg.db.execute<{ payment_ref: string; authorized_by: string | null }>(
      sql`select payment_ref, authorized_by from payment_refunds
          where tenant_id = ${seeded.tenantId} and state = 'failed' order by payment_ref`,
    );
    expect(rows.rows).toEqual([
      { payment_ref: "fauth-with", authorized_by: authorizer },
      { payment_ref: "fauth-without", authorized_by: null },
    ]);
  });

  it("recordRefund ignores a prior FAILED refund when summing (a failed refund does not consume the balance)", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "e3", "20.00");
    await pg.db.transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("20.00") }));
    // A full succeeded refund must still be allowed — the failed one didn't consume anything.
    const result = await pg.db.transaction((tx) =>
      recordRefund(tx, { ...key, amount: decimal("20.00") }),
    );
    expect(result.state).toBe("refunded");
  });

  it("recordFailedRefund throws payment.not_found for an unknown ref", async () => {
    const seeded = await seedTenant();
    const key = { tenantId: seeded.tenantId, provider: "fake", paymentRef: "no-such-ref" };
    const error = await pg.db
      .transaction((tx) => recordFailedRefund(tx, { ...key, amount: decimal("5.00") }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
  });
});

describe("listAcceptedOffline", () => {
  it("listAcceptedOffline returns this provider's accepted_offline rows without locking them", async () => {
    const s = await seedWorkingOrder(pg.db, freshNif());
    await pg.db.transaction((tx) =>
      insertAcceptedOffline(tx, {
        tenantId: s.tenantId,
        workingOrderId: s.workingOrderId,
        provider: "fake",
        paymentRef: "lst-1",
        amount: decimal("10.00"),
        settledAt: new Date("2026-07-24T10:00:00Z"),
      }),
    );
    const listed = await pg.db.transaction((tx) => listAcceptedOffline(tx, s.tenantId, "fake"));
    expect(listed.map((r) => r.paymentRef)).toContain("lst-1");
    expect(listed.find((r) => r.paymentRef === "lst-1")?.saleId).toBeNull();
  });
});

describe("Mode 3 initiated lifecycle", () => {
  const HOSTED = "hosted-abc";
  const SETTLED_AT = new Date("2026-07-24T12:00:00Z");

  async function initiate(seeded: Seeded, externalRef = HOSTED, paymentRef = "pay-1") {
    await pg.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef,
        externalRef,
        amount: decimal("12.10"),
      }),
    );
    return { tenantId: seeded.tenantId, provider: "fake", paymentRef };
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
    const settled = await pg.db.transaction((tx) =>
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
    await pg.db.transaction((tx) =>
      settleInitiated(tx, { provider: "fake", externalRef: HOSTED, settledAt: SETTLED_AT }),
    );
    const firstSettledAt = (await getRow(key))?.settledAt;
    const second = await pg.db.transaction((tx) =>
      settleInitiated(tx, {
        provider: "fake",
        externalRef: HOSTED,
        settledAt: new Date("2026-07-24T13:00:00Z"),
      }),
    );
    expect(second).toBeNull();
    // Proves idempotency directly (not just by state-guard reasoning): a redelivered settle with a
    // LATER timestamp must not move settled_at off the first settlement's value.
    const row = await getRow(key);
    expect(row?.state).toBe("captured");
    expect(row?.settledAt).toBe(firstSettledAt);
  });

  it("expireInitiated advances initiated -> failed and is idempotent", async () => {
    const seeded = await seedTenant();
    const key = await initiate(seeded);
    await pg.db.transaction((tx) => expireInitiated(tx, { provider: "fake", externalRef: HOSTED }));
    expect((await getRow(key))?.state).toBe("failed");
    // Second call is a no-op (state is no longer `initiated`) — does not throw, leaves `failed`.
    await pg.db.transaction((tx) => expireInitiated(tx, { provider: "fake", externalRef: HOSTED }));
    // Proves idempotency directly: re-fetch after the second call and confirm state did not move
    // off `failed` (and settledAt, never set by expireInitiated, stays null).
    const row = await getRow(key);
    expect(row?.state).toBe("failed");
    expect(row?.settledAt).toBeNull();
  });

  it("the partial unique index rejects a second initiated row with the same (provider, external_ref)", async () => {
    const seeded = await seedTenant();
    await initiate(seeded, HOSTED, "pay-1");
    // `db.transaction`/`tx.insert` wrap the real Postgres error in a `DrizzleQueryError` whose own
    // `.message` is the generic "Failed query: ..." — the actual constraint-violation text lives on
    // `.cause` (see `@waitron/db`'s `pgErrorMessage`, used the same way throughout
    // packages/db/src/schema/*.test.ts for a unique/check-constraint assertion).
    const error = await captureError(() => initiate(seeded, HOSTED, "pay-2"));
    expect(pgErrorMessage(error)).toMatch(/payments_provider_external_ref_key|duplicate key/);
  });

  it("the partial unique index does NOT constrain manual/null external_ref rows", async () => {
    const seeded = await seedTenant();
    // Two manual rows sharing a hand-keyed external_ref: allowed (provider = 'manual' is excluded).
    await pg.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "manual",
        paymentRef: "m-1",
        amount: decimal("5.00"),
        externalRef: "OP-777",
        settledAt: SETTLED,
      }),
    );
    await expect(
      pg.db.transaction((tx) =>
        insertCapturedPayment(tx, {
          tenantId: seeded.tenantId,
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
  await pg.db.execute(sql`
    update working_orders
    set status = ${status}, settled_at = ${status === "settled" ? sql`now()` : null}
    where id = ${seeded.workingOrderId}`);
}

describe("listReconcilable", () => {
  it("returns captured rows settled inside the period, joined to their working order", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "in-period");
    const rows = await pg.db.transaction((tx) =>
      listReconcilable(tx, seeded.tenantId, "fake", PERIOD),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      paymentRef: "in-period",
      state: "captured",
      amount: "10.00",
      saleId: null,
      workingOrderId: seeded.workingOrderId,
      workingOrderStatus: "open",
      tillId: seeded.tillId,
      reconcileRemediatedAt: null,
    });
    // auditedAt is the non-null tolerance anchor: settled_at for a captured row.
    expect(rows[0].auditedAt).toBe(rows[0].settledAt);
  });

  it("scopes to the given tenant by an EXPLICIT predicate, not just RLS", async () => {
    // PGlite's connection is always a superuser (RLS never applies under it — see this suite's
    // header note), so this is the one place able to prove the explicit `tenant_id` predicate is
    // doing real work rather than RLS quietly covering for it. Without the fix, this query carries
    // no tenant scoping at all under a bypassing connection, and BOTH tenants' rows come back.
    const a = await seedTenant();
    const b = await seedTenant();
    await capture(a, "tenant-a-pay");
    await capture(b, "tenant-b-pay");
    const rows = await pg.db.transaction((tx) => listReconcilable(tx, a.tenantId, "fake", PERIOD));
    expect(rows.map((r) => r.paymentRef)).toEqual(["tenant-a-pay"]);
  });

  it("returns settled rows too — the forwarded-offline state the orphan rule also reaches", async () => {
    // Load-bearing, not completeness for its own sake: `settled` is the state a mode-2b tender
    // reaches once `forward()` clears it, it is auditable exactly like `captured`, and it can be an
    // orphan — but it has NO reversal path, which is why the sweep's claim gate has to test the
    // state and not just the working order. That gate is only meaningful because this query admits
    // the state in the first place.
    const seeded = await seedTenant();
    await pg.db.transaction(async (tx) => {
      await insertAcceptedOffline(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "forwarded",
        amount: decimal("12.00"),
        settledAt: SETTLED,
      });
      await settleForwarded(tx, {
        tenantId: seeded.tenantId,
        provider: "fake",
        paymentRef: "forwarded",
      });
    });
    const rows = await pg.db.transaction((tx) =>
      listReconcilable(tx, seeded.tenantId, "fake", PERIOD),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentRef: "forwarded", state: "settled", amount: "12.00" });
    // Anchored on settled_at, like a captured row — the acceptance time the offline insert stamped.
    expect(rows[0].auditedAt).toBe(rows[0].settledAt);
  });

  it("merges its two state arms back into one created_at ordering", async () => {
    // The query is split in two (the captured/settled arm and the initiated arm) so each is
    // independently index-usable. The `initiated` row here is created FIRST but comes back from the
    // SECOND query, so a plain concatenation would report it last; only the merge restores the
    // created_at order the single-query form gave.
    const seeded = await seedTenant();
    await pg.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "first-pending",
        amount: decimal("7.00"),
        externalRef: "ext-order",
      }),
    );
    await pg.db.transaction((tx) =>
      insertCapturedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "second-held",
        amount: decimal("8.00"),
        settledAt: new Date(),
      }),
    );
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const rows = await pg.db.transaction((tx) =>
      listReconcilable(tx, seeded.tenantId, "fake", now),
    );
    expect(rows.map((r) => r.paymentRef)).toEqual(["first-pending", "second-held"]);
  });

  it("excludes rows settled outside the period", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "outside");
    const later = { from: new Date("2026-07-23T00:00:00Z"), to: new Date("2026-07-24T00:00:00Z") };
    expect(
      await pg.db.transaction((tx) => listReconcilable(tx, seeded.tenantId, "fake", later)),
    ).toEqual([]);
  });

  it("excludes another provider's rows", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "ours");
    expect(
      await pg.db.transaction((tx) => listReconcilable(tx, seeded.tenantId, "other", PERIOD)),
    ).toEqual([]);
  });

  it("includes initiated rows by created_at and reports auditedAt from it", async () => {
    const seeded = await seedTenant();
    await pg.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "pending",
        amount: decimal("7.00"),
        externalRef: "ext-pending",
      }),
    );
    // created_at defaults to now(), so widen the period to today rather than the fixed fixture day.
    const now = { from: new Date(Date.now() - 60_000), to: new Date(Date.now() + 60_000) };
    const rows = await pg.db.transaction((tx) =>
      listReconcilable(tx, seeded.tenantId, "fake", now),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ paymentRef: "pending", state: "initiated", settledAt: null });
    expect(rows[0].auditedAt).not.toBeNull();
  });

  it("excludes failed and accepted_offline rows (forward's queue, not reconcile's)", async () => {
    const seeded = await seedTenant();
    await pg.db.transaction(async (tx) => {
      await insertFailedPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "nope",
        amount: decimal("3.00"),
      });
      await insertAcceptedOffline(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        provider: "fake",
        paymentRef: "queued",
        amount: decimal("4.00"),
        settledAt: SETTLED,
      });
    });
    expect(
      await pg.db.transaction((tx) => listReconcilable(tx, seeded.tenantId, "fake", PERIOD)),
    ).toEqual([]);
  });

  it("reports the working order status the orphan rule reads", async () => {
    const seeded = await seedTenant();
    await capture(seeded, "abandoned-one");
    await setOrderStatus(seeded, "abandoned");
    const rows = await pg.db.transaction((tx) =>
      listReconcilable(tx, seeded.tenantId, "fake", PERIOD),
    );
    expect(rows[0].workingOrderStatus).toBe("abandoned");
  });
});

describe("existingReferences", () => {
  /** Inserts an `initiated` row so its `externalRef` becomes visible to `existingReferences` —
   * mirrors the fixture the old `anyPaymentWithReference` tests used: state and settlement time are
   * irrelevant to the check (it is unbounded by both), only `provider` + `externalRef` are. */
  async function seedReference(seeded: Seeded, paymentRef: string, externalRef: string) {
    await pg.db.transaction((tx) =>
      insertInitiated(tx, {
        tenantId: seeded.tenantId,
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
    const found = await pg.db.transaction((tx) =>
      existingReferences(tx, seeded.tenantId, "fake", ["nope", "ext-1", "ext-2"]),
    );
    expect(found).toEqual(new Set(["ext-1", "ext-2"]));
  });

  it("matches a record whose reference is not first in the query list", async () => {
    // A batched implementation keyed on `references[0]` alone (rather than every reference in the
    // list) would miss this — the query list here deliberately puts the matching reference last.
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init3", "ext-3");
    const found = await pg.db.transaction((tx) =>
      existingReferences(tx, seeded.tenantId, "fake", ["ghost-a", "ghost-b", "ext-3"]),
    );
    expect(found).toEqual(new Set(["ext-3"]));
  });

  it("is empty for unknown references, an empty list, and another provider", async () => {
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init4", "ext-4");
    expect(
      await pg.db.transaction((tx) => existingReferences(tx, seeded.tenantId, "fake", ["ghost"])),
    ).toEqual(new Set());
    expect(
      await pg.db.transaction((tx) => existingReferences(tx, seeded.tenantId, "fake", [])),
    ).toEqual(new Set());
    expect(
      await pg.db.transaction((tx) => existingReferences(tx, seeded.tenantId, "other", ["ext-4"])),
    ).toEqual(new Set());
  });

  it("chunks the IN list — a match past the first chunk boundary is still found", async () => {
    const seeded = await seedTenant();
    await seedReference(seeded, "r-init5", "ext-5");
    // 1000 non-matching references fill the first chunk exactly (CHUNK_SIZE); "ext-5" lands in the
    // second chunk, so this only passes if every chunk is actually queried.
    const references = [...Array.from({ length: 1000 }, (_, i) => `ghost-${i}`), "ext-5"];
    const found = await pg.db.transaction((tx) =>
      existingReferences(tx, seeded.tenantId, "fake", references),
    );
    expect(found).toEqual(new Set(["ext-5"]));
  });

  it("does not leak another tenant's reference by an EXPLICIT predicate, not just RLS", async () => {
    // Same reasoning as listReconcilable's tenant-scoping test above, but the consequence here is
    // sharper: leaking tenant B's reference into tenant A's check would suppress a real
    // `missingLocal` finding — exactly the money-loss case this audit exists to catch.
    const a = await seedTenant();
    const b = await seedTenant();
    await seedReference(b, "b-init", "ext-b");
    const found = await pg.db.transaction((tx) =>
      existingReferences(tx, a.tenantId, "fake", ["ext-b"]),
    );
    expect(found).toEqual(new Set());
  });
});

describe("markReconcileRemediated", () => {
  it("stamps the marker once and refuses a second stamp", async () => {
    const seeded = await seedTenant();
    const key = await capture(seeded, "orphan-1");
    const at = new Date("2026-07-25T08:00:00Z");
    expect(await pg.db.transaction((tx) => markReconcileRemediated(tx, { ...key, at }))).toBe(true);
    expect(await pg.db.transaction((tx) => markReconcileRemediated(tx, { ...key, at }))).toBe(
      false,
    );
    const rows = await pg.db.transaction((tx) =>
      listReconcilable(tx, seeded.tenantId, "fake", PERIOD),
    );
    // The exact passed timestamp, not just non-null — a bug stamping now() instead of `at` would
    // still pass a `.not.toBeNull()` check.
    expect(new Date(rows[0].reconcileRemediatedAt!).toISOString()).toBe(at.toISOString());
  });

  it("returns false for a payment that does not exist", async () => {
    const seeded = await seedTenant();
    const at = new Date("2026-07-25T08:00:00Z");
    expect(
      await pg.db.transaction((tx) =>
        markReconcileRemediated(tx, {
          tenantId: seeded.tenantId,
          provider: "fake",
          paymentRef: "ghost",
          at,
        }),
      ),
    ).toBe(false);
  });
});

/** Seeds a second till + node + open working order under the SAME tenant/location as `seeded`.
 * Mirrors reconcile.test.ts's own `seedSecondTill` and this file's `seedSecondSale`. The fresh
 * node keeps each returned `Seeded` self-consistent (its own chain/series key), mirroring
 * `seedWorkingOrder`. */
async function seedSecondTill(seeded: Seeded): Promise<Seeded> {
  const [till] = (
    await pg.db.execute<{ location_id: string }>(
      sql`select location_id from tills where id = ${seeded.tillId}`,
    )
  ).rows;
  const till2 = await pg.db.execute<{ id: string }>(sql`
    insert into tills (tenant_id, location_id, name)
    values (${seeded.tenantId}, ${till.location_id}, 'Till 2') returning id`);
  const tillId = till2.rows[0].id;
  const node2 = await pg.db.execute<{ id: string }>(sql`
    insert into nodes (tenant_id, location_id, name)
    values (${seeded.tenantId}, ${till.location_id}, 'Node 2') returning id`);
  const wo2 = await pg.db.execute<{ id: string }>(sql`
    insert into working_orders (tenant_id, till_id, order_number) values (${seeded.tenantId}, ${tillId}, 1) returning id`);
  return {
    tenantId: seeded.tenantId,
    tillId,
    nodeId: node2.rows[0].id,
    workingOrderId: wo2.rows[0].id,
  };
}

describe("tillsForWorkingOrders", () => {
  it("resolves several working orders across two tills in one pass, skipping one that does not exist", async () => {
    const seeded = await seedTenant();
    const second = await seedSecondTill(seeded);
    const tills = await pg.db.transaction((tx) =>
      tillsForWorkingOrders(tx, seeded.tenantId, [
        seeded.workingOrderId,
        second.workingOrderId,
        "00000000-0000-0000-0000-000000000000",
      ]),
    );
    expect(tills).toEqual(
      new Map([
        [seeded.workingOrderId, seeded.tillId],
        [second.workingOrderId, second.tillId],
      ]),
    );
  });

  it("is empty for an empty input list", async () => {
    const seeded = await seedTenant();
    expect(await pg.db.transaction((tx) => tillsForWorkingOrders(tx, seeded.tenantId, []))).toEqual(
      new Map(),
    );
  });

  it("chunks the IN list — a match past the first chunk boundary is still found", async () => {
    const seeded = await seedTenant();
    // 1000 non-matching ids fill the first chunk exactly (CHUNK_SIZE); the real working order id
    // lands in the second chunk, so this only passes if every chunk is actually queried.
    const ids = [
      ...Array.from(
        { length: 1000 },
        (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
      ),
      seeded.workingOrderId,
    ];
    const tills = await pg.db.transaction((tx) => tillsForWorkingOrders(tx, seeded.tenantId, ids));
    expect(tills).toEqual(new Map([[seeded.workingOrderId, seeded.tillId]]));
  });

  it("does not leak another tenant's working order by an EXPLICIT predicate, not just RLS", async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const tills = await pg.db.transaction((tx) =>
      tillsForWorkingOrders(tx, a.tenantId, [b.workingOrderId]),
    );
    expect(tills).toEqual(new Map());
  });
});
