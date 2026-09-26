import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  UNIQUE_VIOLATION,
  captureError,
  checkFailed,
  isRefusal,
  refusalOn,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import {
  countProviderCancelledResolutions,
  recordAttemptResolution,
  recordResolution,
} from "./resolutions.js";
import { getPaymentByRef, insertAttempting } from "./store.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const pg = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const MANAGER = "22222222-2222-4222-8222-222222222222";
const RESOLVED_AT = new Date("2026-09-26T12:00:00Z");

let refCounter = 0;

/** An `attempting` payment on a fresh working order, as a crash would leave it. */
async function stuckPayment(
  provider = "stripe",
  workingOrderId?: string,
): Promise<{ paymentId: string; workingOrderId: string; paymentRef: string }> {
  const woId = workingOrderId ?? (await seedWorkingOrder(pg.db, freshNif())).workingOrderId;
  const paymentRef = `stuck-${++refCounter}`;
  return withTransaction(pg.db, async (tx) => {
    await insertAttempting(tx, {
      workingOrderId: woId,
      provider,
      paymentRef,
      amount: decimal("12.10"),
    });
    const row = await getPaymentByRef(tx, { provider, paymentRef });
    return { paymentId: row!.id, workingOrderId: woId, paymentRef };
  });
}

function record(
  p: { paymentId: string; workingOrderId: string },
  over: Partial<Parameters<typeof recordResolution>[1]> = {},
) {
  return withTransaction(pg.db, (tx) =>
    recordResolution(tx, {
      paymentId: p.paymentId,
      workingOrderId: p.workingOrderId,
      personId: MANAGER,
      outcome: "failed",
      cancelledAtProvider: true,
      providerStatus: "requires_payment_method",
      resolvedAt: RESOLVED_AT,
      ...over,
    }),
  );
}

function countFor(workingOrderId: string, provider?: string): Promise<number> {
  return withTransaction(pg.db, (tx) =>
    countProviderCancelledResolutions(tx, {
      workingOrderId,
      ...(provider === undefined ? {} : { provider }),
    }),
  );
}

describe("recordResolution", () => {
  it("writes one audit row carrying what the manager's resolution decided", async () => {
    const p = await stuckPayment();
    const { id } = await record(p);
    const { rows } = await pg.db.execute<Record<string, unknown>>(
      sql`select payment_id, working_order_id, person_id, outcome, cancelled_at_provider,
                 provider_status, resolved_at
            from payment_resolutions where id = ${id}`,
    );
    expect(rows).toEqual([
      {
        payment_id: p.paymentId,
        working_order_id: p.workingOrderId,
        person_id: MANAGER,
        outcome: "failed",
        cancelled_at_provider: 1,
        provider_status: "requires_payment_method",
        resolved_at: RESOLVED_AT.toISOString(),
      },
    ]);
  });

  it("stores a resolution with no provider status as null", async () => {
    const p = await stuckPayment();
    const { id } = await record(p, {
      outcome: "captured",
      cancelledAtProvider: false,
      providerStatus: null,
    });
    const { rows } = await pg.db.execute<{ provider_status: string | null }>(
      sql`select provider_status from payment_resolutions where id = ${id}`,
    );
    expect(rows).toEqual([{ provider_status: null }]);
  });

  it("refuses a payment id that names no payment", async () => {
    const p = await stuckPayment();
    const error = await captureError(() =>
      record({ ...p, paymentId: "99999999-9999-4999-8999-999999999999" }),
    );
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("refuses a second resolution of the same payment", async () => {
    const p = await stuckPayment();
    await record(p);
    const error = await captureError(() =>
      record(p, { outcome: "captured", cancelledAtProvider: false }),
    );
    // SQLite names the columns that collided, not the index.
    expect(
      refusalOn(error, UNIQUE_VIOLATION, { table: "payment_resolutions", columns: ["payment_id"] }),
    ).toBe(true);
  });

  it("refuses an outcome that changed nothing: only captured and failed are recorded", async () => {
    const p = await stuckPayment();
    const error = await captureError(() =>
      record(p, { outcome: "unknown" as "failed", cancelledAtProvider: false }),
    );
    expect(checkFailed(error, "payment_resolutions_outcome_ck")).toBe(true);
  });

  it("refuses a captured resolution that claims the provider cancelled the payment", async () => {
    const p = await stuckPayment();
    const error = await captureError(() =>
      record(p, { outcome: "captured", cancelledAtProvider: true }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(error, "payment_resolutions_cancelled_ck")).toBe(true);
  });

  it("is append-only: an update and a delete are both refused", async () => {
    const p = await stuckPayment();
    const { id } = await record(p);
    const update = await captureError(() =>
      pg.db.execute(sql`update payment_resolutions set outcome = 'captured' where id = ${id}`),
    );
    expect(triggerRaised(update, "payment_resolutions is append-only")).toBe(true);
    const remove = await captureError(() =>
      pg.db.execute(sql`delete from payment_resolutions where id = ${id}`),
    );
    expect(triggerRaised(remove, "payment_resolutions is append-only")).toBe(true);
  });
});

describe("recordAttemptResolution", () => {
  it("records the resolution against the payment the key names and that payment's order", async () => {
    const p = await stuckPayment("stripe");
    const { id } = await withTransaction(pg.db, (tx) =>
      recordAttemptResolution(
        tx,
        { provider: "stripe", paymentRef: p.paymentRef },
        {
          personId: MANAGER,
          outcome: "captured",
          cancelledAtProvider: false,
          providerStatus: "succeeded",
          resolvedAt: RESOLVED_AT,
        },
      ),
    );
    const { rows } = await pg.db.execute<Record<string, unknown>>(
      sql`select payment_id, working_order_id from payment_resolutions where id = ${id}`,
    );
    expect(rows).toEqual([{ payment_id: p.paymentId, working_order_id: p.workingOrderId }]);
  });

  it("refuses payment.not_found for a key that names no payment", async () => {
    const p = await stuckPayment("stripe");
    const error = await captureError(() =>
      withTransaction(pg.db, (tx) =>
        recordAttemptResolution(
          tx,
          { provider: "sumup", paymentRef: p.paymentRef },
          {
            personId: MANAGER,
            outcome: "failed",
            cancelledAtProvider: false,
            providerStatus: null,
            resolvedAt: RESOLVED_AT,
          },
        ),
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.not_found");
    expect((error as AppError).params).toEqual({ provider: "sumup", paymentRef: p.paymentRef });
  });
});

describe("countProviderCancelledResolutions", () => {
  it("is zero for an order with no resolution", async () => {
    const p = await stuckPayment();
    expect(await countFor(p.workingOrderId)).toBe(0);
  });

  it("counts only this order's resolutions that left the payment cancelled at the provider", async () => {
    const p = await stuckPayment();
    await record(p, { cancelledAtProvider: true });
    const second = await stuckPayment("stripe", p.workingOrderId);
    await record(second, { cancelledAtProvider: true });
    const third = await stuckPayment("stripe", p.workingOrderId);
    await record(third, { cancelledAtProvider: false, providerStatus: null });
    const captured = await stuckPayment("stripe", p.workingOrderId);
    await record(captured, { outcome: "captured", cancelledAtProvider: false });
    const otherOrder = await stuckPayment();
    await record(otherOrder, { cancelledAtProvider: true });

    expect(await countFor(p.workingOrderId)).toBe(2);
  });

  it("counts only the named provider's payments when a provider is given", async () => {
    const p = await stuckPayment("stripe");
    await record(p, { cancelledAtProvider: true });
    const other = await stuckPayment("fake", p.workingOrderId);
    await record(other, { cancelledAtProvider: true });

    expect(await countFor(p.workingOrderId, "stripe")).toBe(1);
    expect(await countFor(p.workingOrderId, "fake")).toBe(1);
    expect(await countFor(p.workingOrderId, "sumup")).toBe(0);
    expect(await countFor(p.workingOrderId)).toBe(2);
  });
});
