import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { MANUAL_PROVIDER, recordManualCardPayment, recordManualRefund } from "./manual.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

beforeEach(async () => {
  // One `delete from` per table in place of `truncate payment_refunds, payments cascade`: SQLite
  // has neither TRUNCATE nor CASCADE, and `node:sqlite` prepares one statement at a time. Child
  // before parent, because deleting `payments` while a `payment_refunds` row still points at it is
  // refused with `FOREIGN KEY constraint failed`. Receipt: `src/reconcile.test.ts`'s own hook.
  await pg.db.execute(sql`delete from payment_refunds`);
  await pg.db.execute(sql`delete from payments`);
});

const SETTLED = new Date("2026-07-23T09:00:00Z");

describe("recordManualCardPayment", () => {
  it("writes a captured row under the manual provider, with external_ref and a minted manual- ref", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    const result = await pg.db.transaction((tx) =>
      recordManualCardPayment(tx, {
        workingOrderId: seeded.workingOrderId,
        amount: decimal("12.10"),
        settledAt: SETTLED,
        externalRef: "OP-000123",
      }),
    );
    expect(result.provider).toBe("manual");
    expect(result.paymentRef.startsWith("manual-")).toBe(true);
    expect(result.settledAt).toBe(SETTLED);

    const rows = await pg.db.execute<{
      provider: string;
      state: string;
      amount: number;
      external_ref: string | null;
      settled_at: string | null;
    }>(sql`
      select provider, state, amount, external_ref, settled_at
      from payments where payment_ref = ${result.paymentRef}
    `);
    // Read straight from the column, so the amount is the stored count of cents, not "12.10".
    expect(rows.rows[0]).toMatchObject({
      provider: "manual",
      state: "captured",
      amount: 1210,
      external_ref: "OP-000123",
    });
    expect(rows.rows[0].settled_at).not.toBeNull();
    expect(new Date(rows.rows[0].settled_at as string).getTime()).toBe(SETTLED.getTime());
  });

  it("leaves external_ref null when the operation number is not supplied", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    const result = await pg.db.transaction((tx) =>
      recordManualCardPayment(tx, {
        workingOrderId: seeded.workingOrderId,
        amount: decimal("5.00"),
        settledAt: SETTLED,
      }),
    );
    const rows = await pg.db.execute<{ external_ref: string | null }>(
      sql`select external_ref from payments where payment_ref = ${result.paymentRef}`,
    );
    expect(rows.rows[0].external_ref).toBeNull();
  });
});

describe("recordManualRefund", () => {
  it("records a refund under the manual provider and advances the payment to refunded", async () => {
    const seeded = await seedWorkingOrder(pg.db, freshNif());
    const paid = await pg.db.transaction((tx) =>
      recordManualCardPayment(tx, {
        workingOrderId: seeded.workingOrderId,
        amount: decimal("20.00"),
        settledAt: SETTLED,
      }),
    );
    const refunded = await pg.db.transaction((tx) =>
      recordManualRefund(tx, {
        paymentRef: paid.paymentRef,
        amount: decimal("20.00"),
      }),
    );
    expect(refunded.state).toBe("refunded");

    const rows = await pg.db.execute<{ provider: string; amount: number }>(sql`
      select provider, amount from payment_refunds
      where payment_ref = ${paid.paymentRef}
    `);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ provider: "manual", amount: 2000 });
  });

  it("exposes the sentinel provider id as MANUAL_PROVIDER", () => {
    expect(MANUAL_PROVIDER).toBe("manual");
  });
});
