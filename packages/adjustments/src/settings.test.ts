import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { PersonRoleValue } from "@waitron/identity";
import { decimal } from "@waitron/shared";
import { ADJUSTMENTS_MIGRATIONS } from "./migrations.js";
import { readAdjustmentSettings, saveAdjustmentSettings } from "./settings.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS, ADJUSTMENTS_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function rows() {
  return (
    await db.execute<{ id: number; max_bill_comp: number | null; bill_approver_roles: string }>(
      sql`select id, max_bill_comp, bill_approver_roles from adjustment_settings`,
    )
  ).rows;
}

describe("adjustment settings", () => {
  it("answers no limit, approved past by Manager and Admin, when the venue has never saved one", async () => {
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: null,
      billApproverRoles: ["manager", "admin"],
    });
  });

  it("answers each read of the unsaved settings with its own list", async () => {
    const first = await inTx(readAdjustmentSettings);
    first.billApproverRoles.push("staff");
    expect((await inTx(readAdjustmentSettings)).billApproverRoles).toEqual(["manager", "admin"]);
  });

  it("saves €40.00 with Supervisor and Manager, replaces it and clears it, keeping one row", async () => {
    expect(
      await inTx((tx) =>
        saveAdjustmentSettings(tx, {
          maxBillComp: decimal("40.00"),
          billApproverRoles: ["supervisor", "manager"],
        }),
      ),
    ).toEqual({ maxBillComp: "40.00", billApproverRoles: ["supervisor", "manager"] });
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: "40.00",
      billApproverRoles: ["supervisor", "manager"],
    });

    await inTx((tx) =>
      saveAdjustmentSettings(tx, { maxBillComp: decimal("12.5"), billApproverRoles: ["admin"] }),
    );
    expect(await rows()).toEqual([
      { id: 1, max_bill_comp: 1250, bill_approver_roles: '["admin"]' },
    ]);

    await inTx((tx) =>
      saveAdjustmentSettings(tx, { maxBillComp: null, billApproverRoles: ["manager"] }),
    );
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: null,
      billApproverRoles: ["manager"],
    });
    expect(await rows()).toEqual([
      { id: 1, max_bill_comp: null, bill_approver_roles: '["manager"]' },
    ]);
  });

  it("moves the row's timestamp on each save", async () => {
    await inTx((tx) =>
      saveAdjustmentSettings(tx, { maxBillComp: decimal("1.00"), billApproverRoles: ["admin"] }),
    );
    const first = (
      await db.execute<{ updated_at: string }>(sql`select updated_at from adjustment_settings`)
    ).rows[0]!.updated_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await inTx((tx) =>
      saveAdjustmentSettings(tx, { maxBillComp: decimal("2.00"), billApproverRoles: ["admin"] }),
    );
    const second = (
      await db.execute<{ updated_at: string }>(sql`select updated_at from adjustment_settings`)
    ).rows[0]!.updated_at;
    expect(second > first).toBe(true);
  });

  it("refuses an amount that is not a positive count of whole cents, writing nothing", async () => {
    for (const bad of ["0", "0.00", "-1.00", "1.005"]) {
      await expect(
        inTx((tx) =>
          saveAdjustmentSettings(tx, { maxBillComp: decimal(bad), billApproverRoles: ["admin"] }),
        ),
        bad,
      ).rejects.toThrow(RangeError);
    }
    expect(await rows()).toEqual([]);
  });

  it("refuses an approver list that is empty, repeats a role or names none, writing nothing", async () => {
    for (const bad of [[], ["manager", "manager"], ["chef"]] as PersonRoleValue[][]) {
      await expect(
        inTx((tx) => saveAdjustmentSettings(tx, { maxBillComp: null, billApproverRoles: bad })),
        JSON.stringify(bad),
      ).rejects.toThrow(RangeError);
    }
    expect(await rows()).toEqual([]);
  });
});
