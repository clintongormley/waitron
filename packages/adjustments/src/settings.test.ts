import { seedPersons } from "@waitron/identity/test/person-rows.js";
import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS, withTransaction, type Database, type Transaction } from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import { decimal } from "@waitron/shared";
import {
  ADJUSTMENTS_SETTINGS,
  readAdjustmentSettings,
  saveAdjustmentSettings,
} from "./settings.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });

let db: Database;
beforeAll(() => {
  db = suite.db;
});

function inTx<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return withTransaction(db, fn);
}

async function rows() {
  return (
    await db.execute<{ doc: string; revision: number }>(
      sql`select doc, revision from settings where module = 'adjustments'`,
    )
  ).rows;
}

describe("adjustment settings", () => {
  it("answers no limit when the venue has never saved one", async () => {
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: null,

      revision: 0,
    });
  });

  it("answers each read of the unsaved settings with its own value", async () => {
    const first = await inTx(readAdjustmentSettings);
    first.maxBillComp = decimal("1.00");
    expect((await inTx(readAdjustmentSettings)).maxBillComp).toBeNull();
  });

  it("saves €40.00 replaces it and clears it, keeping one row", async () => {
    expect(
      await inTx((tx) =>
        saveAdjustmentSettings(
          tx,
          {
            maxBillComp: decimal("40.00"),
          },
          { expectedRevision: 0, personId: null },
        ),
      ),
    ).toEqual({ maxBillComp: "40.00", revision: 1 });
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: "40.00",

      revision: 1,
    });

    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: decimal("12.5") },
        { expectedRevision: 1, personId: null },
      ),
    );
    expect(await rows()).toEqual([{ doc: '{"maxBillComp":1250}', revision: 2 }]);

    await inTx((tx) =>
      saveAdjustmentSettings(tx, { maxBillComp: null }, { expectedRevision: 2, personId: null }),
    );
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: null,

      revision: 3,
    });
    expect(await rows()).toEqual([{ doc: '{"maxBillComp":null}', revision: 3 }]);
  });

  it("moves the row's timestamp on each save", async () => {
    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: decimal("1.00") },
        { expectedRevision: 0, personId: null },
      ),
    );
    const first = (
      await db.execute<{ updated_at: string }>(
        sql`select updated_at from settings where module = 'adjustments'`,
      )
    ).rows[0]!.updated_at;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: decimal("2.00") },
        { expectedRevision: 1, personId: null },
      ),
    );
    const second = (
      await db.execute<{ updated_at: string }>(
        sql`select updated_at from settings where module = 'adjustments'`,
      )
    ).rows[0]!.updated_at;
    expect(second > first).toBe(true);
  });

  it("refuses an amount that is not a nonnegative count of whole cents, writing nothing", async () => {
    for (const bad of ["-1.00", "1.005"]) {
      await expect(
        inTx((tx) =>
          saveAdjustmentSettings(
            tx,
            { maxBillComp: decimal(bad) },
            { expectedRevision: 0, personId: null },
          ),
        ),
        bad,
      ).rejects.toThrow(RangeError);
    }
    expect(await rows()).toEqual([]);
  });

  it("a zero bill limit round-trips", async () => {
    expect(
      await inTx((tx) =>
        saveAdjustmentSettings(
          tx,
          { maxBillComp: decimal("0.00") },
          { expectedRevision: 0, personId: null },
        ),
      ),
    ).toEqual({ maxBillComp: "0.00", revision: 1 });
    expect(await inTx(readAdjustmentSettings)).toEqual({ maxBillComp: "0.00", revision: 1 });
    expect(await rows()).toEqual([{ doc: '{"maxBillComp":0}', revision: 1 }]);
  });
});

describe("the adjustments document", () => {
  it("keeps the amount rules when checking a document", () => {
    const good = { maxBillComp: 4000 };
    for (const maxBillComp of [-100, 12.5, "40"]) {
      expect(ADJUSTMENTS_SETTINGS.parse({ ...good, maxBillComp })).toEqual({
        ok: false,
        field: "maxBillComp",
      });
    }
    expect(ADJUSTMENTS_SETTINGS.parse({ ...good, billApproverRoles: ["admin"] })).toEqual({
      ok: false,
      field: "billApproverRoles",
    });
    expect(ADJUSTMENTS_SETTINGS.parse({ ...good, colour: "blue" })).toEqual({
      ok: false,
      field: "colour",
    });
    for (const maxBillComp of [null, 0, 4000]) {
      const doc = { ...good, maxBillComp };
      expect(ADJUSTMENTS_SETTINGS.parse(doc)).toEqual({ ok: true, doc });
    }
  });
  it("refuses a save from a stale revision, keeping the first document", async () => {
    const first = {
      maxBillComp: decimal("40.00"),
    };
    await inTx((tx) => saveAdjustmentSettings(tx, first, { expectedRevision: 0, personId: null }));
    await expect(
      inTx((tx) =>
        saveAdjustmentSettings(
          tx,
          { ...first, maxBillComp: null },
          { expectedRevision: 0, personId: null },
        ),
      ),
    ).rejects.toMatchObject({
      code: "settings.out_of_date",
      params: { module: "adjustments", revision: 1 },
    });
    expect(await inTx(readAdjustmentSettings)).toEqual({ ...first, revision: 1 });
  });
  it("names the person who saved", async () => {
    const [person] = await seedPersons(db, { displayName: "Manager" });
    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: null },
        { expectedRevision: 0, personId: person!.id },
      ),
    );
    expect(
      db.execute(sql`select updated_by from settings where module = 'adjustments'`).rows,
    ).toEqual([{ updated_by: person!.id }]);
  });
});
