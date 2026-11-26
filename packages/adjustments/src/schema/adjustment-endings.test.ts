import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  captureError,
  checkFailed,
  CORE_MIGRATIONS,
  refusalOn,
  UNIQUE_VIOLATION,
  withTransaction,
  type Database,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { seedPerson } from "@waitron/db/testing/seed.js";
import { decimal } from "@waitron/shared";
import { policySnapshotOf } from "../policy.js";
import { recordAdjustment } from "../record.js";
import { seedReason, seedWorkingOrder } from "../../test/seed.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

const WAITER = "11111111-1111-4111-8111-111111111111";

/** A 10% discount on a row of three €10.00 dishes, and the bill it is on. */
async function discount(): Promise<{ adjustmentId: string; workingOrderId: string }> {
  await seedPerson(db, { id: WAITER, displayName: "Waiter" });
  const workingOrderId = await seedWorkingOrder(db);
  const reason = await seedReason(db);
  const adjustmentId = await withTransaction(db, (tx) =>
    recordAdjustment(tx, {
      workingOrderId,
      line: {
        id: randomUUID(),
        name: "Burger",
        quantity: "3",
        listUnitPriceGross: decimal("10.00"),
        creditedTo: WAITER,
        stage: "fired",
      },
      quantity: "3",
      reason: {
        id: reason.id,
        name: reason.name,
        policy: policySnapshotOf(reason, { maxBillComp: null }),
      },
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
  return { adjustmentId, workingOrderId };
}

async function cover(adjustmentId: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`insert into adjustment_lines (id, adjustment_id, line_id, reduction, quantity) values (${id}, ${adjustmentId}, ${randomUUID()}, 100, 1000)`,
  );
  return id;
}

async function end(
  on: { adjustmentId: string; workingOrderId: string },
  why: string,
  lineId: string | null,
): Promise<string> {
  const id = randomUUID();
  await db.run(
    sql`insert into adjustment_endings (id, adjustment_id, working_order_id, why, dish_name, line_id, ended_at) values (${id}, ${on.adjustmentId}, ${on.workingOrderId}, ${why}, ${"Burger"}, ${lineId}, ${new Date().toISOString()})`,
  );
  return id;
}

function giveBack(endingId: string, adjustmentLineId: string) {
  return db.run(
    sql`insert into adjustment_ending_lines (id, ending_id, adjustment_line_id) values (${randomUUID()}, ${endingId}, ${adjustmentLineId})`,
  );
}

async function endingsOf(adjustmentId: string): Promise<number> {
  const rows = await db.all<{ n: number }>(
    sql`select count(*) as n from adjustment_endings where adjustment_id = ${adjustmentId}`,
  );
  return rows[0]!.n;
}

describe("A1515-3 endings: the comps and discounts that came off a bill", () => {
  it("A1515-3 endings: a changed dish's ending may name the line it is offered again on", async () => {
    const on = await discount();
    await end(on, "extras_changed", randomUUID());
    await end(on, "variant_changed", randomUUID());
    await end(on, "dish_cancelled", null);
    expect(await endingsOf(on.adjustmentId)).toBe(3);
  });

  it("A1515-3 endings: any other ending naming a line is refused", async () => {
    const on = await discount();
    const refused = await captureError(() => end(on, "dish_cancelled", randomUUID()));
    expect(checkFailed(refused, "adjustment_endings_line_ck")).toBe(true);
    expect(await endingsOf(on.adjustmentId)).toBe(0);
  });

  it("A1515-3 endings: each covered row is given back once, by whichever ending comes first", async () => {
    const on = await discount();
    const row = await cover(on.adjustmentId);
    const other = await cover(on.adjustmentId);
    const first = await end(on, "dish_moved", null);
    const second = await end(on, "dish_moved", null);
    await giveBack(first, row);
    await giveBack(second, other);

    const twice = await captureError(() => giveBack(second, row));
    expect(
      refusalOn(twice, UNIQUE_VIOLATION, {
        table: "adjustment_ending_lines",
        columns: ["adjustment_line_id"],
      }),
    ).toBe(true);
  });
});
