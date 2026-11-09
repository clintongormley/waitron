import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CORE_MIGRATIONS,
  persons,
  withTransaction,
  type Database,
  type Transaction,
} from "@waitron/db";
import { useVenueDb } from "@waitron/db/testing/venue-db.js";
import type { PersonRoleValue } from "@waitron/identity";
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
  it("answers no limit, approved past by Manager and Admin, when the venue has never saved one", async () => {
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: null,
      billApproverRoles: ["manager", "admin"],
      revision: 0,
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
        saveAdjustmentSettings(
          tx,
          {
            maxBillComp: decimal("40.00"),
            billApproverRoles: ["supervisor", "manager"],
          },
          { expectedRevision: 0, personId: null },
        ),
      ),
    ).toEqual({ maxBillComp: "40.00", billApproverRoles: ["supervisor", "manager"], revision: 1 });
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: "40.00",
      billApproverRoles: ["supervisor", "manager"],
      revision: 1,
    });

    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: decimal("12.5"), billApproverRoles: ["admin"] },
        { expectedRevision: 1, personId: null },
      ),
    );
    expect(await rows()).toEqual([
      { doc: '{"maxBillComp":1250,"billApproverRoles":["admin"]}', revision: 2 },
    ]);

    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: null, billApproverRoles: ["manager"] },
        { expectedRevision: 2, personId: null },
      ),
    );
    expect(await inTx(readAdjustmentSettings)).toEqual({
      maxBillComp: null,
      billApproverRoles: ["manager"],
      revision: 3,
    });
    expect(await rows()).toEqual([
      { doc: '{"maxBillComp":null,"billApproverRoles":["manager"]}', revision: 3 },
    ]);
  });

  it("moves the row's timestamp on each save", async () => {
    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: decimal("1.00"), billApproverRoles: ["admin"] },
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
        { maxBillComp: decimal("2.00"), billApproverRoles: ["admin"] },
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

  it("refuses an amount that is not a positive count of whole cents, writing nothing", async () => {
    for (const bad of ["0", "0.00", "-1.00", "1.005"]) {
      await expect(
        inTx((tx) =>
          saveAdjustmentSettings(
            tx,
            { maxBillComp: decimal(bad), billApproverRoles: ["admin"] },
            { expectedRevision: 0, personId: null },
          ),
        ),
        bad,
      ).rejects.toThrow(RangeError);
    }
    expect(await rows()).toEqual([]);
  });

  it("refuses an approver list that is empty, repeats a role or names none, writing nothing", async () => {
    for (const bad of [[], ["manager", "manager"], ["chef"]] as PersonRoleValue[][]) {
      await expect(
        inTx((tx) =>
          saveAdjustmentSettings(
            tx,
            { maxBillComp: null, billApproverRoles: bad },
            { expectedRevision: 0, personId: null },
          ),
        ),
        JSON.stringify(bad),
      ).rejects.toThrow(RangeError);
    }
    expect(await rows()).toEqual([]);
  });
});

describe("the adjustments document", () => {
  it("keeps the amount and approver rules when checking a document", () => {
    const good = { maxBillComp: 4000, billApproverRoles: ["admin"] };
    for (const maxBillComp of [0, -100, 12.5, "40"]) {
      expect(ADJUSTMENTS_SETTINGS.parse({ ...good, maxBillComp })).toEqual({
        ok: false,
        field: "maxBillComp",
      });
    }
    for (const billApproverRoles of [[], ["manager", "manager"], ["owner"], undefined, "manager"]) {
      expect(ADJUSTMENTS_SETTINGS.parse({ ...good, billApproverRoles })).toEqual({
        ok: false,
        field: "billApproverRoles",
      });
    }
    expect(ADJUSTMENTS_SETTINGS.parse({ ...good, colour: "blue" })).toEqual({
      ok: false,
      field: "colour",
    });
    for (const maxBillComp of [null, 4000]) {
      const doc = { ...good, maxBillComp };
      expect(ADJUSTMENTS_SETTINGS.parse(doc)).toEqual({ ok: true, doc });
    }
  });
  it("refuses a save from a stale revision, keeping the first document", async () => {
    const first = {
      maxBillComp: decimal("40.00"),
      billApproverRoles: ["manager"] as PersonRoleValue[],
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
    const [person] = await db.insert(persons).values({ displayName: "Manager" }).returning();
    await inTx((tx) =>
      saveAdjustmentSettings(
        tx,
        { maxBillComp: null, billApproverRoles: ["manager"] },
        { expectedRevision: 0, personId: person!.id },
      ),
    );
    expect(
      db.execute(sql`select updated_by from settings where module = 'adjustments'`).rows,
    ).toEqual([{ updated_by: person!.id }]);
  });
});
