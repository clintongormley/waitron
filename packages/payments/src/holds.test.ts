import { beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { CORE_MIGRATIONS, captureError, withTransaction } from "@waitron/db";
import { seedPerson } from "@waitron/db/testing/seed.js";
import * as holds from "./holds.js";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { AppError, decimal, deviceOrigin } from "@waitron/shared";
import { PAYMENTS_MIGRATIONS } from "./migrations.js";
import { getPaymentByRef, insertCapturedPayment, markReconcileRemediated } from "./store.js";
import { listOpenHolds, recordHold, recordHoldOutcome } from "./holds.js";
import { freshNif, seedWorkingOrder } from "../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, PAYMENTS_MIGRATIONS] });

const MANAGER = "22222222-2222-4222-8222-222222222222";
const NO_HOLD = "99999999-9999-4999-8999-999999999999";
const SETTLED = new Date("2026-10-17T20:30:00.000Z");

beforeEach(() => seedPerson(suite.db, { id: MANAGER, displayName: "Manager" }));

let refCounter = 0;

async function aCapturedPayment(amount = "12.10") {
  const { workingOrderId, deviceId, nodeId } = await seedWorkingOrder(suite.db, freshNif());
  const paymentRef = `held-${++refCounter}`;
  const paymentId = await withTransaction(suite.db, async (tx) => {
    await insertCapturedPayment(tx, {
      origin: deviceOrigin(deviceId),
      workingOrderId,
      nodeId,
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
    sql`select hold_provider_amount as provider_amount, held_at as found_at from payments where id = ${paymentId} and held_at is not null`,
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
    expect(wrote).toBe("written");
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
    expect(second).toBe("existing");
    expect(await holdRows(paymentId)).toEqual([
      { provider_amount: 1195, found_at: "2026-10-18T01:00:00.000Z" },
    ]);
  });
});

describe("recordHold on a claimed payment", () => {
  it("refuses, and writes nothing, for a payment claimed for a refund", async () => {
    const { paymentId, paymentRef } = await aCapturedPayment();
    await withTransaction(suite.db, (tx) =>
      markReconcileRemediated(tx, {
        provider: "stripe",
        paymentRef,
        at: new Date("2026-10-18T00:30:00.000Z"),
      }),
    );
    const result = await withTransaction(suite.db, (tx) =>
      recordHold(tx, {
        paymentId,
        providerAmount: decimal("11.95"),
        foundAt: new Date("2026-10-18T01:00:00.000Z"),
      }),
    );
    expect(result).toBe("refused");
    expect(await holdRows(paymentId)).toEqual([]);
  });
});

describe("markReconcileRemediated on a held payment", () => {
  it("does not claim a payment that has a hold", async () => {
    const { paymentId, paymentRef } = await aCapturedPayment();
    await withTransaction(suite.db, (tx) =>
      recordHold(tx, {
        paymentId,
        providerAmount: decimal("11.95"),
        foundAt: new Date("2026-10-18T01:00:00.000Z"),
      }),
    );
    const claimed = await withTransaction(suite.db, (tx) =>
      markReconcileRemediated(tx, {
        provider: "stripe",
        paymentRef,
        at: new Date("2026-10-18T02:00:00.000Z"),
      }),
    );
    expect(claimed).toBe(false);
    const { rows } = await suite.db.execute(
      sql`select reconcile_remediated_at from payments where id = ${paymentId}`,
    );
    expect(rows).toEqual([{ reconcile_remediated_at: null }]);
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
        paymentId: earlier.paymentId,
        paymentRef: earlier.paymentRef,
        provider: "stripe",
        amount: "12.10",
        providerAmount: "11.95",
        settledAt: SETTLED.toISOString(),
        workingOrderId: earlier.workingOrderId,
        heldAt: "2026-10-18T01:00:00.000Z",
      },
      {
        paymentId: later.paymentId,
        paymentRef: later.paymentRef,
        provider: "stripe",
        amount: "20.00",
        providerAmount: "19.50",
        settledAt: SETTLED.toISOString(),
        workingOrderId: later.workingOrderId,
        heldAt: "2026-10-19T01:00:00.000Z",
      },
    ]);

    await withTransaction(suite.db, (tx) =>
      recordHoldOutcome(tx, {
        paymentId: open[0]!.paymentId,
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
    return (await withTransaction(suite.db, (tx) => listOpenHolds(tx)))[0]!.paymentId;
  }

  it("stores the outcome, the note, the manager and the moment", async () => {
    const paymentId = await aHold();
    await withTransaction(suite.db, (tx) =>
      recordHoldOutcome(tx, {
        paymentId,
        outcome: "refunded_at_provider",
        note: "Refunded 0.15 in Stripe",
        personId: MANAGER,
        at: new Date("2026-10-19T10:00:00.000Z"),
      }),
    );
    const { rows } = await suite.db.execute(
      sql`select hold_outcome as outcome, hold_note as note, hold_decided_by as person_id, hold_decided_at as recorded_at from payments
          where id = ${paymentId}`,
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
          paymentId: NO_HOLD,
          outcome: "kept",
          note: null,
          personId: MANAGER,
          at: new Date("2026-10-19T10:00:00.000Z"),
        }),
      ),
    );
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe("payment.hold_not_found");
    expect((error as AppError).params).toEqual({ paymentId: NO_HOLD });
  });

  it("refuses a second outcome with payment.hold_already_recorded and keeps the first", async () => {
    const paymentId = await aHold();
    const first = {
      paymentId,
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
    expect((error as AppError).params).toEqual({ paymentId });
    const { rows } = await suite.db.execute(
      sql`select hold_outcome as outcome, hold_note as note from payments where id = ${paymentId}`,
    );
    expect(rows).toEqual([{ outcome: "kept", note: null }]);
  });
});

it("refuses an outcome for a payment that was never held", async () => {
  const { paymentId } = await aCapturedPayment();
  await expect(
    withTransaction(suite.db, (tx) =>
      recordHoldOutcome(tx, {
        paymentId,
        outcome: "kept",
        note: null,
        personId: MANAGER,
        at: SETTLED,
      }),
    ),
  ).rejects.toMatchObject({ code: "payment.hold_not_found", params: { paymentId } });
});

it("the held list reads by index", async () => {
  const rows = await withTransaction(suite.db, (tx) =>
    tx.execute<{ detail: string }>(sql`explain query plan ${holds.openHoldsQuery(tx).getSQL()}`),
  );
  const details = rows.rows.map((row) => row.detail).join("\n");
  expect(details).toContain("USING INDEX payments_open_hold_idx");
  expect(details).not.toContain("SCAN payments");
});
