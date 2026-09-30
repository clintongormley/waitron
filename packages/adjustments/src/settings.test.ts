import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
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
    await db.execute<{ id: number; max_bill_discount: number | null }>(
      sql`select id, max_bill_discount from adjustment_settings`,
    )
  ).rows;
}

describe("adjustment settings", () => {
  it("answers no limit when the venue has never saved one", async () => {
    expect(await inTx(readAdjustmentSettings)).toEqual({ maxBillDiscountBp: null });
  });

  it("saves a limit, replaces it and clears it, keeping one row", async () => {
    expect(await inTx((tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: 4000 }))).toEqual({
      maxBillDiscountBp: 4000,
    });
    expect(await inTx(readAdjustmentSettings)).toEqual({ maxBillDiscountBp: 4000 });

    await inTx((tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: 10000 }));
    expect(await rows()).toEqual([{ id: 1, max_bill_discount: 10000 }]);

    await inTx((tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: null }));
    expect(await inTx(readAdjustmentSettings)).toEqual({ maxBillDiscountBp: null });
    expect(await rows()).toEqual([{ id: 1, max_bill_discount: null }]);
  });

  it("moves the row's timestamp on each save", async () => {
    await inTx((tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: 1 }));
    const first = (
      await db.execute<{ updated_at: string }>(sql`select updated_at from adjustment_settings`)
    ).rows[0]!.updated_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await inTx((tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: 2 }));
    const second = (
      await db.execute<{ updated_at: string }>(sql`select updated_at from adjustment_settings`)
    ).rows[0]!.updated_at;
    expect(second > first).toBe(true);
  });

  it("refuses a limit that is not a whole count of basis points from 1 to 10000, writing nothing", async () => {
    for (const bad of [0, 10001, 12.5, -1, Number.NaN]) {
      await expect(
        inTx((tx) => saveAdjustmentSettings(tx, { maxBillDiscountBp: bad })),
        String(bad),
      ).rejects.toThrow(RangeError);
    }
    expect(await rows()).toEqual([]);
  });
});
