import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  CHECK_VIOLATION,
  CORE_MIGRATIONS,
  captureError,
  checkFailed,
  isRefusal,
  triggerRaised,
  withTransaction,
} from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { PAYMENT_CHANGE_REFUSAL } from "./trigger-refusals.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import type { NodeId } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { countProviderCancelledResolutions, recordAttemptResolution } from "./resolutions.js";
import { getPaymentByRef, insertAttempting } from "./store.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const MANAGER = "22222222-2222-4222-8222-222222222222";
const RESOLVED_AT = new Date("2026-09-26T12:00:00Z");

beforeEach(() => seedPerson(suite.db, { id: MANAGER, displayName: "Manager" }));

let refCounter = 0;

/** An `attempting` payment on a fresh working order, or on `on`'s, as a crash would leave it. */
async function stuckPayment(
  provider = "stripe",
  on?: { workingOrderId: string; deviceId: string; nodeId: NodeId },
): Promise<{
  paymentId: string;
  workingOrderId: string;
  deviceId: string;
  nodeId: NodeId;
  paymentRef: string;
  provider: string;
}> {
  const { workingOrderId, deviceId, nodeId } = on ?? (await seedWorkingOrder(suite.db, freshNif()));
  const paymentRef = `stuck-${++refCounter}`;
  return withTransaction(suite.db, async (tx) => {
    await insertAttempting(tx, {
      origin: deviceOrigin(deviceId),
      workingOrderId,
      nodeId,
      provider,
      paymentRef,
      amount: decimal("12.10"),
    });
    const row = await getPaymentByRef(tx, { provider, paymentRef });
    return { paymentId: row!.id, workingOrderId, deviceId, nodeId, paymentRef, provider };
  });
}

function record(
  p: { provider: string; paymentRef: string },
  over: Partial<Parameters<typeof recordAttemptResolution>[2]> = {},
) {
  return withTransaction(suite.db, (tx) =>
    recordAttemptResolution(tx, p, {
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
  return withTransaction(suite.db, (tx) =>
    countProviderCancelledResolutions(tx, {
      workingOrderId,
      ...(provider === undefined ? {} : { provider }),
    }),
  );
}

describe("payment resolution facts", () => {
  it("records an automatic resolution without inventing a manager", async () => {
    const automatic = await stuckPayment();
    const manual = await stuckPayment();
    await record(automatic, { personId: null });
    const automaticId = automatic.paymentId;
    await record(manual, { cancelledAtProvider: false });
    const manualId = manual.paymentId;
    const { rows } = await suite.db.execute(sql`
      select resolved_by as person_id, resolution_outcome as outcome, resolution_cancelled_at_provider as cancelled_at_provider, resolution_provider_status as provider_status, resolved_at
      from payments where id in (${automaticId}, ${manualId})
      order by case when id = ${automaticId} then 0 else 1 end`);
    expect(rows).toEqual([
      {
        person_id: null,
        outcome: "failed",
        cancelled_at_provider: 1,
        provider_status: "requires_payment_method",
        resolved_at: "2026-09-26T12:00:00.000Z",
      },
      {
        person_id: MANAGER,
        outcome: "failed",
        cancelled_at_provider: 0,
        provider_status: "requires_payment_method",
        resolved_at: "2026-09-26T12:00:00.000Z",
      },
    ]);
    expect(await countFor(automatic.workingOrderId, "stripe")).toBe(1);
    expect(await countFor(manual.workingOrderId, "stripe")).toBe(0);
  });

  it("stores what the manager's resolution decided on the payment", async () => {
    const p = await stuckPayment();
    await record(p);
    const id = p.paymentId;
    const { rows } = await suite.db.execute<Record<string, unknown>>(
      sql`select id as payment_id, working_order_id, resolved_by as person_id, resolution_outcome as outcome, resolution_cancelled_at_provider as cancelled_at_provider,
                 resolution_provider_status as provider_status, resolved_at
            from payments where id = ${id}`,
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
    const id = p.paymentId;
    await record(p, {
      outcome: "captured",
      cancelledAtProvider: false,
      providerStatus: null,
    });
    const { rows } = await suite.db.execute<{ provider_status: string | null }>(
      sql`select resolution_provider_status as provider_status from payments where id = ${id}`,
    );
    expect(rows).toEqual([{ provider_status: null }]);
  });

  it("refuses a second resolution of the same payment", async () => {
    const p = await stuckPayment();
    await record(p);
    const error = await captureError(() =>
      record(p, { outcome: "captured", cancelledAtProvider: false }),
    );
    expect(triggerRaised(error, PAYMENT_CHANGE_REFUSAL)).toBe(true);
  });

  it("refuses an outcome that changed nothing: only captured and failed are recorded", async () => {
    const p = await stuckPayment();
    const error = await captureError(() =>
      record(p, { outcome: "unknown" as "failed", cancelledAtProvider: false }),
    );
    expect(checkFailed(error, "payments_resolution_outcome_ck")).toBe(true);
  });

  it("refuses a captured resolution that claims the provider cancelled the payment", async () => {
    const p = await stuckPayment();
    const error = await captureError(() =>
      record(p, { outcome: "captured", cancelledAtProvider: true }),
    );
    expect(isRefusal(error, CHECK_VIOLATION)).toBe(true);
    expect(checkFailed(error, "payments_resolution_cancelled_ck")).toBe(true);
  });
});

describe("recordAttemptResolution", () => {
  it("records the resolution against the payment the key names and that payment's order", async () => {
    const p = await stuckPayment("stripe");
    await withTransaction(suite.db, (tx) =>
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
    const { rows } = await suite.db.execute<Record<string, unknown>>(
      sql`select id as payment_id, working_order_id from payments where id = ${p.paymentId}`,
    );
    expect(rows).toEqual([{ payment_id: p.paymentId, working_order_id: p.workingOrderId }]);
  });

  it("refuses payment.not_found for a key that names no payment", async () => {
    const p = await stuckPayment("stripe");
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
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
    const second = await stuckPayment("stripe", p);
    await record(second, { cancelledAtProvider: true });
    const third = await stuckPayment("stripe", p);
    await record(third, { cancelledAtProvider: false, providerStatus: null });
    const captured = await stuckPayment("stripe", p);
    await record(captured, { outcome: "captured", cancelledAtProvider: false });
    const otherOrder = await stuckPayment();
    await record(otherOrder, { cancelledAtProvider: true });

    expect(await countFor(p.workingOrderId)).toBe(2);
  });

  it("counts only the named provider's payments when a provider is given", async () => {
    const p = await stuckPayment("stripe");
    await record(p, { cancelledAtProvider: true });
    const other = await stuckPayment("fake", p);
    await record(other, { cancelledAtProvider: true });

    expect(await countFor(p.workingOrderId, "stripe")).toBe(1);
    expect(await countFor(p.workingOrderId, "fake")).toBe(1);
    expect(await countFor(p.workingOrderId, "sumup")).toBe(0);
    expect(await countFor(p.workingOrderId)).toBe(2);
  });
});
