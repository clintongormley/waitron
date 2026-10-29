import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  CORE_MIGRATIONS,
  FOREIGN_KEY_VIOLATION,
  isRefusal,
  refusalOn,
  triggerRaised,
  UNIQUE_VIOLATION,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "../migrations.js";
import { policySnapshotOf } from "../policy.js";
import { recordAdjustment } from "../record.js";
import { seedReason, seedWorkingOrder } from "../../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const WAITER = "11111111-1111-4111-8111-111111111111";

/** A 10% discount on a row of three €10.00 dishes; returns the adjustment's id. */
async function discount(): Promise<string> {
  const order = await seedWorkingOrder(db);
  const reason = await seedReason(db);
  return withTransaction(db, (tx) =>
    recordAdjustment(tx, {
      workingOrderId: order,
      line: {
        id: randomUUID(),
        name: "Burger",
        quantity: "3",
        listUnitPriceGross: decimal("10.00"),
        creditedTo: WAITER,
        stage: "fired",
      },
      quantity: "3",
      reason: { id: reason.id, name: reason.name, policy: policySnapshotOf(reason) },
      action: "discount_percent",
      percentBp: 1000,
      beforeAmount: decimal("30.00"),
      afterAmount: decimal("27.00"),
      reduction: decimal("3.00"),
      nominalValue: decimal("3.00"),
      requestedBy: WAITER,
      approvedBy: null,
      note: null,
      chargeKept: true,
      preparationStarted: false,
      refundHandoff: false,
      refundValue: null,
    }),
  );
}

function cover(adjustmentId: string, lineId: string) {
  return db.run(
    sql`insert into adjustment_lines (id, adjustment_id, line_id, reduction, quantity) values (${randomUUID()}, ${adjustmentId}, ${lineId}, 100, 1000)`,
  );
}

describe("A803 portions: the lines each comp or discount covered", () => {
  it("A803 portions: a covered line naming a missing adjustment is refused", async () => {
    const error = await captureError(() => cover(randomUUID(), randomUUID()));
    expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
  });

  it("A803 portions: one line twice for one adjustment is refused", async () => {
    const adjustmentId = await discount();
    const line = randomUUID();
    await cover(adjustmentId, line);
    await cover(adjustmentId, randomUUID());
    const twice = await captureError(() => cover(adjustmentId, line));
    expect(
      refusalOn(twice, UNIQUE_VIOLATION, {
        table: "adjustment_lines",
        columns: ["adjustment_id", "line_id"],
      }),
    ).toBe(true);
  });

  it("A803 portions: rows refuse update, delete and insert-or-replace", async () => {
    const adjustmentId = await discount();
    await cover(adjustmentId, randomUUID());
    const raised = "adjustment_lines is append-only";
    const update = await captureError(() =>
      db.run(
        sql`update adjustment_lines set line_id = ${randomUUID()} where adjustment_id = ${adjustmentId}`,
      ),
    );
    expect(triggerRaised(update, raised)).toBe(true);
    const remove = await captureError(() =>
      db.run(sql`delete from adjustment_lines where adjustment_id = ${adjustmentId}`),
    );
    expect(triggerRaised(remove, raised)).toBe(true);
    const replace = await captureError(() =>
      db.run(
        sql`insert or replace into adjustment_lines select * from adjustment_lines where adjustment_id = ${adjustmentId}`,
      ),
    );
    expect(triggerRaised(replace, raised)).toBe(true);
  });
});
