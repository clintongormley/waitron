import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentByRef, insertCapturedPayment } from "./store.js";
import { listOpenHolds, recordHold, recordHoldOutcome } from "./holds.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const MANAGER = "22222222-2222-4222-8222-222222222222";
const NO_HOLD = "99999999-9999-4999-8999-999999999999";
const SETTLED = new Date("2026-10-17T20:30:00.000Z");

let refCounter = 0;

async function aCapturedPayment(amount = "12.10") {
  const { workingOrderId, deviceId } = await seedWorkingOrder(suite.db, freshNif());
  const paymentRef = `held-${++refCounter}`;
  const paymentId = await withTransaction(suite.db, async (tx) => {
    await insertCapturedPayment(tx, {
      origin: deviceOrigin(deviceId),
      workingOrderId,
      provider: "stripe",
      paymentRef,
      amount: decimal(amount),
      settledAt: SETTLED,
    });
    return (await getPaymentByRef(tx, { provider: "stripe", paymentRef }))!.id;
  });
  return { paymentId, paymentRef, workingOrderId };
}

async function holdRows(paymentId: string) {
  const { rows } = await suite.db.execute(
    sql`select provider_amount, found_at from payment_holds where payment_id = ${paymentId}`,
  );
  return rows;
}

describe("recordHold", () => {
  it("stores the provider's figure in whole cents and the moment it was found", async () => {
    const { paymentId } = await aCapturedPayment();
    const wrote = await withTransaction(suite.db, (tx) =>
      recordHold(tx, {
        paymentId,
        providerAmount: decimal("11.95"),
        foundAt: new Date("2026-10-18T01:00:00.000Z"),
      }),
    );
    expect(wrote).toBe(true);
    expect(await holdRows(paymentId)).toEqual([
      { provider_amount: 1195, found_at: "2026-10-18T01:00:00.000Z" },
    ]);
  });

  it("writes nothing and does not throw for a payment already held", async () => {
    const { paymentId } = await aCapturedPayment();
    await withTransaction(suite.db, (tx) =>
      recordHold(tx, {
        paymentId,
        providerAmount: decimal("11.95"),
        foundAt: new Date("2026-10-18T01:00:00.000Z"),
      }),
    );
    const second = await withTransaction(suite.db, (tx) =>
      recordHold(tx, {
        paymentId,
        providerAmount: decimal("9.00"),
        foundAt: new Date("2026-10-19T01:00:00.000Z"),
      }),
    );
    expect(second).toBe(false);
    expect(await holdRows(paymentId)).toEqual([
      { provider_amount: 1195, found_at: "2026-10-18T01:00:00.000Z" },
    ]);
  });
});

describe("listOpenHolds", () => {
  it("lists holds oldest first with both amounts, and drops one once it has an outcome", async () => {
    const later = await aCapturedPayment("20.00");
    const earlier = await aCapturedPayment("12.10");
    await withTransaction(suite.db, async (tx) => {
      await recordHold(tx, {
        paymentId: later.paymentId,
        providerAmount: decimal("19.50"),
        foundAt: new Date("2026-10-19T01:00:00.000Z"),
      });
      await recordHold(tx, {
        paymentId: earlier.paymentId,
        providerAmount: decimal("11.95"),
        foundAt: new Date("2026-10-18T01:00:00.000Z"),
      });
    });

    const open = await withTransaction(suite.db, (tx) => listOpenHolds(tx));
    expect(open).toEqual([
      {
        holdId: expect.any(String),
        paymentId: earlier.paymentId,
        paymentRef: earlier.paymentRef,
        provider: "stripe",
        amount: "12.10",
        providerAmount: "11.95",
        settledAt: SETTLED.toISOString(),
        workingOrderId: earlier.workingOrderId,
        foundAt: "2026-10-18T01:00:00.000Z",
      },
      {
        holdId: expect.any(String),
        paymentId: later.paymentId,
        paymentRef: later.paymentRef,
        provider: "stripe",
        amount: "20.00",
        providerAmount: "19.50",
        settledAt: SETTLED.toISOString(),
        workingOrderId: later.workingOrderId,
        foundAt: "2026-10-19T01:00:00.000Z",
      },
    ]);

    await withTransaction(suite.db, (tx) =>
      recordHoldOutcome(tx, {
        holdId: open[0]!.holdId,
        outcome: "kept",
        note: null,
        personId: MANAGER,
        at: new Date("2026-10-19T10:00:00.000Z"),
      }),
    );
    const after = await withTransaction(suite.db, (tx) => listOpenHolds(tx));
    expect(after.map((h) => h.paymentRef)).toEqual([later.paymentRef]);
  });
});

describe("recordHoldOutcome", () => {
  async function aHold(): Promise<string> {
    const { paymentId } = await aCapturedPayment();
    await withTransaction(suite.db, (tx) =>
      recordHold(tx, {
        paymentId,
        providerAmount: decimal("11.95"),
        foundAt: new Date("2026-10-18T01:00:00.000Z"),
      }),
    );
    return (await withTransaction(suite.db, (tx) => listOpenHolds(tx)))[0]!.holdId;
  }

  it("stores the outcome, the note, the manager and the moment", async () => {
    const holdId = await aHold();
    await withTransaction(suite.db, (tx) =>
      recordHoldOutcome(tx, {
        holdId,
        outcome: "refunded_at_provider",
        note: "Refunded 0.15 in Stripe",
        personId: MANAGER,
        at: new Date("2026-10-19T10:00:00.000Z"),
      }),
    );
    const { rows } = await suite.db.execute(
      sql`select outcome, note, person_id, recorded_at from payment_hold_outcomes
          where hold_id = ${holdId}`,
    );
    expect(rows).toEqual([
      {
        outcome: "refunded_at_provider",
        note: "Refunded 0.15 in Stripe",
        person_id: MANAGER,
        recorded_at: "2026-10-19T10:00:00.000Z",
      },
    ]);
  });

  it("refuses an unknown hold with payment.hold_not_found", async () => {
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        recordHoldOutcome(tx, {
          holdId: NO_HOLD,
          outcome: "kept",
          note: null,
          personId: MANAGER,
          at: new Date("2026-10-19T10:00:00.000Z"),
        }),
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.hold_not_found");
    expect((error as AppError).params).toEqual({ holdId: NO_HOLD });
  });

  it("refuses a second outcome with payment.hold_already_recorded and keeps the first", async () => {
    const holdId = await aHold();
    const first = {
      holdId,
      outcome: "kept" as const,
      note: null,
      personId: MANAGER,
      at: new Date("2026-10-19T10:00:00.000Z"),
    };
    await withTransaction(suite.db, (tx) => recordHoldOutcome(tx, first));
    const error = await captureError(() =>
      withTransaction(suite.db, (tx) =>
        recordHoldOutcome(tx, {
          ...first,
          outcome: "refunded_at_provider",
          note: "second try",
        }),
      ),
    );
    expect((error as AppError).code).toBe("payment.hold_already_recorded");
    expect((error as AppError).params).toEqual({ holdId });
    const { rows } = await suite.db.execute(
      sql`select outcome, note from payment_hold_outcomes where hold_id = ${holdId}`,
    );
    expect(rows).toEqual([{ outcome: "kept", note: null }]);
  });
});
