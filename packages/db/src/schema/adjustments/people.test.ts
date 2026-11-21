import { beforeEach, describe, expect, it } from "vitest";
import { CORE_MIGRATIONS } from "../../migrations.js";
import { FOREIGN_KEY_VIOLATION } from "../../sql-state.js";
import { captureError } from "../../testing/errors.js";
import { seedPerson, seedVenue, seedWorkingOrder } from "../../testing/seed.js";
import { useVenueDb } from "../../testing/venue-db.js";
import { isRefusal } from "../../unique-violation.js";
import { adjustments } from "./adjustments.js";

const suite = useVenueDb({ migrations: [CORE_MIGRATIONS] });
let adjustment: typeof adjustments.$inferInsert;

beforeEach(async () => {
  const { db } = suite;
  await seedVenue(db, { name: "Dining room", invoiceLocales: ["es"] });
  const order = await seedWorkingOrder(db);
  adjustment = {
    workingOrderId: order.id,
    lineId: "line",
    lineName: "Chicken",
    lineQuantity: 1000,
    lineListUnitPrice: 1500,
    splits: [],
    reasonId: "complaint",
    reasonName: "Complaint",
    policySnapshot: {
      kind: "comp",
      actions: ["comp"],
      maxBillComp: null,
      maxPercentBp: null,
      maxAmount: null,
      noteRequired: false,
    },
    action: "comp",
    quantity: 1000,
    beforeAmount: 1500,
    afterAmount: 0,
    reduction: 1500,
    nominalValue: 1500,
    stage: "served",
    requestedBy: await seedPerson(db, { displayName: "Requester" }),
    approvedBy: await seedPerson(db, { displayName: "Approver" }),
    creditedTo: await seedPerson(db, { displayName: "Server" }),
  };
});

function write(row: typeof adjustments.$inferInsert) {
  return suite.db.insert(adjustments).values(row).returning({
    requestedBy: adjustments.requestedBy,
    approvedBy: adjustments.approvedBy,
    creditedTo: adjustments.creditedTo,
  });
}

describe("adjustment people", () => {
  it("records the requester, approver and credited person", async () => {
    const { requestedBy, approvedBy, creditedTo } = adjustment;
    expect(await write(adjustment)).toEqual([{ requestedBy, approvedBy, creditedTo }]);
  });

  it.each(["requestedBy", "approvedBy", "creditedTo"] as const)(
    "refuses an absent person in %s",
    async (column) => {
      const error = await captureError(() => write({ ...adjustment, [column]: "missing" }));
      expect(isRefusal(error, FOREIGN_KEY_VIOLATION)).toBe(true);
    },
  );

  it("allows an adjustment without an approver and credited person", async () => {
    expect(await write({ ...adjustment, approvedBy: null, creditedTo: null })).toEqual([
      { requestedBy: adjustment.requestedBy, approvedBy: null, creditedTo: null },
    ]);
  });
});
