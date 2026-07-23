import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, createPgliteDb, runMigrations } from "@waitron/db";
import type { Database } from "@waitron/db";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

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

const SETTLED = new Date("2026-07-23T09:00:00Z");

describe("recordManualCardPayment", () => {
  it("writes a captured row under the manual provider, with external_ref and a minted manual- ref", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await db.transaction((tx) =>
      recordManualCardPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
        settledAt: SETTLED,
        externalRef: "OP-000123",
      }),
    );
    expect(result.provider).toBe("manual");
    expect(result.paymentRef.startsWith("manual-")).toBe(true);
    expect(result.settledAt).toBe(SETTLED);

    const rows = await db.execute<{
      provider: string;
      state: string;
      amount: string;
      external_ref: string | null;
      settled_at: string | null;
    }>(sql`
      select provider, state, amount, external_ref, settled_at
      from payments where payment_ref = ${result.paymentRef} and tenant_id = ${seeded.tenantId}
    `);
    expect(rows.rows[0]).toMatchObject({
      provider: "manual",
      state: "captured",
      amount: "12.10",
      external_ref: "OP-000123",
    });
    expect(rows.rows[0].settled_at).not.toBeNull();
    expect(new Date(rows.rows[0].settled_at as string).getTime()).toBe(SETTLED.getTime());
  });

  it("leaves external_ref null when the operation number is not supplied", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const result = await db.transaction((tx) =>
      recordManualCardPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("5.00"),
        settledAt: SETTLED,
      }),
    );
    const rows = await db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${result.paymentRef} and tenant_id = ${seeded.tenantId}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});

describe("recordManualRefund", () => {
  it("records a refund under the manual provider and advances the payment to refunded", async () => {
    const seeded = await seedWorkingOrder(db, freshNif());
    const paid = await db.transaction((tx) =>
      recordManualCardPayment(tx, {
        tenantId: seeded.tenantId,
        workingOrderId: seeded.workingOrderId,
        amount: decimal("20.00"),
        settledAt: SETTLED,
      }),
    );
    const refunded = await db.transaction((tx) =>
      recordManualRefund(tx, {
        tenantId: seeded.tenantId,
        paymentRef: paid.paymentRef,
        amount: decimal("20.00"),
      }),
    );
    expect(refunded.state).toBe("refunded");

    const rows = await db.execute<{ provider: string; amount: string }>(sql`
      select provider, amount from payment_refunds
      where payment_ref = ${paid.paymentRef} and tenant_id = ${seeded.tenantId}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ provider: "manual", amount: "20.00" });
  });

  it("exposes the sentinel provider id as MANUAL_PROVIDER", () => {
    expect(MANUAL_PROVIDER).toBe("manual");
  });
});
